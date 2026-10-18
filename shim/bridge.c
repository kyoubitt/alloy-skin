// alloyskin bridge: a small, allowlisted native channel for the injected page script.
// Alloy's CSP stops the page from talking to the internet, so CurseForge requests go through here:
//
//   window.webkit.messageHandlers.alloyskin.postMessage("<command>\n<arg>\n...")  ->  Promise<string>
//
//   CF GET  <path>          GET  https://api.curseforge.com<path>   (path must start with /v1/)
//   CF POST <path> <json>   POST https://api.curseforge.com<path>
//   DL <url> <dir> <name>   download a CurseForge CDN file into an instance's mods/resourcepacks/shaderpacks
//   FP <dir>                CurseForge fingerprints of the .jar files in an instance's mods folder
//   RM <dir> <name>         delete one file from those folders (used when replacing an updated mod)
//   PI <zip>                pull pack.png out of a resource pack zip into $ALLOY_SKIN_ICONS; replies with the png path
//   ATL <path>              GET https://download.nodecdn.net<path> (ATLauncher's pack list and pack files, under /containers/atl/)
//   UNZIP <zip> <instance>  unpack a downloaded pack zip (configs) into one instance folder
//   FTB <path>              GET https://api.modpacks.ch<path> (FTB's public modpack API, under /public/modpack/)
//   MSK <query>             GET https://api.mineskin.org/v2/skins<query> (MineSkin's public skin gallery)
//   DLI <url> <inst> <rel>  download a pack file to <instance>/<rel> (any subfolder inside that one instance)
//   SMOOTH 0|1              turn WebKit's smooth (gliding) wheel scrolling off or on
//   GEN                     how many times the skin scripts were swapped (the page reloads itself when it changes)
//   FXCOPY <file>           copy a GIF/MP4/WebM/PNG/WebP effect into $APPCONFIG/backgrounds/xmcl-fx (the only copy kept); replies with its path
//   PX <picture>            accent colours of a background picture in Alloy's backgrounds folder: "#vivid #dark"
//   MF <zip>                manifest.json of a CurseForge modpack zip downloaded into $ALLOY_SKIN_PACKS
//
// DL and RM also accept $ALLOY_SKIN_PACKS (modpack .zip files only), where packs wait for Alloy's own importer.
//
// The API key never reaches the page: curl reads it from $ALLOY_SKIN_CF_HEADERS ("x-api-key: ..." file).
// GLib/WebKit come from the copies Alloy already loaded (built against the 2.72 API, not linked).
#define GLIB_VERSION_MIN_REQUIRED GLIB_VERSION_2_72
#define GLIB_VERSION_MAX_ALLOWED GLIB_VERSION_2_72
#include <gio/gio.h>
#include <dlfcn.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef char *(*to_string_fn)(void *value);
typedef void *(*get_context_fn)(void *value);
typedef void *(*new_string_fn)(void *ctx, const char *s);
typedef void *(*reply_ref_fn)(void *reply);
typedef void (*reply_unref_fn)(void *reply);
typedef void (*reply_value_fn)(void *reply, void *value);
typedef void (*reply_error_fn)(void *reply, const char *message);
typedef gboolean (*register_fn)(void *mgr, const char *name, const char *world);

static to_string_fn js_to_string;
static get_context_fn js_context;
static new_string_fn js_new_string;
static reply_ref_fn reply_ref;
static reply_unref_fn reply_unref;
static reply_value_fn reply_value;
static reply_error_fn reply_error;

typedef struct {
    void *reply;
    void *ctx;
} Pending;

static void finish(Pending *p, const char *out, const char *err) {
    if (err) reply_error(p->reply, err);
    else reply_value(p->reply, js_new_string(p->ctx, out ? out : ""));
    reply_unref(p->reply);
    g_object_unref(p->ctx);
    g_free(p);
}

// ---------- path checks ----------

// the instance folder must live under Alloy's data dir and end in one of the content folders
static gboolean allowed_dir(const char *dir) {
    const char *data = getenv("ALLOY_SKIN_DATA");
    char real[PATH_MAX], root[PATH_MAX];
    if (!data || !dir || !realpath(dir, real) || !realpath(data, root)) return FALSE;
    size_t n = strlen(root);
    if (strncmp(real, root, n) != 0 || strncmp(real + n, "/instances/", 11) != 0) return FALSE;
    const char *base = strrchr(real, '/');
    return base && (!strcmp(base, "/mods") || !strcmp(base, "/resourcepacks") || !strcmp(base, "/shaderpacks"));
}

