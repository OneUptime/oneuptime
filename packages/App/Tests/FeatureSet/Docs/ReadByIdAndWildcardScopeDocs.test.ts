import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY GRANT AND SCOPE NARROWS WHAT IT REACHES, AND A READ BY ID OF A
 * RECORD YOU MAY NOT READ ANSWERS 404.
 *
 * The record rule (Common/Server/Types/Database/Permissions/BasePermission
 * .addRecordScopeToQuery) narrows a read, a change and a delete by every
 * grant that lets it in: an All Operational Resources permission restricted
 * to labels and a block with labels on one (HeldPermissionsUtil
 * .getLabelBlockingPermissions), the Owned scope of the record a model is
 * read through (OwnedScopePermission.addOwnedParentsToQuery), and the
 * telemetry a delete reaches (AnalyticsDatabase/ModelPermission
 * .checkDeletePermission). A read by id that reaches nothing answers 404
 * (BaseAPI.getItem).
 *
 * Users, Teams & Permissions says so in every docs language, the API
 * reference says what a read by id answers, and the upgrade notes say what
 * changes, in English at length and in one line in every other guide.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const WILDCARD: string = "**All Operational Resources**";
const GET_ITEM: string = "`POST /api/<resource>/<id>/get-item`";

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function stepOf(markdown: string, number: number): string {
  return (
    markdown.split("\n").find((line: string): boolean => {
      return line.startsWith(`${number}. `);
    }) || ""
  );
}

// The paragraphs of the section under the `index`th `## ` heading.
function paragraphsOf(markdown: string, index: number): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = [];

  lines.forEach((line: string, lineIndex: number) => {
    if (line.startsWith("## ")) {
      headings.push(lineIndex);
    }
  });

  return lines
    .slice(headings[index]! + 1, headings[index + 1]!)
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const TELEMETRY_SECTION: number = 7;

describe("Docs: every grant and scope narrows what it reaches", () => {
  const english: string = read("en", "permissions/index.md");

  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("step 5 says a wildcard restricted to labels reaches those labels", () => {
    expect(stepOf(english, 5)).toContain(
      "An **All Operational Resources** permission restricted to labels narrows the same way: it reaches the operational resources carrying one of its labels, as the resource's own permission restricted to those labels would.",
    );
  });

  test("step 6 says a block with labels on a wildcard takes them away", () => {
    expect(stepOf(english, 6)).toContain(
      "A block with labels on an **All Operational Resources** permission takes the resources carrying those labels away from what that permission grants.",
    );
  });

  test("step 7 says the Owned scope of the record read through narrows, and a read by ID answers 404", () => {
    const step: string = stepOf(english, 7);

    expect(step).toContain(
      "when your permission to read incidents is scoped to Owned, a permission on notes reaches only the notes of the incidents you or one of your teams own.",
    );
    expect(step).toContain(
      "A read of one record by its ID answers `404` the same way when the record does not exist or you may not read it.",
    );
  });

  test("Telemetry says a delete keeps to what you may read, one project at a time", () => {
    const paragraphs: Array<string> = paragraphsOf(english, TELEMETRY_SECTION);

    expect(paragraphs).toContain(
      "Deleting telemetry keeps to the same resources: a delete reaches the rows of the resources that both your permission to read the signal and your permission to delete it reach, less those a block with labels on either takes away, and it is made in one project at a time.",
    );
  });

  test.each(LANGUAGES)(
    "%s says the same in the same places, translated",
    (language: string) => {
      const page: string = read(language, "permissions/index.md");

      expect([language, stepOf(page, 5).includes(WILDCARD)]).toEqual([
        language,
        true,
      ]);
      expect([language, stepOf(page, 6).includes(WILDCARD)]).toEqual([
        language,
        true,
      ]);
      // A change or delete by ID, and now a read by ID, each answer 404.
      expect([language, countOf(stepOf(page, 7), "`404`")]).toEqual([
        language,
        2,
      ]);
      expect([
        language,
        paragraphsOf(page, TELEMETRY_SECTION).length,
      ]).toEqual([language, paragraphsOf(english, TELEMETRY_SECTION).length]);

      if (language !== "en") {
        expect([language, stepOf(page, 5) === stepOf(english, 5)]).toEqual([
          language,
          false,
        ]);
      }
    },
  );

  test("the API reference says what a read by ID answers", () => {
    const page: string = read("en", "api-reference/api-reference.md");

    expect(page).toContain("### Reading one record by its ID");
    expect(page).toContain(
      `A read of one record by its ID - ${GET_ITEM} - answers \`404\` when the record does not exist, is in another project, or is one you may not read, the same answer for each:`,
    );
    expect(page).toContain("It used to answer `200` with an empty body.");
    expect(page).toContain(
      "A delete of one row by its ID that reaches nothing answers `404` or `422` as above.",
    );
  });

  test("the English upgrade notes say what changes", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      "- **Every grant and scope narrows what it reaches, and a read by ID of a",
      `  - Reading one record by its ID (${GET_ITEM})`,
      "    body. The dashboard shows such a record as not found, as before. The",
      "  - An **All Operational Resources** permission restricted to labels",
      "  - When a role may read incidents only at **Owned** scope, the records",
      "  - Deleting telemetry - logs, traces, metrics, exceptions, profiles and",
      "  - A status page's SAML and OIDC sign-in providers are read by",
      "(/docs/api-reference/api-reference#reading-one-record-by-its-id)",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test.each(LANGUAGES.filter((language: string) => {
    return language !== "en";
  }))("the %s upgrade guide has the line, before the endpoint changes", (language: string) => {
    const lines: Array<string> = read(language, "installation/upgrading.md").split(
      "\n",
    );
    const anchor: number = lines.findIndex((line: string): boolean => {
      return (
        line.startsWith("- ") && line.includes("(#api-and-endpoint-changes)")
      );
    });

    expect([language, anchor > 0]).toEqual([language, true]);

    const line: string = lines[anchor - 1] || "";

    expect([language, line.startsWith("- **")]).toEqual([language, true]);
    expect([language, line.includes(GET_ITEM)]).toEqual([language, true]);
    expect([language, line.includes(WILDCARD)]).toEqual([language, true]);
    expect([language, line.includes("`404`")]).toEqual([language, true]);
  });
});
