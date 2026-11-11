import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Admin Dashboard > Projects shows where each project is in its first hour
 * (issue #6830): a Setup column - "No monitor yet", "Nobody reachable yet",
 * "Set up" - and on a project's page a card with every milestone and when
 * it was reached. Read from this server's own ProjectMilestone rows; nothing
 * is sent anywhere.
 *
 * What connects them is hand-written and fails silently: reading through
 * the tenant-scoped ModelAPI instead of AdminModelAPI scopes the read to a
 * project the admin belongs to; reading one project at a time costs a
 * request a row; a locale missing a key shows the raw key. The admin
 * dashboard has no React render harness, so this checks the source text
 * and the locale files, as its sibling suites do. The words and the stuck-
 * at rule are Common's (ActivationMilestone suite).
 */

const ADMIN_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(ADMIN_SRC, relativePath), "utf8"),
  );
}

const LOCALES_DIR: string = nodePath.join(ADMIN_SRC, "Locales");

describe("project milestones in the Admin Dashboard", () => {
  test("the milestones are read through AdminModelAPI, a page of projects in one request", () => {
    const source: string = read(
      "Components/ProjectMilestones/ProjectMilestones.ts",
    );

    expect(source).toContain(
      'import AdminModelAPI from "../../Utils/ModelAPI";',
    );
    expect(source).not.toMatch(/from "Common\/UI\/Utils\/ModelAPI\/ModelAPI"/);
    expect(source).toMatch(
      /AdminModelAPI\.getList<ProjectMilestone>\(\{\s*modelType: ProjectMilestone,\s*query: \{ projectId: new Includes\(projectIds\) \},/,
    );
    expect(source).toMatch(
      /AdminModelAPI\.getList<ProjectMilestone>\(\{\s*modelType: ProjectMilestone,\s*query: \{ projectId: projectId \},/,
    );
  });

  test("the Projects list reads them once its page is read, and draws a Setup column from them", () => {
    const source: string = read("Pages/Projects/Index.tsx");

    expect(source).toMatch(
      /onFetchSuccess=\{\(projects: Array<Project>\): void => \{\s*readMilestones\(projects\);\s*\}\}/,
    );
    expect(source).toContain("fetchReachedMilestonesByProject(projectIds)");
    expect(source).toMatch(/title: "Setup",\s*type: FieldType\.Element,/);
    expect(source).toMatch(
      /<ProjectSetupStatus\s*reached=\{reachedByProject\[item\.id\?\.toString\(\) \|\| ""\] \|\| null\}\s*\/>/,
    );
    // A read overtaken by a newer page's never lands.
    expect(source).toContain("if (read === milestonesReadRef.current) {");
  });

  test("the status says where the project is stuck, by the one rule", () => {
    const source: string = read(
      "Components/ProjectMilestones/ProjectSetupStatus.tsx",
    );

    expect(source).toContain("getActivationSetupSummary(");
    expect(source).toMatch(
      /<Pill text=\{summary\.text\} color=\{summary\.isSetUp \? Green : Yellow\} \/>/,
    );
  });

  test("the project's page shows the card, with words from the locales", () => {
    const source: string = read("Pages/Projects/View/Index.tsx");

    expect(source).toMatch(
      /<ProjectMilestonesCard\s*projectId=\{modelId\}\s*title=\{t\("pages\.projectView\.milestonesCardTitle"\)\}\s*description=\{t\("pages\.projectView\.milestonesCardDescription"\)\}\s*\/>/,
    );

    const card: string = read(
      "Components/ProjectMilestones/ProjectMilestonesCard.tsx",
    );

    expect(card).toContain("fetchProjectMilestones(props.projectId)");
    expect(card).toContain("ACTIVATION_MILESTONE_DETAILS.map(");
    expect(card).toContain('"Not yet"');
  });

  test("every locale has the card's title and description", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files.length).toBeGreaterThanOrEqual(18);

    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(nodePath.join(LOCALES_DIR, "en.json"), "utf8"),
    ).pages.projectView;

    for (const file of files) {
      const projectView: Record<string, string> = JSON.parse(
        fs.readFileSync(nodePath.join(LOCALES_DIR, file), "utf8"),
      ).pages.projectView;

      for (const key of ["milestonesCardTitle", "milestonesCardDescription"]) {
        expect(typeof projectView[key]).toBe("string");
        expect(projectView[key]!.trim().length).toBeGreaterThan(0);

        if (file !== "en.json") {
          expect(projectView[key]).not.toBe(english[key]);
        }
      }
    }
  });
});
