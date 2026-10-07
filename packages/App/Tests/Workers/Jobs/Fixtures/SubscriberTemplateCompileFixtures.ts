import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import ObjectID from "Common/Types/ObjectID";
import SafeHtml from "Common/Types/SafeHtml";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import { SubscriberNotificationEmailBodyTemplateVariables } from "Common/Types/StatusPage/SubscriberNotificationTemplateCompiler";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import { expect, jest } from "@jest/globals";

/*
 * Escaping in the subscriber job tests.
 *
 * The jobs compile a custom EMAIL template's body with
 * compileEmailBodyTemplate, which escapes every plain value and inserts only
 * SafeHtml values as HTML, and everything else (subjects, SMS, Slack, Teams)
 * with compileTemplate, which inserts values as it is given them: subjects
 * and SMS get every value as written, Slack and Teams - Markdown - get every
 * plain value escaped for Markdown first (see HOSTILE_TITLE_MARKDOWN below).
 * The job tests mock
 * StatusPageSubscriberNotificationTemplateService, whose real module pulls in
 * the database, and hand compileEmailBodyTemplate to the real compiler
 * (jest.requireActual of Common/Types/StatusPage/
 * SubscriberNotificationTemplateCompiler), so the body a test reads is the
 * one a subscriber gets, escaping included.
 *
 * The hostile values below hold markup a project member could type into a
 * title or a name. Unescaped in an email, each is a live link or script.
 */

export const HOSTILE_TITLE: string =
  "<script>alert('title')</script> Checkout <b>down</b>";
export const HOSTILE_TITLE_HTML: string =
  "&lt;script&gt;alert(&#39;title&#39;)&lt;/script&gt; Checkout &lt;b&gt;down&lt;/b&gt;";

export const HOSTILE_PAGE_NAME: string =
  '<a href="https://evil.example/login">Acme</a> "Status"';
export const HOSTILE_PAGE_NAME_HTML: string =
  "&lt;a href=&quot;https://evil.example/login&quot;&gt;Acme&lt;/a&gt; &quot;Status&quot;";

export const HOSTILE_RESOURCE_NAME: string =
  '<img src=x onerror="alert(1)"> Payments & Billing';
export const HOSTILE_RESOURCE_NAME_HTML: string =
  "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; Payments &amp; Billing";

export const HOSTILE_GROUP_NAME: string = "EU <i>West</i> 'A'";
export const HOSTILE_GROUP_NAME_HTML: string =
  "EU &lt;i&gt;West&lt;/i&gt; &#39;A&#39;";

// The two hostile resources below, as each form of the resource list shows them.
export const HOSTILE_RESOURCES_HTML: string = `${HOSTILE_GROUP_NAME_HTML}: ${HOSTILE_RESOURCE_NAME_HTML}<br/>Search &amp; Browse`;
export const HOSTILE_RESOURCES_TEXT: string = `${HOSTILE_GROUP_NAME}: ${HOSTILE_RESOURCE_NAME}; Search & Browse`;

/*
 * The same values as a Slack or Teams message gets them. That message is
 * Markdown, so each plain value is escaped where it is placed
 * (escapeMarkdownValue): "[", "]", "<" and "\" behind a backslash. Rendered,
 * it reads as written (withoutMarkdownEscapes), and it can become no link,
 * image, raw HTML or chat mention there.
 */
export const HOSTILE_TITLE_MARKDOWN: string =
  "\\<script>alert('title')\\</script> Checkout \\<b>down\\</b>";
export const HOSTILE_PAGE_NAME_MARKDOWN: string =
  '\\<a href="https://evil.example/login">Acme\\</a> "Status"';
export const HOSTILE_RESOURCE_NAME_MARKDOWN: string =
  '\\<img src=x onerror="alert(1)"> Payments & Billing';
export const HOSTILE_GROUP_NAME_MARKDOWN: string = "EU \\<i>West\\</i> 'A'";
export const HOSTILE_RESOURCES_MARKDOWN: string = `${HOSTILE_GROUP_NAME_MARKDOWN}: ${HOSTILE_RESOURCE_NAME_MARKDOWN}; Search & Browse`;

