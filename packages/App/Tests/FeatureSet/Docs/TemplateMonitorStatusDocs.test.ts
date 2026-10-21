import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Permission from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the template pages say about a template's Change Monitor Status to
 * and Initial Incident State, against the product: who may change them (the
 * columns' update lists), and what an existing template's Affected
 * Resources card shows when the template picks no status (the card's own
 * words, read from its component rather than imported: App tests never
 * import a React module).
 *
 * Persian keeps the incident settings page in step with English
 * (IncidentTemplateDocs); every other language falls back to English there.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const STATUS_ELEMENT_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/MonitorStatus/ChangeMonitorStatusToElement.tsx",
);

const NO_STATUS_TEXT: string = "Monitors keep their status.";

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// The lines of a page that hold every one of these.
function linesWith(text: string, needles: Array<string>): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return needles.every((needle: string): boolean => {
      return line.includes(needle);
    });
  });
}

function updateListOf(
  model: IncidentTemplate | ScheduledMaintenanceTemplate,
  column: string,
): Array<Permission> {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  return [...(access?.update || [])].sort();
}

// How the incident settings page names each permission that edits a template.
const NAMED_AS: Record<string, Record<string, string>> = {
  en: {
    [Permission.ProjectOwner]: "Project Owners",
    [Permission.ProjectAdmin]: "Project Admins",
    [Permission.ProjectMember]: "Project Members",
    [Permission.IncidentAdmin]: "Incident Admins",
    [Permission.IncidentMember]: "Incident Members",
    [Permission.EditIncidentTemplate]: "**Edit Incident Template**",
  },
  fa: {
    [Permission.ProjectOwner]: "Project Ownerها",
    [Permission.ProjectAdmin]: "Project Adminها",
    [Permission.ProjectMember]: "Project Memberها",
    [Permission.IncidentAdmin]: "Incident Adminها",
    [Permission.IncidentMember]: "Incident Memberها",
    [Permission.EditIncidentTemplate]: "**Edit Incident Template**",
  },
};

describe("the template pages, on a template's Change Monitor Status to", () => {
  test("the card's words for a template with no status are the ones the docs quote", () => {
    const element: string = fs.readFileSync(STATUS_ELEMENT_FILE, "utf8");

    expect(element).toContain(`translator.translateText("${NO_STATUS_TEXT}")`);

    for (const [language, page] of [
      ["en", "incidents/settings"],
      ["fa", "incidents/settings"],
      ["en", "status-pages/subscribers"],
    ] as Array<[string, string]>) {
      expect([
        `${language}/${page}`,
        linesWith(readPage(language, page), [
          "**Affected Resources**",
          `**${NO_STATUS_TEXT}**`,
        ]).length,
      ]).toEqual([`${language}/${page}`, 1]);
    }
  });

  test("the incident settings page names exactly who may change it, as the template's columns say", () => {
    const editors: Array<Permission> = updateListOf(
      new IncidentTemplate(),
      "changeMonitorStatusTo",
    );

    // By both of its names, and the initial state alike.
    expect(
      updateListOf(new IncidentTemplate(), "changeMonitorStatusToId"),
    ).toEqual(editors);
    expect(
      updateListOf(new IncidentTemplate(), "initialIncidentState"),
    ).toEqual(editors);
    expect(editors).toEqual(
      [...new IncidentTemplate().getUpdatePermissions()].sort(),
    );

    for (const language of ["en", "fa"]) {
      const rule: Array<string> = linesWith(
        readPage(language, "incidents/settings"),
        [
          "**Initial Incident State**",
          "**Change Monitor Status to**",
          "**Edit Incident Template**",
        ],
      );

      expect([language, rule.length]).toEqual([language, 1]);

      for (const permission of editors) {
        const name: string | undefined = NAMED_AS[language]![permission];

        expect([language, permission, Boolean(name)]).toEqual([
          language,
          permission,
          true,
        ]);
        expect([language, permission, rule[0]!.includes(name!)]).toEqual([
          language,
          permission,
          true,
        ]);
      }
    }
  });

  test("the scheduled maintenance page says the template's editors may change it, as its columns say", () => {
    const editors: Array<Permission> = updateListOf(
      new ScheduledMaintenanceTemplate(),
      "changeMonitorStatusTo",
    );

    expect(editors).toEqual(
      [...new ScheduledMaintenanceTemplate().getUpdatePermissions()].sort(),
    );
    expect(
      linesWith(readPage("en", "status-pages/subscribers"), [
        "anyone who can edit the template can change it there",
      ]),
    ).toHaveLength(1);
  });
});
