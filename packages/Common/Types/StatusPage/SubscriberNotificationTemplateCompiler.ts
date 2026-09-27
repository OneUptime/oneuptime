import SafeHtml from "../SafeHtml";

/*
 * Fills the {{variable}} placeholders of a status page's custom subscriber
 * notification templates.
 *
 * There are two ways in, and which one a template takes depends on what its
 * channel renders, never on the variables:
 *
 *   - compileEmailBodyTemplate, for the body of an EMAIL template. The body
 *     is sent as HTML (it is wrapped only by BlankTemplate), so a value is
 *     inserted as written only when it is a SafeHtml: Markdown the note or
 *     description was rendered from, the date helper's HTML, the escaped
 *     resource list. Every other value is plain text - a title, a severity or
 *     state name, a status page name, a URL - and is HTML-escaped first, so a
 *     title such as `<a href="https://evil.example">Reset your password</a>`
 *     reads as those characters instead of arriving as a live link.
 *   - compileTemplate, for everything that is NOT HTML: an email subject,
 *     SMS, Slack and Microsoft Teams. Those channels show text as written, so
 *     escaping would put "&amp;" in front of the reader. Its variables are
 *     strings, so a SafeHtml (HTML) value cannot reach one by mistake.
 *
 * The escaping is the default rather than something each sender remembers to
 * do: a sender that adds a new plain value to its email variables gets it
 * escaped without doing anything. App/Tests/SubscriberEmailBodyCompileCallSites
 * holds every email template body to compileEmailBodyTemplate.
 *
 * The admin who writes the template is trusted, as before: the template's own
 * HTML is sent as written. Only the values put into it are escaped.
 *
 * Kept free of server dependencies so the dashboard can fill placeholders too.
 */

export type SubscriberNotificationTextTemplateVariables = Record<
  string,
  string
>;

export type SubscriberNotificationEmailBodyTemplateVariables = Record<
  string,
  string | SafeHtml
>;

type RenderValueFunction = (name: string) => string | null;

/*
 * What may sit between the braces of a placeholder: ASCII letters, digits,
 * underscores and dots, and nothing else (`\w` without the `u` flag is ASCII
 * only). Written once so that the fill below and isPlaceholderName, which
 * the custom field template keys are generated against, cannot disagree.
 */
const PLACEHOLDER_NAME_SOURCE: string = "[\\w.]+";

const PLACEHOLDER_NAME_PATTERN: RegExp = new RegExp(
  `^${PLACEHOLDER_NAME_SOURCE}$`,
);

export default class SubscriberNotificationTemplateCompiler {
  /**
   * Whether `{{name}}` is a placeholder these templates fill in. A name with
   * any other character (a hyphen, a space, a non-ASCII letter) is left in
   * the message as written, so anything that hands out variable names -
   * incident custom field keys, for one - has to produce names this accepts.
   */
  public static isPlaceholderName(name: string): boolean {
    return PLACEHOLDER_NAME_PATTERN.test(name);
  }

  /**
   * Compile a template for a channel that does not render HTML: an email
   * subject, SMS, Slack or Microsoft Teams. Each {{variableName}} is replaced
   * with its value exactly as written.
   *
   * Never use this for the body of an email template: see
   * compileEmailBodyTemplate.
   */
  public static compileTemplate(
    template: string,
    variables: SubscriberNotificationTextTemplateVariables,
  ): string {
    return SubscriberNotificationTemplateCompiler.fillPlaceholders(
      template,
      (name: string): string | null => {
        if (!Object.prototype.hasOwnProperty.call(variables, name)) {
          return null;
        }

        return variables[name] || "";
      },
    );
  }

  /**
   * Compile the body of an EMAIL template, which is sent as HTML.
   *
   * A SafeHtml value is inserted as it is. Any other value is plain text and
   * is HTML-escaped, so it can neither add markup nor break out of the
   * attribute it is placed in (href="{{detailsUrl}}").
   */
  public static compileEmailBodyTemplate(
    template: string,
    variables: SubscriberNotificationEmailBodyTemplateVariables,
  ): string {
    return SubscriberNotificationTemplateCompiler.fillPlaceholders(
      template,
      (name: string): string | null => {
        if (!Object.prototype.hasOwnProperty.call(variables, name)) {
          return null;
        }

        const value: string | SafeHtml | undefined = variables[name];

        if (SafeHtml.isSafeHtml(value)) {
          return value.toHtml();
        }

        if (value === null || value === undefined) {
          return "";
        }

        return SafeHtml.escape(String(value));
      },
    );
  }

  /*
   * One pass over the template, with a replacer function:
   * - A replacement string would give "$&", "$$", "$`" and "$'" special
   *   meaning, so a note mentioning "$$5" or a resource named "Store $&" was
   *   rewritten on its way to subscribers.
   * - Replacing one variable at a time also expanded placeholders that
   *   appeared inside an earlier value, so a note containing
   *   "{{unsubscribeUrl}}" came out as a link.
   * A placeholder with no variable is left as written.
   */
  private static fillPlaceholders(
    template: string,
    renderValue: RenderValueFunction,
  ): string {
    return template.replace(
      new RegExp(`{{\\s*(${PLACEHOLDER_NAME_SOURCE})\\s*}}`, "g"),
      (placeholder: string, name: string): string => {
        const rendered: string | null = renderValue(name);

        return rendered === null ? placeholder : rendered;
      },
    );
  }
}
