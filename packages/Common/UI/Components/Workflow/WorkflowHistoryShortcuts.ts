import { WorkflowHistoryDirection } from "./WorkflowEditHistory";
import KeyboardKey, {
  KeyboardShortcutKey,
} from "../KeyboardShortcut/KeyboardKey";
import {
  KeyboardEventLike,
  hasOpenModalDialog,
  isTextEntryTarget,
} from "../../Utils/GlobalKeyboardShortcut";

/*
 * THE BUILDER'S UNDO AND REDO SHORTCUTS: ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z
 * redoes, and so does Ctrl+Y, as on Windows. ⌘Y is left alone: on a Mac it is
 * the browser's History.
 *
 * They never take a key from whoever is typing. A field, a text area, a code
 * editor or anything else that takes text undoes its own typing, so a
 * shortcut pressed there is the field's; so is one pressed while a dialog or
 * a panel is open, since the canvas is behind it. Pure: the page asks these
 * on every keydown.
 */

// The parts of a keydown the shortcuts read.
export interface WorkflowHistoryKeyEvent extends KeyboardEventLike {
  // The key's place on the keyboard, whatever it types: "KeyZ".
  code?: string | undefined;
  // True while an input method is composing a character.
  isComposing?: boolean | undefined;
}

/*
 * The keys a button's tooltip names, as the reader's platform writes them:
 * ⌘Z and ⇧⌘Z on a Mac, Ctrl+Z and Ctrl+Y elsewhere. Every one of the
 * shortcuts above works on either; these are the ones people there know.
 */
export const getWorkflowHistoryShortcutKeys: (data: {
  direction: WorkflowHistoryDirection;
  isApplePlatform: boolean;
}) => Array<KeyboardShortcutKey> = (data: {
  direction: WorkflowHistoryDirection;
  isApplePlatform: boolean;
}): Array<KeyboardShortcutKey> => {
  if (data.direction === WorkflowHistoryDirection.Undo) {
    return [KeyboardKey.Mod, "Z"];
  }

  return data.isApplePlatform
    ? [KeyboardKey.Shift, KeyboardKey.Mod, "Z"]
    : [KeyboardKey.Mod, "Y"];
};

// A key that types one Latin letter.
const LATIN_LETTER: RegExp = /^[a-z]$/;

/*
 * Whether the key pressed is `letter` (lower case): by the character it types,
 * or - on a keyboard that types no Latin letter there (Russian, Greek) - by
 * its place, as the same shortcut works there in every editor.
 */
const isLetter: (event: WorkflowHistoryKeyEvent, letter: string) => boolean = (
  event: WorkflowHistoryKeyEvent,
  letter: string,
): boolean => {
  const key: string = (event.key || "").toLowerCase();

  if (key === letter) {
    return true;
  }

  const typesLatinLetter: boolean = LATIN_LETTER.test(key);

  return !typesLatinLetter && event.code === `Key${letter.toUpperCase()}`;
};

/*
 * Which of the two a keydown asks for, or null for neither. Only the
 * keys: whether the builder should act on it is shouldWorkflowHandleHistoryShortcut.
 */
export const getWorkflowHistoryShortcut: (
  event: WorkflowHistoryKeyEvent,
) => WorkflowHistoryDirection | null = (
  event: WorkflowHistoryKeyEvent,
): WorkflowHistoryDirection | null => {
  if (event.altKey) {
    return null;
  }

  const isModifierDown: boolean = Boolean(event.metaKey || event.ctrlKey);

  if (!isModifierDown) {
    return null;
  }

  if (isLetter(event, "z")) {
    return event.shiftKey
      ? WorkflowHistoryDirection.Redo
      : WorkflowHistoryDirection.Undo;
  }

  // Ctrl+Y, as Windows redoes. Never ⌘Y, which is the browser's History on a Mac.
  if (
    isLetter(event, "y") &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    return WorkflowHistoryDirection.Redo;
  }

  return null;
};

// What the shortcut is read against: the element focused, and the page.
interface ElementLike {
  closest?: ((selector: string) => unknown) | undefined;
}

/*
 * Anything that takes text, beyond the inputs isTextEntryTarget knows: a
 * code editor's own surface (Monaco, CodeMirror), and any element that says
 * it is a text box.
 */
const TEXT_TAKING_ANCESTORS: string =
  '.monaco-editor, .cm-editor, .CodeMirror, [role="textbox"], [contenteditable]:not([contenteditable="false"])';

// A dialog or a panel the canvas is behind.
const DIALOG_ANCESTORS: string = '[role="dialog"], [role="alertdialog"]';

const isInside: (target: unknown, selector: string) => boolean = (
  target: unknown,
  selector: string,
): boolean => {
  const element: ElementLike | null =
    target && typeof target === "object" ? (target as ElementLike) : null;

  if (!element || typeof element.closest !== "function") {
    return false;
  }

  try {
    return Boolean(element.closest(selector));
  } catch {
    return false;
  }
};

/*
 * Whether the builder takes a keydown that asks for Undo or Redo: not one
 * another handler took already, not one typed into anything that takes
 * text, not one while an input method composes, and not one pressed in a
 * dialog or panel or while a dialog is open over the canvas.
 */
export const shouldWorkflowHandleHistoryShortcut: (data: {
  event: WorkflowHistoryKeyEvent;
  page: ParentNode | null | undefined;
}) => boolean = (data: {
  event: WorkflowHistoryKeyEvent;
  page: ParentNode | null | undefined;
}): boolean => {
  const event: WorkflowHistoryKeyEvent = data.event;

  if (event.defaultPrevented || event.isComposing) {
    return false;
  }

  if (isTextEntryTarget(event.target)) {
    return false;
  }

  if (isInside(event.target, TEXT_TAKING_ANCESTORS)) {
    return false;
  }

  if (isInside(event.target, DIALOG_ANCESTORS)) {
    return false;
  }

  return !hasOpenModalDialog(data.page);
};
