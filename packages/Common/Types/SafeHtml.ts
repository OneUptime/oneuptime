/*
 * A value that is ALREADY HTML and may go into an HTML document as written.
 *
 * Status page subscriber emails are filled from two kinds of value, and a
 * plain string cannot say which one it holds:
 *
 *   - plain text: an incident, episode, maintenance or announcement title, a
 *     severity or state name, a status page or resource name, a URL. Project
 *     members type these, and a title is exactly what someone outside the
 *     team gets to influence (an incident created from a monitor, an API
 *     call, a Slack command). Put into HTML as written, a title such as
 *     `<a href="https://evil.example">Reset your password</a>` becomes a live
 *     link in an email the recipient trusts.
 *   - HTML this code produced itself: Markdown.convertToHTML output (which
 *     escapes the raw HTML an author typed and keeps only http, https and
 *     mailto links), the date helper's multi-timezone HTML, and the resource
 *     list StatusPageResourceUtil.getResourcesGroupedByGroupName builds from
 *     escaped names.
 *
 * So the HTML ones travel wrapped in this type, and anything that is still a
 * string is treated as plain text and escaped where it meets HTML (see
 * SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate). A value
 * nobody thought about is therefore escaped, which at worst shows the reader
 * an "&amp;" too many; it can never become markup by accident.
 *
 * Kept free of server dependencies so both the server and the dashboard can
 * use it.
 */

/*
 * Marks instances without instanceof, which a second copy of this module (a
 * test's isolated module registry, a duplicated bundle) would defeat.
 */
const SAFE_HTML_BRAND: unique symbol = Symbol.for("OneUptime.SafeHtml");

export default class SafeHtml {
  // Read by isSafeHtml; a symbol key, so JSON.stringify leaves it out.
  public readonly [SAFE_HTML_BRAND]: boolean = true;

  private readonly html: string;

  private constructor(html: string) {
    this.html = html;
  }

  /*
   * Wraps markup this code produced from values it had already made safe:
   * Markdown.convertToHTML(..., MarkdownContentType.Email) output,
   * OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones output, and
   * StatusPageResourceUtil.getResourcesGroupedByGroupName output. Never a
   * value a user typed.
   */
  public static fromTrustedHtml(html: string | null | undefined): SafeHtml {
    return new SafeHtml(html || "");
  }

  // Plain text, escaped so it reads the same in HTML.
  public static fromPlainText(text: string | null | undefined): SafeHtml {
    return new SafeHtml(SafeHtml.escape(text || ""));
  }

  /*
   * Escapes the five characters that can break out of HTML text or a quoted
   * attribute value. The ampersand goes first, so the entities the other
   * four become are not escaped a second time.
   *
   * This is the one implementation: Markdown.escapeHtml calls it.
   */
  public static escape(text: string): string {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  public static isSafeHtml(value: unknown): value is SafeHtml {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as { [SAFE_HTML_BRAND]?: unknown })[SAFE_HTML_BRAND] === true
    );
  }

  public toHtml(): string {
    return this.html;
  }

  public toString(): string {
    return this.html;
  }
}
