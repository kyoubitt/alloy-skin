# alloy-xmcl-skin

A reskin for the [Alloy](https://github.com/SteelAspect/alloy-releases) Minecraft launcher on Linux, styled after XMCL with bits of the Modrinth app, NoRisk and Prism.

Alloy is closed source, so this doesn't patch it. A small `LD_PRELOAD` library (`shim/`) adds a user stylesheet and scripts to Alloy's webview, and the skin (`skin/`) does the rest.

## What you get
- XMCL-style home: header with PLAY, plus cards for mods, saves, shaders, resource packs, screenshots, logs and servers. Drag to move, resize or hide them.
- All four Alloy layouts reworked: Sidebar, Hero (full artwork launcher screen), Card grid and Compact list (wide rail with names).
- Instance pages with tabs on top, an Instances page with artwork tiles and a details panel.
- CurseForge search and installs, modpacks from Modrinth, CurseForge, FTB and ATLauncher.
- A Prism-style New instance page, a log console with mclo.gs upload, and a skin gallery.
- Glass panels over your background picture, accent colour taken from the picture, and your own GIF/MP4 overlay effects.
- 144 Hz scrolling (WebKit caps Alloy at ~72 fps otherwise). Minecraft runs on the NVIDIA GPU while the launcher stays on the iGPU.

## Install
Needs `gcc`, `pkg-config`, GLib/GIO headers, `curl` and `unzip`. ImageMagick is optional, for lighter animated icons.

```sh
git clone https://github.com/kyoubitt/alloy-xmcl-skin ~/src/alloy-xmcl-skin
cd ~/src/alloy-xmcl-skin
make install
```

Put the Alloy AppImage at `~/Applications/Alloy.AppImage`, then start Alloy with `~/.local/lib/alloy-skin/alloy-skinned`. You can point your `.desktop` file's `Exec=` at that.

If you don't have an NVIDIA laptop, empty `ALLOY_SKIN_GAME_ENV` in `shim/alloy-skinned`.

## CurseForge
CurseForge needs an API key, and **you have to use your own**; none ships with this.
1. Get a key at https://console.curseforge.com.
2. Save it like `curseforge.headers.example`:
   ```sh
   printf 'x-api-key: %s\n' 'YOUR_KEY' > ~/.config/alloy-skin/curseforge.headers
   chmod 600 ~/.config/alloy-skin/curseforge.headers
   ```
3. Restart Alloy.

The key is read only by `curl` in the loader. The page scripts never see it, and it's only sent to `api.curseforge.com`. Without a key, everything else works and CurseForge tells you how to add one.

## Undo
Start Alloy normally (the AppImage) instead of `alloy-skinned`, and delete `~/.local/lib/alloy-skin` and `~/.config/alloy-skin`.
