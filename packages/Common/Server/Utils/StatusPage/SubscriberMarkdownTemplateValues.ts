import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";

/*
 * THE VALUES A CUSTOM SLACK OR MICROSOFT TEAMS SUBSCRIBER MESSAGE GETS.
 *
 * Those messages are Markdown. The values a template places into them are
 * plain text - a title, a status page's name, a severity or state, the
 * resource list, a custom field's text - except the addresses OneUptime
 * builds itself. Each plain value is escaped where it is placed
 * (FeedMarkdown.templateText), so it reads exactly as typed and cannot become a
 * link, an image, raw HTML or a chat mention, wherever the template puts it.
 *
 * Every value is escaped unless it is named as an address here, so a plain
 * value a job adds later is escaped without anyone listing it. A value that
 * is Markdown already (a description, a note) is added by the caller after
 * this, as it is.
 */

// The values that go in as they are: addresses OneUptime builds.
export const SUBSCRIBER_MARKDOWN_ADDRESS_VARIABLES: ReadonlySet<string> =
  new Set<string>(["statusPageUrl", "detailsUrl", "unsubscribeUrl"]);

export default class SubscriberMarkdownTemplateValues {
  /*
   * Every value escaped for Markdown (on one line: a value has no business
   * starting a heading or a list), except the addresses.
   */
  public static fromPlainValues(
    values: Record<string, string>,
  ): Record<string, string> {
    const markdown: Record<string, string> = {};

    for (const [name, value] of Object.entries(values)) {
      markdown[name] = SUBSCRIBER_MARKDOWN_ADDRESS_VARIABLES.has(name)
        ? value
        : FeedMarkdown.templateText(value);
    }

    return markdown;
  }
}
