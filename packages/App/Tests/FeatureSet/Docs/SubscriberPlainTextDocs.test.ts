import Markdown from "Common/Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "Values in templates", says what a custom
 * email subject and a custom SMS are given for a description, a note, the
 * postmortem and a rich text field: plain text, with the Markdown
 * formatting and HTML tags and comments taken out and a "<" that starts
 * none of them kept, and how to keep angle brackets - an inline code span,
 * not a fenced block or a comment. Its examples are held here to
 * Markdown.convertToPlainText, which
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
      "A `<` that does not start one, as in `p99 < 200 ms`, stays.",
      "To keep angle brackets, put the text in an inline code span, as in `Map<String, Integer>` between single backticks: a fenced code block is left out, and so is anything inside a comment.",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test.each([
    ["formatting comes out", "**Checkout** is _slow_", "Checkout is slow"],
    ["a tag comes out", "Checkout is <b>down</b>", "Checkout is down"],
    ["an end tag comes out", "Status: <b>down</b> now", "Status: down now"],
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
      "p99 < 200 ms, <3 retries, x <= 5, </3>, <é>",
      "p99 < 200 ms, <3 retries, x <= 5, </3>, <é>",
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
    [
      "a fenced code block is left out",
      "Threw:\n```\nMap<String, Integer>\n```\nagain",
      "Threw:\nagain",
    ],
    [
      "and so is a code span inside a comment",
      "Kept <!-- `Map<String, Integer>` --> out",
      "Kept out",
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
      // "A < that starts no tag or comment, as in p99 < 200 ms, stays".
      persian(
        "هر `<` که تگ یا کامنتی را آغاز نکند، مانند `p99 < 200 ms`، می|ماند",
      ),
      // "Put the text in an inline code span ... between single backticks".
      persian("متن را در یک inline code span بگذارید"),
      persian("`Map<String, Integer>` میان دو بک|تیک تکی"),
      // "A fenced code block is left out, and so is anything inside a comment".
      persian(
        "یک fenced code block کنار گذاشته می|شود، و همچنین هر آنچه درون یک کامنت باشد",
      ),
    ]) {
      expect(section).toContain(phrase);
    }
  });
});
