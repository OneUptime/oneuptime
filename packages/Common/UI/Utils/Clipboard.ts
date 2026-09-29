/*
 * Clipboard writes that report whether anything was actually copied.
 *
 * `navigator.clipboard` is absent on plain-http origins (a self-hosted
 * install reached over a LAN hostname), inside some sandboxed frames and in
 * older browsers, and `writeText` rejects when the document is not focused.
 * An affordance that awaits an optional-chained call and then says
 * "Copied!" lies in every one of those cases. The legacy execCommand path
 * still works where the async API is missing, so it is the fallback; the
 * boolean is what lets a caller show "Copy failed" instead of a green tick.
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

    const textarea: HTMLTextAreaElement = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";

    document.body.appendChild(textarea);

    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      return document.execCommand("copy") === true;
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
}
