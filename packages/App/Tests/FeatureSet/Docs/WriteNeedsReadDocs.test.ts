import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A WRITE NEEDS A READ (Common/Server/Types/Database/Permissions
 * /BasePermission.addRecordScopeToQuery): a change or a delete reaches only
 * the records its caller may read, a record read through another one only
 * through a record its caller may read, and a change or a delete by ID that
 * reaches nothing answers 404 for a record the caller may not read and 422
 * for one they may read but not change (DatabaseService
 * .getUnwrittenByIdError).
 *
 * Users, Teams & Permissions says so in every docs language - step 7 of how
 * a request is decided, and a paragraph under Granular permissions for the
 * custom roles it changes - and the API reference and the upgrade notes say
 * what a client sees.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function permissionsPage(language: string): string {
  return read(language, "permissions/index.md");
}

// The one line of a numbered step on the permissions page.
function stepOf(markdown: string, number: number): string {
  return (
    markdown.split("\n").find((line: string): boolean => {
      return line.startsWith(`${number}. `);
    }) || ""
  );
}

// The paragraph right after the one naming every granular permission.
function granularParagraph(markdown: string): string {
  const lines: Array<string> = markdown.split("\n");
  const index: number = lines.findIndex((line: string): boolean => {
    return line.includes("{{PERMISSION_TOTAL_COUNT}}");
  });

  expect(index).toBeGreaterThanOrEqual(0);
  expect(lines[index + 1]).toBe("");

  return lines[index + 2] || "";
}

describe("Docs: a write needs a read", () => {
  const english: string = permissionsPage("en");

  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("step 7 says a change or a delete keeps to what you may read", () => {
    const step: string = stepOf(english, 7);

    expect(step).toContain(
      "A change or a delete is narrowed by your read permissions as well as by the permission for the change",
    );
    expect(step).toContain(
      "a block with no labels on reading a kind of record takes changing and deleting it away too",
    );
    expect(step).toContain(
      "with no permission to read incidents, a permission on notes reaches no note",
    );
    expect(step).toContain(
      "a block with labels on reading incidents leaves out the notes of the incidents carrying them",
    );
    expect(step).toContain(
      "is answered as if the record did not exist (`404`) when you may not read it, and refused when you may read it but not change it.",
    );
  });

  test("Granular permissions tells a custom role to give the read permission with the edit one", () => {
    const paragraph: string = granularParagraph(english);

    expect(paragraph).toContain(
      "`EditProjectIncident` changes no incident without `ReadProjectIncident`",
    );
    expect(paragraph).toContain(
      "`ReadIncidentInternalNote` reaches no note without one to read incidents",
    );
    expect(paragraph).toContain("The roles hold both already.");
  });

  test.each(LANGUAGES)(
    "%s has step 7 and the granular paragraph, translated, with the permission names kept",
    (language: string) => {
      const page: string = permissionsPage(language);
      const step: string = stepOf(page, 7);
      const paragraph: string = granularParagraph(page);

      expect([language, step.length > 0]).toEqual([language, true]);
      expect([language, stepOf(page, 8)]).toEqual([language, ""]);
      expect([language, step.includes("`404`")]).toEqual([language, true]);

      for (const permission of [
        "`EditProjectIncident`",
        "`ReadProjectIncident`",
        "`ReadIncidentInternalNote`",
      ]) {
        expect([language, permission, paragraph.includes(permission)]).toEqual(
          [language, permission, true],
        );
      }

      // Step 7 follows step 6 directly: the steps are one list.
      const lines: Array<string> = page.split("\n");
      const sixth: number = lines.findIndex((line: string): boolean => {
        return line.startsWith("6. ");
      });

      expect([language, lines[sixth + 1]]).toEqual([language, step]);

      if (language !== "en") {
        expect([language, step === stepOf(english, 7)]).toEqual([
          language,
          false,
        ]);
        expect([language, paragraph === granularParagraph(english)]).toEqual([
          language,
          false,
        ]);
      }
    },
  );

  test("the API reference says what a change or a delete by ID answers", () => {
    const page: string = read("en", "api-reference/api-reference.md");

    expect(page).toContain(
      "### Changing or deleting a record you may not read",
    );
    expect(page).toContain(
      "- `404` when the record does not exist, is in another project, or is one you may not read - the same answer for each:",
    );
    expect(page).toContain(
      "- `422` when you may read the record but not change or delete it, with the reason:",
    );
    expect(page).toContain("A delete that reached nothing used to answer `200`.");
    expect(page).toContain(
      "Terraform reads a `404` on `terraform destroy` as a resource that is already gone.",
    );
  });

  test("the upgrade notes say what changes for custom roles and API keys", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      "**A record you may not read can no longer be changed or deleted, and a",
      "permissions are, and a block on reading takes changing and deleting",
      "`ReadIncidentInternalNote` without one to read incidents now reaches no",
      "routes) answers `404` when the record does not exist or the caller may",
      "A delete used to answer `200` with nothing deleted, and an update `422`",
      "(/docs/api-reference/api-reference#changing-or-deleting-a-record-you-may-not-read)",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }
  });
});
