import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SLO_MONITORS_MANAGED_BY_RULES_MESSAGE,
  SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/SloMonitorSource";

/*
 * Source wiring of the SLO Monitors and Monitor Rules pages. App has no React,
 * so the pages are read as text and only their INVARIANTS are pinned - what
 * would silently break the product if it drifted:
 *
 *   - Monitor Rules is a RuleTable over the rule model with all four
 *     match fields on the "match-criteria" step (that is what makes ModelForm
 *     swap in the condition builder), scoped to this SLO and project.
 *   - Monitors lists exactly the SLO's monitor ids, writes through the pure
 *     helper's payload, and never borrows MonitorsTable's monitor-level bulk
 *     actions.
 *   - Both keep their table state to themselves, and the words the page shows
 *     for a refused action are the words the API refuses it with.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");
const REPOSITORY_ROOT: string = path.join(APP_ROOT, "..");

const MONITOR_RULES_PAGE: string = "Pages/Slo/View/MonitorRules.tsx";
const MONITOR_RULE_FIELDS: string =
  "Pages/Slo/View/SloMonitorRuleFormFields.ts";
const MONITORS_PAGE: string = "Pages/Slo/View/Monitors.tsx";
const HELPER_MODULE: string = "Pages/Slo/Utils/SloMonitorSource.ts";

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may legitimately mention anything), whitespace squashed.
function readCode(relativePath: string): string {
  return readRaw(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  // A named RegExp, because eslint's wrap-regex and prettier fight over a bare literal.
  const sourceFilePattern: RegExp = /\.(ts|tsx)$/;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (sourceFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("SLO Monitor Rules page", () => {
  const code: string = readCode(MONITOR_RULES_PAGE);
  const formFields: string = readCode(MONITOR_RULE_FIELDS);

  /*
   * RuleTable renders a ModelTable with the same props (so the form still
   * swaps in the condition builder) and adds Run Now plus a per-rule view
   * page. RuleViewPagesWiring.test.ts pins the view routing itself.
   */
  test("is a RuleTable over the rule model, typed and bound in the same opening tag", () => {
    expect(code).toMatch(
      /<RuleTable<ServiceLevelObjectiveMonitorRule> modelType=\{ServiceLevelObjectiveMonitorRule\}/,
    );
    expect(code).not.toContain("<ModelTable");
  });

  test("reads the SLO id one segment back from <sloId>/monitor-rules, two back on a rule's view page", () => {
    expect(code).toContain(
      "Navigation.getLastParamAsObjectID( props.ruleViewModelType ? 2 : 1, )",
    );
  });

  test("lists and creates rules for this SLO in this project only", () => {
    expect(code).toMatch(
      /query=\{\{ serviceLevelObjectiveId: modelId, projectId: ProjectUtil\.getCurrentProjectId\(\)!, \}\}/,
    );
    expect(code).toContain("item.serviceLevelObjectiveId = modelId;");
    expect(code).toMatch(
      /item\.projectId = ProjectUtil\.getCurrentProjectId\(\)/,
    );
  });

  test("has the basic-info and match-criteria steps", () => {
    expect(code).toContain('{ title: "Basic Info", id: "basic-info" }');
    expect(code).toContain('{ title: "Match Criteria", id: "match-criteria" }');
  });

  test("uses the shared SLO monitor rule form fields", () => {
    expect(code).toContain(
      'import getSloMonitorRuleFormFields from "./SloMonitorRuleFormFields";',
    );
    expect(code).toContain("formFields={getSloMonitorRuleFormFields()}");
  });

  test("puts all four match fields on the match-criteria step, so ModelForm swaps in the builder", () => {
    for (const field of [
      "monitorLabels",
      "monitorType",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]) {
      expect(formFields).toMatch(
        new RegExp(
          `field: \\{ ${field}: true \\},(?:(?!stepId:).)*?stepId: "match-criteria"`,
        ),
      );
    }
  });

  test("labels are picked from the project's labels", () => {
    expect(formFields).toMatch(
      /field: \{ monitorLabels: true \},(?:(?!stepId:).)*?stepId: "match-criteria",(?:(?!field:).)*?dropdownModal: \{ type: Label,/,
    );
  });

  /*
   * The condition builder labels each criterion option with its field's
   * title, and the SLO E2E spec picks the option by that exact label. PR CI
   * never runs E2E, so a renamed title (Monitor Name Pattern -> Monitor Name)
   * would only surface as a timed-out click on master. Pin the link here.
   */
  test("every criterion the SLO E2E spec picks is a match-criteria field title", () => {
    const spec: string = fs
      .readFileSync(
        path.join(REPOSITORY_ROOT, "E2E/Tests/Dashboard/Slo.spec.ts"),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|\s)\/\/.*$/gm, " ")
      .replace(/\s+/g, " ");

    const pickedCriteria: Array<string> = Array.from(
      spec.matchAll(
        /name: "Criteria for condition \d+",? \}\);(?:(?!getByRole\().)*getByRole\("option", \{ name: "([^"]+)", exact: true \}\)/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(pickedCriteria.length).toBeGreaterThan(0);

    for (const title of pickedCriteria) {
      const escapedTitle: string = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const matchCriteriaFieldPattern: RegExp = new RegExp(
        `field: \\{ \\w+: true \\}, title: "${escapedTitle}", stepId: "match-criteria"`,
      );

      expect({
        title: title,
        isMatchCriteriaFieldTitle: matchCriteriaFieldPattern.test(formFields),
      }).toEqual({ title: title, isMatchCriteriaFieldTitle: true });
    }
  });

  test("its help has a Match Criteria section for the builder to rewrite", () => {
    expect(readRaw(MONITOR_RULES_PAGE)).toContain("### Match Criteria");
  });

  test("shows the SLO notice banner and links through to the Monitors page", () => {
    expect(code).toContain("<SloNoticeBanner sloId={modelId} />");
    expect(code).toContain("RouteMap[PageMap.SLO_VIEW_MONITORS] as Route");
  });

  test("shows whether each rule is enabled", () => {
    expect(code).toContain('text="Enabled"');
    expect(code).toContain('text="Disabled"');
    expect(code).toContain("selectMoreFields={{ isEnabled: true }}");
  });
});

