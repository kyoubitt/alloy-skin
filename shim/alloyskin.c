// alloyskin: LD_PRELOAD shim for the Alloy launcher.
//  - adds $ALLOY_SKIN_CSS as a user stylesheet and reloads it live when the file changes
//  - injects the scripts listed in $ALLOY_SKIN_JS (colon-separated) and swaps them when a file changes;
//    they take effect when the page next loads (xmcl.js reloads it while the window is in the background)
//  - exposes a small allowlisted CurseForge bridge to those scripts (bridge.c)
//  - keeps Alloy's own UI on the integrated GPU, but hands $ALLOY_SKIN_GAME_ENV
//    (";"-separated KEY=VALUE pairs) to the java process it launches
// Alloy registers Tauri init scripts through webkit_user_content_manager_add_script;
// the first time we see a content manager we attach our stylesheet and scripts to it.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

extern char **environ;

typedef void *(*sheet_new_fn)(const char *, int, int, const char *const *, const char *const *);
typedef void *(*script_new_fn)(const char *, int, int, const char *const *, const char *const *);
typedef void (*add_fn)(void *, void *);
typedef void (*remove_all_fn)(void *);
typedef void (*remove_fn)(void *, void *);
typedef void (*unref_fn)(void *);
typedef unsigned (*timeout_add_fn)(unsigned, int (*)(void *), void *);

#define MAX_MGRS 16
static void *seen[MAX_MGRS];
static int nseen;

#define MAX_GAME_ENV 16
static char *game_env[MAX_GAME_ENV];
static int ngame_env;

static int is_alloy(void) {
    char exe[4096];
    ssize_t n = readlink("/proc/self/exe", exe, sizeof exe - 1);
    if (n <= 0) return 0;
    exe[n] = 0;
    const char *base = strrchr(exe, '/');
    return base && strcmp(base + 1, "alloy") == 0;
}

__attribute__((constructor)) static void setup(void) {
    // AppRun's bash must keep LD_PRELOAD so it reaches alloy; inside alloy we drop it
    if (!is_alloy()) return;
    unsetenv("LD_PRELOAD");

    const char *spec = getenv("ALLOY_SKIN_GAME_ENV");
    if (spec) {
        char *copy = strdup(spec), *save = NULL;
        for (char *kv = strtok_r(copy, ";", &save); kv && ngame_env < MAX_GAME_ENV; kv = strtok_r(NULL, ";", &save)) {
            char *eq = strchr(kv, '=');
            if (!eq) continue;
            game_env[ngame_env++] = strdup(kv);
            // the launcher UI shouldn't wake the dGPU, so these only go to the game
            *eq = 0;
            unsetenv(kv);
        }
        free(copy);
        unsetenv("ALLOY_SKIN_GAME_ENV");
    }
}

// ---------- game environment ----------

static int is_java(const char *path) {
    if (!path || !ngame_env) return 0;
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    return strcmp(base, "java") == 0 || strcmp(base, "javaw") == 0;
}

static int overridden(const char *kv) {
    for (int i = 0; i < ngame_env; i++) {
        size_t klen = strchr(game_env[i], '=') - game_env[i] + 1;
        if (strncmp(kv, game_env[i], klen) == 0) return 1;
    }
    return 0;
}

// fills out with envp + game_env; no allocation, so it is safe in a forked child
static char **with_game_env(char *const envp[], char **out, size_t cap) {
    size_t n = 0;
    for (int i = 0; envp && envp[i] && n + ngame_env + 1 < cap; i++)
        if (!overridden(envp[i])) out[n++] = envp[i];
    for (int i = 0; i < ngame_env; i++) out[n++] = game_env[i];
    out[n] = NULL;
    return out;
}

#define ENV_CAP 4096
static char *child_env[ENV_CAP];

int execve(const char *path, char *const argv[], char *const envp[]) {
    static int (*real)(const char *, char *const[], char *const[]);
    if (!real) real = dlsym(RTLD_NEXT, "execve");
    if (is_java(path)) envp = with_game_env(envp, child_env, ENV_CAP);
    return real(path, argv, envp);
}

int execvp(const char *file, char *const argv[]) {
    static int (*real)(const char *, char *const[]);
    if (!real) real = dlsym(RTLD_NEXT, "execvp");
    if (is_java(file) && strchr(file, '/')) return execve(file, argv, environ);
    return real(file, argv);
}

typedef int (*spawn_fn)(pid_t *, const char *, const posix_spawn_file_actions_t *,
                        const posix_spawnattr_t *, char *const[], char *const[]);

static int spawn_with_env(spawn_fn real, pid_t *pid, const char *path, const posix_spawn_file_actions_t *fa,
                          const posix_spawnattr_t *attr, char *const argv[], char *const envp[]) {
    if (!is_java(path)) return real(pid, path, fa, attr, argv, envp);
    char **env = malloc(ENV_CAP * sizeof *env);
    if (!env) return real(pid, path, fa, attr, argv, envp);
    int rc = real(pid, path, fa, attr, argv, with_game_env(envp, env, ENV_CAP));
    free(env);
    return rc;
}

