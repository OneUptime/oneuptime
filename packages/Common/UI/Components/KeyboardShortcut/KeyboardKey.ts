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

/*
 * The words that name each named key where a shortcut is said rather than
 * drawn: the screen-reader label beside the keycaps, a header button's
 * tooltip. A front end hands in the reader's own (useSpokenKeyNames, from
 * the keyboardKeys entries of its locale, #7484); every other caller gets
 * the English.
 */
export interface SpokenKeyNames {
  // The Apple platform's primary modifier, ⌘.
  command: string;
  control: string;
  // The Apple platform's Alt key, ⌥.
  option: string;
  /*
   * Not `alt`: the Dashboard's extraction reads a property of that name as
   * an image's alt text, and would make "Alt" a word of its own.
   */
  altKey: string;
  shift: string;
  enter: string;
  escape: string;
  backspace: string;
  delete: string;
  tab: string;
  space: string;
  arrowUp: string;
  arrowDown: string;
  arrowLeft: string;
  arrowRight: string;
  // The Windows logo key (Meta on a PC).
  windows: string;
}

export const ENGLISH_SPOKEN_KEY_NAMES: Readonly<SpokenKeyNames> = {
  command: "Command",
  control: "Control",
  option: "Option",
  altKey: "Alt",
  shift: "Shift",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  space: "Space",
  arrowUp: "Up arrow",
  arrowDown: "Down arrow",
  arrowLeft: "Left arrow",
  arrowRight: "Right arrow",
  windows: "Windows",
};

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
   * inconsistently (or not at all), so shortcuts are labelled in words: the
   * reader's own when `names` is given (useSpokenKeyNames: "Strg" and
   * "Pfeil nach oben" in German), English otherwise.
   */
  public static getSpokenKey(
    key: KeyboardShortcutKey,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
    names: Readonly<SpokenKeyNames> = ENGLISH_SPOKEN_KEY_NAMES,
  ): string {
    switch (key) {
      case KeyboardKey.Mod:
        return isApplePlatform ? names.command : names.control;
      case KeyboardKey.Meta:
        return isApplePlatform ? names.command : names.windows;
      case KeyboardKey.Control:
        return names.control;
      case KeyboardKey.Alt:
        return isApplePlatform ? names.option : names.altKey;
      case KeyboardKey.Shift:
        return names.shift;
      case KeyboardKey.Enter:
        return names.enter;
      case KeyboardKey.Escape:
        return names.escape;
      case KeyboardKey.Backspace:
        return names.backspace;
      case KeyboardKey.Delete:
        return names.delete;
      case KeyboardKey.Tab:
        return names.tab;
      case KeyboardKey.Space:
        return names.space;
      case KeyboardKey.ArrowUp:
        return names.arrowUp;
      case KeyboardKey.ArrowDown:
        return names.arrowDown;
      case KeyboardKey.ArrowLeft:
        return names.arrowLeft;
      case KeyboardKey.ArrowRight:
        return names.arrowRight;
      default:
        return key.length === 1 ? key.toUpperCase() : key;
    }
  }

  /**
   * A full shortcut written out for tooltips and screen readers, e.g.
   * "Command + I" or "Control + I" - in the reader's words when `names` is
   * given ("Strg + I").
   */
  public static getShortcutLabel(
    keys: Array<KeyboardShortcutKey>,
    isApplePlatform: boolean = PlatformUtil.isApplePlatform(),
    names: Readonly<SpokenKeyNames> = ENGLISH_SPOKEN_KEY_NAMES,
  ): string {
    return keys
      .map((key: KeyboardShortcutKey) => {
        return this.getSpokenKey(key, isApplePlatform, names);
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
