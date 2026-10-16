import {
  ClassSource,
  hasMethod,
  readClassSource,
  reachableText,
} from "../TestingUtils/ClassSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A PLAN LIMIT COUNTED IN A CREATE HOOK IS DECIDED WITH THE INSERT TOO.
 *
 * A limit on how many of something a project may have - its people, its
 * active monitors, the Free plan's status pages, subscribers, dashboards and
 * escalation rules - was a count in onBeforeCreate followed, later, by the
 * INSERT. Creates made at the same moment each counted before any of the
 * others had written, all saw room and were all added, so a project could
 * go past the limit by as many creates as it sent at once.
 *
 * So the rule: a service whose create hooks count rows against a plan's
 * limit also hands DatabaseService that limit for the INSERT
 * (getCreateLimit), which counts again in the INSERT's own transaction
 * under the limit's lock in the project (ProjectLimitLock). The early count
 * stays: it answers first, before anything is prepared.
 *
 * Read from each service's source: what its create hooks reach through
 * `this.<method>(` calls - comments and strings blanked - counting rows
 * (countBy, the project's people, the active monitor count) where a plan's
 * limit is read (the Free plan, a seat limit, the active monitor limit).
 * A service that starts counting against a plan's limit in a create hook
 * must add getCreateLimit, and join the list below.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

// The create hooks a limit is counted in before the record is written.
const CREATE_HOOKS: Array<string> = ["onBeforeCreate", "onCreatePermitted"];

// Where a plan's limit is read: AllowedStatusPageCountInFreePlan and the like too.
const PLAN_LIMIT: RegExp =
  /\b(PlanType\.Free|\w*InFreePlan|seatLimit|readPeopleLimits|ActiveMonitorLimit)\b/;

// Counting what the limit holds.
const COUNTS_ROWS: RegExp =
  /\b(countBy|getUniqueTeamMemberCountInProject|assertRoomFor|countActiveMonitors)\s*\(/;

// Every service whose create hooks count against a plan's limit today.
const SERVICES_HOLDING_A_PLAN_LIMIT: Array<string> = [
  "DashboardService.ts",
  "MonitorService.ts",
  "OnCallDutyPolicyEscalationRuleService.ts",
  "StatusPageService.ts",
  "StatusPageSubscriberService.ts",
  "TeamMemberService.ts",
];

/*
 * Create hooks the scan reads as counting against a plan's limit that do
 * not hold one, and why.
 */
const NOT_A_PLAN_LIMIT: Record<string, string> = {
  "ProjectService.ts":
    "A new project's create writes its seat limit from a reseller's plan, and counts the creator's projects of the same name: no limit on how many projects anyone may have.",
};

function serviceFiles(): Array<string> {
  return fs
    .readdirSync(SERVICES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".ts") && file !== "DatabaseService.ts";
    })
    .sort();
}

// The text a create's hooks reach, or "" for a service with none.
function createHookText(classSource: ClassSource): string {
  return CREATE_HOOKS.map((hook: string): string => {
    return reachableText(classSource, hook);
  }).join("\n");
}

function countsAgainstAPlanLimit(text: string): boolean {
  return PLAN_LIMIT.test(text) && COUNTS_ROWS.test(text);
}

describe("the scan", () => {
  test("sees a Free plan count, a seat limit's count and the active monitor limit", () => {
    expect(
      countsAgainstAPlanLimit(
        "if (createBy.props.currentPlan === PlanType.Free) { const count = await this.countBy({}); }",
      ),
    ).toBe(true);
    expect(
      countsAgainstAPlanLimit(
        "if (project.seatLimit) { await this.getUniqueTeamMemberCountInProject(projectId); }",
      ),
    ).toBe(true);
    expect(
      countsAgainstAPlanLimit(
        "await ActiveMonitorLimit.assertRoomFor({ projectId: projectId });",
      ),
    ).toBe(true);
    expect(
      countsAgainstAPlanLimit(
        "if (count >= AllowedStatusPageCountInFreePlan) { await this.countBy({}); }",
      ),
    ).toBe(true);
  });

  test("passes a count no plan limit reads, and a plan read with no count", () => {
    expect(
      countsAgainstAPlanLimit(
        "const order = (await this.countBy({ query })).toNumber() + 1;",
      ),
    ).toBe(false);
    expect(
      countsAgainstAPlanLimit(
        "if (currentPlan.plan === PlanType.Free) { throw new BadDataException(); }",
      ),
    ).toBe(false);
  });
});

describe("every plan limit counted in a create hook is decided with the INSERT", () => {
  const found: Array<string> = serviceFiles().filter(
    (file: string): boolean => {
      return countsAgainstAPlanLimit(
        createHookText(readClassSource(path.join(SERVICES_DIR, file))),
      );
    },
  );

  test("the services found are the ones known to hold a plan's limit, and the ones known not to", () => {
    expect(
      found.filter((file: string): boolean => {
        return !NOT_A_PLAN_LIMIT[file];
      }),
    ).toEqual(SERVICES_HOLDING_A_PLAN_LIMIT);

    // An exception that no longer matches anything goes.
    for (const file of Object.keys(NOT_A_PLAN_LIMIT)) {
      expect(found).toContain(file);
    }
  });

  test.each(SERVICES_HOLDING_A_PLAN_LIMIT)(
    "%s hands DatabaseService its limit for the INSERT (getCreateLimit)",
    (file: string) => {
      const classSource: ClassSource = readClassSource(
        path.join(SERVICES_DIR, file),
      );

      expect(hasMethod(classSource, "getCreateLimit")).toBe(true);
    },
  );
});
