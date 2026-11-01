// Sticky Note: a text area (os.ui.TextArea), a title bar that changes, an app menu, and text that is saved between sessions.
module.exports = {
  name: 'Sticky Note',
  desc: 'A little note that stays put.',
  version: '1.0.0',
  icon: { color: '#ffd60a', glyph: 'N' },
  size: [46, 14],
  create(os, win, saved) {
    const { TextArea } = os.ui;
    const note = new TextArea((saved && saved.text) || 'Click here and type.\nUndo: Ctrl+Z');
    return {
      title: () => `Sticky Note (${note.getText().length} characters)`, // shown in the window's title bar
      save: () => ({ text: note.getText() }),
      menus: () => [{ title: 'Note', items: [{ label: 'Undo', fn: () => note.undo() }, { sep: true }, { label: 'Clear', fn: () => note.setText('') }] }],
      draw(v, focused) {
        note.draw(v, os.th, { focus: focused, gutter: false });
      },
      key(e) {
        return note.key(e, 8); // true when the key was used (typing, arrows, Ctrl+Z ...)
      },
      mouse(e) {
        if (e.kind === 'wheel') note.wheel(e.dir);
        else if (e.kind === 'down') note.click(e.x, e.y);
      },
    };
  },
};
