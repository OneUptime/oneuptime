/*
 * "Start from an outline" fills an empty AI context field with a heading
 * for each kind of note - and goes, as the field is no longer empty. Focus
 * would go with it, back to the page, and the next Tab would start again
 * from the dialog's top. It goes instead into the editor, the caret in the
 * outline's first item, under "How our systems fit together": where the
 * first note is written, for the keyboard and the mouse alike.
 *
 * The editor shows the outline only once the form has taken it, so it is
 * looked for a few times while the form redraws - and never once focus has
 * moved somewhere else meanwhile.
 *
 * React-free, so it is tested on its own.
 */

export const OUTLINE_FOCUS_TRIES: number = 10;

export const OUTLINE_FOCUS_INTERVAL_MS: number = 25;

// The visual editor, and its Markdown source.
const VISUAL_EDITOR_SELECTOR: string = "[role='textbox'][contenteditable]";
const SOURCE_EDITOR_SELECTOR: string = "textarea";

// An outline item, as the source writes it: "- " at the start of a line.
const SOURCE_ITEM_MARKER: string = "\n- ";

export interface OutlineFocusInput {
  // The button pressed: it is gone by the time the outline is drawn.
  from: Element | null;
  // The field's editor, by its test id (the form field's dataTestId).
  editorTestId: string;
}

// Whether focus is still where pressing the button left it.
function isFocusLeftBehind(ownerDocument: Document, from: Element): boolean {
  const active: Element | null = ownerDocument.activeElement;

  return (
    !active ||
    active === ownerDocument.body ||
    active === ownerDocument.documentElement ||
    from.contains(active)
  );
}

// The caret at the start of the visual editor's first list item.
function focusFirstItem(editable: HTMLElement): boolean {
  const item: Element | null = editable.querySelector("li");

  if (!item) {
    return false;
  }

  editable.focus();

  const view: (Window & typeof globalThis) | null =
    editable.ownerDocument.defaultView;
  const selection: Selection | null = view ? view.getSelection() : null;

  if (selection) {
    const range: Range = editable.ownerDocument.createRange();
    range.selectNodeContents(item);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return true;
}

// The caret after the source's first "- ".
function focusFirstSourceItem(textarea: HTMLTextAreaElement): boolean {
  const at: number = textarea.value.indexOf(SOURCE_ITEM_MARKER);

  if (at < 0) {
    return false;
  }

  const caret: number = at + SOURCE_ITEM_MARKER.length;

  textarea.focus();
  textarea.setSelectionRange(caret, caret);

  return true;
}

export function focusOutlineStart(input: OutlineFocusInput): void {
  const from: Element | null = input.from;

  if (!from) {
    return;
  }

  const ownerDocument: Document = from.ownerDocument;
  // Found now: once the button is gone, it has no dialog to look in.
  const scope: ParentNode = from.closest("[role='dialog']") || ownerDocument;
  let triesLeft: number = OUTLINE_FOCUS_TRIES;

  const tryToFocus: () => void = (): void => {
    if (!isFocusLeftBehind(ownerDocument, from)) {
      return;
    }

    const editor: Element | null = scope.querySelector(
      `[data-testid='${input.editorTestId}']`,
    );
    const editable: HTMLElement | null = editor
      ? editor.querySelector<HTMLElement>(VISUAL_EDITOR_SELECTOR)
      : null;
    const textarea: HTMLTextAreaElement | null = editor
      ? editor.querySelector<HTMLTextAreaElement>(SOURCE_EDITOR_SELECTOR)
      : null;

    /*
     * While the button is still drawn the form has not taken the outline
     * yet, and the editor still shows the empty field.
     */
    const isFocused: boolean =
      !from.isConnected &&
      ((editable !== null && focusFirstItem(editable)) ||
        (textarea !== null && focusFirstSourceItem(textarea)));

    if (isFocused) {
      return;
    }

    triesLeft--;

    if (triesLeft > 0) {
      setTimeout(tryToFocus, OUTLINE_FOCUS_INTERVAL_MS);
    }
  };

  setTimeout(tryToFocus, 0);
}
