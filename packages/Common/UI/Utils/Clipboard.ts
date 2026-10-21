/*
 * Clipboard writes that report whether anything was actually copied.
 *
 * `navigator.clipboard` is absent on plain-http origins (a self-hosted
 * install reached over a LAN hostname), inside some sandboxed frames and in
 * older browsers, and `writeText` rejects when the document is not focused.
 * An affordance that awaits an optional-chained call and then says
 * "Copied!" lies in every one of those cases (issue #5132: the status
 * page's Subscribe to calendar said "Copied!" over an empty clipboard). The
 * legacy execCommand path still works where the async API is missing, so
 * it is the fallback; the boolean is what lets a caller show "Copy failed"
 * instead of a green tick.
 *
 * Every copy control in the product writes through here - most through
 * useClipboardCopy (UseClipboardCopy.ts), which holds the Copied / Copy
 * failed state they draw - and ClipboardWritesGuard (Common/Tests/UI) fails
 * a direct navigator.clipboard or execCommand("copy") anywhere else. A
 * control says "Copied" only when copyToClipboard resolves true, and
 * otherwise says it could not, selecting the text where it is on screen
 * (selectForManualCopy) so it can be copied by hand.
 */
export default class Clipboard {
  public static async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);

        return true;
      }
    } catch {
      /*
       * The async API refused (document not focused, permission denied):
       * fall through to the legacy path rather than give up.
       */
    }

    return Clipboard.copyWithExecCommand(text);
  }

  /*
   * After a copy that failed: the text the control copies, selected where
   * it is shown, so the reader can copy it with the keyboard or the
   * browser's own menu - the one way left that always works. A field is
   * focused and selected whole; any other element has its text selected
   * (it takes no focus, so a keyboard reader stays on the button).
   */
  public static selectForManualCopy(
    element: HTMLElement | null | undefined,
  ): void {
    if (!element || !element.isConnected) {
      return;
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      element.focus();
      element.select();

      try {
        // iOS selects a read-only field only this way.
        element.setSelectionRange(0, element.value.length);
      } catch {
        // A field type with no text selection keeps what select() did.
      }

      return;
    }

    const selection: Selection | null =
      typeof window !== "undefined" && typeof window.getSelection === "function"
        ? window.getSelection()
        : null;

    if (!selection) {
      return;
    }

    selection.selectAllChildren(element);
  }

  /*
   * A hidden, read-only textarea selected and copied through the deprecated
   * command. Off-screen rather than display:none — a hidden element cannot
   * be selected, and selection is what the command copies.
   */
  private static copyWithExecCommand(text: string): boolean {
    if (
      typeof document === "undefined" ||
      typeof document.execCommand !== "function" ||
      !document.body
    ) {
      return false;
    }

    /*
     * Selecting the scratch textarea moves the focus to it, and removing it
     * then leaves the focus on <body>: a keyboard reader's place on the page
     * - or inside the dialog the copy button sits in - would be lost. The
     * focus goes back where it was once the copy is done.
     */
    const focusedBeforeCopy: Element | null = document.activeElement;

    const textarea: HTMLTextAreaElement = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    textarea.setAttribute("tabindex", "-1");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    // iOS zooms the page into a focused field whose text is under 16px.
    textarea.style.fontSize = "16px";

    document.body.appendChild(textarea);

    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      return document.execCommand("copy") === true;
    } catch {
      return false;
    } finally {
      textarea.remove();
      Clipboard.restoreFocus(focusedBeforeCopy);
    }
  }

  private static restoreFocus(element: Element | null): void {
    if (
      typeof HTMLElement === "undefined" ||
      !(element instanceof HTMLElement) ||
      element === document.body ||
      !element.isConnected ||
      document.activeElement === element
    ) {
      return;
    }

    try {
      element.focus({ preventScroll: true });
    } catch {
      // An element that cannot take the focus back keeps what it has.
    }
  }
}