static gboolean allowed_name(const char *name) {
    return name && *name && !strchr(name, '/') && strcmp(name, ".") && strcmp(name, "..") && name[0] != '.';
}

// the modpack download folder; only .zip files go there
static gboolean is_packs_dir(const char *dir) {
    const char *packs = getenv("ALLOY_SKIN_PACKS");
    char real[PATH_MAX], root[PATH_MAX];
    return packs && dir && realpath(dir, real) && realpath(packs, root) && !strcmp(real, root);
}

// a freshly imported modpack may not have every content folder yet; create it if its instance exists
static void ensure_content_dir(const char *dir) {
    if (!dir || g_file_test(dir, G_FILE_TEST_IS_DIR)) return;
    const char *data = getenv("ALLOY_SKIN_DATA");
    char *parent = g_path_get_dirname(dir), *base = g_path_get_basename(dir);
    char real[PATH_MAX], root[PATH_MAX];
    if (data && realpath(parent, real) && realpath(data, root)) {
        size_t n = strlen(root);
        const char *rest = real + n;
        // parent must be exactly <data>/instances/<one folder>
        if (!strncmp(real, root, n) && !strncmp(rest, "/instances/", 11) && rest[11] && !strchr(rest + 11, '/') &&
            (!strcmp(base, "mods") || !strcmp(base, "resourcepacks") || !strcmp(base, "shaderpacks"))) {
            char *path = g_build_filename(real, base, NULL);
            mkdir(path, 0755);
            g_free(path);
        }
    }
    g_free(parent);
    g_free(base);
}

static gboolean allowed_target(const char *dir, const char *name) {
    if (!allowed_name(name)) return FALSE;
    if (is_packs_dir(dir)) return g_str_has_suffix(name, ".zip");
    return allowed_dir(dir);
}

// mod hosts: CurseForge's CDN, ATLauncher's CDN, Modrinth's CDN and GitHub release downloads
static gboolean allowed_url(const char *url) {
    static const char *const hosts[] = {"https://edge.forgecdn.net/", "https://mediafilez.forgecdn.net/", "https://download.nodecdn.net/containers/atl/",
                                        "https://cdn.modrinth.com/", "https://github.com/", "https://objects.githubusercontent.com/",
                                        "https://dist.modpacks.ch/", NULL};
    if (strpbrk(url, " \t\r\n")) return FALSE;
    for (int i = 0; hosts[i]; i++)
        if (g_str_has_prefix(url, hosts[i])) return TRUE;
    return FALSE;
}

// <data>/instances/<one folder>, resolved; NULL otherwise
static char *instance_root(const char *dir) {
    const char *data = getenv("ALLOY_SKIN_DATA");
    char real[PATH_MAX], root[PATH_MAX];
    if (!data || !dir || !realpath(dir, real) || !realpath(data, root)) return NULL;
    size_t n = strlen(root);
    const char *rest = real + n;
    if (strncmp(real, root, n) || strncmp(rest, "/instances/", 11) || !rest[11] || strchr(rest + 11, '/')) return NULL;
    return g_strdup(real);
}

// ---------- curl ----------

typedef struct {
    Pending *p;
    char *part, *dest; // downloads: rename part -> dest on success
} Job;

static void curl_done(GObject *src, GAsyncResult *res, gpointer data) {
    Job *job = data;
    char *out = NULL, *errout = NULL;
    GError *error = NULL;
    g_subprocess_communicate_utf8_finish(G_SUBPROCESS(src), res, &out, &errout, &error);
    gboolean ok = !error && g_subprocess_get_successful(G_SUBPROCESS(src));
    if (ok && job->dest && rename(job->part, job->dest) != 0) ok = FALSE;
    if (!ok && job->part) unlink(job->part);
    if (ok) finish(job->p, job->dest ? job->dest : out, NULL);
    else finish(job->p, NULL, error ? error->message : (errout && *errout ? errout : "request failed"));
    g_clear_error(&error);
    g_free(out);
    g_free(errout);
    g_free(job->part);
    g_free(job->dest);
    g_free(job);
    g_object_unref(src);
}

