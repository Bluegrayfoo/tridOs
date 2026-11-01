// What an app from someone else gets to see. It is handed this small `os` and `win` instead of the real ones, so it cannot reach the
// Terminal, the installed apps or the rest of the system by the obvious routes. This is a fence, not a vault: JavaScript can not be
// fully sandboxed, which is why such apps are also scanned (pack.js), shown to you before installing, and checked again on every load.

export function osFacade(os) {
  return Object.freeze({
    get th() {
      return os.th;
    },
    get settings() {
      return Object.freeze({ theme: os.settings.theme, accent: os.settings.accent, clock24: os.settings.clock24 });
    },
    cv: Object.freeze({
      get pw() {
        return os.cv.pw;
      },
      get ph() {
        return os.cv.ph;
      },
      get scale() {
        return os.cv.scale;
      },
    }),
    get mouse() {
      return { x: os.mouse.x, y: os.mouse.y };
    },
    ui: os.ui,
    util: os.util,
    toast: (m) => os.toast(String(m).slice(0, 200)),
    dialog: (o) => os.dialog({ title: String(o?.title || ''), message: String(o?.message || ''), input: o?.input, buttons: o?.buttons, onDone: o?.onDone }),
    ask: (t, m, v, cb) => os.ask(String(t), String(m), String(v ?? ''), cb),
    confirm: (t, m, ok, cb) => os.confirm(String(t), String(m), String(ok), cb),
  });
}

export function winFacade(win) {
  return Object.freeze({
    get id() {
      return win.id;
    },
    get x() {
      return win.x;
    },
    get y() {
      return win.y;
    },
    get w() {
      return win.w;
    },
    get h() {
      return win.h;
    },
    def: Object.freeze({ id: win.def.id, name: win.def.name, desc: win.def.desc, author: win.def.author || '' }),
  });
}

// Names an app from someone else must not be able to see, shadowed with undefined when its code is compiled.
export const HIDDEN_GLOBALS = ['require', 'process', 'global', 'globalThis', 'Function', 'eval', 'fetch', 'Buffer', 'window', 'self', 'module_', 'WebAssembly', 'Reflect', 'Proxy', 'XMLHttpRequest', 'WebSocket'];
