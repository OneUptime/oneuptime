import PlatformUtil from "../../Utils/Platform";

/**
 * Named keys for keyboard shortcut hints. Anything not in this list (letters,
 * digits, "/", "?") can be passed through as a plain string.
 */
enum KeyboardKey {
  /**
   * The primary shortcut modifier of the platform: ⌘ on Apple hardware,
   * Ctrl everywhere else. Use this for shortcuts handled with
   * `event.metaKey || event.ctrlKey`.
   */
  Mod = "Mod",
  Meta = "Meta",
  Control = "Control",
  Alt = "Alt",
  Shift = "Shift",
  Enter = "Enter",
  Escape = "Escape",
  Backspace = "Backspace",
  Delete = "Delete",
  Tab = "Tab",
  Space = "Space",
  ArrowUp = "ArrowUp",
  ArrowDown = "ArrowDown",
  ArrowLeft = "ArrowLeft",
  ArrowRight = "ArrowRight",
}

export type KeyboardShortcutKey = KeyboardKey | string;

/**
 * Renders shortcut keys the way the user's own platform writes them. macOS
 * users read ⌘⇧K; Windows and Linux users read Ctrl Shift K — the same
 * shortcut, spelled in the convention they already know.
 */
export class KeyboardKeyUtil {
  /**
   * The glyph or short word shown on the keycap.
   */
  public static getDisplayKey(
    key: KeyboardShortcutKey,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
  ): string {
    switch (key) {
      case KeyboardKey.Mod:
        return isApplePlatform ? "⌘" : "Ctrl";
      case KeyboardKey.Meta:
        return isApplePlatform ? "⌘" : "Win";
      case KeyboardKey.Control:
        return isApplePlatform ? "⌃" : "Ctrl";
      case KeyboardKey.Alt:
        return isApplePlatform ? "⌥" : "Alt";
      case KeyboardKey.Shift:
        return isApplePlatform ? "⇧" : "Shift";
      case KeyboardKey.Enter:
        return isApplePlatform ? "↵" : "Enter";
      case KeyboardKey.Escape:
        return "Esc";
      case KeyboardKey.Backspace:
        return isApplePlatform ? "⌫" : "Backspace";
      case KeyboardKey.Delete:
        return isApplePlatform ? "⌦" : "Del";
      case KeyboardKey.Tab:
        return isApplePlatform ? "⇥" : "Tab";
      case KeyboardKey.Space:
        return "Space";
      case KeyboardKey.ArrowUp:
        return "↑";
      case KeyboardKey.ArrowDown:
        return "↓";
      case KeyboardKey.ArrowLeft:
        return "←";
      case KeyboardKey.ArrowRight:
        return "→";
      default:
        // Single characters read better capitalised: "i" -> "I".
        return key.length === 1 ? key.toUpperCase() : key;
    }
  }

  /**
   * The spoken name for screen readers — glyphs like ⌘ are announced
   * inconsistently (or not at all), so shortcuts are labelled in words.
   */
  public static getSpokenKey(
    key: KeyboardShortcutKey,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
  ): string {
    switch (key) {
      case KeyboardKey.Mod:
        return isApplePlatform ? "Command" : "Control";
      case KeyboardKey.Meta:
        return isApplePlatform ? "Command" : "Windows";
      case KeyboardKey.Control:
        return "Control";
      case KeyboardKey.Alt:
        return isApplePlatform ? "Option" : "Alt";
      case KeyboardKey.Shift:
        return "Shift";
      case KeyboardKey.Enter:
        return "Enter";
      case KeyboardKey.Escape:
        return "Escape";
      case KeyboardKey.Backspace:
        return "Backspace";
      case KeyboardKey.Delete:
        return "Delete";
      case KeyboardKey.Tab:
        return "Tab";
      case KeyboardKey.Space:
        return "Space";
      case KeyboardKey.ArrowUp:
        return "Up arrow";
      case KeyboardKey.ArrowDown:
        return "Down arrow";
      case KeyboardKey.ArrowLeft:
        return "Left arrow";
      case KeyboardKey.ArrowRight:
        return "Right arrow";
      default:
        return key.length === 1 ? key.toUpperCase() : key;
    }
  }

  /**
   * A full shortcut written out for tooltips and aria-labels, e.g.
   * "Command + I" or "Control + I".
   */
  public static getShortcutLabel(
    keys: Array<KeyboardShortcutKey>,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
  ): string {
    return keys
      .map((key: KeyboardShortcutKey) => {
        return this.getSpokenKey(key, isApplePlatform);
      })
      .join(" + ");
  }

  /**
   * The shortcut written with the platform's own glyphs, for plain-text spots
   * that cannot render keycaps — "⌘B" on a Mac, "Ctrl+B" elsewhere.
   */
  public static getDisplayLabel(
    keys: Array<KeyboardShortcutKey>,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
  ): string {
    return keys
      .map((key: KeyboardShortcutKey) => {
        return this.getDisplayKey(key, isApplePlatform);
      })
      .join(isApplePlatform ? "" : "+");
  }

  /**
   * The shortcut in the token syntax the `aria-keyshortcuts` attribute expects
   * (e.g. "Meta+I"), so assistive tech can announce and index it.
   */
  public static getAriaKeyShortcuts(
    keys: Array<KeyboardShortcutKey>,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
  ): string {
    return keys
      .map((key: KeyboardShortcutKey) => {
        switch (key) {
          case KeyboardKey.Mod:
            return isApplePlatform ? "Meta" : "Control";
          case KeyboardKey.ArrowUp:
            return "ArrowUp";
          case KeyboardKey.ArrowDown:
            return "ArrowDown";
          case KeyboardKey.ArrowLeft:
            return "ArrowLeft";
          case KeyboardKey.ArrowRight:
            return "ArrowRight";
          default:
            return key.length === 1 ? key.toUpperCase() : key;
        }
      })
      .join("+");
  }
}

export default KeyboardKey;