// runs curl (or unzip, for MF) without the AppImage's library path
static void run_curl(Job *job, const char *const *argv) {
    GError *error = NULL;
    // the AppImage points LD_LIBRARY_PATH at its bundled (older) libs; system curl needs the system ones
    GSubprocessLauncher *launcher = g_subprocess_launcher_new(G_SUBPROCESS_FLAGS_STDOUT_PIPE | G_SUBPROCESS_FLAGS_STDERR_PIPE);
    g_subprocess_launcher_unsetenv(launcher, "LD_LIBRARY_PATH");
    g_subprocess_launcher_unsetenv(launcher, "LD_PRELOAD");
    GSubprocess *proc = g_subprocess_launcher_spawnv(launcher, argv, &error);
    g_object_unref(launcher);
    if (!proc) {
        finish(job->p, NULL, error->message);
        g_error_free(error);
        g_free(job->part);
        g_free(job->dest);
        g_free(job);
        return;
    }
    g_subprocess_communicate_utf8_async(proc, NULL, NULL, curl_done, job);
}

static void cf_request(Pending *p, const char *method, const char *path, const char *body) {
    const char *headers = getenv("ALLOY_SKIN_CF_HEADERS");
    if (!headers || access(headers, R_OK) != 0) return finish(p, NULL, "No CurseForge API key yet. Get your own at console.curseforge.com and put the line \"x-api-key: YOUR_KEY\" in ~/.config/alloy-skin/curseforge.headers, then restart Alloy.");
    if (!g_str_has_prefix(path, "/v1/") || strpbrk(path, " \t\r\n")) return finish(p, NULL, "bad CurseForge path");
    char *url = g_strconcat("https://api.curseforge.com", path, NULL);
    char *hdr = g_strconcat("@", headers, NULL);
    Job *job = g_new0(Job, 1);
    job->p = p;
    if (!strcmp(method, "POST")) {
        const char *argv[] = {"/usr/bin/curl", "-sS", "--fail-with-body", "--max-time", "30", "-H", hdr, "-H", "Accept: application/json",
                              "-H", "Content-Type: application/json", "--data-binary", body ? body : "{}", url, NULL};
        run_curl(job, argv);
    } else {
        const char *argv[] = {"/usr/bin/curl", "-sS", "--fail-with-body", "--max-time", "30", "-H", hdr, "-H", "Accept: application/json", url, NULL};
        run_curl(job, argv);
    }
    g_free(url);
    g_free(hdr);
}

static void download(Pending *p, const char *url, const char *dir, const char *name) {
    if (!allowed_url(url)) return finish(p, NULL, "download URL is not on an allowed mod host");
    ensure_content_dir(dir);
    if (!allowed_target(dir, name)) return finish(p, NULL, "download target is outside the instance content folders");
    Job *job = g_new0(Job, 1);
    job->p = p;
    job->dest = g_build_filename(dir, name, NULL);
    job->part = g_strconcat(job->dest, ".part", NULL);
    const char *argv[] = {"/usr/bin/curl", "-sS", "--fail", "-L", "--proto-redir", "=https", "--max-time", "600", "-o", job->part, url, NULL};
    run_curl(job, argv);
}

static void remove_file(Pending *p, const char *dir, const char *name) {
    if (!allowed_target(dir, name)) return finish(p, NULL, "refusing to delete outside the instance content folders");
    char *path = g_build_filename(dir, name, NULL);
    int rc = unlink(path);
    g_free(path);
    finish(p, rc == 0 ? "ok" : NULL, rc == 0 ? NULL : "could not delete the file");
}

static void pack_manifest(Pending *p, const char *zip) {
    char *dir = g_path_get_dirname(zip), *name = g_path_get_basename(zip);
    gboolean ok = is_packs_dir(dir) && allowed_name(name) && g_str_has_suffix(name, ".zip");
    g_free(dir);
    g_free(name);
    if (!ok) return finish(p, NULL, "not a downloaded modpack");
    Job *job = g_new0(Job, 1);
    job->p = p;
    const char *argv[] = {"/usr/bin/unzip", "-p", zip, "manifest.json", NULL};
    run_curl(job, argv);
}

