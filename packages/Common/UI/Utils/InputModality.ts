/*
 * Whether the person's last press was a key or a pointer - the mouse, a
 * pen or a finger.
 *
 * Focus says little on its own about who moved it. A script moves it all
 * the time on the person's behalf: a menu opened with the mouse focuses its
 * first item, and a dialog that closes hands focus back to the button that
 * opened it. Something that answers focus as if it were the keyboard's - a
 * tooltip that shows on focus - then pops up under the mouse user's pointer
 * unasked, and stays until focus leaves. Asked here, it can tell the two
 * apart: the keyboard's focus follows a key, a script's after a click
 * follows a pointer press.
 *
 * Until either has happened - a page that has just loaded, or a test that
 * moves focus itself - focus counts as the keyboard's, which is what every
 * focus counted as before this was asked.
 */

export enum InputModality {
  Keyboard = "keyboard",
  Pointer = "pointer",
}

let lastInputModality: InputModality = InputModality.Keyboard;
let isListening: boolean = false;

const onKeyDown: (event: KeyboardEvent) => void = (
  event: KeyboardEvent,
): void => {
  /*
   * A shortcut held with a modifier (Cmd+Tab away and back, Ctrl+C) is not
   * someone moving through the page with the keys.
   */
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  lastInputModality = InputModality.Keyboard;
};

const onPointerDown: () => void = (): void => {
  lastInputModality = InputModality.Pointer;
};

/*
 * Starts listening, once per page. Captured, so a handler that stops its
 * event from spreading cannot hide the press. Only on a document that can
 * be listened to: a test without a DOM may stand a bare one in.
 */
export const listenForInputModality: () => void = (): void => {
  if (
    isListening ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }

  isListening = true;

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  // Browsers and test environments that send mouse events alone.
  document.addEventListener("mousedown", onPointerDown, true);
};

/*
 * From the moment the module loads, not the first time it is asked: the
 * first menu opened with the mouse is asked about after the press that
 * opened it, which a listener added then would have missed.
 */
listenForInputModality();

export const getLastInputModality: () => InputModality = (): InputModality => {
  listenForInputModality();

  return lastInputModality;
};

export const wasLastInputFromKeyboard: () => boolean = (): boolean => {
  return getLastInputModality() === InputModality.Keyboard;
};
