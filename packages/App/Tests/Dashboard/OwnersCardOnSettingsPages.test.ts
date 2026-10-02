import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident template, scheduled maintenance template, probe and runner
 * pages listed their owners as two tables - "Owners (Teams)" and "Owners
 * (Users)" - each with its own Add button and dropdown. They now show the
 * one Owners card every resource's Owners page shows: people and teams
 * together, added from one list with a click. This pins each page to it,
 * with the owner models and the column that ties a row to the page's record.
 *
 * Read from source: App has no react (FeatureSetImportsStayReactFree), and
 * the card itself is driven in Common/Tests/App/Dashboard/OwnersCard.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

interface OwnersPage {
  file: string;
  userModel: string;
  teamModel: string;
  resourceIdField: string;
  resourceDisplayName: string;
  // What owning means here, in the card's description.
  means: string;
}

const PAGES: Array<OwnersPage> = [
  {
    file: "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
    userModel: "IncidentTemplateOwnerUser",
    teamModel: "IncidentTemplateOwnerTeam",
    resourceIdField: "incidentTemplateId",
    resourceDisplayName: "incident template",
    means: "own every incident declared from this template",
  },
  {
    file: "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx",
    userModel: "ScheduledMaintenanceTemplateOwnerUser",
    teamModel: "ScheduledMaintenanceTemplateOwnerTeam",
    resourceIdField: "scheduledMaintenanceTemplateId",
    resourceDisplayName: "scheduled maintenance template",
    means: "own every event scheduled from this template",
  },
  {
    file: "Pages/Monitor/Settings/MonitorProbeView.tsx",
    userModel: "ProbeOwnerUser",
    teamModel: "ProbeOwnerTeam",
    resourceIdField: "probeId",
    resourceDisplayName: "probe",
    means: "alerted when its status changes",
  },
  {
    file: "Pages/Runbook/Runners/RunnerView.tsx",
    userModel: "RunnerOwnerUser",
    teamModel: "RunnerOwnerTeam",
    resourceIdField: "runnerId",
    resourceDisplayName: "runner",
    means: "alerted when its status changes",
  },
];

/*
 * Comments removed, whitespace squashed, and none kept inside a type
 * argument list: prettier breaks a long `<OwnersCard<User, Team>` over
 * lines, which would otherwise read back as `<OwnersCard< User, Team >`.
 */
function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .replace(/<OwnersCard<\s*([\w]+),\s*([\w]+)\s*>/g, "<OwnersCard<$1, $2>");
}

describe.each(PAGES)("$file", (page: OwnersPage) => {
  const code: string = readCode(page.file);

  test("shows its owners in the one Owners card", () => {
    expect(code).toContain(
      'import OwnersCard from "../../../Components/Owners/OwnersCard";',
    );
    expect(code).toContain(`<OwnersCard<${page.userModel}, ${page.teamModel}>`);
    expect(code).toContain(`ownerUserModelType={${page.userModel}}`);
    expect(code).toContain(`ownerTeamModelType={${page.teamModel}}`);
    expect(code).toContain(`resourceIdField="${page.resourceIdField}"`);
    expect(code).toContain(`resourceDisplayName="${page.resourceDisplayName}"`);
    expect(code).toContain("resourceId={modelId}");
  });

  test("says what owning it means", () => {
    const description: RegExpMatchArray | null = code.match(
      /<OwnersCard<[^>]+>[\s\S]*?description="([^"]+)"/,
    );

    expect(description?.[1]).toContain(page.means);
    expect(code).toMatch(/emptyDescription="Add a teammate or a team [^"]+"/);
  });

  test("no longer lists them in a table per kind", () => {
    expect(code).not.toContain(`ModelTable<${page.userModel}>`);
    expect(code).not.toContain(`ModelTable<${page.teamModel}>`);
    expect(code).not.toContain("Owners (Teams)");
    expect(code).not.toContain("Owners (Users)");
  });

  test("ties each owner row to this record through a column the owner models have", () => {
    const modelsDir: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "Models",
      "DatabaseModels",
    );

    for (const model of [page.userModel, page.teamModel]) {
      const modelCode: string = fs.readFileSync(
        path.join(modelsDir, `${model}.ts`),
        "utf8",
      );

      expect(modelCode).toContain(`public ${page.resourceIdField}?: ObjectID`);
    }
  });
});