// resource pack icon: unzip pack.png into a per-pack temp folder, then move it to <icons>/pack-<hash>.png
static void pack_icon(Pending *p, const char *zip) {
    const char *icons = getenv("ALLOY_SKIN_ICONS");
    char *dir = g_path_get_dirname(zip), *name = g_path_get_basename(zip);
    gboolean ok = icons && allowed_dir(dir) && g_str_has_suffix(dir, "/resourcepacks") && allowed_name(name) && g_str_has_suffix(name, ".zip");
    g_free(dir);
    g_free(name);
    struct stat st;
    if (!ok || stat(zip, &st) != 0) return finish(p, NULL, "not a resource pack zip");
    char *key = g_strdup_printf("%s:%ld:%ld", zip, (long)st.st_mtime, (long)st.st_size);
    char *hash = g_compute_checksum_for_string(G_CHECKSUM_SHA1, key, -1);
    char *dest = g_strdup_printf("%s/pack-%.16s.png", icons, hash);
    char *tmp = g_strdup_printf("%s/.tmp-%.16s", icons, hash);
    g_free(key);
    g_free(hash);
    if (g_file_test(dest, G_FILE_TEST_EXISTS)) {
        finish(p, dest, NULL);
        g_free(dest);
        g_free(tmp);
        return;
    }
    Job *job = g_new0(Job, 1);
    job->p = p;
    job->dest = dest;
    job->part = g_strdup_printf("%s/pack.png", tmp);
    const char *argv[] = {"/usr/bin/unzip", "-o", "-j", "-q", zip, "pack.png", "-d", tmp, NULL};
    run_curl(job, argv);
    g_free(tmp);
}

