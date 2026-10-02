import { describe, expect, test } from "@jest/globals";
import DOMPurify from "dompurify";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../../UI/Components/Markdown.tsx/MarkdownConverters";

/*
 * A template's {{variables}} go through the visual editor's render/serialize
 * loop like any text: the editor draws the markdown as HTML, someone types,
 * and the HTML is written back as markdown.
 *
 * An incident custom field's key joins its words with underscores
 * (on_call_lead), and the editor's renderer read the underscores as italics:
 * "{{incident.customFields.on_call_lead}}" was drawn with a slanted "call",
 * and the first keystroke anywhere in the note saved it back as
 * "{{incident.customFields.on*call*lead}}" - a variable nothing fills in,
 * left as written in every note made from the template. Now that the editor
 * puts variables in at a click, this pins that they come back as they went
 * in.
 */

const roundTrip: (markdown: string) => string = (markdown: string): string => {
  const html: string = DOMPurify.sanitize(markdownToHtml(markdown));
  return htmlToMarkdown(html).trim();
};

describe("template variables in the visual editor", () => {
  test("a custom field variable with underscores is drawn as text, not italics", () => {
    const html: string = markdownToHtml(
      "Lead: {{incident.customFields.on_call_lead}}",
    );

    expect(html).not.toContain("<em>");
    expect(html).toContain("{{incident.customFields.on_call_lead}}");
  });

  test("two variables with underscores on one line keep the text between them plain", () => {
    const html: string = markdownToHtml(
      "{{incident.customFields.expected_resolution}} and {{incident.customFields.root_cause}}",
    );

    expect(html).not.toContain("<em>");
    expect(html).toContain(
      "{{incident.customFields.expected_resolution}} and {{incident.customFields.root_cause}}",
    );
  });

  test.each([
    "{{incident.customFields.on_call_lead}}",
    "Lead: {{incident.customFields.on_call_lead}} (paged)",
    "{{incident.customFields.expected_resolution}} and {{incident.customFields.root_cause}}",
    "**Incident**: {{incident.title}}",
    "- Severity: {{incident.severity}}\n- Labels: {{incident.labels}}",
    "{{ incident.title }}",
    "Started {{incident.startedAt}}, now {{incident.state}}.",
  ])(
    "%j comes back from the editor exactly as it went in",
    (markdown: string) => {
      expect(roundTrip(markdown)).toBe(markdown);
    },
  );

  test("a variable inside bold stays inside it, as text", () => {
    const html: string = markdownToHtml(
      "**{{incident.customFields.on_call_lead}}**",
    );

    expect(html).toContain(
      "<strong>{{incident.customFields.on_call_lead}}</strong>",
    );
    expect(roundTrip("**{{incident.customFields.on_call_lead}}**")).toBe(
      "**{{incident.customFields.on_call_lead}}**",
    );
  });

  test("a variable in a link's address is still the address", () => {
    const html: string = markdownToHtml("[Status]({{statusPageUrl}})");

    expect(html).toContain('href="{{statusPageUrl}}"');
    expect(html).toContain(">Status</a>");
  });

  test("a variable in a link's label is text inside the link", () => {
    const html: string = markdownToHtml(
      "[{{incident.customFields.ticket_id}}](https://example.com)",
    );

    expect(html).toContain(
      '<a href="https://example.com">{{incident.customFields.ticket_id}}</a>',
    );
  });

  test("a variable in inline code stays code", () => {
    expect(markdownToHtml("`{{incident.title}}`")).toContain(
      "<code>{{incident.title}}</code>",
    );
  });

  test("Handlebars tags are text too", () => {
    const markdown: string =
      "{{#each report.rows}}{{this.group_name}}{{/each}}";

    expect(markdownToHtml(markdown)).not.toContain("<em>");
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test("emphasis outside a variable still works", () => {
    const html: string = markdownToHtml(
      "_urgent_ {{incident.customFields.on_call_lead}} *now*",
    );

    expect(html).toContain("<em>urgent</em>");
    expect(html).toContain("<em>now</em>");
    expect(html).toContain("{{incident.customFields.on_call_lead}}");
  });

  test("a variable's text is escaped like any other text", () => {
    expect(markdownToHtml("{{a<b>}}")).toContain("{{a&lt;b&gt;}}");
  });
});
