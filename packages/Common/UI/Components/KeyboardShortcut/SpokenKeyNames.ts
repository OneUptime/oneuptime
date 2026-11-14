import { SpokenKeyNames } from "./KeyboardKey";
import { useTranslation } from "react-i18next";

/*
 * THE KEYS OF A SHORTCUT, SAID IN THE READER'S LANGUAGE (#7484).
 *
 * A shortcut is drawn as keycaps (Ctrl, ⌘, Esc, ↑: what keyboards print, the
 * same in every language) and said in words: the screen-reader label beside
 * the keycaps ("Control + K") and a header button's tooltip ("Search ·
 * Control + K"). Those words were English in every language, so a Russian
 * page said "Справка · Control + /".
 *
 * Each language names a key the way its keyboards and its platform's own
 * help name it: a key with its name printed on it reads as that language's
 * keyboards print it ("Strg", "Umschalt", "Entf" in German; "Maj", "Échap"
 * in French; "Ctrl", "Shift", "Tab" in Russian or Japanese, whose keyboards
 * print the English), and a key with no word on it - the arrows, the space
 * bar - is named in the language ("Стрелка вверх", "Leertaste").
 *
 * The words are nested keys (keyboardKeys.*), not the English text: "Delete"
 * and "Command" are flat keys already, for the verb and for a command to run
 * ("Löschen", "Befehl"), and a key is neither. Each lookup is written out
 * with its English, so the Dashboard's extraction (npm run i18n:extract)
 * finds it. A front end whose locale has no keyboardKeys entry, or no
 * i18next at all, reads the English.
 */

const KEY_PATH_PREFIX: string = "keyboardKeys.";

/*
 * What a lookup said, or the English where it said nothing of its own: a
 * lookup that answers with the key ("keyboardKeys.shift") has no wording.
 */
const orEnglish: (said: unknown, english: string) => string = (
  said: unknown,
  english: string,
): string => {
  return typeof said === "string" &&
    said.trim().length > 0 &&
    !said.startsWith(KEY_PATH_PREFIX)
    ? said
    : english;
};

export const useSpokenKeyNames: () => SpokenKeyNames = (): SpokenKeyNames => {
  const { t } = useTranslation();

  return {
    command: orEnglish(t("keyboardKeys.command", "Command"), "Command"),
    control: orEnglish(t("keyboardKeys.control", "Control"), "Control"),
    option: orEnglish(t("keyboardKeys.option", "Option"), "Option"),
    altKey: orEnglish(t("keyboardKeys.alt", "Alt"), "Alt"),
    shift: orEnglish(t("keyboardKeys.shift", "Shift"), "Shift"),
    enter: orEnglish(t("keyboardKeys.enter", "Enter"), "Enter"),
    escape: orEnglish(t("keyboardKeys.escape", "Escape"), "Escape"),
    backspace: orEnglish(t("keyboardKeys.backspace", "Backspace"), "Backspace"),
    delete: orEnglish(t("keyboardKeys.delete", "Delete"), "Delete"),
    tab: orEnglish(t("keyboardKeys.tab", "Tab"), "Tab"),
    space: orEnglish(t("keyboardKeys.space", "Space"), "Space"),
    arrowUp: orEnglish(t("keyboardKeys.arrowUp", "Up arrow"), "Up arrow"),
    arrowDown: orEnglish(
      t("keyboardKeys.arrowDown", "Down arrow"),
      "Down arrow",
    ),
    arrowLeft: orEnglish(
      t("keyboardKeys.arrowLeft", "Left arrow"),
      "Left arrow",
    ),
    arrowRight: orEnglish(
      t("keyboardKeys.arrowRight", "Right arrow"),
      "Right arrow",
    ),
    windows: orEnglish(t("keyboardKeys.windows", "Windows"), "Windows"),
  };
};

export default useSpokenKeyNames;
