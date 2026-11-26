import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ALERT_RULE_MODEL_TYPES,
  getAlertRuleResourceTypes,
} from "../../FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertRuleAuditLogTypes";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getApiSingularName } from "Common/Utils/ModelApiName";

/*
 * ALERTS > RULES > AUDIT LOGS (#10290): who changed the project's alert
 * rules, what they changed and when. Most alert rules are rows on their
 * list, with no page of their own to hang an Audit Logs page off, so their
 * history is one page at the end of the menu section that lists them.
 *
 * These hold the page to every kind of alert rule - a new kind is listed
 * here or fails the test - and to its place in the Dashboard: its route,
 * its breadcrumbs, its entry in Search. AlertsSideMenu holds its place in
 * the menu.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

const ALERT_RULE_TABLE: RegExp = /^Alert(Episode)?[A-Za-z]*Rule(OwningTeam)?$/;

describe("which alert rules it lists", () => {
  test("every kind of alert rule the audit log records, and its owning teams", () => {
    const recorded: Array<string> = (
      AllModelTypes as Array<{ new (): BaseModel }>
    )
      .map((modelType: { new (): BaseModel }): BaseModel => {
        return new modelType();
      })
      .filter((model: BaseModel): boolean => {
        return (
          ALERT_RULE_TABLE.test(model.tableName || "") &&
          Boolean(model.enableAuditLogOn?.update)
        );
      })
      .map((model: BaseModel): string => {
        return model.tableName || "";
      })
      .sort();

    const listed: Array<string> = ALERT_RULE_MODEL_TYPES.map(
      (modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      },
    ).sort();

    expect(listed.length).toBeGreaterThanOrEqual(13);
    expect(listed).toEqual(recorded);
  });

  test("by the types their entries are stored under, each once", () => {
    const types: Array<string> = getAlertRuleResourceTypes();

    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual(
      ALERT_RULE_MODEL_TYPES.map((modelType: { new (): BaseModel }): string => {
        return getApiSingularName(new modelType());
      }),
    );
  });

  test("no incident rule's: each is an alert's, or an alert episode's", () => {
    for (const type of getAlertRuleResourceTypes()) {
      expect(type).toMatch(/^Alert /);
    }
  });

  test("the page asks for exactly those types", () => {
    const page: string = read("Pages/Alerts/Settings/AlertRulesAuditLogs.tsx");

    expect(page).toContain("resourceTypes={getAlertRuleResourceTypes()}");
    expect(page).not.toContain("rootResourceId");
  });
});

describe("where it is", () => {
  test("has a page map entry and a route under Alerts' settings", () => {
    expect(PageMap.ALERTS_SETTINGS_RULES_AUDIT_LOGS).toBe(
      "ALERTS_SETTINGS_RULES_AUDIT_LOGS",
    );

    const routeMap: string = read("Utils/RouteMap.ts");

    expect(routeMap).toContain(
      '[PageMap.ALERTS_SETTINGS_RULES_AUDIT_LOGS]: "settings/rules-audit-logs",',
    );
    expect(routeMap).toContain(
      "[PageMap.ALERTS_SETTINGS_RULES_AUDIT_LOGS]: new Route(",
    );
  });

  test("is routed to its page", () => {
    const routes: string = read("Routes/AlertRoutes.tsx");

    expect(routes).toContain(
      'import AlertRulesAuditLogs from "../Pages/Alerts/Settings/AlertRulesAuditLogs";',
    );
    expect(routes).toContain(
      "AlertsRoutePath[PageMap.ALERTS_SETTINGS_RULES_AUDIT_LOGS]",
    );
    expect(routes).toContain("<AlertRulesAuditLogs");
  });

  test("has a trail back up: Project > Alerts > Rules > Audit Logs", () => {
    const breadcrumbs: string = read("Utils/Breadcrumbs/AlertBreadcrumbs.ts");

    expect(breadcrumbs).toMatch(
      /PageMap\.ALERTS_SETTINGS_RULES_AUDIT_LOGS,\s*\[\s*"Project",\s*"Alerts",\s*"Rules",\s*"Audit Logs",?\s*\]/,
    );
  });

  test("is found by Search under Rules", () => {
    const search: string = read("Components/CommandPalette/PageSearchIndex.ts");

    expect(search).toMatch(
      /page: PageMap\.ALERTS_SETTINGS_RULES_AUDIT_LOGS,\s*title: "Audit Logs",/,
    );
  });
});
