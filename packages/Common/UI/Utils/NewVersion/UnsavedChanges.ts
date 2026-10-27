import { useLayoutEffect } from "react";

/*
 * Whether this page holds something the reader typed and has not saved yet:
 * what a reload would throw away.
 *
 * Nothing reloads the page while it does. A new version of OneUptime is
 * reached on the reader's next page instead, and the Reload a notice offers
 * asks first (NewVersion, NewVersionNotice, ChunkLoadRecovery).
 *
 * It is read from the page itself, so no form or editor has to report it:
 * typing in a field fires an input event, and one listener on the document
 * hears every one of them, in every frontend. What was typed counts while
 * it is still on the page.
 *
 *   - A field inside a form scope (BasicForm marks its root with
 *     data-unsaved-changes-scope) makes the whole form count, whatever was
 *     changed in it - a pick, a toggle, text - until the form is saved
 *     (markSaved) or leaves the page.
 *   - Any other text field counts while it still holds text: the AI chat's
 *     message, a note, a comment.
 *   - A search or filter box never counts, in a form or out of one: what is
 *     typed in it is a query, and losing it costs nothing. Such a box says
 *     so - every search and filter box in the product carries
 *     data-unsaved-changes-ignore (Common/Tests/UI/
 *     SearchBoxesNeverUnsavedGuard keeps it so), or is an input of type
 *     search or a searchbox - and anything under the attribute is left out
 *     with it (a table's filters, a dropdown's own search).
 *
 * A form counts from its first change however it was made: a pick from a
 * dropdown or a picker fires no input event, so BasicForm notes every edit
 * of its values itself (noteChange) - and a search typed inside a form to
 * find what to pick is no change to the form until something is picked.
 *
 * Changes that are not typed - a dashboard's layout being edited, steps
 * moved around - are held explicitly while they are there
 * (useUnsavedChanges).
 */

export const UNSAVED_CHANGES_SCOPE_ATTRIBUTE: string =
  "data-unsaved-changes-scope";

export const UNSAVED_CHANGES_IGNORE_ATTRIBUTE: string =
  "data-unsaved-changes-ignore";

/*
 * Inputs that hold no text of their own. (A search input holds a query:
 * isSearchOrFilterField leaves it out before this is asked.)
 */
