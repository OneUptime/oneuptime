import Markdown from "Common/Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "Values in templates", says what a custom
 * email subject and a custom SMS are given for a description, a note, the
 * postmortem and a rich text field: plain text, with the Markdown
 * formatting and HTML tags and comments taken out, by a rule it states
 * clause by clause. Each clause is held here to Markdown.convertToPlainText,
 * which those values go through - what it takes out, and what it leaves -
 * and the sentence to the Persian page, the one translated corpus with this
 * section. Markdown is not compiled, so nothing else notices when the docs
 * and the code drift apart.
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

// Lines of "x": no line is long enough to be held back as text.
function lines(count: number): string {
  return "x\n".repeat(count);
}

describe("Subscribers & Announcements: Markdown values in a subject and an SMS", () => {
  test("English states the rule", () => {
    const section: string = sectionOf(read("en"), "### Values in templates");

    for (const phrase of [
      "A subject and an SMS show text as written, so they get every plain value unchanged",
      "descriptions, notes, the postmortem and rich text fields as plain text",
      "Their Markdown formatting comes out, and so do HTML tags and comments: from a `<` followed by an English letter (or by `/` and one), `!` or `?` to the next `>`, unless a `<` that stays comes first.",
      "One that would run past 65,536 characters stays as written, and so does a tag that would run past a blank line or a code span.",
      "Any other `<`, as in `p99 < 200 ms`, stays, and so does the text of a code span that no comment holds.",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test.each([
    ["formatting comes out", "**Checkout** is _slow_", "Checkout is slow"],
    [
      "a tag comes out, from its '<' to the next '>'",
      "Expected <String> got <Integer> back",
      "Expected got back",
    ],
    [
      "to the next '>', even one inside quotes",
      'See <a title="x>y">the page</a> now',
      'See y">the page now',
    ],
    ["an end tag comes out", "a</b>c and </p>d", "ac and d"],
    [
      "a '/' with no English letter after it starts nothing",
      "Closing </ b> and </3> and </> stay",
      "Closing </ b> and </3> and </> stay",
    ],
    [
      "a letter that is not English starts nothing",
      "Keep <é> and <ب> and <语>",
      "Keep <é> and <ب> and <语>",
    ],
    [
      "comments, declarations and processing instructions come out",
      '<!-- draft --><!DOCTYPE html><?xml version="1.0"?>Resolved',
      "Resolved",
    ],
    [
      "a '<' that stays, before the '>', keeps a tag from forming",
      "Mixed <a b <3 c> end",
      "Mixed <a b <3 c> end",
    ],
    [
      "markup inside markup comes out with it",
      "Restarted <scr<script>ipt>x</script> pods",
      "Restarted x pods",
    ],
    [
      "a tag that would run past a blank line stays",
      "a <b\n\nc> d",
      "a <b\nc> d",
    ],
    ["a tag that would run past a code span stays", "a <b `x`> d", "a <b x> d"],
    [
      "any other '<' stays",
      "p99 < 200 ms and <3 retries and <= 5",
      "p99 < 200 ms and <3 retries and <= 5",
    ],
    [
      "the text of a code span stays",
      "Threw `Map<String, List<Integer>>` again",
      "Threw Map<String, List<Integer>> again",
    ],
    [
      "a comment takes the code span it holds",
      "Kept <!-- `internal` --> out",
      "Kept out",
    ],
  ])(
    "which is what plain text does: %s",
    (_case: string, markdown: string, text: string) => {
      expect(Markdown.convertToPlainText(markdown)).toBe(text);
    },
  );

  test("which is what plain text does: one that would run past 65,536 characters stays", () => {
    // "<a", a line break and "x" lines: 60002 after the "a", then 66002.
    expect(
      Markdown.convertToPlainText(`Before <a\n${lines(30000)}x> After`),
    ).toBe("Before After");

    const tooLong: string = Markdown.convertToPlainText(
      `Before <a\n${lines(33000)}x> After`,
    );

    expect(tooLong.startsWith("Before <a\nx\nx\n")).toBe(true);
    expect(tooLong.endsWith("x\nx\nx> After")).toBe(true);
  });

  test("Persian states the same rule", () => {
    const section: string = sectionOf(
      read("fa"),
      persian("### مقدارها در قالب|ها"),
    );

    for (const phrase of [
      // "Rich text fields ... as plain text."
      persian("فیلدهای متن غنی را به|صورت متن ساده"),
      // "From a < followed by an English letter (or / and one), ! or ? to the next >".
      "از یک `<` که پس از آن یک حرف انگلیسی (یا `/` و یک حرف انگلیسی)، `!` یا `?` بیاید تا نخستین `>` پس از آن",
      // "Unless a < that stays comes first".
      persian("مگر آنکه پیش از آن نویسهٔ `<` دیگری بیاید که می|ماند"),
      // "One that would run past 65,536 characters".
      "آنچه از ۶۵۵۳۶ نویسه فراتر برود",
      // "A tag that would run past a blank line or a code span".
      "تگی که از یک خط خالی یا یک code span بگذرد",
      // "Any other <, as in p99 < 200 ms, stays".
      persian("هر `<` دیگری، مانند `p99 < 200 ms`، می|ماند"),
      // "The text of a code span, if no comment holds it".
      "و متن یک code span نیز، اگر درون یک کامنت نباشد",
    ]) {
      expect(section).toContain(phrase);
    }
  });
});