static void atl_get(Pending *p, const char *path) {
    if (!g_str_has_prefix(path, "/containers/atl/") || strstr(path, "..") || path[strspn(path, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/-%+")])
        return finish(p, NULL, "bad ATLauncher path");
    char *url = g_strconcat("https://download.nodecdn.net", path, NULL);
    Job *job = g_new0(Job, 1);
    job->p = p;
    const char *argv[] = {"/usr/bin/curl", "-sS", "--fail", "--compressed", "--max-time", "30", url, NULL};
    run_curl(job, argv);
    g_free(url);
}

// read-only JSON from a fixed host and path prefix
static void api_get(Pending *p, const char *base, const char *prefix, const char *path) {
    if (!g_str_has_prefix(path, prefix) || strstr(path, "..") || path[strspn(path, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/-%+?=&")])
        return finish(p, NULL, "bad API path");
    char *url = g_strconcat(base, path, NULL);
    Job *job = g_new0(Job, 1);
    job->p = p;
    const char *argv[] = {"/usr/bin/curl", "-sS", "--fail", "--compressed", "--max-time", "30", "-A", "alloy-skin", url, NULL};
    run_curl(job, argv);
    g_free(url);
}

// a relative path that stays inside the folder it's joined to
static gboolean safe_rel(const char *rel) {
    if (!rel || !*rel || rel[0] == '/' || rel[strspn(rel, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/ -+()[]',!&@#")]) return FALSE;
    char **parts = g_strsplit(rel, "/", -1);
    gboolean ok = TRUE;
    for (int i = 0; parts[i]; i++)
        if (!*parts[i] || !strcmp(parts[i], ".") || !strcmp(parts[i], "..")) ok = FALSE;
    g_strfreev(parts);
    return ok;
}

// FTB packs ship configs and scripts in many subfolders; files may go anywhere inside the one instance
static void download_into(Pending *p, const char *url, const char *dir, const char *rel) {
    if (!allowed_url(url)) return finish(p, NULL, "download URL is not on an allowed mod host");
    char *root = instance_root(dir);
    if (!root || !safe_rel(rel)) {
        g_free(root);
        return finish(p, NULL, "download target is outside the instance");
    }
    char *dest = g_build_filename(root, rel, NULL), *parent = g_path_get_dirname(dest);
    g_mkdir_with_parents(parent, 0755);
    g_free(parent);
    g_free(root);
    Job *job = g_new0(Job, 1);
    job->p = p;
    job->dest = dest;
    job->part = g_strconcat(dest, ".part", NULL);
    const char *argv[] = {"/usr/bin/curl", "-sS", "--fail", "-L", "--proto-redir", "=https", "--max-time", "600", "-o", job->part, url, NULL};
    run_curl(job, argv);
}

// unzip refuses entries that climb out with ../ and strips leading slashes, so everything lands inside the instance
static void unzip_into(Pending *p, const char *zip, const char *dir) {
    char *zdir = g_path_get_dirname(zip), *zname = g_path_get_basename(zip);
    gboolean ok = is_packs_dir(zdir) && allowed_name(zname) && g_str_has_suffix(zname, ".zip");
    g_free(zdir);
    g_free(zname);
    char *root = ok ? instance_root(dir) : NULL;
    if (!root) return finish(p, NULL, "can only unpack a downloaded pack zip into an instance folder");
    Job *job = g_new0(Job, 1);
    job->p = p;
    const char *argv[] = {"/usr/bin/unzip", "-o", "-q", zip, "-d", root, NULL};
    run_curl(job, argv);
    g_free(root);
}

// ---------- fingerprints (CurseForge: MurmurHash2, seed 1, whitespace bytes skipped) ----------

static uint32_t cf_fingerprint(const unsigned char *buf, size_t size) {
    unsigned char *data = g_malloc(size ? size : 1);
    size_t n = 0;
    for (size_t i = 0; i < size; i++)
        if (buf[i] != 9 && buf[i] != 10 && buf[i] != 13 && buf[i] != 32) data[n++] = buf[i];
    const uint32_t m = 0x5bd1e995;
    uint32_t h = 1 ^ (uint32_t)n;
    size_t i = 0;
    for (; n - i >= 4; i += 4) {
        uint32_t k = data[i] | data[i + 1] << 8 | data[i + 2] << 16 | (uint32_t)data[i + 3] << 24;
        k *= m;
        k ^= k >> 24;
        k *= m;
        h *= m;
        h ^= k;
    }
    switch (n - i) {
    case 3: h ^= data[i + 2] << 16; /* fallthrough */
    case 2: h ^= data[i + 1] << 8;  /* fallthrough */
    case 1: h ^= data[i]; h *= m;
    }
    h ^= h >> 13;
    h *= m;
    h ^= h >> 15;
    g_free(data);
    return h;
}

typedef struct {
    Pending *p;
    char *dir;
    GString *out;
} FpJob;

static gboolean fp_reply(gpointer data) {
    FpJob *job = data;
    finish(job->p, job->out->str, NULL);
    g_string_free(job->out, TRUE);
    g_free(job->dir);
    g_free(job);
    return G_SOURCE_REMOVE;
}

// hashing ~100 jars takes a moment, so it runs off the UI thread; output is "name\tfingerprint" lines
static gpointer fp_thread(gpointer data) {
    FpJob *job = data;
    GDir *d = g_dir_open(job->dir, 0, NULL);
    for (const char *name; d && (name = g_dir_read_name(d));) {
        if (!g_str_has_suffix(name, ".jar")) continue;
        char *path = g_build_filename(job->dir, name, NULL), *buf = NULL;
        gsize size = 0;
        if (g_file_get_contents(path, &buf, &size, NULL)) g_string_append_printf(job->out, "%s\t%u\n", name, cf_fingerprint((unsigned char *)buf, size));
        g_free(buf);
        g_free(path);
    }
    if (d) g_dir_close(d);
    g_idle_add(fp_reply, job);
    return NULL;
}

static void fingerprints(Pending *p, const char *dir) {
    if (!allowed_dir(dir)) return finish(p, NULL, "not an instance content folder");
    FpJob *job = g_new0(FpJob, 1);
    job->p = p;
    job->dir = g_strdup(dir);
    job->out = g_string_new(NULL);
    g_thread_unref(g_thread_new("alloyskin-fp", fp_thread, job));
}


// ---------- PX: accent colour of a background picture ----------

typedef void *(*pixbuf_load_fn)(const char *path, int w, int h, gboolean keep, GError **err);
typedef int (*pixbuf_int_fn)(void *pb);
typedef unsigned char *(*pixbuf_px_fn)(void *pb);

typedef struct {
    Pending *p;
    char *path;
    char out[32];
} PxJob;

static gboolean px_reply(gpointer data) {
    PxJob *job = data;
    finish(job->p, job->out[0] ? job->out : NULL, job->out[0] ? NULL : "could not read picture");
    g_free(job->path);
    g_free(job);
    return G_SOURCE_REMOVE;
}

static void rgb_to_hsv(double r, double g, double b, double *h, double *s, double *v) {
    double mx = MAX(r, MAX(g, b)), mn = MIN(r, MIN(g, b)), d = mx - mn;
    *v = mx;
    *s = mx > 0 ? d / mx : 0;
    if (d <= 0) *h = 0;
    else if (mx == r) *h = fmod((g - b) / d + 6, 6) / 6;
    else if (mx == g) *h = ((b - r) / d + 2) / 6;
    else *h = ((r - g) / d + 4) / 6;
}

// the hue that most of the colourful pixels share (weighted by saturation x brightness), averaged
// over those pixels; plus the average colour of the dark pixels for tinting surfaces
static gpointer px_thread(gpointer data) {
    PxJob *job = data;
    pixbuf_load_fn load = (pixbuf_load_fn)dlsym(RTLD_DEFAULT, "gdk_pixbuf_new_from_file_at_scale");
    pixbuf_int_fn width = (pixbuf_int_fn)dlsym(RTLD_DEFAULT, "gdk_pixbuf_get_width");
    pixbuf_int_fn height = (pixbuf_int_fn)dlsym(RTLD_DEFAULT, "gdk_pixbuf_get_height");
    pixbuf_int_fn stride = (pixbuf_int_fn)dlsym(RTLD_DEFAULT, "gdk_pixbuf_get_rowstride");
    pixbuf_int_fn channels = (pixbuf_int_fn)dlsym(RTLD_DEFAULT, "gdk_pixbuf_get_n_channels");
    pixbuf_px_fn pixels = (pixbuf_px_fn)dlsym(RTLD_DEFAULT, "gdk_pixbuf_get_pixels");
    void *pb = load && width && height && stride && channels && pixels ? load(job->path, 64, 64, TRUE, NULL) : NULL;
    if (pb) {
        enum { BINS = 24 };
        double weight[BINS] = {0}, sum[BINS][3] = {{0}}, dark[3] = {0}, darkn = 0;
        int w = width(pb), h = height(pb), rs = stride(pb), nc = channels(pb);
        unsigned char *px = pixels(pb);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) {
                unsigned char *c = px + y * rs + x * nc;
                double r = c[0] / 255.0, g = c[1] / 255.0, b = c[2] / 255.0, hu, sa, va;
                rgb_to_hsv(r, g, b, &hu, &sa, &va);
                if (va < 0.35) { dark[0] += r; dark[1] += g; dark[2] += b; darkn++; }
                if (sa < 0.25 || va < 0.25) continue;
                int bin = (int)(hu * BINS) % BINS;
                double wt = sa * va * sa;
                weight[bin] += wt;
                sum[bin][0] += r * wt; sum[bin][1] += g * wt; sum[bin][2] += b * wt;
            }
        int best = -1;
        double bw = 0;
        for (int i = 0; i < BINS; i++) {
            // neighbours count too, so a hue split across two bins still wins
            double t = weight[i] + 0.5 * (weight[(i + 1) % BINS] + weight[(i + BINS - 1) % BINS]);
            if (t > bw) { bw = t; best = i; }
        }
        if (best >= 0 && weight[best] > 0 && bw > 0.4) {
            double r = sum[best][0] / weight[best], g = sum[best][1] / weight[best], b = sum[best][2] / weight[best];
            double hu, sa, va;
            rgb_to_hsv(r, g, b, &hu, &sa, &va);
            // push it to a usable button colour: vivid, not neon, readable with white text
            sa = MAX(sa, 0.55); va = CLAMP(va, 0.62, 0.82);
            double f = hu * 6, q = f - floor(f), P = va * (1 - sa), Q = va * (1 - sa * q), T = va * (1 - sa * (1 - q));
            int k = (int)floor(f) % 6;
            double rr[6] = {va, Q, P, P, T, va}, gg[6] = {T, va, va, Q, P, P}, bb[6] = {P, P, T, va, va, Q};
            int dr = darkn ? (int)(dark[0] / darkn * 255) : 0, dg = darkn ? (int)(dark[1] / darkn * 255) : 0, db = darkn ? (int)(dark[2] / darkn * 255) : 0;
            g_snprintf(job->out, sizeof job->out, "#%02x%02x%02x #%02x%02x%02x", (int)(rr[k] * 255), (int)(gg[k] * 255), (int)(bb[k] * 255), dr, dg, db);
        } else g_strlcpy(job->out, "none", sizeof job->out);
        g_object_unref(pb);
    }
    g_idle_add(px_reply, job);
    return NULL;
}

static void picture_accent(Pending *p, const char *path) {
    char real[PATH_MAX], root[PATH_MAX];
    char *dir = g_build_filename(g_get_user_config_dir(), "dev.steelaspect.alloy", "backgrounds", NULL);
    gboolean ok = realpath(path, real) && realpath(dir, root) && !strncmp(real, root, strlen(root)) && real[strlen(root)] == '/';
    g_free(dir);
    if (!ok) return finish(p, NULL, "not a background picture");
    PxJob *job = g_new0(PxJob, 1);
    job->p = p;
    job->path = g_strdup(real);
    g_thread_unref(g_thread_new("alloyskin-px", px_thread, job));
}


// ---------- FXCOPY: the user's own background effect ----------

typedef struct {
    Pending *p;
    char *dest;
} FxJob;

static void fx_copied(GObject *src, GAsyncResult *res, gpointer data) {
    FxJob *job = data;
    GError *err = NULL;
    if (g_file_copy_finish(G_FILE(src), res, &err)) finish(job->p, job->dest, NULL);
    else {
        finish(job->p, NULL, err ? err->message : "copy failed");
        g_clear_error(&err);
    }
    g_free(job->dest);
    g_free(job);
}

static void fx_copy(Pending *p, const char *src) {
    static const char *const exts[] = {".gif", ".mp4", ".webm", ".png", ".apng", ".webp", NULL};
    char *lower = g_ascii_strdown(src, -1);
    gboolean ok_ext = FALSE;
    for (int i = 0; exts[i]; i++) ok_ext |= g_str_has_suffix(lower, exts[i]);
    g_free(lower);
    struct stat st;
    if (!ok_ext || stat(src, &st) != 0 || !S_ISREG(st.st_mode)) return finish(p, NULL, "pick a GIF, MP4, WebM, PNG or WebP file");
    if (st.st_size > 200 * 1024 * 1024) return finish(p, NULL, "that file is over 200 MB");

    char *dir = g_build_filename(g_get_user_config_dir(), "dev.steelaspect.alloy", "backgrounds", "xmcl-fx", NULL);
    g_mkdir_with_parents(dir, 0700);
    // only the current effect is kept
    GDir *d = g_dir_open(dir, 0, NULL);
    for (const char *name; d && (name = g_dir_read_name(d));) {
        char *old = g_build_filename(dir, name, NULL);
        if (g_file_test(old, G_FILE_TEST_IS_REGULAR)) unlink(old);
        g_free(old);
    }
    if (d) g_dir_close(d);

    char *base = g_path_get_basename(src);
    for (char *c = base; *c; c++)
        // plain ASCII test: g_ascii_isalnum reads the g_ascii_table data symbol, which non-GLib programs
        // (sed, mkdir… started under LD_PRELOAD) can't resolve, so they'd fail to start
        if (!((*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9')) && *c != '.' && *c != '-' && *c != '_') *c = '_';
    char *name = g_strdup_printf("%" G_GINT64_FORMAT "-%s", g_get_real_time() / 1000000, base);
    FxJob *job = g_new0(FxJob, 1);
    job->p = p;
    job->dest = g_build_filename(dir, name, NULL);
    GFile *from = g_file_new_for_path(src), *to = g_file_new_for_path(job->dest);
    g_file_copy_async(from, to, G_FILE_COPY_OVERWRITE, G_PRIORITY_DEFAULT, NULL, NULL, NULL, fx_copied, job);
    g_object_unref(from);
    g_object_unref(to);
    g_free(name);
    g_free(base);
    g_free(dir);
}

// ---------- message handler ----------

extern int alloyskin_js_gen; // alloyskin.c
void alloyskin_set_smooth(int on); // alloyskin.c

static gboolean on_message(void *mgr, void *value, void *reply, gpointer user) {
    (void)mgr;
    (void)user;
    Pending *p = g_new0(Pending, 1);
    p->reply = reply_ref(reply);
    p->ctx = g_object_ref(js_context(value));
    char *msg = js_to_string(value);
    char **a = g_strsplit(msg ? msg : "", "\n", 5);
    guint n = g_strv_length(a);
    if (n >= 3 && !strcmp(a[0], "CF")) cf_request(p, a[1], a[2], n >= 4 ? a[3] : NULL);
    else if (n == 4 && !strcmp(a[0], "DL")) download(p, a[1], a[2], a[3]);
    else if (n == 2 && !strcmp(a[0], "FP")) fingerprints(p, a[1]);
    else if (n == 3 && !strcmp(a[0], "RM")) remove_file(p, a[1], a[2]);
    else if (n == 2 && !strcmp(a[0], "MF")) pack_manifest(p, a[1]);
    else if (n == 2 && !strcmp(a[0], "PI")) pack_icon(p, a[1]);
    else if (n == 2 && !strcmp(a[0], "ATL")) atl_get(p, a[1]);
    else if (n == 3 && !strcmp(a[0], "UNZIP")) unzip_into(p, a[1], a[2]);
    else if (n == 2 && !strcmp(a[0], "FTB")) api_get(p, "https://api.modpacks.ch", "/public/modpack/", a[1]);
    else if (n == 2 && !strcmp(a[0], "MSK")) api_get(p, "https://api.mineskin.org/v2/skins", "?", a[1]);
    else if (n == 2 && !strcmp(a[0], "PX")) picture_accent(p, a[1]);
    else if (n == 2 && !strcmp(a[0], "FXCOPY")) fx_copy(p, a[1]);
    else if (n == 4 && !strcmp(a[0], "DLI")) download_into(p, a[1], a[2], a[3]);
    else if (n == 2 && !strcmp(a[0], "SMOOTH")) {
        alloyskin_set_smooth(!strcmp(a[1], "1"));
        finish(p, a[1], NULL);
    }
    else if (n == 1 && !strcmp(a[0], "GEN")) {
        char num[16];
        snprintf(num, sizeof num, "%d", alloyskin_js_gen);
        finish(p, num, NULL);
    }
    else finish(p, NULL, "unknown bridge command");
    g_strfreev(a);
    g_free(msg);
    return TRUE;
}

void alloyskin_bridge_attach(void *mgr) {
    register_fn reg = (register_fn)dlsym(RTLD_DEFAULT, "webkit_user_content_manager_register_script_message_handler_with_reply");
    js_to_string = (to_string_fn)dlsym(RTLD_DEFAULT, "jsc_value_to_string");
    js_context = (get_context_fn)dlsym(RTLD_DEFAULT, "jsc_value_get_context");
    js_new_string = (new_string_fn)dlsym(RTLD_DEFAULT, "jsc_value_new_string");
    reply_ref = (reply_ref_fn)dlsym(RTLD_DEFAULT, "webkit_script_message_reply_ref");
    reply_unref = (reply_unref_fn)dlsym(RTLD_DEFAULT, "webkit_script_message_reply_unref");
    reply_value = (reply_value_fn)dlsym(RTLD_DEFAULT, "webkit_script_message_reply_return_value");
    reply_error = (reply_error_fn)dlsym(RTLD_DEFAULT, "webkit_script_message_reply_return_error_message");
    if (!reg || !js_to_string || !js_context || !js_new_string || !reply_ref || !reply_unref || !reply_value || !reply_error) {
        fprintf(stderr, "alloyskin: bridge unavailable (WebKit too old)\n");
        return;
    }
    if (!reg(mgr, "alloyskin", NULL)) return;
    g_signal_connect(mgr, "script-message-with-reply-received::alloyskin", G_CALLBACK(on_message), NULL);
    fprintf(stderr, "alloyskin: bridge attached\n");
}
