# Writing TridOS apps: a guide for people who know JavaScript

An app is **one `.js` file** that sets `module.exports`. It is ordinary JavaScript run by Node.js: the same language, the same
`Math`, `JSON`, `Date`, `Array`, classes, `async`, everything. What is different is the surroundings. There is no browser, no DOM,
no HTML or CSS: you draw into a window with a few functions, and TridOS calls you when something happens.

If you have 10 minutes, read sections 1 to 5 and look at the two apps in [`examples/`](examples).

## 1. Your first app (60 seconds)

1. In TridOS get **Code Studio** from the App Store and open it.
2. **New App** → pick **Hello** → name it. A file appears in the editor.
3. Press **Run** (or Ctrl+R). TridOS saves it, checks it, puts it in the Dock and opens it.
4. Change something and press Run again.

Your apps live in `~/.tridos/apps/<name>.js`. You can also edit them in any editor; Code Studio's Run reloads them.

## 2. The shape of an app

```js
module.exports = {
  name: 'My App',                          // shown in the Dock and the App Store
  desc: 'What it does, in a line.',        // one line
  version: '1.0.0',                        // used when you share it
  icon: { color: '#ff453a', glyph: 'M' },  // a colour and one letter
  size: [44, 15],                          // the window, in text cells: columns, rows
  create(os, win, saved) {                 // called once, when the window opens
    // set up your state here, then return the app:
    return {
      draw(v, focused) {},                 // paint the window
      key(e) {},                           // a key was pressed
      mouse(e) {},                         // the pointer did something
      tick(dt, focused) { return false; }, // time passed (animation); true = redraw
      save() { return {}; },               // returned value comes back next time as `saved`
      // optional: title() menus() close() dirty()
    };
  },
};
```

Everything in the returned object is optional. `create` is the only thing TridOS needs. It is CommonJS: `module.exports`, no
`import`/`export`. State lives in plain variables inside `create` (a closure), as in the examples.

## 3. Two grids: text cells and pixels

The whole desktop is drawn in **pixels**, including text (TridOS has its own pixel font), so you can mix both freely.

- **Text cells** are what you lay things out in. One character = one cell. A cell is 6×10 pixels times the *text size* the
  person chose (1 to 4), so cells are always the same shape but their size in pixels changes.
- **Pixels** are square. Use them for graphics. `v.pxW` and `v.pxH` are your window's size in pixels, and they depend on the
  text size, so never hard-code them.

`v` (the view you draw into) always starts at `(0, 0)` in its own top-left corner, and everything you draw is clipped to it.
Your window can be resized, so always lay out from `v.w` and `v.h` (cells), not from `size`.

## 4. Drawing: the `v` object

Colours are numbers like `0xff9f0a` (red, green, blue). All of these are relative to your window.

| call | does |
| --- | --- |
| `v.w`, `v.h` | size in text cells |
| `v.pxW`, `v.pxH` | size in pixels |
| `v.pw`, `v.ph` | pixels per text cell (width, height) |
| `v.fill(color)` | fill the whole window |
| `v.rect(x, y, w, h, color)` | fill a rectangle of text cells |
| `v.text(x, y, string, fg, bg?)` | write text; `x, y` in cells; `bg` is optional (otherwise transparent) |
| `v.px(x, y, color)` | one pixel |
| `v.pxRect(x, y, w, h, color)` | a rectangle of pixels |
| `v.pxLine(x0, y0, x1, y1, color)` | a line of pixels |
| `v.blendRect(x, y, w, h, color, alpha)` | tint pixels (alpha 0 to 1) |
| `v.sprite(x, y, rows, palette)` | a small picture from strings: `v.sprite(2, 2, ['.#.', '###'], { '#': 0xffffff })` |
| `v.sub(x, y, w, h)` | a smaller view of part of the window (its own `(0, 0)`), good for panels |
| `v.hover(x, y, w?, h?)` | is the pointer over this cell rectangle right now? |

`draw` is called whenever anything on screen needs repainting (a key, a mouse move, a clock tick, your own `tick`). It should
**paint everything from your state, every time**, and be quick. Do not keep drawing state in `draw` itself; change state in
`key`, `mouse` and `tick`, and just look at it in `draw`.

Text is drawn from a built-in 5×8 pixel font: ASCII, plus `● ○ ◉ ◼ ▫ ▪ ◆ ▾ ▴ ▸ ▶ ◢ → ← ↑ ↓ ‹ › × − ✓ • · … π ± ─`. Accented
letters draw as the plain letter; anything else draws as a small box.

## 5. Input

### Keys: `key(e)`