describe("SLO Monitors page", () => {
  const code: string = readCode(MONITORS_PAGE);

  test("is its own ModelTable over Monitor, never the shared MonitorsTable with its bulk actions", () => {
    expect(code).toMatch(/<ModelTable<Monitor> modelType=\{Monitor\}/);
    expect(code).not.toContain("Components/Monitor/MonitorTable");
    expect(code).not.toContain("<MonitorsTable");
    expect(code).toContain("isDeleteable={false}");
    expect(code).toContain("isEditable={false}");
    expect(code).toContain("isCreateable={false}");
  });

  test("reads the SLO id one segment back from <sloId>/monitors", () => {
    expect(code).toContain("Navigation.getLastParamAsObjectID(1)");
  });

  test("lists exactly the SLO's monitors, in this project", () => {
    expect(code).toContain("_id: new Includes(membership.monitorIds)");
    expect(code).toContain("projectId: ProjectUtil.getCurrentProjectId()!");
    expect(code).toMatch(
      /select: \{ monitors: \{ _id: true, \}, autoAddedMonitors: \{ _id: true, \}, \}/,
    );
  });

  test("counts only ENABLED monitor rules of this SLO", () => {
    expect(code).toMatch(
      /ModelAPI\.count<ServiceLevelObjectiveMonitorRule>\(\{ modelType: ServiceLevelObjectiveMonitorRule, query: \{ serviceLevelObjectiveId: modelId, projectId: ProjectUtil\.getCurrentProjectId\(\)!, isEnabled: true, \}, \}\)/,
    );
  });

  test("writes the monitor list through the helper's payload, applied to a fresh read", () => {
    expect(code).toMatch(
      /const saveMonitorChange: SaveMonitorChangeFunction = async \(.*?\): Promise<void> => \{ const current: SloMonitorState = await fetchSloMonitorState\(\);/,
    );
    expect(code).toMatch(
      /ModelAPI\.updateById<ServiceLevelObjective>\(\{ modelType: ServiceLevelObjective, id: modelId, data: buildSloMonitorsUpdateData\( applySloMonitorChange\(\{ currentMonitorIds: current\.membership\.monitorIds,/,
    );
  });

  test("decides every affordance through the pure helper", () => {
    expect(code).toContain("getAddMonitorsAvailability(");
    expect(code).toContain("getRemoveMonitorAvailability(");
    expect(code).toContain("getSloMonitorSource(");
    expect(code).toContain("getAddableMonitorOptions(");
  });

  test("shows where each monitor came from", () => {
    expect(code).toContain('title: "Source"');
    expect(code).toContain('text="Rule"');
    expect(code).toContain('text="Manual"');
  });

  test("asks before removing, and explains rule management with a link to the rules", () => {
    expect(code).toContain('title="Remove Monitor from SLO"');
    expect(code).toContain("SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE");
    expect(code).toContain("RouteMap[PageMap.SLO_VIEW_MONITOR_RULES] as Route");
  });

  test("refreshes the notice banner and the table together after a change", () => {
    expect(code).toContain("refreshToggle={refreshCount.toString()}");
    expect(code).toMatch(
      /<SloNoticeBanner sloId=\{modelId\} refreshToggle=\{refreshCount\.toString\(\)\} \/>/,
    );
  });

  test("never reads or writes the deprecated SLO monitorLabels column", () => {
    expect(code).not.toContain("monitorLabels");
  });

  test("gates add and remove on permission to edit the SLO", () => {
    expect(code).toContain(
      "PermissionGate.check( new ServiceLevelObjective(), ModelAction.Update, )",
    );
    expect(code).toContain("PermissionGate.gateCardButton(");
  });
});

describe("SLO monitor pages keep their table state to themselves", () => {
  const sources: Array<{ file: string; raw: string }> = listSourceFiles(
    DASHBOARD_SRC,
  ).map((file: string) => {
    return { file: file, raw: fs.readFileSync(file, "utf8") };
  });

  for (const [tableId, page] of [
    ["slo-monitors-table", MONITORS_PAGE],
    ["slo-monitor-rules-table", MONITOR_RULES_PAGE],
  ] as Array<[string, string]>) {
    test(`"${tableId}" is used by ${page} and nowhere else`, () => {
      const users: Array<string> = sources
        .filter((source: { file: string; raw: string }) => {
          return source.raw.includes(`"${tableId}"`);
        })
        .map((source: { file: string; raw: string }) => {
          return path.relative(DASHBOARD_SRC, source.file);
        });

      expect(users).toEqual([page]);

      const code: string = readCode(page);

      expect(code).toContain(`userPreferencesKey="${tableId}"`);
      expect(code).toContain(`saveFilterProps={{ tableId: "${tableId}", }}`);
    });
  }
});

describe("SloMonitorSource helper", () => {
  test("stays importable from plain node: no React, no window-at-load modules", () => {
    const importStatementPattern: RegExp = /^\s*import\b/;
    const fromClausePattern: RegExp = /\bfrom\s+"/;

    const imports: Array<string> = readRaw(HELPER_MODULE)
      .split("\n")
      .filter((line: string) => {
        return (
          importStatementPattern.test(line) || fromClausePattern.test(line)
        );
      });

    for (const line of imports) {
      expect(line).not.toMatch(
        /"react"|RouteMap|PageMap|Navigation|UI\/Config/,
      );
    }
  });

  test("speaks the same words the API refuses with", () => {
    const serverSource: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "Common/Server/Services/ServiceLevelObjectiveService.ts",
      ),
      "utf8",
    );

    expect(serverSource).toContain(SLO_MONITORS_MANAGED_BY_RULES_MESSAGE);
    expect(serverSource).toContain(SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE);
  });
});