int posix_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *fa,
                const posix_spawnattr_t *attr, char *const argv[], char *const envp[]) {
    static spawn_fn real;
    if (!real) real = (spawn_fn)dlsym(RTLD_NEXT, "posix_spawn");
    return spawn_with_env(real, pid, path, fa, attr, argv, envp);
}

int posix_spawnp(pid_t *pid, const char *file, const posix_spawn_file_actions_t *fa,
                 const posix_spawnattr_t *attr, char *const argv[], char *const envp[]) {
    static spawn_fn real;
    if (!real) real = (spawn_fn)dlsym(RTLD_NEXT, "posix_spawnp");
    return spawn_with_env(real, pid, file, fa, attr, argv, envp);
}

// ---------- stylesheet + scripts ----------

static char *read_path(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "alloyskin: can't open %s\n", path); return NULL; }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    rewind(f);
    char *buf = malloc(len + 1);
    if (buf && fread(buf, 1, len, f) == (size_t)len) buf[len] = 0;
    else { free(buf); buf = NULL; }
    fclose(f);
    return buf;
}

static time_t css_mtime;

static void load_css(void *mgr) {
    sheet_new_fn sheet_new = (sheet_new_fn)dlsym(RTLD_DEFAULT, "webkit_user_style_sheet_new");
    add_fn add_sheet = (add_fn)dlsym(RTLD_DEFAULT, "webkit_user_content_manager_add_style_sheet");
    const char *path = getenv("ALLOY_SKIN_CSS");
    if (!sheet_new || !add_sheet || !path) return;

    struct stat st;
    if (stat(path, &st) == 0) css_mtime = st.st_mtime;
    char *css = read_path(path);
    if (!css) return;
    // WEBKIT_USER_CONTENT_INJECT_TOP_FRAME = 1, WEBKIT_USER_STYLE_LEVEL_USER = 1
    add_sheet(mgr, sheet_new(css, 1, 1, NULL, NULL));
    free(css);
}

// runs on the GTK main loop once a second: swap the stylesheet when the file is saved
static void watch_scripts(void);
static int watch_css(void *unused) {
    (void)unused;
    watch_scripts();
    const char *path = getenv("ALLOY_SKIN_CSS");
    struct stat st;
    if (!path || stat(path, &st) != 0 || st.st_mtime == css_mtime) return 1;
    remove_all_fn remove_all = (remove_all_fn)dlsym(RTLD_DEFAULT, "webkit_user_content_manager_remove_all_style_sheets");
    if (!remove_all) return 1;
    for (int i = 0; i < nseen; i++) {
        remove_all(seen[i]);
        load_css(seen[i]);
    }
    fprintf(stderr, "alloyskin: stylesheet reloaded\n");
    return 1;
}

void alloyskin_bridge_attach(void *mgr); // bridge.c

#define MAX_SCRIPTS 16
static void *ours[MAX_MGRS][MAX_SCRIPTS]; // our WebKitUserScripts per content manager, so they can be swapped
static int nours[MAX_MGRS];
static add_fn real_add;
static long js_sig;
int alloyskin_js_gen; // bumped when the scripts change; bridge.c reports it to the page

// changes whenever a listed script is saved
static long scripts_sig(void) {
    const char *list = getenv("ALLOY_SKIN_JS");
    if (!list) return 0;
    long sig = 0;
    char *copy = strdup(list), *save = NULL;
    for (char *path = strtok_r(copy, ":", &save); path; path = strtok_r(NULL, ":", &save)) {
        struct stat st;
        if (stat(path, &st) == 0) sig = sig * 31 + (long)st.st_mtim.tv_sec * 1000 + st.st_mtim.tv_nsec / 1000000;
    }
    free(copy);
    return sig;
}

static void attach_scripts(int slot) {
    script_new_fn script_new = (script_new_fn)dlsym(RTLD_DEFAULT, "webkit_user_script_new");
    const char *list = getenv("ALLOY_SKIN_JS");
    if (!script_new || !list) return;
    js_sig = scripts_sig();
    char *copy = strdup(list), *save = NULL;
    for (char *path = strtok_r(copy, ":", &save); path; path = strtok_r(NULL, ":", &save)) {
        char *js = read_path(path);
        if (!js) continue;
        // WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END = 1
        void *script = script_new(js, 1, 1, NULL, NULL);
        real_add(seen[slot], script);
        if (nours[slot] < MAX_SCRIPTS) ours[slot][nours[slot]++] = script;
        free(js);
        fprintf(stderr, "alloyskin: script %s attached\n", path);
    }
    free(copy);
}

