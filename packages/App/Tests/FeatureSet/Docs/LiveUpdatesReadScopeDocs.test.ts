import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Users, Teams & Permissions says that live updates follow the rule every
 * read follows: a record's update reaches only the open pages of people who
 * may read that record (Common/Server/Utils/Realtime), an update that takes
 * the record away from someone reaches theirs too (DatabaseService
 * .getRealtimeAccessBeforeUpdate), and a change to someone's permissions, a
 * block or losing master admin reaches their open pages at once
 * (RealtimeAccessChanges, on every server). The next paragraph says live
 * updates end with the sign-in that opened them - signing out, a password
 * change, a block, and the 15-minute access token the page renews
 * (RealtimeSessions) - and that a project requiring SSO gives them only to
 * pages signed in with SSO (RealtimeJoinAccess). This pins both English
 * paragraphs, their place in "How OneUptime decides whether a request is
 * allowed", and that every language has them in the same place.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const ENGLISH_PARAGRAPH: string =
  "Live updates follow the same rule. When a record is created, changed or deleted, OneUptime tells the open pages of the people who may read that record, and nobody else. Whatever limits what you read limits your live updates too: labels, owners, a block with labels, a private incident or someone else's AI conversation. When a change takes a record away from you, such as making it private, your open pages are told too, so they stop showing it. A change to your permissions, a block, or no longer being a master admin reaches your open pages at once.";

const ENGLISH_SESSION_PARAGRAPH: string =
  "Live updates also end with the sign-in that opened them. Signing out, changing your password or being blocked stops the live updates of your open pages at once. An open page renews its sign-in every 15 minutes and picks its live updates back up; when the sign-in cannot be renewed, it takes you to the sign-in page. A project that requires SSO gives live updates only to pages signed in with SSO, as it does with everything else.";

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "permissions/index.md"),
    "utf8",
  );
}

// The paragraphs of "How OneUptime decides whether a request is allowed".
function decisionParagraphs(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = lines
    .map((line: string, index: number): number => {
      return line.startsWith("## ") ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  const section: Array<string> = lines.slice(
    headings[headings.length - 3]! + 1,
    headings[headings.length - 2]!,
  );

  const paragraphs: Array<string> = [];
  let current: Array<string> = [];

  for (const line of section) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs;
}

describe("Users, Teams & Permissions: live updates follow the read rule", () => {
  const english: string = readPage("en");
  const englishParagraphs: Array<string> = decisionParagraphs(english);

  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("the English section says live updates reach only people who may read the record", () => {
    expect(english).toContain(
      "## How OneUptime decides whether a request is allowed",
    );

    const index: number = englishParagraphs.indexOf(ENGLISH_PARAGRAPH);

    expect(index).toBeGreaterThan(0);
    // After the sentence about everything else the same rule decides...
    expect(englishParagraphs[index - 1]).toMatch(
      /^The same rule decides everything else/,
    );
    // ...then how live updates end with the sign-in...
    expect(englishParagraphs[index + 1]).toBe(ENGLISH_SESSION_PARAGRAPH);
    // ...and before the automatic permissions and the cache.
    expect(englishParagraphs[index + 2]).toMatch(
      /^Every logged-in user additionally holds/,
    );
  });

  test("no paragraph still promises the old 30-second wait for a permission change", () => {
    expect(english).not.toContain(
      "A change to your permissions reaches your open pages within 30 seconds.",
    );
  });

  test.each(LANGUAGES)(
    "%s has both paragraphs in the same place, translated",
    (language: string) => {
      const paragraphs: Array<string> = decisionParagraphs(readPage(language));
      const index: number = englishParagraphs.indexOf(ENGLISH_PARAGRAPH);

      expect([language, paragraphs.length]).toEqual([
        language,
        englishParagraphs.length,
      ]);

      // A permission change no longer waits 30 seconds anywhere.
      expect([language, paragraphs[index]]).toEqual([
        language,
        expect.not.stringContaining("30"),
      ]);

      // The sign-in paragraph names the 15 minutes and SSO.
      expect([language, paragraphs[index + 1]]).toEqual([
        language,
        expect.stringMatching(/15[\s\S]*SSO|SSO[\s\S]*15/),
      ]);

      if (language !== "en") {
        expect(paragraphs[index]).not.toBe(ENGLISH_PARAGRAPH);
        expect(paragraphs[index]).toContain("OneUptime");
        expect(paragraphs[index + 1]).not.toBe(ENGLISH_SESSION_PARAGRAPH);
      }
    },
  );
});
