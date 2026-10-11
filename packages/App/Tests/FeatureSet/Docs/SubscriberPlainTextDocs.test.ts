import Markdown from "Common/Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "Values in templates", says what a custom
 * email subject and a custom SMS are given for a description, a note, the
 * postmortem and a rich text field: plain text, with the Markdown
 * formatting taken out and what reads as HTML - from a "<" before a letter,
 * "/", "!" or "?" up to the next ">" - with it, while a "<" before a space
 * or a digit and everything in a code span stay. Held here to
 * Markdown.convertToPlainText, which those values go through, and to the
 * Persian page, the one translated corpus with this section. Markdown is
 * not compiled, so nothing else notices when the two drift apart.
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
  test("English says what comes out and what stays", () => {
    const section: string = sectionOf(read("en"), "### Values in templates");

    for (const phrase of [
      "A subject and an SMS show text as written, so they get every plain value unchanged",
      "descriptions, notes, the postmortem and rich text fields as plain text",
      "their Markdown formatting comes out, and so does what reads as HTML, from a `<` before a letter, `/`, `!` or `?` up to the next `>`",
      "A `<` before a space or a digit, as in `p99 < 200 ms`, stays, and so does everything in a code span",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test.each([
    ["formatting comes out", "**Checkout** is _slow_", "Checkout is slow"],
    [
      "a tag comes out, from its '<' up to the next '>'",
      "Expected <String> got <Integer> back",
      "Expected got back",
    ],
    [
      "up to the next '>', even inside quotes",
      'See <a title="x>y">the page</a> now',
      'See y">the page now',
    ],
    [
      "markup inside markup comes out with it",
      "Restarted <scr<script>ipt>x</script> pods",
      "Restarted x pods",
    ],
    [
      "comments, declarations and processing instructions come out",
      '<!-- draft --><!DOCTYPE html><?xml version="1.0"?>Resolved',
      "Resolved",
    ],
    [
      "a '<' before a space or a digit stays",
      "p99 < 200 ms and <3 retries",
      "p99 < 200 ms and <3 retries",
    ],
    [
      "everything in a code span stays",
      "Threw `Map<String, List<Integer>>` again",
      "Threw Map<String, List<Integer>> again",
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
      // "From a < before a letter, /, ! or ? up to the next >".
      "از یک `<` پیش از یک حرف، `/`، `!` یا `?` تا نخستین `>` پس از آن",
      // "A < before a space or a digit, as in p99 < 200 ms, stays".
      persian("یک `<` پیش از فاصله یا رقم، مانند `p99 < 200 ms`، می|ماند"),
      // "Everything in a code span".
      "همهٔ متن درون یک code span",
    ]) {
      expect(section).toContain(phrase);
    }
  });
});
