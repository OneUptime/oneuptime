import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import ObjectID from "Common/Types/ObjectID";
import SafeHtml from "Common/Types/SafeHtml";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import { SubscriberNotificationEmailBodyTemplateVariables } from "Common/Types/StatusPage/SubscriberNotificationTemplateCompiler";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import { expect } from "@jest/globals";

/*
 * Escaping in the subscriber job tests.
 *
 * The jobs compile a custom EMAIL template's body with
 * compileEmailBodyTemplate, which escapes every plain value and inserts only
 * SafeHtml values as HTML, and everything else (subjects, SMS, Slack, Teams)
 * with compileTemplate, which inserts values as written. The job tests mock
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
 * {{customFields.<key>}} - may be HTML when the family says so (a Rich text
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

// Text channels show values as written: no HTML entity may reach them.
export function expectNoHtmlEntities(text: string): void {
  expect(text).not.toMatch(/&(?:amp|lt|gt|quot|#39);/);
}