`e.key` is the key's name: a printable key is itself (`'a'`, `'7'`, `' '`, `'+'`; an upper-case letter arrives as `'A'`),
and the rest are `'enter'`, `'backspace'`, `'delete'`, `'tab'`, `'up'`, `'down'`, `'left'`, `'right'`, `'home'`, `'end'`,
`'pageup'`, `'pagedown'`. `e.ctrl`, `e.alt`, `e.shift` are booleans. For a Ctrl key, `e.key` is the letter (`Ctrl+S` is
`{ key: 's', ctrl: true }`). `e.text` is the typed character when there is one (use it to build a string).

Esc is TridOS's: it starts keyboard navigation of the desktop. If your app wants Esc (to close its own dialog, say), return
`true` from `key(e)` when you used it, and TridOS leaves it alone. Return values do not matter for other keys.

### Mouse: `mouse(e)`

`e.kind` is `'down'`, `'up'`, `'drag'` (moving with a button held) or `'wheel'`. (Plain moves are not sent; use `v.hover` in
`draw` for hover effects.) `e.button` is 0 (left), 1 (middle), 2 (right). Position, relative to your window:

- `e.x`, `e.y`: the text cell
- `e.px`, `e.py`: the pixel (use these for drawing, painting and smooth dragging)
- `e.dir` for `'wheel'`: -1 up, 1 down

After a `'down'`, `'drag'` and `'up'` keep coming to your window even if the pointer leaves it (the coordinates can then be
negative or bigger than the window).

### Clickable things: `Hits` and `button`

`os.ui` has helpers. The pattern: collect click targets while you draw, use them when the mouse comes.

```js
const { button, Hits } = os.ui;
const hits = new Hits();
// in draw:
hits.reset();
button(v, hits, 3, 6, 'Say hello', os.th, () => n++, { primary: true });
// in mouse:
if (e.kind === 'down') hits.click(e.x, e.y);
```

`button(v, hits, x, y, label, theme, onClick, { primary, danger, active, width })` draws a one-row button and returns its width, so
you can lay buttons side by side. You can also add your own areas: `hits.add(x, y, w, h, fn)`.

## 6. Time and animation

`tick(dt, focused)` is called about 30 times a second for every open window. `dt` is the seconds since the last call (never more
than 0.2). **Return `true` if something changed and the window needs repainting**, `false` otherwise (so an idle app costs nothing).
See `examples/bounce.js` (physics in pixels).

You can use `Date.now()`, `setTimeout` and so on too, but `tick` is simpler and stops when the window does.

## 7. Remembering things, windows, menus, dialogs

