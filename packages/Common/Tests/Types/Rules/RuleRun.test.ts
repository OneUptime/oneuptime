import {
  MAX_RULE_RUN_PASSES,
  RULE_RUN_RESOURCES_PER_PASS,
  RULE_RUN_TYPE_METADATA,
  RuleRunAction,
  RuleRunPassResult,
  RuleRunResult,
  RuleRunResultUtil,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Contract under test - the shapes "Run now" shares between the API and the
 * dashboard.
 *
 * Three things here fail silently if they drift. The run type IS the rule
 * model's tableName, and the dashboard recognises a runnable table by it, so a
 * value that is not a real tableName is a rule table with no Run Now. The
 * action decides what the confirmation promises, so a label rule mapped to the
 * owner action would describe the wrong run. And the parser is what stands
 * between a hand-rolled or old API response and "NaN monitors" in a modal.
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Models",
  "DatabaseModels",
);

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

function pass(overrides: Partial<RuleRunPassResult> = {}): RuleRunPassResult {
  return {
    ...RuleRunResultUtil.emptyCounts(),
    nextCursor: null,
    ownersNotified: false,
    ...overrides,
  };
}

describe("RuleRunType", () => {
  const ruleTypes: Array<RuleRunType> = Object.values(RuleRunType);

  it("covers every label, owner and privacy rule plus status page and SLO monitor rules", () => {
    const modelFiles: Array<string> = fs
      .readdirSync(MODELS_DIRECTORY)
      .map((fileName: string): string => {
        return fileName.replace(/\.ts$/, "");
      });

    const runnableRuleModelName: RegExp = /(LabelRule|OwnerRule|PrivacyRule)$/;

    const expected: Array<string> = modelFiles
      .filter((modelName: string): boolean => {
        return runnableRuleModelName.test(modelName);
      })
      .concat(["StatusPageMonitorRule", "ServiceLevelObjectiveMonitorRule"])
      .sort();

    expect([...ruleTypes].sort()).toEqual(expected);
  });

  it.each(ruleTypes)(
    "%s is the tableName of a real rule model",
    (ruleType: RuleRunType) => {
      const source: string = fs.readFileSync(
        path.join(MODELS_DIRECTORY, `${ruleType}.ts`),
        "utf8",
      );

      expect(source).toContain(`tableName: "${ruleType}"`);
    },
  );

  /*
   * The user-facing decision behind this feature: rules whose effect on an
   * existing record is paging someone, executing a runbook or regrouping
   * episodes are deliberately not runnable against old data.
   */
  it.each([
    "IncidentOnCallRule",
    "AlertOnCallRule",
    "IncidentEpisodeOnCallRule",
    "AlertEpisodeOnCallRule",
    "RunbookRule",
    "AutoRemediationRule",
    "IncidentGroupingRule",
    "AlertGroupingRule",
    "IncidentReminderRule",
    "NetworkSiteAssignmentRule",
  ])("%s cannot be run", (tableName: string) => {
    expect(RuleRunTypeUtil.fromTableName(tableName)).toBeNull();
  });
});

describe("RULE_RUN_TYPE_METADATA", () => {
  it.each(Object.values(RuleRunType))(
    "%s has an action that matches its name and readable nouns",
    (ruleType: RuleRunType) => {
      const meta: (typeof RULE_RUN_TYPE_METADATA)[RuleRunType] =
        RULE_RUN_TYPE_METADATA[ruleType];

      const expectedAction: RuleRunAction = ruleType.endsWith("LabelRule")
        ? RuleRunAction.AddLabels
        : ruleType.endsWith("OwnerRule")
          ? RuleRunAction.AddOwners
          : ruleType.endsWith("PrivacyRule")
            ? RuleRunAction.MarkPrivate
            : ruleType === RuleRunType.ServiceLevelObjectiveMonitorRule
              ? RuleRunAction.SyncSloMonitors
              : RuleRunAction.SyncStatusPageMonitors;

      expect(meta.action).toBe(expectedAction);
      expect(meta.resourceSingular.length).toBeGreaterThan(0);
      expect(meta.resourcePlural.length).toBeGreaterThan(
        meta.resourceSingular.length - 1,
      );
      expect(meta.resourcePlural).not.toBe(meta.resourceSingular);
    },
  );

  it("agrees on the resource between a resource's label and owner rules", () => {
    expect(RULE_RUN_TYPE_METADATA[RuleRunType.HostLabelRule]).toEqual({
      ...RULE_RUN_TYPE_METADATA[RuleRunType.HostOwnerRule],
      action: RuleRunAction.AddLabels,
    });
    expect(
      RULE_RUN_TYPE_METADATA[RuleRunType.IncidentPrivacyRule].resourcePlural,
    ).toBe("incidents");
  });
});

