import { describe, expect, test } from "@jest/globals";
import {
  LibraryStatusFilter,
  RECOMMENDED_FILTER,
  readRuleLibraryFilters,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import {
  MAX_DISMISSED_IDS,
  RECOMMENDED_RULES_SHOWN,
  RecommendedRulesNotAddedView,
  RuleAddedByOneUptimeView,
  SecurityRecommendedRulesDismissal,
  getDismissalKey,
  getRecommendedRulesNotAddedQuery,
  getRecommendedRulesNotAddedView,
  getRulesAddedByOneUptimeViews,
  mergeDismissedIds,
  readDismissedIdsFrom,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityRecommendedRulesModel";
import {
  SecuritySetupStatus,
  parseSecuritySetupStatus,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
/*
 * What the Overview's lines about recommended rules are drawn from (#11037):
 * which rules are named, how many, and what the rest open; which rules
 * OneUptime turned on to say; what a reader dismissed, per project; and the
 * server's answer, read defensively.
 */

const SERVED: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SENSITIVE_FILE_SERVED_RULE_ID,
)!;
const SCANNING: DetectionRuleLibraryEntry = getDetectionRuleLibraryEntry(
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
)!;
const PROJECT: ObjectID = new ObjectID("11037000-0000-4000-8000-0000000000e1");

function status(
  overrides: Partial<SecuritySetupStatus> = {},
): SecuritySetupStatus {
  return {
    connections: 1,
    logsSourceEnabled: true,
    telemetrySourcesEnabled: 0,
    eventsLast24Hours: 0,
    lastEventAt: null,
    enabledRules: 3,
    recommendedRules: RECOMMENDED_DETECTION_RULE_IDS.length,
    recommendedRulesOn: 3,
    threatIntelFeeds: 0,
    openCases: 0,
    enabledPlaybooks: 1,
    destinations: 0,
    ...overrides,
  };
}

function ids(entries: Array<DetectionRuleLibraryEntry>): Array<string> {
  return entries.map((entry: DetectionRuleLibraryEntry): string => {
    return entry.id;
  });
}

describe("the recommended rules the card names", () => {
  test("none to name, no line", () => {
    expect(
      getRecommendedRulesNotAddedView({ status: status(), dismissedIds: [] }),
    ).toBeNull();
    expect(
      getRecommendedRulesNotAddedView({
        status: status({ recommendedRulesNotAdded: [] }),
        dismissedIds: [],
      }),
    ).toBeNull();
  });

  test("the first few by name, the rest counted - and every one of them is what Dismiss puts away", () => {
    const missing: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules().slice(0, RECOMMENDED_RULES_SHOWN + 4);
    const view: RecommendedRulesNotAddedView = getRecommendedRulesNotAddedView({
      status: status({ recommendedRulesNotAdded: missing }),
      dismissedIds: [],
    })!;

    expect(ids(view.shown)).toEqual(
      ids(missing.slice(0, RECOMMENDED_RULES_SHOWN)),
    );
    expect(view.total).toBe(RECOMMENDED_RULES_SHOWN + 4);
    expect(view.more).toBe(4);
    expect(view.ids).toEqual(ids(missing));
  });

  test("a rule the reader dismissed is left out; a line of nothing but those is none", () => {
    expect(
      ids(
        getRecommendedRulesNotAddedView({
          status: status({ recommendedRulesNotAdded: [SCANNING, SERVED] }),
          dismissedIds: [SCANNING.id],
        })!.shown,
      ),
    ).toEqual([SERVED.id]);
    expect(
      getRecommendedRulesNotAddedView({
        status: status({ recommendedRulesNotAdded: [SERVED] }),
        dismissedIds: [SERVED.id],
      }),
    ).toBeNull();
  });

  test("the rest open in the Rule Library on the recommended rules not added - as its own filters read them", () => {
    const query: Record<string, string> = getRecommendedRulesNotAddedQuery();

    expect(
      readRuleLibraryFilters(new URLSearchParams(query).toString()),
    ).toEqual({
      category: RECOMMENDED_FILTER,
      data: "",
      status: LibraryStatusFilter.NotAdded,
      search: "",
    });
  });
});

describe("the rules OneUptime turned on, to say", () => {
  const rule: {
    ruleId: string;
    libraryRuleId: string;
    name: string;
    addedAt: string;
  } = {
    ruleId: "11037000-0000-4000-8000-0000000000a1",
    libraryRuleId: SERVED.id,
    name: "Sensitive file served",
    addedAt: "2026-11-24T09:30:00.000Z",
  };

  test("each with the library rule it is, for what it catches", () => {
    const views: Array<RuleAddedByOneUptimeView> =
      getRulesAddedByOneUptimeViews({
        status: status({ rulesAddedByOneUptime: [rule] }),
        dismissedIds: [],
      });

    expect(views).toEqual([{ rule, entry: SERVED }]);
  });

  test("not one the reader dismissed, nor one of a library rule this Dashboard does not know", () => {
    expect(
      getRulesAddedByOneUptimeViews({
        status: status({
          rulesAddedByOneUptime: [
            rule,
            { ...rule, ruleId: "x", libraryRuleId: "newer" },
          ],
        }),
        dismissedIds: [rule.ruleId],
      }),
    ).toEqual([]);
    expect(
      getRulesAddedByOneUptimeViews({ status: status(), dismissedIds: [] }),
    ).toEqual([]);
  });
});

describe("what a reader dismissed, per project", () => {
  test("kept under the project, apart for each line; nowhere without a project", () => {
    expect(
      getDismissalKey(
        SecurityRecommendedRulesDismissal.NotAdded,
        PROJECT.toString(),
      ),
    ).toBe(`security-recommended-rules-dismissed-${PROJECT.toString()}`);
    expect(
      getDismissalKey(
        SecurityRecommendedRulesDismissal.AddedByOneUptime,
        PROJECT.toString(),
      ),
    ).toBe(`security-rules-added-by-oneuptime-dismissed-${PROJECT.toString()}`);
    expect(
      getDismissalKey(SecurityRecommendedRulesDismissal.NotAdded, null),
    ).toBeNull();
    expect(
      getDismissalKey(SecurityRecommendedRulesDismissal.NotAdded, ""),
    ).toBeNull();
  });

  test("what was kept, read defensively: ids, each once", () => {
    expect(
      readDismissedIdsFrom([
        SERVED.id,
        42,
        "",
        SERVED.id,
        SCANNING.id,
      ] as never),
    ).toEqual([SERVED.id, SCANNING.id]);

    for (const value of [null, "x", { not: "a list" }, 7]) {
      expect(readDismissedIdsFrom(value as JSONValue)).toEqual([]);
    }
  });

  test("added to what was before, the latest first, never more than it can hold", () => {
    expect(mergeDismissedIds([SERVED.id], [SCANNING.id, SERVED.id])).toEqual([
      SCANNING.id,
      SERVED.id,
    ]);

    const many: Array<string> = Array.from(
      { length: MAX_DISMISSED_IDS + 50 },
      (_value: unknown, index: number): string => {
        return `id-${index}`;
      },
    );

    expect(mergeDismissedIds([], many)).toHaveLength(MAX_DISMISSED_IDS);
    expect(readDismissedIdsFrom(many)).toHaveLength(MAX_DISMISSED_IDS);
  });
});

describe("the server's answer, read defensively", () => {
  test("the recommended rules not added, and the rules OneUptime added, as the setup status sends them", () => {
    const parsed: SecuritySetupStatus = parseSecuritySetupStatus({
      recommendedRulesNotAdded: [SERVED.id, "a newer rule", SCANNING.id],
      rulesAddedByOneUptime: [
        {
          ruleId: "11037000-0000-4000-8000-0000000000a1",
          libraryRuleId: SERVED.id,
          name: "Sensitive file served",
          addedAt: "2026-11-24T09:30:00.000Z",
        },
        { ruleId: "", libraryRuleId: SERVED.id },
      ],
    } as JSONObject);

    // In the library's order, each known one once.
    expect(ids(parsed.recommendedRulesNotAdded!)).toEqual([
      SCANNING.id,
      SERVED.id,
    ]);
    expect(parsed.rulesAddedByOneUptime).toEqual([
      {
        ruleId: "11037000-0000-4000-8000-0000000000a1",
        libraryRuleId: SERVED.id,
        name: "Sensitive file served",
        addedAt: "2026-11-24T09:30:00.000Z",
      },
    ]);
  });

  test("a server that sends neither - an older one - leaves them out, as before", () => {
    const parsed: SecuritySetupStatus = parseSecuritySetupStatus({
      recommendedRules: 27,
      recommendedRulesOn: 26,
    });

    expect(parsed.recommendedRulesNotAdded).toBeUndefined();
    expect(parsed.rulesAddedByOneUptime).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(parsed, "recommendedRulesNotAdded"),
    ).toBe(false);
  });
});
