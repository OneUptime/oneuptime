import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Users, Teams & Permissions says what reaches a record with no labels of
 * its own (Common/Server/Types/Database/Permissions/ReadPermission
 * .addLabelRulesToQuery), for reading, changing and deleting alike; that a
 * request reaches its own project's records only; that a list across all
 * projects narrows each project's records by that project's permissions
 * (TenantPermission); and which analytics rows are read through the record
 * they belong to (@OwnedThrough on MonitorLog, SloHistory, NetworkFlow,
 * KubernetesCostAllocation). This pins the English sentences and that
 * every language has them in the same places.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "permissions/index.md"),
    "utf8",
  );
}

// The paragraphs of the section under the `index`th heading.
function paragraphsOf(markdown: string, index: number): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = lines
    .map((line: string, lineIndex: number): number => {
      return line.startsWith("## ") ? lineIndex : -1;
    })
    .filter((lineIndex: number): boolean => {
      return lineIndex >= 0;
    });

  const section: Array<string> = lines.slice(
    headings[index]! + 1,
    headings[index + 1]!,
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

// A numbered step of how a request is decided.
function step(markdown: string, number: number): string {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = lines
    .map((line: string, lineIndex: number): number => {
      return line.startsWith("## ") ? lineIndex : -1;
    })
    .filter((lineIndex: number): boolean => {
      return lineIndex >= 0;
    });

  return (
    lines
      .slice(headings[headings.length - 3]!, headings[headings.length - 2]!)
      .find((line: string): boolean => {
        return line.startsWith(`${number}. `);
      }) || ""
  );
}

const LABELS_SECTION: number = 6;
const TELEMETRY_SECTION: number = 7;

describe("Users, Teams & Permissions: one rule for reading, changing and deleting", () => {
  const english: string = readPage("en");

  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("Labels says what reaches a record with no labels of its own", () => {
    const paragraphs: Array<string> = paragraphsOf(english, LABELS_SECTION);

    expect(paragraphs[2]).toBe(
      "A record with no labels of its own, such as an incident's note, a status page announcement or an AI insight about a service, carries the labels of the records it belongs to or is about. A permission restricted to labels reaches it when those records carry one of the permission's labels, and a block with labels takes it away when one of them carries a blocked label, for reading, changing and deleting alike. An AI insight about no service belongs to the project: a label restriction does not narrow it, and a block with labels does not take it away.",
    );
    expect(paragraphs[3]).toMatch(
      /^Where to find it: \*\*Settings → Labels\*\*/,
    );
  });

  test("Telemetry says which rows are read through the record they belong to", () => {
    const paragraphs: Array<string> = paragraphsOf(english, TELEMETRY_SECTION);

    expect(paragraphs[paragraphs.length - 1]).toBe(
      "Monitor logs, SLO history, network flows and Kubernetes cost allocations are read the same way, through the monitor, SLO, network device or cluster they belong to: Owned and Labels reach the rows of the records you may read, and a block with labels leaves out the rows of the records carrying those labels. The audit log and threat intelligence indicators are read across the project by whoever may read them.",
    );
  });

  test("the steps say a request keeps to its project, and how lists across projects are narrowed", () => {
    expect(step(english, 1)).toContain(
      "A request reaches the records of this project only: a record of another project, named by its id or in a filter, is answered as if it did not exist.",
    );
    expect(step(english, 5)).toContain(
      "A record with no labels of its own, such as an incident note, matches a label-scoped grant when the records it belongs to carry one of the grant's labels.",
    );
    expect(step(english, 6)).toContain(
      "A list of records from all of your projects at once, such as the incidents on your home page, narrows each project's records by your blocks and grants in that project.",
    );
  });

  test.each(LANGUAGES)(
    "%s has the same paragraphs in the same places, translated",
    (language: string) => {
      const page: string = readPage(language);

      for (const section of [LABELS_SECTION, TELEMETRY_SECTION]) {
        expect([language, section, paragraphsOf(page, section).length]).toEqual(
          [language, section, paragraphsOf(english, section).length],
        );
      }

      // The steps are there, each one line.
      for (const number of [1, 5, 6]) {
        expect([language, number, step(page, number).length > 0]).toEqual([
          language,
          number,
          true,
        ]);
      }

      if (language !== "en") {
        expect(paragraphsOf(page, LABELS_SECTION)[2]).not.toBe(
          paragraphsOf(english, LABELS_SECTION)[2],
        );
        // The product names stay as they are.
        expect(paragraphsOf(page, TELEMETRY_SECTION).slice(-1)[0]).toContain(
          "SLO",
        );
        expect(paragraphsOf(page, TELEMETRY_SECTION).slice(-1)[0]).toContain(
          "Kubernetes",
        );
      }
    },
  );
});