/*
 * A Slack or Teams message as its reader sees the values in it: every
 * backslash escape undone, and the invisible word joiner that breaks a chat
 * mention taken out.
 */
export function withoutMarkdownEscapes(markdown: string): string {
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .split("\u2060")
    .join("");
}

// No value brings raw HTML or an autolink into a Markdown message.
export function expectNoUnescapedAngleBracket(markdown: string): void {
  expect(markdown).not.toMatch(/(?<!\\)</);
}

/*
 * A title as a monitor may fill it in from what it watched - the subject of
 * an incoming email, say - and a state's name: Markdown that would act on its
 * own in a chat message. An image fetched when the message is shown, a link
 * whose words hide where it goes, and Slack mentions.
 */
export const MARKDOWN_TITLE: string =
  "![](https://tracker.example/p.png) [Reset your password](https://evil.example/login) <!channel> <@U0123ABC> <b>now</b>";
export const MARKDOWN_STATE_NAME: string =
  "[Resolved](https://evil.example/state) <!here>";

/*
 * No value placed into a Markdown message makes an image, a link to an
 * address the value brought, raw HTML or a chat mention. The template's own
 * links (the status page, unsubscribe) are OneUptime's, and stay links.
 */
export function expectValuesInertInMarkdown(markdown: string): void {
  expect(markdown).not.toMatch(
    /(?<!\\)\[[^\]]*\]\(https:\/\/(?:evil|tracker)\.example/,
  );
  expect(markdown).not.toMatch(/(?<!\\)!\[/);
  expectNoUnescapedAngleBracket(markdown);
}

interface SlackConversion {
  default: { convertMarkdownToSlackRichText: (markdown: string) => string };
}

const SLACK_LINK_PATTERN: RegExp = /<(https?:\/\/[^|>]+)\|([^>]*)>/g;

// The addresses MARKDOWN_TITLE and MARKDOWN_STATE_NAME bring.
const VALUE_ADDRESS_PATTERN: RegExp = /^https:\/\/(?:evil|tracker)\.example/;

/*
 * What Slack shows of a message: the job's Markdown through the real
 * conversion, which the job tests replace with one that changes nothing.
 * Slack reads no mention in it, and every link to an address the values
 * brought shows that address as its text - a bare address in a value is
 * still made a link, as anywhere, but no words can hide where it goes.
 */
export function expectSlackReadsNoMention(markdown: string): void {
  const slackModule: SlackConversion = jest.requireActual(
    "Common/Server/Utils/Workspace/Slack/Slack",
  ) as SlackConversion;
  const slack: string =
    slackModule.default.convertMarkdownToSlackRichText(markdown);

  expect(slack).not.toMatch(/<[!@#]/);
  expect(
    Array.from(slack.matchAll(SLACK_LINK_PATTERN))
      .filter((link: RegExpMatchArray): boolean => {
        return VALUE_ADDRESS_PATTERN.test(link[1]!) && link[2] !== link[1];
      })
      .map((link: RegExpMatchArray): string => {
        return link[0];
      }),
  ).toEqual([]);
}

/*
 * A resource in a hostile group with a hostile name, and an ungrouped one,
 * on the given status page.
 */
export function hostileResources(
  statusPageId: ObjectID,
): Array<StatusPageResource> {
  const grouped: StatusPageResource = new StatusPageResource();
  grouped._id = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
  grouped.statusPageId = statusPageId;
  grouped.displayName = HOSTILE_RESOURCE_NAME;
  grouped.statusPageGroupId = new ObjectID(
    "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2",
  );
  const group: StatusPageGroup = new StatusPageGroup();
  group.name = HOSTILE_GROUP_NAME;
  grouped.statusPageGroup = group;

  const ungrouped: StatusPageResource = new StatusPageResource();
  ungrouped._id = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
  ungrouped.statusPageId = statusPageId;
  ungrouped.displayName = "Search & Browse";

  return [grouped, ungrouped];
}

/*
 * The variables of an email body compile with every SafeHtml value turned
 * into its HTML, so they compare with the string variables of the other
 * channels. htmlVariableNames says which ones were SafeHtml.
 */
export function emailBodyVariablesAsText(
  variables: SubscriberNotificationEmailBodyTemplateVariables,
): Record<string, string> {
  const text: Record<string, string> = {};

  for (const [name, value] of Object.entries(variables)) {
    text[name] = SafeHtml.isSafeHtml(value) ? value.toHtml() : value;
  }

  return text;
}

// One compile the job made, of either kind.
export interface RecordedCompile {
  template: string;
  // As text: an email body's SafeHtml values as their HTML.
  variables: Record<string, string>;
  // As the job passed them.
  rawVariables: SubscriberNotificationEmailBodyTemplateVariables;
  // compileEmailBodyTemplate, rather than compileTemplate.
  emailBody: boolean;
}

interface RecordedMock {
  mock: {
    calls: Array<Array<unknown>>;
    invocationCallOrder: Array<number>;
  };
}

/*
 * Every compile the job made through the two mocked compile methods, in the
 * order it made them.
 */
export function recordedCompiles(
  compileTemplate: unknown,
  compileEmailBodyTemplate: unknown,
): Array<RecordedCompile> {
  const recorded: Array<{ order: number; compile: RecordedCompile }> = [];

  const text: RecordedMock = compileTemplate as RecordedMock;
  text.mock.calls.forEach((call: Array<unknown>, index: number): void => {
    recorded.push({
      order: text.mock.invocationCallOrder[index]!,
      compile: {
        template: call[0] as string,
        variables: call[1] as Record<string, string>,
        rawVariables: call[1] as Record<string, string>,
        emailBody: false,
      },
    });
  });

  const emailBody: RecordedMock = compileEmailBodyTemplate as RecordedMock;
  emailBody.mock.calls.forEach((call: Array<unknown>, index: number): void => {
    const variables: SubscriberNotificationEmailBodyTemplateVariables =
      call[1] as SubscriberNotificationEmailBodyTemplateVariables;

    recorded.push({
      order: emailBody.mock.invocationCallOrder[index]!,
      compile: {
        template: call[0] as string,
        variables: emailBodyVariablesAsText(variables),
        rawVariables: variables,
        emailBody: true,
      },
    });
  });

  return recorded
    .sort(
      (
        a: { order: number; compile: RecordedCompile },
        b: { order: number; compile: RecordedCompile },
      ): number => {
        return a.order - b.order;
      },
    )
    .map(
      (entry: { order: number; compile: RecordedCompile }): RecordedCompile => {
        return entry.compile;
      },
    );
}

// The variables an email body compile got as HTML (SafeHtml), sorted.
export function htmlVariableNames(
  variables: SubscriberNotificationEmailBodyTemplateVariables,
): Array<string> {
  return Object.entries(variables)
    .filter(([, value]: [string, string | SafeHtml]): boolean => {
      return SafeHtml.isSafeHtml(value);
    })
    .map(([name]: [string, string | SafeHtml]): string => {
      return name;
    })
    .sort();
}

/*
 * A job may hand an email body as HTML only the variables the variable list
 * marks as HTML in an email body (rendered Markdown and the escaped resource
 * list); every title, name, state, time and URL must reach it as plain text,
 * to be escaped.
 *
 * A family of variables listed by prefix - an incident's
 * {{incident.customFields.<key>}} - may be HTML when the family says so (a Rich text
 * field's rendered Markdown, say): those are left out of the comparison,
 * and any other family's members must be plain text.
 */
export function expectOnlyTheListedHtmlVariables(
  variables: SubscriberNotificationEmailBodyTemplateVariables,
  eventType: StatusPageSubscriberNotificationEventType,
): void {
  const listed: Array<string> =
    SubscriberNotificationTemplateVariables.getEmailBodyHtmlVariableNamesForEventType(
      eventType,
    );

  const html: Array<string> = htmlVariableNames(variables).filter(
    (name: string): boolean => {
      return (
        SubscriberNotificationTemplateVariables.getDynamicVariableForName(
          eventType,
          name,
        )?.mayBeHtmlInEmailBody !== true
      );
    },
  );

  expect(html).toEqual([...listed].sort());
}

// Text channels are never HTML: no HTML entity may reach them.
export function expectNoHtmlEntities(text: string): void {
  expect(text).not.toMatch(/&(?:amp|lt|gt|quot|#39);/);
}
