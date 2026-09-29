import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import {
  SLO_MONITORS_MANAGED_BY_RULES_MESSAGE,
  SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
  SloMonitorMembership,
  SloMonitorSource,
  applySloMonitorChange,
  buildSloMonitorsUpdateData,
  describeSloMonitorCounts,
  getAddMonitorsAvailability,
  getAddableMonitorOptions,
  getRemoveMonitorAvailability,
  getSelectedMonitorIds,
  getSloMonitorMembership,
  getSloMonitorSource,
  normalizeMonitorId,
  toMonitorIdList,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/SloMonitorSource";

/*
 * The decisions behind the SLO Monitors page: which monitors a rule owns,
 * what a person may add or remove by hand while monitor rules are enabled,
 * and the payload that writes the list. They mirror the server guard in
 * ServiceLevelObjectiveService - a page that offered what the API refuses
 * would read as a broken button.
 */

const MANUAL: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function membership(): SloMonitorMembership {
  return getSloMonitorMembership({
    monitors: [{ _id: MANUAL }, { _id: RULE }],
    autoAddedMonitors: [{ _id: RULE }],
  });
}

describe("normalizeMonitorId / toMonitorIdList", () => {
  test("gives every spelling of an id the same key", () => {
    expect(normalizeMonitorId(MANUAL.toUpperCase())).toBe(MANUAL);
    expect(normalizeMonitorId(` ${MANUAL} `)).toBe(MANUAL);
    expect(normalizeMonitorId(new ObjectID(MANUAL))).toBe(MANUAL);
    expect(normalizeMonitorId({ _id: MANUAL })).toBe(MANUAL);
    expect(normalizeMonitorId({ id: new ObjectID(MANUAL) })).toBe(MANUAL);
    expect(normalizeMonitorId(null)).toBe("");
    expect(normalizeMonitorId(undefined)).toBe("");
    expect(normalizeMonitorId({})).toBe("");
  });

  test("de-duplicates in first-seen order and drops blanks", () => {
    expect(
      toMonitorIdList([RULE, MANUAL.toUpperCase(), { _id: RULE }, "", null]),
    ).toEqual([RULE, MANUAL]);
    expect(toMonitorIdList(undefined)).toEqual([]);
  });
});

describe("getSloMonitorMembership / getSloMonitorSource", () => {
  test("marks the attached monitors a rule put there as Rule, and the rest as Manual", () => {
    const current: SloMonitorMembership = membership();

    expect(current.monitorIds).toEqual([MANUAL, RULE]);
    expect(Array.from(current.ruleAttachedMonitorIds)).toEqual([RULE]);
    expect(
      getSloMonitorSource({
        monitorId: RULE.toUpperCase(),
        ruleAttachedMonitorIds: current.ruleAttachedMonitorIds,
      }),
    ).toBe(SloMonitorSource.Rule);
    expect(
      getSloMonitorSource({
        monitorId: MANUAL,
        ruleAttachedMonitorIds: current.ruleAttachedMonitorIds,
      }),
    ).toBe(SloMonitorSource.Manual);
  });

  test("ignores a bookkeeping entry for a monitor that is not attached", () => {
    expect(
      Array.from(
        getSloMonitorMembership({
          monitors: [{ _id: MANUAL }],
          autoAddedMonitors: [{ _id: RULE }],
        }).ruleAttachedMonitorIds,
      ),
    ).toEqual([]);
  });

  test("an SLO with nothing loaded has no monitors", () => {
    const empty: SloMonitorMembership = getSloMonitorMembership({});

    expect(empty.monitorIds).toEqual([]);
    expect(empty.ruleAttachedMonitorIds.size).toBe(0);
  });
});

describe("getAddMonitorsAvailability", () => {
  test("allows adding by hand when no monitor rule is enabled", () => {
    expect(getAddMonitorsAvailability({ enabledMonitorRuleCount: 0 })).toEqual({
      isAllowed: true,
    });
  });

  test("refuses with the server's own message while any rule is enabled", () => {
    expect(getAddMonitorsAvailability({ enabledMonitorRuleCount: 2 })).toEqual({
      isAllowed: false,
      disabledReason: SLO_MONITORS_MANAGED_BY_RULES_MESSAGE,
    });
    expect(SLO_MONITORS_MANAGED_BY_RULES_MESSAGE).toBe(
      "This SLO's monitors are managed by its monitor rules. Disable the rules to add monitors by hand.",
    );
  });
});

describe("getRemoveMonitorAvailability", () => {
  test("always allows removing a hand-attached monitor", () => {
    expect(
      getRemoveMonitorAvailability({
        monitorId: MANUAL,
        ruleAttachedMonitorIds: membership().ruleAttachedMonitorIds,
        enabledMonitorRuleCount: 3,
      }),
    ).toEqual({ isAllowed: true });
  });

  test("refuses removing a rule-attached monitor while rules are enabled - it would come back", () => {
    expect(
      getRemoveMonitorAvailability({
        monitorId: RULE,
        ruleAttachedMonitorIds: membership().ruleAttachedMonitorIds,
        enabledMonitorRuleCount: 1,
      }),
    ).toEqual({
      isAllowed: false,
      disabledReason: SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
    });
  });

  test("allows removing a leftover rule-attached monitor once no rule is enabled", () => {
    expect(
      getRemoveMonitorAvailability({
        monitorId: RULE,
        ruleAttachedMonitorIds: membership().ruleAttachedMonitorIds,
        enabledMonitorRuleCount: 0,
      }).isAllowed,
    ).toBe(true);
  });
});

describe("applySloMonitorChange", () => {
  test("adds to the list as it is now, without duplicates", () => {
    expect(
      applySloMonitorChange({
        currentMonitorIds: [MANUAL, RULE],
        addMonitorIds: [OTHER, MANUAL.toUpperCase()],
      }),
    ).toEqual([MANUAL, RULE, OTHER]);
  });

  test("removes only what was asked", () => {
    expect(
      applySloMonitorChange({
        currentMonitorIds: [MANUAL, RULE, OTHER],
        removeMonitorIds: [{ _id: MANUAL }],
      }),
    ).toEqual([RULE, OTHER]);
  });

  test("can empty the list", () => {
    expect(
      applySloMonitorChange({
        currentMonitorIds: [MANUAL],
        removeMonitorIds: [MANUAL],
      }),
    ).toEqual([]);
  });
});

describe("buildSloMonitorsUpdateData", () => {
  test("writes the EntityArray as `{ _id }` stubs, the shape ModelForm sends", () => {
    expect(buildSloMonitorsUpdateData([MANUAL, RULE.toUpperCase()])).toEqual({
      monitors: [{ _id: MANUAL }, { _id: RULE }],
    });
  });

  test("sends an empty list as an empty list - that is how the last monitor is removed", () => {
    expect(buildSloMonitorsUpdateData([])).toEqual({ monitors: [] });
  });
});

describe("getAddableMonitorOptions", () => {
  test("offers only monitors not already attached, sorted by name", () => {
    expect(
      getAddableMonitorOptions({
        monitors: [
          { _id: OTHER, name: "checkout" },
          { _id: MANUAL, name: "attached" },
          { _id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "API" },
          { _id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
          { _id: OTHER, name: "duplicate row" },
        ],
        attachedMonitorIds: [MANUAL.toUpperCase()],
      }),
    ).toEqual([
      { value: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "API" },
      { value: OTHER, label: "checkout" },
      {
        value: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        label: "Untitled monitor",
      },
    ]);
  });
});

describe("getSelectedMonitorIds", () => {
  test("reads bare values and option objects alike", () => {
    expect(
      getSelectedMonitorIds([MANUAL, { value: RULE, label: "x" }]),
    ).toEqual([MANUAL, RULE]);
  });

  test("tolerates a single value and nothing at all", () => {
    expect(getSelectedMonitorIds(MANUAL)).toEqual([MANUAL]);
    expect(getSelectedMonitorIds(null)).toEqual([]);
    expect(getSelectedMonitorIds(undefined)).toEqual([]);
    expect(getSelectedMonitorIds("")).toEqual([]);
    expect(getSelectedMonitorIds([42, { value: 7 }])).toEqual([]);
  });
});

describe("describeSloMonitorCounts", () => {
  test("says where the monitors came from", () => {
    expect(describeSloMonitorCounts(getSloMonitorMembership({}))).toBe(
      "No monitors attached",
    );
    expect(
      describeSloMonitorCounts(
        getSloMonitorMembership({ monitors: [{ _id: MANUAL }] }),
      ),
    ).toBe("1 monitor, all attached by hand");
    expect(
      describeSloMonitorCounts(
        getSloMonitorMembership({
          monitors: [{ _id: RULE }],
          autoAddedMonitors: [{ _id: RULE }],
        }),
      ),
    ).toBe("1 monitor, all attached by monitor rules");
    expect(describeSloMonitorCounts(membership())).toBe(
      "2 monitors: 1 attached by monitor rules, 1 by hand",
    );
  });
});
