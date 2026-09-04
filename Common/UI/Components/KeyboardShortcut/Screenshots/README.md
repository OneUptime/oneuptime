# Keyboard shortcut screenshots

The dashboard's global keyboard layer — the shortcuts dialog
(`../KeyboardShortcutsModal.tsx`) and the two places it is reachable by mouse.
Rendered from the real components against the dashboard's own Tailwind build
and `Common/UI/Styles/Theme.css`.

| File                                     | Shows                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `keyboard-shortcuts-dialog.png`          | The dialog opened with `?`: the chorded shortcuts other components own on the left, the `g`-then-key jumps on the right. |
| `keyboard-shortcuts-dialog-dark.png`     | The same dialog on the dark theme, which it inherits from `Theme.css` rather than declaring for itself.                  |
| `keyboard-shortcuts-narrow.png`          | A narrow screen, where the two columns stack.                                                                            |
| `keyboard-shortcuts-help-menu.png`       | The Help menu, where the dialog is reachable by mouse — with the keycap that teaches the shortcut on the way past.       |
| `keyboard-shortcuts-command-palette.png` | The same dialog offered as a command-palette action, for anyone who reaches for `Cmd`/`Ctrl`+`K` first.                  |

Keycaps follow the machine they are rendered on; these were shot on macOS, so
the modifier reads `⌘`. On Windows and Linux the same rows read `Ctrl`.

Re-shoot these when the dialog's layout or the shortcut catalog changes.