describe("RuleRunTypeUtil", () => {
  it("recognises a runnable rule by its tableName", () => {
    expect(RuleRunTypeUtil.fromTableName("MonitorLabelRule")).toBe(
      RuleRunType.MonitorLabelRule,
    );
    expect(RuleRunTypeUtil.fromTableName("StatusPageMonitorRule")).toBe(
      RuleRunType.StatusPageMonitorRule,
    );
    expect(
      RuleRunTypeUtil.fromTableName("ServiceLevelObjectiveMonitorRule"),
    ).toBe(RuleRunType.ServiceLevelObjectiveMonitorRule);
  });

  /*
   * An SLO's monitors are the union of every enabled rule of the SLO, while a
   * status page rule owns only what it added; the two syncs are described and
   * run differently, so they must not share an action.
   */
  it("gives SLO monitor rules their own sync action, not the status page one", () => {
    expect(
      RuleRunTypeUtil.getAction(RuleRunType.ServiceLevelObjectiveMonitorRule),
    ).toBe(RuleRunAction.SyncSloMonitors);
    expect(RuleRunTypeUtil.getAction(RuleRunType.StatusPageMonitorRule)).toBe(
      RuleRunAction.SyncStatusPageMonitors,
    );
  });

  it("rejects anything else", () => {
    expect(RuleRunTypeUtil.fromTableName(undefined)).toBeNull();
    expect(RuleRunTypeUtil.fromTableName(null)).toBeNull();
    expect(RuleRunTypeUtil.fromTableName("")).toBeNull();
    expect(RuleRunTypeUtil.fromTableName("monitorlabelrule")).toBeNull();
    expect(RuleRunTypeUtil.isRuleRunType(42)).toBe(false);
    expect(RuleRunTypeUtil.isRuleRunType("__proto__")).toBe(false);
  });

  it("reads the action off the metadata", () => {
    expect(RuleRunTypeUtil.getAction(RuleRunType.AlertOwnerRule)).toBe(
      RuleRunAction.AddOwners,
    );
  });
});

describe("run bounds", () => {
  it("covers a large project in one press while keeping each pass small", () => {
    expect(RULE_RUN_RESOURCES_PER_PASS).toBeLessThanOrEqual(500);
    expect(RULE_RUN_RESOURCES_PER_PASS * MAX_RULE_RUN_PASSES).toBeGreaterThan(
      99999,
    );
  });
});

describe("RuleRunResultUtil.parsePassResult", () => {
  it("reads every counter and the cursor", () => {
    const json: JSONObject = {
      resourcesEvaluated: 200,
      resourcesMatched: 40,
      resourcesUpdated: 12,
      itemsAdded: 24,
      itemsRemoved: 1,
      resourcesFailed: 2,
      nextCursor: RULE_ID,
      ownersNotified: true,
    };

    expect(RuleRunResultUtil.parsePassResult(json)).toEqual(json);
  });

  it("reads an absent body as an empty, finished pass", () => {
    expect(RuleRunResultUtil.parsePassResult(undefined)).toEqual(pass());
    expect(RuleRunResultUtil.parsePassResult(null)).toEqual(pass());
    expect(RuleRunResultUtil.parsePassResult({})).toEqual(pass());
  });

  it("reads junk counters as zero rather than NaN", () => {
    const parsed: RuleRunPassResult = RuleRunResultUtil.parsePassResult({
      resourcesEvaluated: "200",
      resourcesMatched: Number.NaN,
      resourcesUpdated: -3,
      itemsAdded: Number.POSITIVE_INFINITY,
      itemsRemoved: null,
      resourcesFailed: 2.7,
    } as unknown as JSONObject);

    expect(parsed.resourcesEvaluated).toBe(0);
    expect(parsed.resourcesMatched).toBe(0);
    expect(parsed.resourcesUpdated).toBe(0);
    expect(parsed.itemsAdded).toBe(0);
    expect(parsed.itemsRemoved).toBe(0);
    expect(parsed.resourcesFailed).toBe(2);
  });

  /*
   * A cursor that is not an id would be rejected by the next request; reading
   * it as "more to do" would turn one bad response into a loop of 400s.
   */
  it("ends the run on a cursor that is not an id", () => {
    for (const cursor of ["", "not-a-uuid", 42, true, {}]) {
      expect(
        RuleRunResultUtil.parsePassResult({
          nextCursor: cursor,
        } as unknown as JSONObject).nextCursor,
      ).toBeNull();
    }
  });

  it("only reads a literal true as notified", () => {
    expect(
      RuleRunResultUtil.parsePassResult({ ownersNotified: "true" })
        .ownersNotified,
    ).toBe(false);
    expect(
      RuleRunResultUtil.parsePassResult({ ownersNotified: 1 }).ownersNotified,
    ).toBe(false);
  });
});

describe("RuleRunResultUtil.mergePasses", () => {
  it("sums every counter across passes", () => {
    const merged: RuleRunResult = RuleRunResultUtil.mergePasses({
      passes: [
        pass({
          resourcesEvaluated: 200,
          resourcesMatched: 10,
          resourcesUpdated: 8,
          itemsAdded: 16,
          resourcesFailed: 1,
          nextCursor: RULE_ID,
        }),
        pass({
          resourcesEvaluated: 57,
          resourcesMatched: 3,
          resourcesUpdated: 3,
          itemsAdded: 3,
          itemsRemoved: 2,
        }),
      ],
      isTruncated: false,
    });

    expect(merged).toEqual({
      resourcesEvaluated: 257,
      resourcesMatched: 13,
      resourcesUpdated: 11,
      itemsAdded: 19,
      itemsRemoved: 2,
      resourcesFailed: 1,
      passes: 2,
      isTruncated: false,
      ownersNotified: false,
    });
  });

  it("reports notification if any pass notified, and passes truncation through", () => {
    const merged: RuleRunResult = RuleRunResultUtil.mergePasses({
      passes: [pass(), pass({ ownersNotified: true }), pass()],
      isTruncated: true,
    });

    expect(merged.ownersNotified).toBe(true);
    expect(merged.isTruncated).toBe(true);
    expect(merged.passes).toBe(3);
  });

  it("merges no passes into an empty result", () => {
    expect(
      RuleRunResultUtil.mergePasses({ passes: [], isTruncated: false }),
    ).toEqual({
      ...RuleRunResultUtil.emptyCounts(),
      passes: 0,
      isTruncated: false,
      ownersNotified: false,
    });
  });
});
