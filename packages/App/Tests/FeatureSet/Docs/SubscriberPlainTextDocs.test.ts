import Markdown from "Common/Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "Values in templates", says what a custom
 * email subject and a custom SMS are given for a description, a note, the
 * postmortem and a rich text field: plain text, with the Markdown
 * formatting and any HTML typed in it taken out, and a "<" typed as text
 * kept. Held here to Markdown.convertToPlainText, which those values go
 * through, and to the Persian page, the one translated corpus with this
 * section. Markdown is not compiled, so nothing else notices when the two
 * drift apart.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function read(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "status-pages/subscribers.md"),
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

describe("Subscribers & Announcements: Markdown values in a subject and an SMS", () => {
  test("English says they arrive as plain text, typed HTML out and a typed '<' kept", () => {
    const section: string = sectionOf(read("en"), "### Values in templates");

    for (const phrase of [
      "A subject and an SMS show text as written, so they get every plain value unchanged",
      "descriptions, notes, the postmortem and rich text fields as plain text",
      "their Markdown formatting and any HTML typed in them come out",
      "a `<` typed as text, as in `p99 < 200 ms`, stays",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test("which is what the plain text of such a value is", () => {
    expect(
      Markdown.convertToPlainText(
        "**Checkout** is slow: p99 < 200 ms <scr<script>ipt>alert(1)</script> missed",
      ),
    ).toBe("Checkout is slow: p99 < 200 ms alert(1) missed");
  });

  test("Persian says the same", () => {
    const section: string = sectionOf(read("fa"), "### مقدارها در قالب‌ها");

    // "As plain text", "are removed", and the example.
    for (const phrase of ["متن ساده", "برداشته", "`p99 < 200 ms`"]) {
      expect(section).toContain(phrase);
    }
  });
});
