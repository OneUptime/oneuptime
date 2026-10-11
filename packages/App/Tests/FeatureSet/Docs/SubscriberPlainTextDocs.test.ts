import Markdown from "Common/Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "Values in templates", says what a custom
 * email subject and a custom SMS are given for a description, a note, the
 * postmortem and a rich text field: plain text, with the Markdown
 * formatting and HTML tags and comments taken out, a "<" that starts none
 * of them kept, and anything in a code span kept - the way to keep angle
 * brackets. Its examples are held here to Markdown.convertToPlainText, which
 * those values go through, and the sentence to the Persian page, the one
 * translated corpus with this section. The exact rule is the code's, and
 * its own suites pin it (MarkdownPlainTextMarkup, HtmlMarkup*). Markdown is
 * not compiled, so nothing else notices when the docs and the code drift
 * apart.
 */

const PACKAGES_DIRECTORY: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIRECTORY: string = path.join(
  PACKAGES_DIRECTORY,
  "App/FeatureSet/Docs/Content",
);

function read(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIRECTORY, language, "status-pages/subscribers.md"),
    "utf8",
  );
}

// A section of a page, from its heading to the next heading of its level.
function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThan(0);

  const end: number = markdown.indexOf("\n### ", start + heading.length + 2);

  return markdown.slice(start, end === -1 ? undefined : end);
}

// The zero-width non-joiner Persian words are written with, as "|" here.
const ZWNJ: string = String.fromCharCode(0x200c);

function persian(text: string): string {
  return text.split("|").join(ZWNJ);
}

describe("Subscribers & Announcements: Markdown values in a subject and an SMS", () => {
  test("English says what comes out, what stays, and how to keep angle brackets", () => {
    const section: string = sectionOf(read("en"), "### Values in templates");

    for (const phrase of [
      "A subject and an SMS show text as written, so they get every plain value unchanged",
      "descriptions, notes, the postmortem and rich text fields as plain text",
      "their Markdown formatting comes out, and so do HTML tags and comments, such as `<b>`, `</p>` or `<!-- draft -->`.",
      "A `<` that does not start one, as in `p99 < 200 ms`, stays, and so does anything in a code span: write `Map<String, Integer>` between backticks to keep its angle brackets.",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test.each([
    ["formatting comes out", "**Checkout** is _slow_", "Checkout is slow"],
    ["a tag comes out", "Checkout is <b>down</b>", "Checkout is down"],
    ["an end tag comes out", "Paragraph one</p>Two", "Paragraph oneTwo"],
    [
      "a comment comes out",
      "Restarted <!-- draft --> the pods",
      "Restarted the pods",
    ],
    [
      "markup inside markup comes out with it",
      "Restarted <scr<script>ipt>x</script> pods",
      "Restarted x pods",
    ],
    [
      "a '<' that starts nothing stays",
      "p99 < 200 ms, <3 retries, x <= 5",
      "p99 < 200 ms, <3 retries, x <= 5",
    ],
    [
      "angle brackets between backticks stay",
      "Threw `Map<String, Integer>` again",
      "Threw Map<String, Integer> again",
    ],
    [
      "and without them, read as a tag, they do not",
      "Threw Map<String, Integer> again",
      "Threw Map again",
    ],
  ])(
    "which is what plain text does: %s",
    (_case: string, markdown: string, text: string) => {
      expect(Markdown.convertToPlainText(markdown)).toBe(text);
    },
  );

  test("Persian says the same", () => {
    const section: string = sectionOf(
      read("fa"),
      persian("### مقدارها در قالب|ها"),
    );

    for (const phrase of [
      // "Rich text fields ... as plain text".
      persian("فیلدهای متن غنی را به|صورت متن ساده"),
      // "Such as <b>, </p> or <!-- draft -->".
      "مانند `<b>`، `</p>` یا `<!-- draft -->`",
      // "A < that does not start one, as in p99 < 200 ms, stays".
      persian("هر `<` که تگی را آغاز نکند، مانند `p99 < 200 ms`، می|ماند"),
      // "Write Map<String, Integer> between backticks".
      persian("`Map<String, Integer>` را میان دو بک|تیک بنویسید"),
    ]) {
      expect(section).toContain(phrase);
    }
  });
});
