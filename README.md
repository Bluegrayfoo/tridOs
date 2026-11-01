# TridOS

A fullscreen desktop for your terminal, drawn in pixels made from block characters: the
**octants** (U+1CD00–1CDE5, 2×4 pixels per character) and **sextants** (U+1FB00–1FB3B, 2×3), plus the
older block characters that fill the gaps in those ranges. It looks like a Mac desktop: a menu bar,
a Dock, windows with traffic lights and shadows, wallpapers, light and dark themes.

## Install

With [tlib](https://github.com/BlueGrayFoo/TLIB):

```
tlib install knittingCat/tridOs
tridos
```

Without tlib (needs [Node.js](https://nodejs.org) 18 or newer, nothing else):

```
git clone https://github.com/knittingCat/tridOs.git
cd tridOs
./bin/tridos
```

To get a `tridos` command anywhere, link it onto your PATH: `ln -s "$PWD/bin/tridos" ~/.local/bin/tridos`
(or any folder on your PATH). To update: `tlib update knittingCat/tridOs`, or `git pull`.

## Run

```
tridos              start it (a big or full-screen terminal window is best: Ctrl+Cmd+F)
tridos --glyphs     check that your font draws the block characters
tridos --reset      forget settings, installed apps and windows (your files stay)
tridos --snapshot   draw one frame as text (for tests); add --text for just the text layer
```

Needs Node 18+. No packages to install. Run `npm test` for the self-test (34 checks, headless).

## Text, fonts and the terminal

**All text is drawn in pixels** from a built-in 5×8 font, so it is readable even when your terminal's
own font is tiny (it was made for a 3 pt terminal font, full screen). The **text size** scales it: by
default *Auto* picks the biggest size that still leaves room for the desktop (at least 96×28 text
cells); change it in System Settings → Display, or press **Alt +** / **Alt −** anywhere (Option as
Meta in Terminal.app: Settings → Profiles → Keyboard), or use the Apple menu → Bigger / Smaller Text.

The block characters themselves come from your font. Octants are new in Unicode 16, so the font has to
have them. **Julia Mono** does (and is a good terminal font). If the desktop looks like boxes or
question marks, open System Settings → Display and pick **Sextants** or **Half blocks** (half blocks
work in nearly every font). In Terminal.app keep *Line spacing* at 1.0 or the blocks will not touch.
Mouse reporting must be on (Terminal → View → Allow Mouse Reporting). 24-bit colour is used when the
terminal supports it (Terminal.app on macOS 26, iTerm2, kitty, WezTerm, ...), otherwise 256 colours.

## Using it

**Pointer:** everything works with the mouse: click the Dock, drag windows by the title bar, resize
from the corner, click the red / yellow / green dots, double-click a title bar to zoom, scroll with
the wheel.

**Keyboard** (when there is no mouse): press **Esc** to start keyboard navigation (the menu bar says
so). Then:

| keys | does |
| --- | --- |
| ← → | pick a Dock icon (Dock), pick a menu (menu bar) |
| ↑ | go up to the menu bar; ↓ opens a menu, ↑ ↓ choose, Enter picks |
| Enter | open the Dock icon / run the menu item |
| Tab / Shift+Tab | switch window; then arrows move it, Shift+arrows resize it, `w` closes, `m` minimizes, `z` zooms |
| Esc | go back, and leave keyboard navigation |

**Ctrl+Q** (or  → Shut Down…) shuts down. Everything is saved when you quit and while you work.

## Apps

Only the **App Store** is installed at first. Open it, choose **Get**, and the app lands in the Dock:

- **Finder**: browse the TridOS disk, make folders and files, rename, trash, open. (Keys: arrows, Enter,
  Backspace up, `n` new folder, `f` new file, `r` rename, `t` trash.)
- **Terminal**: TridOS commands (`help`) and, for anything else, your real shell, run in the folder you are in.
- **Text Editor**: plain text and code, line numbers, undo, JavaScript highlighting. Ctrl+S saves.
- **Grapher**: plot equations like Desmos: `y = sin(x)`, `f(x) = x^2`, `a = 2` then `y = a x`, `x = 3`, `|x|`.
  Drag to pan, wheel to zoom, Tab for keyboard pan/zoom. Curves are drawn to the pixel.
- **Code Studio**: write your own apps (below).
- **App Distributor**: send your apps to anyone with TridOS, and install apps people send you. See below.
- **System Settings** (in the  menu, not the App Store): dark / light, accent colour, wallpaper (9), pixel
  mode, colour depth, clock, Dock size. Changes apply and save at once.

## Making apps

Open Code Studio → **New App** → pick a template (Hello, Counter, Paint) → **Run**. Run saves the file,
checks it, puts it in the Dock and opens it. Apps are JavaScript files in `~/.tridos/apps/`:

```js
module.exports = {
  name: 'My App', desc: 'What it does', icon: { color: '#ff9f0a', glyph: 'M' }, size: [44, 12],
  create(os, win, saved) {
    return {
      draw(v, focused) { v.fill(os.th.bg); v.text(2, 1, 'Hello!', os.th.text); },
      key(e)   { /* e.key, e.ctrl, e.shift, e.text */ },
      mouse(e) { /* e.kind: down | up | drag | wheel; e.x, e.y in cells */ },
      tick(dt) { return false; },       // return true to redraw (animation)
      save()   { return { n: 1 }; },    // handed back as `saved` next time
    };
  },
};
```

`v` draws in cells (`v.fill`, `v.rect`, `v.text`) and in pixels (`v.px`, `v.pxRect`, `v.pxLine`; `v.pxW`,
`v.pxH` are the size in pixels). `os.th` has the theme colours, `os.ui` has `button`, `Hits`, `LineInput`
and `TextArea`, `os.toast`, `os.dialog`, `os.ask` and `os.launch` do what they say. Code Studio's
**Reference** button shows all of it.

## Sharing apps (App Distributor)

Get **App Distributor** from the App Store. Every app is carried as one piece of text starting `TRIDAPP1.` (the app,
compressed, with a checksum). An app you made in Code Studio can go to other people three ways:

- **Publish to catalog**: puts it in the **[`apps/`](apps) folder of this repo**, the TridOS catalog, using your GitHub
  account through the [`gh`](https://cli.github.com) command (`gh auth login` once). If you can edit this repo the app goes
  straight in; otherwise TridOS forks the repo and opens a **pull request**, and the owner reads the app's code before
  merging it. Everyone with TridOS then sees it in the **App Store** (Discover, next to the apps that come with TridOS, marked
  "shared") and in the Distributor's **Catalog**. Choosing Get shows the app's source first, and only then installs it. (Published shows what you sent; you can
  take back an app you put in directly.)
- **Copy code**: puts the text on your clipboard; paste it in a message. The other person pastes it in **Get apps**.
- **Save file**: writes `name.tridapp` on your Desktop. Send the file; opening it in TridOS (Finder or Desktop) installs it.

**Get apps** also installs from any https link (a GitHub gist page works).

Before anything is installed you **read the app's source** and approve it. Make sure you trust whoever sent it:
**an app is code, and TridOS cannot fully sandbox JavaScript.** What it does to limit the risk:

- the code is scanned and **refused** if it uses `require`, `process`, `eval`, `Function`, the network, files, hidden text
  (escapes, `fromCharCode`), object internals (`.constructor`, `["name"]`) or the TridOS internals;
- it runs with no `require`/`process`/`eval` and is handed a small fenced `os` and `win` (it cannot reach the Terminal or
  your other apps), unlike your own apps from Code Studio, which are fully trusted;
- its checksum is recorded when you install it and checked every time it loads, so a changed file will not run.

This is a fence, not a vault: treat apps from strangers like any program from a stranger. Apps from others live in
`~/.tridos/apps/community/` and can be removed in Get apps. Add `version: '1.2.0'` to your app to version it.

## Where things are

Everything lives in `~/.tridos` (set `TRIDOS_HOME` to use another place):
`state.json` (settings, installed apps, open windows), `disk/` (the Finder's world: Desktop, Documents,
Downloads, and a hidden Trash) and `apps/` (apps you wrote). Files on the Desktop show as icons.

## How it works

`src/gfx.js` keeps one pixel buffer per frame (text included, drawn from `src/font.js`). For each
terminal character it picks the two dominant colours of its 2×4 pixels, chooses the octant that
matches, and sends only the cells whose pixels changed. `src/glyphs.js` maps every pixel pattern to its
character (generated from the Unicode names). Apps lay out in *text cells* (6×10 pixels times the text
size); the terminal's cells are only 2×4 pixels, so the pointer is accurate to a couple of pixels.
`src/os.js` is the desktop; `src/apps/` has the apps; `src/term.js` reads keys and the mouse.