const UNTYPED_INPUT_TYPES: ReadonlySet<string> = new Set<string>([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const getElement: (target: EventTarget | null) => Element | null = (
  target: EventTarget | null,
): Element | null => {
  if (!target || typeof Element === "undefined") {
    return null;
  }

  return target instanceof Element ? target : null;
};

const isContentEditable: (element: Element) => boolean = (
  element: Element,
): boolean => {
  return (
    (element as HTMLElement).isContentEditable === true ||
    element.getAttribute("contenteditable") === "true" ||
    element.getAttribute("contenteditable") === ""
  );
};

/*
 * A box that searches or filters what the page shows: one under
 * data-unsaved-changes-ignore, an input of type search, or a searchbox.
 */
export const isSearchOrFilterField: (element: Element) => boolean = (
  element: Element,
): boolean => {
  if (element.closest(`[${UNSAVED_CHANGES_IGNORE_ATTRIBUTE}]`)) {
    return true;
  }

  if (
    element.tagName.toLowerCase() === "input" &&
    ((element as HTMLInputElement).type || "").toLowerCase() === "search"
  ) {
    return true;
  }

  return (element.getAttribute("role") || "").toLowerCase() === "searchbox";
};

// A field the reader types text into.
const isTextField: (element: Element) => boolean = (
  element: Element,
): boolean => {
  const tagName: string = element.tagName.toLowerCase();

  if (tagName === "textarea") {
    return true;
  }

  if (tagName === "input") {
    const type: string = (
      (element as HTMLInputElement).type || "text"
    ).toLowerCase();

    return !UNTYPED_INPUT_TYPES.has(type);
  }

  return isContentEditable(element);
};

/*
 * A page the reader is leaving while the next one's code downloads: React
 * keeps it mounted under the Suspense fallback until the next page can be
 * shown, hidden with an inline `display: none !important` on its top
 * elements - and drops it then. What was typed in it is going either way, so
 * it does not hold a full load of the next page back. Nothing else in the
 * product hides with an important inline display (a closed section or a
 * tab uses a class), so this never mistakes a form that is only folded away.
 */
const isOnItsWayOut: (element: Element) => boolean = (
  element: Element,
): boolean => {
  let current: Element | null = element;

  while (current) {
    const style: CSSStyleDeclaration | undefined = (current as HTMLElement)
      .style;

    if (
      style &&
      style.getPropertyValue("display") === "none" &&
      style.getPropertyPriority("display") === "important"
    ) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
};

const holdsText: (element: Element) => boolean = (
  element: Element,
): boolean => {
  const tagName: string = element.tagName.toLowerCase();

  if (tagName === "textarea" || tagName === "input") {
    const value: unknown = (element as HTMLInputElement).value;
    return typeof value === "string" && value.trim().length > 0;
  }

  return (element.textContent || "").trim().length > 0;
};

export default class UnsavedChanges {
  private static isInstalled: boolean = false;

  // Form scopes something was changed in.
  private static changedScopes: Set<Element> = new Set<Element>();

  // Text fields outside any scope that were typed in.
  private static typedFields: Set<Element> = new Set<Element>();

  // Changes held explicitly (useUnsavedChanges), one token each.
  private static holds: Set<symbol> = new Set<symbol>();

  /*
   * Lets go of forms and fields that have left the page: what was typed in
   * them went with them. Done as anything is added, so a long session that
   * opens and closes form after form keeps no hold on the ones it closed.
   */
  private static forgetWhatLeftThePage(): void {
    for (const scope of Array.from(UnsavedChanges.changedScopes)) {
      if (!scope.isConnected) {
        UnsavedChanges.changedScopes.delete(scope);
      }
    }

    for (const field of Array.from(UnsavedChanges.typedFields)) {
      if (!field.isConnected) {
        UnsavedChanges.typedFields.delete(field);
      }
    }
  }

  private static onInput(event: Event): void {
    const element: Element | null = getElement(event.target);

    if (!element) {
      return;
    }

    // A query, in a form or out of one: never work to keep.
    if (isSearchOrFilterField(element)) {
      return;
    }

    const scope: Element | null = element.closest(
      `[${UNSAVED_CHANGES_SCOPE_ATTRIBUTE}]`,
    );

    if (scope) {
      UnsavedChanges.forgetWhatLeftThePage();
      UnsavedChanges.changedScopes.add(scope);
      return;
    }

    if (isTextField(element)) {
      UnsavedChanges.forgetWhatLeftThePage();
      UnsavedChanges.typedFields.add(element);
    }
  }

  /*
   * A change the reader made inside a form that no input event announced: a
   * pick from a dropdown, a picker or a list, a value a field's own control
   * set. BasicForm calls it for every edit of its values. The form it is in
   * counts from then on, as if it had been typed in; outside a form scope
   * it does nothing, as a pick outside a form was never held.
   */
  public static noteChange(element: Element | null | undefined): void {
    if (!UnsavedChanges.isInstalled || !element) {
      return;
    }

    const scope: Element | null = element.closest(
      `[${UNSAVED_CHANGES_SCOPE_ATTRIBUTE}]`,
    );

    if (!scope) {
      return;
    }

    UnsavedChanges.forgetWhatLeftThePage();
    UnsavedChanges.changedScopes.add(scope);
  }

  // Starts listening. Safe to call more than once.
  public static install(): void {
    if (UnsavedChanges.isInstalled || typeof document === "undefined") {
      return;
    }

    UnsavedChanges.isInstalled = true;

    /*
     * Capturing, so a field that stops its own events from bubbling is
     * still heard. "change" too: some pickers only fire that one.
     */
    document.addEventListener("input", UnsavedChanges.onInput, true);
    document.addEventListener("change", UnsavedChanges.onInput, true);
  }

  public static hasUnsavedChanges(): boolean {
    if (UnsavedChanges.holds.size > 0) {
      return true;
    }

    let hasChanges: boolean = false;

    for (const scope of Array.from(UnsavedChanges.changedScopes)) {
      if (!scope.isConnected) {
        // It left the page, and what was typed in it went with it.
        UnsavedChanges.changedScopes.delete(scope);
        continue;
      }

      if (!isOnItsWayOut(scope)) {
        hasChanges = true;
      }
    }

    for (const field of Array.from(UnsavedChanges.typedFields)) {
      if (!field.isConnected) {
        UnsavedChanges.typedFields.delete(field);
        continue;
      }

      if (holdsText(field) && !isOnItsWayOut(field)) {
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  // A form was saved: what was typed in it is no longer at risk.
  public static markSaved(scope: Element | null | undefined): void {
    if (!scope) {
      return;
    }

    UnsavedChanges.changedScopes.delete(scope);

    for (const field of Array.from(UnsavedChanges.typedFields)) {
      if (scope.contains(field)) {
        UnsavedChanges.typedFields.delete(field);
      }
    }
  }

  // Holds changes that are not typed until the returned function is called.
  public static hold(): () => void {
    const token: symbol = Symbol("unsaved-changes");

    UnsavedChanges.holds.add(token);

    return (): void => {
      UnsavedChanges.holds.delete(token);
    };
  }

  // For tests: forgets everything and stops listening.
  public static reset(): void {
    if (UnsavedChanges.isInstalled && typeof document !== "undefined") {
      document.removeEventListener("input", UnsavedChanges.onInput, true);
      document.removeEventListener("change", UnsavedChanges.onInput, true);
    }

    UnsavedChanges.isInstalled = false;
    UnsavedChanges.changedScopes.clear();
    UnsavedChanges.typedFields.clear();
    UnsavedChanges.holds.clear();
  }
}

/*
 * Holds changes the reader has not saved while `hasUnsavedChanges` is true.
 * A layout effect, so a page leaving the screen lets go in the same commit
 * that removes it - before anything that runs after the commit asks.
 */
export const useUnsavedChanges: (hasUnsavedChanges: boolean) => void = (
  hasUnsavedChanges: boolean,
): void => {
  useLayoutEffect(() => {
    if (!hasUnsavedChanges) {
      return undefined;
    }

    return UnsavedChanges.hold();
  }, [hasUnsavedChanges]);
};
