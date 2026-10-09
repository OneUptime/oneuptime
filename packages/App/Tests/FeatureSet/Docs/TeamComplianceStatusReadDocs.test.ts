import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A TEAM'S COMPLIANCE STATUS IS READ ONLY BY SOMEONE WHO MAY READ ITS
 * COMPLIANCE RULES (ee/Server/TeamCompliance/TeamComplianceAPI asks
 * CommonAPI.assertCanReadTable about TeamComplianceSetting before anything is
 * read as root): a member whose teams grant only other roles is refused the
 * status, as the rules' own CRUD endpoint refuses them.
 *
 * The upgrade notes say so, at length in English and in one line in every
 * other guide, naming the route and the roles that read it.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const ROUTE: string = "`GET /api/team/compliance-status/:teamId`";

// What reads the rules on their CRUD endpoint, and so the status.
const READERS: Array<string> = [
  "`ProjectOwner`",
  "`ProjectAdmin`",
  "`ProjectMember`",
  "`Viewer`",
  "`ReadProjectTeam`",
];

function upgradeNotes(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "installation/upgrading.md"),
    "utf8",
  );
}

// The line of the notes that names the route - the whole bullet, outside English.
function lineNamingTheRoute(markdown: string): string {
  return (
    markdown.split("\n").find((line: string): boolean => {
      return line.includes(ROUTE);
    }) || ""
  );
}

describe("Docs: a team's compliance status takes a read of its rules", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("the English upgrade notes say who reads the status, and who no longer does", () => {
    const page: string = upgradeNotes("en");
    for (const sentence of [
      "- **On the Enterprise Edition, a team's compliance status is read only by",
      "someone who may read its compliance rules.** The team's Compliance page",
      `(${ROUTE}) now takes what reading the`,
      "`ReadProjectTeam`, and no team block on them. A member whose teams grant",
      "only other roles, such as `MonitorViewer`, was refused the rules but shown",
      "refused with a `422`. Anyone in the project still lists a team's members.",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test("the English note sits with the other changes in 14, beside who owns a resource", () => {
    const page: string = upgradeNotes("en");
    const note: number = page.indexOf(
      "- **On the Enterprise Edition, a team's compliance status",
    );
    const otherChanges: number = page.indexOf("### Other changes in 14");
    const owners: number = page.indexOf(
      "- **Who owns a resource, and a setting that holds credentials",
    );
    expect(otherChanges).toBeGreaterThanOrEqual(0);
    expect(note).toBeGreaterThan(otherChanges);
    expect(owners).toBeGreaterThan(note);
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s has the note in one line, translated, with the route and the role names kept",
    (language: string) => {
      const line: string = lineNamingTheRoute(upgradeNotes(language));

      expect([language, line.startsWith("- **")]).toEqual([language, true]);
      for (const name of [...READERS, "`MonitorViewer`", "`422`"]) {
        expect([language, name, line.includes(name)]).toEqual([
          language,
          name,
          true,
        ]);
      }
      expect([language, line.includes("is read only by")]).toEqual([
        language,
        false,
      ]);
    },
  );
});
