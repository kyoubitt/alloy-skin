# alloy-skin

Small polish for the [Alloy](https://github.com/SteelAspect/alloy-releases) Minecraft launcher on Linux.

Alloy itself has the card home, artwork instances page, CurseForge, modpacks, log console and skin gallery. This adds a few fixes on top:

- Text stays readable over any background picture: lists, tab bars and loose labels get a solid backing, and small grey text has a readable minimum.
- The Play time card is hidden.
- Calmer wheel scrolling, one even step per notch (a short glide when Alloy's Smooth scrolling is on). A scroll that starts in a box, like the log or a mod list, stays in that box.
- Only Play uses the accent colour, so Install buttons don't compete with it.
- Info pills in the instance header become one plain line.
- The Arrange-cards resize corner is easy to see.
- Plain layout names: "Modern" instead of "XMCL".
- The page draws at your display's refresh rate (WebKit otherwise holds it near 60 fps, which halves smoothness on a 144 Hz screen).
- Minecraft starts on the NVIDIA GPU, while the launcher stays on the integrated one.

Colours come from Alloy's own colour schemes, so every scheme and your accent colour keep working.

## Install
Needs `gcc`, `pkg-config` and the GLib/GIO headers.

```sh
git clone https://github.com/kyoubitt/alloy-skin ~/src/alloy-skin
cd ~/src/alloy-skin
make install
```

Put the Alloy AppImage at `~/Applications/Alloy.AppImage`, then start Alloy with `~/.local/lib/alloy-skin/alloy-skinned`. You can point your `.desktop` file's `Exec=` at that.

If you don't have an NVIDIA laptop, empty `ALLOY_SKIN_GAME_ENV` in `shim/alloy-skinned`.

## How it works
Alloy is closed source, so nothing is patched. A small `LD_PRELOAD` library (`shim/alloyskin.c`) adds `skin/skin.css` as a user stylesheet and `skin/skin.js` as a page script to Alloy's web view. It also turns off WebKit's 60 fps preference and gives the java process the GPU environment.

## Undo
Start `~/Applications/Alloy.AppImage` directly, and delete `~/.local/lib/alloy-skin` and `~/.config/alloy-skin`.