- **`save()`** returns any JSON-able value. TridOS writes it (with the window's position and size) within a couple of seconds of
  any key, click or animation, and when you quit or close the terminal, and hands it back as `saved` the next time `create`
  runs. `saved` is empty the first time. This is how an app remembers.
- **`title()`** returns the text for the title bar. **`menus()`** returns app menus for the menu bar:
  `[{ title: 'Note', items: [{ label: 'Clear', fn: () => ... }, { sep: true }, { label: 'Undo', fn: ... }] }]`.
- **`dirty()`** returning `true` makes TridOS ask before the window is closed. **`close()`** is called when it closes.
- Dialogs: `os.ask(title, message, initialText, (text) => ...)`, `os.confirm(title, message, 'OK label', () => ...)` and
  `os.dialog({ title, message, input, buttons, onDone })`. `os.toast('message')` shows a short notice (use it where you would
  use `console.log`: do not call `console.log`, it would scribble on the screen).
- **Errors:** if `draw` throws, the window shows the error instead of crashing TridOS; errors in `key`, `mouse` and `tick` show as a
  notice. Syntax errors show in Code Studio's console when you press Run.

## 8. More building blocks (`os.ui`, `os.util`, `os.th`)

- `new os.ui.LineInput(text)`: a one-line text box. `.text`, `.set(text)`, `.key(e)` (returns `true` if it used the key),
  `.draw(v, x, y, width, os.th, { focus, mask })`.
- `new os.ui.TextArea(text, { lang: 'js' })`: a multi-line editor with undo and optional JavaScript colouring. `.getText()`,
  `.setText(t)`, `.key(e, pageRows)`, `.draw(v, os.th, { focus, gutter })`, `.click(x, y)` and `.wheel(dir)` for the mouse,
  `.undo()`, `.redo()`, `.modified`. See `examples/sticky-note.js`.
- `os.util`: `mix(colorA, colorB, t)`, `lighten(c, t)`, `darken(c, t)`, `clamp(v, lo, hi)`, `fit(text, width)` (shorten with `…`),
  `len(text)`.
- `os.th` has the theme, so your app follows light and dark mode and the accent colour: `bg`, `text`, `dim`, `accent`, `line`,
  `field`, `side`, `ctrl`, `sel`, `danger`, `ok`, `warn`, and `dark` (true in dark mode). Use these instead of fixed colours and
  your app will look right everywhere.
- `os.cv.scale` is the text size (1 to 4); `os.mouse` is the pointer's text cell.

## 9. Your apps and shared apps

Apps you write and run yourself are **fully trusted**: `os` is TridOS itself, and you can `require('fs')`, `'path'`, `'os'` and
`'child_process'` (name the TridOS object something else if you need Node's `os`). You can read and write files, run commands,
open other apps with `os.launch('terminal')`. (`~/.tridos/disk` is the folder the Finder and Terminal show, if you want your
app to work with the same files.)

**Apps you share are fenced**, because the people who install them are trusting you. A shared app:

- gets a small `os` with only: `th`, `settings` (theme, accent, clock24), `cv` (`pw`, `ph`, `scale`), `mouse`, `ui`, `util`, `toast`,
  `dialog`, `ask`, `confirm`, and a small `win`: `id`, `x`, `y`, `w`, `h`, `def` (name, desc, author);
- has no `require`, `process`, `eval`, `Function`, `fetch`, `Buffer` or the global object;
- can remember things only through `save()`.

Before you can share one, TridOS scans the source, and so does everyone's TridOS before installing. It **refuses** code that
uses: `require`, `import`, `process`, running commands, `eval`, `Function`, `global`/`globalThis`/`window`/`self`,
`.constructor`/`prototype`/`__proto__`/`Reflect`/`Proxy`, `fetch`/`XMLHttpRequest`/`WebSocket`, `Buffer`/`fs`/file calls, the
TridOS internals (`os.windows`, `os.term`, ...), looking a property up by text (`obj['name']`; an array of strings is fine), and
hidden text (`\u00..`, `\x..`, `String.fromCharCode`, `atob`). The scan is text-based: it also trips on those words inside
strings (a message saying "process" counts), so word things differently. App Distributor's Share page tells you which line.

This is a fence and not a vault: JavaScript cannot be fully sandboxed, so people are also shown the full source before they
install, and a checksum is checked every time an installed app loads. Write shared apps assuming strangers will read them.

## 10. Sharing your app

Open **App Distributor → Share**, pick your app, and choose:

- **Publish to catalog**: puts it in the `apps/` folder of the TridOS repo through your GitHub account (the `gh` command, signed
  in with `gh auth login`). If you can write to the repo it goes straight in; otherwise it becomes a pull request that the owner
  reads before merging. Then everyone sees it in the App Store.
- **Copy code** or **Save file**: send one piece of text, or a `.tridapp` file, to a friend.

Set `version` in your app (`'1.2.0'`) and publish again to send an update; people see **Update** next to it. The name on the app is
the one you give the first time you share. The icon is the `icon` line.

## 11. Debugging

- Press **Run** in Code Studio: the console shows load errors with the message.
- Put `os.toast(JSON.stringify(thing))` where you would put a `console.log`.
- A blank window usually means `draw` is not filling: start with `v.fill(os.th.bg)`.
- Clicks not working: remember `hits.reset()` at the top of `draw`, and `hits.click(e.x, e.y)` in `mouse`.
- Text cut off: `v.text` clips at the window's edge. Use `os.util.fit(text, width)` to shorten.
- Slow: do not allocate large things in `draw`; keep them in `create` and update them in `tick`.

## 12. Browser JavaScript versus this

| in a browser | here |
| --- | --- |
| `document`, DOM, CSS, `canvas` | `v.fill`, `v.text`, `v.px...` |
| `addEventListener('click')` | `mouse(e)` with `e.kind === 'down'` |
| `requestAnimationFrame` | `tick(dt)` returning `true` |
| `localStorage` | `save()` / `saved` |
| `alert`, `prompt`, `confirm` | `os.toast`, `os.ask`, `os.confirm` |
| `import x from 'y'` | not available; one file, `module.exports` |
| `fetch` | your own apps can use Node; shared apps cannot |
| `console.log` | `os.toast` |

## 13. The example apps

Both run as your own apps and as shared apps (they pass the scan and work inside the fence). Copy one into Code Studio as a
starting point. (The **Counter** template in Code Studio shows buttons with `Hits` and `save()`/`saved`.)

- [`examples/bounce.js`](examples/bounce.js): pixel drawing and animation, mouse pixels `e.px`/`e.py`.
- [`examples/sticky-note.js`](examples/sticky-note.js): `os.ui.TextArea`, `title()`, `menus()`, saving text.