// runs once a second with watch_css: replace our scripts (only ours, Tauri's stay) after an edit
static void watch_scripts(void) {
    if (!nseen || scripts_sig() == js_sig) return;
    remove_fn remove = (remove_fn)dlsym(RTLD_DEFAULT, "webkit_user_content_manager_remove_script");
    unref_fn unref = (unref_fn)dlsym(RTLD_DEFAULT, "webkit_user_script_unref");
    if (!remove || !unref) return;
    for (int i = 0; i < nseen; i++) {
        for (int k = 0; k < nours[i]; k++) {
            remove(seen[i], ours[i][k]);
            unref(ours[i][k]);
        }
        nours[i] = 0;
        attach_scripts(i);
    }
    alloyskin_js_gen++;
    fprintf(stderr, "alloyskin: scripts reloaded\n");
}

void webkit_user_content_manager_add_script(void *mgr, void *script) {
    static add_fn real;
    if (!real) real = (add_fn)dlsym(RTLD_NEXT, "webkit_user_content_manager_add_script");

    int known = 0;
    for (int i = 0; i < nseen; i++) known |= seen[i] == mgr;
    if (!known && nseen < MAX_MGRS) {
        seen[nseen++] = mgr;
        real_add = real;
        load_css(mgr);
        alloyskin_bridge_attach(mgr);
        attach_scripts(nseen - 1);
        fprintf(stderr, "alloyskin: attached\n");
        if (nseen == 1) {
            timeout_add_fn timeout_add = (timeout_add_fn)dlsym(RTLD_DEFAULT, "g_timeout_add_seconds");
            if (timeout_add) timeout_add(1, watch_css, NULL);
        }
    }
    real(mgr, script);
}


// WebKit caps page rendering near 60 fps by default; on a 144 Hz screen that means every other frame (72 fps),
// which makes scrolling look half as smooth as other apps. Alloy asks its web view for the settings object,
// so turn that cap off on it the first time it's handed out.
void *alloyskin_settings; // the web view's settings; bridge.c flips smooth scrolling on it live

// WebKit glides every wheel step (smooth scrolling); the page then trails your input, which feels like lag.
// Off by default; the Appearance page can turn it back on through the bridge (SMOOTH 1).
void alloyskin_set_smooth(int on) {
    void (*smooth)(void *, int) = (void (*)(void *, int))dlsym(RTLD_DEFAULT, "webkit_settings_set_enable_smooth_scrolling");
    if (smooth && alloyskin_settings) smooth(alloyskin_settings, on);
}

static void uncap_frame_rate(void *settings) {
    static void *done[8];
    for (int i = 0; i < 8; i++) {
        if (done[i] == settings) return;
        if (!done[i]) { done[i] = settings; break; }
    }
    void *(*all)(void) = (void *(*)(void))dlsym(RTLD_DEFAULT, "webkit_settings_get_all_features");
    unsigned long (*len)(void *) = (unsigned long (*)(void *))dlsym(RTLD_DEFAULT, "webkit_feature_list_get_length");
    void *(*get)(void *, unsigned long) = (void *(*)(void *, unsigned long))dlsym(RTLD_DEFAULT, "webkit_feature_list_get");
    const char *(*ident)(void *) = (const char *(*)(void *))dlsym(RTLD_DEFAULT, "webkit_feature_get_identifier");
    void (*set)(void *, void *, int) = (void (*)(void *, void *, int))dlsym(RTLD_DEFAULT, "webkit_settings_set_feature_enabled");
    void (*unref)(void *) = (void (*)(void *))dlsym(RTLD_DEFAULT, "webkit_feature_list_unref");
    alloyskin_settings = settings;
    alloyskin_set_smooth(0);
    if (!all || !len || !get || !ident || !set) return;
    void *list = all();
    if (getenv("ALLOY_SKIN_DEBUG")) fprintf(stderr, "alloyskin: settings %p, %lu features\n", settings, list ? len(list) : 0);
    for (unsigned long i = 0; list && i < len(list); i++) {
        void *f = get(list, i);
        if (getenv("ALLOY_SKIN_DEBUG") && strstr(ident(f), "60")) fprintf(stderr, "alloyskin: feature %s\n", ident(f));
        if (!strncmp(ident(f), "PreferPageRenderingUpdatesNear60FPS", 35)) {
            set(settings, f, 0);
            fprintf(stderr, "alloyskin: page rendering follows the display refresh rate\n");
        }
    }
    if (list && unref) unref(list);
}

void *webkit_web_view_get_settings(void *view) {
    static void *(*real)(void *);
    if (!real) real = (void *(*)(void *))dlsym(RTLD_NEXT, "webkit_web_view_get_settings");
    void *settings = real(view);
    if (getenv("ALLOY_SKIN_DEBUG")) fprintf(stderr, "alloyskin: get_settings(%p) -> %p\n", view, settings);
    if (settings) uncap_frame_rate(settings);
    return settings;
}
