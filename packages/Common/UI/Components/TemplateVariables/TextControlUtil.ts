/*
 * What the template variable pickers need from a plain text control - a
 * <textarea> or a text <input>, which is what a text field, a long text
 * field, the code editor and the Markdown editor's source view all are:
 *
 *   - where the cursor is on screen, so the list that "{{" opens appears
 *     under it rather than under the whole field;
 *   - putting a variable in, in place of a range, the way typing would: as one
 *     step Ctrl+Z takes back, and through the control's own change handling,
 *     so the form hears of it like any other edit.
 */

export type TextControl = HTMLTextAreaElement | HTMLInputElement;

// The input types that hold free text a variable can go into.
const TEXT_INPUT_TYPES: Array<string> = ["text", "search", "url", "email", ""];

export type IsTextControlFunction = (
  element: Element | null | undefined,
) => element is TextControl;

export const isTextControl: IsTextControlFunction = (
  element: Element | null | undefined,
): element is TextControl => {
  if (!element) {
    return false;
  }

  if (element.tagName === "TEXTAREA") {
    return true;
  }

  if (element.tagName === "INPUT") {
    return TEXT_INPUT_TYPES.includes(
      ((element as HTMLInputElement).getAttribute("type") || "").toLowerCase(),
    );
  }

  return false;
};

export type FindTextControlFunction = (
  container: Element | null | undefined,
) => TextControl | null;

/**
 * The text control inside a field's wrapper: its textarea if it has one (a
 * long text field, a code editor), else its text input.
 */
export const findTextControl: FindTextControlFunction = (
  container: Element | null | undefined,
): TextControl | null => {
  if (!container) {
    return null;
  }

  const textarea: HTMLTextAreaElement | null =
    container.querySelector("textarea");

  if (textarea) {
    return textarea;
  }

  const inputs: Array<HTMLInputElement> = Array.from(
    container.querySelectorAll("input"),
  );

  return (
    inputs.find((input: HTMLInputElement): boolean => {
      return isTextControl(input);
    }) || null
  );
};

type MakeRectFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
) => DOMRect;

const makeRect: MakeRectFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect => {
  return {
    x: left,
    y: top,
    left: left,
    top: top,
    width: width,
    height: height,
    right: left + width,
    bottom: top + height,
    toJSON: (): object => {
      return { left, top, width, height };
    },
  } as DOMRect;
};

// The styles a hidden copy of the control needs to lay its text out the same.
const MIRRORED_PROPERTIES: Array<string> = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
];

const toPixels: (value: string | null | undefined) => number = (
  value: string | null | undefined,
): number => {
  const pixels: number = parseFloat(value || "");
  return Number.isFinite(pixels) ? pixels : 0;
};

export type GetTextControlCaretRectFunction = (
  control: TextControl,
  position: number,
) => DOMRect;

/**
 * Where the cursor at `position` is on screen: one pixel wide and a line
 * tall. A control has no API for it, so its text up to the position is laid
 * out in a hidden copy with the same styles and the end of it measured.
 * Where nothing can be measured (no layout, as in a test), the control's own
 * rectangle.
 */
export const getTextControlCaretRect: GetTextControlCaretRectFunction = (
  control: TextControl,
  position: number,
): DOMRect => {
  const controlRect: DOMRect = control.getBoundingClientRect();

  if (
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function" ||
    !document.body
  ) {
    return controlRect;
  }

  const computed: CSSStyleDeclaration = window.getComputedStyle(control);
  const isInput: boolean = control.tagName === "INPUT";
  const mirror: HTMLDivElement = document.createElement("div");
  const style: CSSStyleDeclaration = mirror.style;

  for (const property of MIRRORED_PROPERTIES) {
    (style as unknown as Record<string, string>)[property] =
      (computed as unknown as Record<string, string>)[property] || "";
  }

  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "-9999px";
  style.overflow = "hidden";
  style.whiteSpace = isInput ? "pre" : "pre-wrap";
  style.overflowWrap = isInput ? "normal" : "break-word";

  const value: string = control.value || "";
  const at: number = Math.max(0, Math.min(position, value.length));

  mirror.textContent = value.slice(0, at);

  const marker: HTMLSpanElement = document.createElement("span");
  // Something to measure even at the end of the text.
  marker.textContent = value.slice(at) || ".";
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  // Read while the copy is in the page: detached, every offset is 0.
  const markerLeft: number = marker.offsetLeft;
  const markerTop: number = marker.offsetTop;
  const markerHeight: number = marker.offsetHeight;

  document.body.removeChild(mirror);

  // No layout: nothing was measured, and the control's box is the best guess.
  if (markerHeight === 0 && markerLeft === 0 && markerTop === 0) {
    return controlRect;
  }

  const lineHeight: number =
    toPixels(computed.lineHeight) ||
    markerHeight ||
    toPixels(computed.fontSize) * 1.25 ||
    20;
  const left: number =
    controlRect.left +
    markerLeft +
    toPixels(computed.borderLeftWidth) -
    control.scrollLeft;
  const top: number =
    controlRect.top +
    markerTop +
    toPixels(computed.borderTopWidth) -
    control.scrollTop;

  return makeRect(
    Math.min(Math.max(left, controlRect.left), controlRect.right),
    Math.min(Math.max(top, controlRect.top), controlRect.bottom - lineHeight),
    1,
    lineHeight,
  );
};

export type InsertIntoTextControlFunction = (
  control: TextControl,
  start: number,
  end: number,
  text: string,
) => void;

/**
 * Puts `text` in place of start..end and leaves the cursor after it.
 *
 * execCommand("insertText") is how typing goes in: one step on the undo
 * stack, and an input event the control's owner (React's onChange) hears. A
 * browser without it - jsdom, or one that refuses the command - gets the
 * value set through the native setter and an input event of its own, which
 * React reads as a change too.
 */
export const insertIntoTextControl: InsertIntoTextControlFunction = (
  control: TextControl,
  start: number,
  end: number,
  text: string,
): void => {
  const value: string = control.value || "";
  const from: number = Math.max(0, Math.min(start, end, value.length));
  const to: number = Math.min(value.length, Math.max(start, end, 0));
  const expected: string = value.slice(0, from) + text + value.slice(to);
  const caret: number = from + text.length;

  control.focus();
  control.setSelectionRange(from, to);

  let inserted: boolean = false;

  if (typeof document.execCommand === "function") {
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
  }

  if (!inserted || control.value !== expected) {
    const prototype: object =
      control.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter: ((this: TextControl, value: string) => void) | undefined =
      Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (setter) {
      setter.call(control, expected);
    } else {
      control.value = expected;
    }

    control.dispatchEvent(new Event("input", { bubbles: true }));
  }

  control.setSelectionRange(caret, caret);
};
