import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The permissions guide says how a team's block rows are read, and every
 * permission check reads them that way (Types/HeldPermissions):
 *
 *  - a block applies to everything the user does: a block with no labels on
 *    one team takes the capability away even where another team allows it,
 *    and a block row never grants anything;
 *  - an operational resource also accepts the matching All Operational
 *    Resources permission, unless that is blocked;
 *  - fields, actions and the buttons OneUptime shows follow the same rule,
 *    and a locked button names the team block that refuses it.
 *
 * The guide once said the opposite - that a block on one team does not
 * cancel an allow on another - so this pins the English sentences and that
 * every language says as much as English does.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const ALL_LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

function readGuide(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "permissions", "index.md"),
    "utf8",
  );
}

// The section that walks through how a request is decided: the numbered list.
function decisionSection(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<number> = lines
    .map((line: string, index: number): number => {
      return line.startsWith("## ") ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  for (const start of headings) {
    const end: number =
      headings.find((index: number): boolean => {
        return index > start;
      }) ?? lines.length;
    const section: Array<string> = lines.slice(start, end);

    if (
      section.some((line: string): boolean => {
        return line.startsWith("6. ");
      })
    ) {
      return section;
    }
  }

  throw new Error("The guide has no section with the numbered decision list.");
}

function paragraphCount(section: Array<string>): number {
  return section
    .join("\n")
    .split(/\n\s*\n/)
    .filter((paragraph: string): boolean => {
      return paragraph.trim().length > 0;
    }).length;
}

describe("the permissions guide on block rows", () => {
  const english: string = readGuide("en");

  test("there are 17 languages", () => {
    expect(ALL_LANGUAGES).toHaveLength(17);
  });

  test("says a block on one team takes the capability away whatever another team allows", () => {
    expect(english).toContain(
      "a block with no labels on one team takes the capability away even where another team allows it, and a block entry never grants anything",
    );
    expect(english).not.toContain(
      "a block on one team does **not** cancel an allow on another team",
    );
  });

  test("says a block with no labels on any accepted permission refuses, on whichever team it is", () => {
    expect(english).toContain(
      "3. Check the block list first. A block with no labels on any permission the target table accepts for this operation rejects the request outright, whichever team it is on.",
    );
  });

  test("names the operational-resource wildcards the server accepts", () => {
    for (const permission of [
      Permission.CreateAllOperationalResources,
      Permission.ReadAllOperationalResources,
      Permission.EditAllOperationalResources,
      Permission.DeleteAllOperationalResources,
    ]) {
      expect(PermissionHelper.getTitle(permission)).toContain(
        "All Operational Resources",
      );
    }

    expect(english).toContain(
      "the matching **All Operational Resources** permission (Create, Read, Edit or Delete) counts too, unless it is blocked itself",
    );
    expect(english).toContain(
      "but not a field that is narrower on purpose, such as a secret key",
    );
  });

  test("says a locked button names the team block", () => {
    expect(english).toContain(
      "when a block on one of your teams is the reason, it names the blocked permission",
    );
  });

  test.each(ALL_LANGUAGES)(
    "%s says as much as English: the wildcard twice, and every paragraph of the decision",
    (language: string) => {
      const guide: string = readGuide(language);

      expect(guide.split("**All Operational Resources**").length - 1).toBe(
        english.split("**All Operational Resources**").length - 1,
      );
      expect(paragraphCount(decisionSection(guide))).toBe(
        paragraphCount(decisionSection(english)),
      );
    },
  );
});
