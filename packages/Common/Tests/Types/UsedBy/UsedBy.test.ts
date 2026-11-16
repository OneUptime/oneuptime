import {
  MONITOR_RULE_ROW_KINDS,
  MONITOR_TEMPLATE_ROW_KINDS,
  ON_CALL_POLICY_OTHER_ROW_KINDS,
  ON_CALL_POLICY_RULE_ROW_KINDS,
  TEAM_OWNED_OTHER_ROW_KINDS,
  USED_BY_BULK_MAX_RECORDS,
  USED_BY_MAX_PAGE_SIZE,
  USED_BY_PAGE_SIZE,
  USED_BY_RELATIONS,
  UsedByBulkSummary,
  UsedByGroup,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRelationDescription,
  UsedByRowKind,
  UsedBySummary,
  getUsedByBulkRelations,
  getUsedByGroupTotal,
  getUsedByGroupsInUse,
  getUsedByRecordKindOfRelation,
  getUsedByRelationDescription,
  getUsedByRelations,
  getUsedByRowKind,
  getUsedByRowKindOfRow,
  isUsedByBulkSummary,
  isUsedByFamily,
  isUsedByNothing,
  isUsedByPage,
  isUsedByRecordKind,
  isUsedByRelation,
  isUsedBySummary,
  normalizeUsedByPageSize,
  normalizeUsedBySkip,
} from "../../../Types/UsedBy/UsedBy";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * "USED BY" (#6813): the kinds of record that show what refers to them, the
 * relations each lists, and the shapes the server answers with.
 */

function group(overrides: Partial<UsedByGroup> = {}): UsedByGroup {
  return {
    relation: UsedByRelation.MonitorStatusPages,
    rowKind: UsedByRowKind.StatusPage,
    count: 0,
    hiddenCount: 0,
    rows: [],
    ...overrides,
  };
}

function summary(groups: Array<UsedByGroup>): UsedBySummary {
  return {
    recordKind: UsedByRecordKind.Monitor,
    recordId: "68130000-0000-4000-8000-000000000001",
    groups: groups,
  };
}

describe("the kinds and their relations", () => {
  test("the six records of the issue, then an on-call policy, a monitor group and an SLO", () => {
    expect(Object.values(UsedByRecordKind)).toEqual([
      "monitor",
      "on-call-schedule",
      "service",
      "status-page",
      "team",
      "label",
      "on-call-policy",
      "monitor-group",
      "slo",
    ]);
  });

  test("an on-call policy lists what runs it, its on-call rules first (#7758)", () => {
    expect(
      getUsedByRelations(UsedByRecordKind.OnCallPolicy).map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    ).toEqual([
      UsedByRelation.OnCallPolicyRules,
      UsedByRelation.OnCallPolicyMonitors,
      UsedByRelation.OnCallPolicyOther,
      UsedByRelation.OnCallPolicyWorkflows,
    ]);
  });

  test("a monitor group its status pages and SLOs, an SLO its rules, policy and dashboards (#7437)", () => {
    expect(
      getUsedByRelations(UsedByRecordKind.MonitorGroup).map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    ).toEqual([
      UsedByRelation.MonitorGroupStatusPages,
      UsedByRelation.MonitorGroupSlos,
    ]);
    expect(
      getUsedByRelations(UsedByRecordKind.Slo).map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    ).toEqual([
      UsedByRelation.SloBurnRateRules,
      UsedByRelation.SloErrorBudgetPolicies,
      UsedByRelation.SloDashboards,
    ]);
  });

  test("a family names every kind it counts, and starts with the first", () => {
    const families: Array<[UsedByRelation, ReadonlyArray<UsedByRowKind>]> = [
      [UsedByRelation.MonitorRules, MONITOR_RULE_ROW_KINDS],
      [UsedByRelation.MonitorTemplates, MONITOR_TEMPLATE_ROW_KINDS],
      [UsedByRelation.TeamOwnedOther, TEAM_OWNED_OTHER_ROW_KINDS],
      [UsedByRelation.OnCallPolicyRules, ON_CALL_POLICY_RULE_ROW_KINDS],
      [UsedByRelation.OnCallPolicyOther, ON_CALL_POLICY_OTHER_ROW_KINDS],
    ];

    for (const [relation, rowKinds] of families) {
      const description: UsedByRelationDescription | null =
        getUsedByRelationDescription(relation);

      expect(isUsedByFamily(relation)).toBe(true);
      expect(description?.family).toEqual(rowKinds);
      expect(description?.rowKind).toBe(rowKinds[0]);
      // Each kind once.
      expect(new Set(rowKinds).size).toBe(rowKinds.length);
    }

    // Every family is one of those.
    expect(
      Object.values(UsedByRelation).filter((relation: UsedByRelation) => {
        return isUsedByFamily(relation);
      }),
    ).toEqual(
      families.map(
        ([relation]: [UsedByRelation, ReadonlyArray<UsedByRowKind>]) => {
          return relation;
        },
      ),
    );
    expect(isUsedByFamily(UsedByRelation.MonitorSlos)).toBe(false);
  });

  test("everything else a team owns leaves out the five its card lists on their own lines", () => {
    for (const rowKind of [
      UsedByRowKind.Monitor,
      UsedByRowKind.StatusPage,
      UsedByRowKind.Service,
      UsedByRowKind.OnCallDutyPolicy,
      UsedByRowKind.OnCallSchedule,
    ]) {
      expect(TEAM_OWNED_OTHER_ROW_KINDS).not.toContain(rowKind);
    }

    // What people act on first, its events last.
    expect(TEAM_OWNED_OTHER_ROW_KINDS.slice(0, 3)).toEqual([
      UsedByRowKind.ServiceLevelObjective,
      UsedByRowKind.Dashboard,
      UsedByRowKind.Workflow,
    ]);
    expect(TEAM_OWNED_OTHER_ROW_KINDS.slice(-5)).toEqual([
      UsedByRowKind.Incident,
      UsedByRowKind.IncidentEpisode,
      UsedByRowKind.Alert,
      UsedByRowKind.AlertEpisode,
      UsedByRowKind.ScheduledMaintenance,
    ]);
  });

  test("a status page's open incidents are read one page at a time, and left out of a selection", () => {
    expect(
      getUsedByBulkRelations(UsedByRecordKind.StatusPage).map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    ).toEqual([UsedByRelation.StatusPageMaintenance]);
    expect(getUsedByBulkRelations(UsedByRecordKind.Monitor)).toEqual(
      getUsedByRelations(UsedByRecordKind.Monitor),
    );
    // Every other relation is counted for a selection.
    expect(
      Object.values(UsedByRecordKind)
        .flatMap((kind: UsedByRecordKind) => {
          return getUsedByRelations(kind);
        })
        .filter((description: UsedByRelationDescription): boolean => {
          return Boolean(description.isOneRecordOnly);
        })
        .map((description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        }),
    ).toEqual([UsedByRelation.StatusPageOpenIncidents]);
  });

  test("a row's kind is its own in a family, its group's otherwise", () => {
    expect(
      getUsedByRowKindOfRow(
        { rowKind: UsedByRowKind.AlertOwnerRule },
        UsedByRowKind.IncidentOnCallRule,
      ),
    ).toBe(UsedByRowKind.AlertOwnerRule);
    expect(getUsedByRowKindOfRow({}, UsedByRowKind.StatusPage)).toBe(
      UsedByRowKind.StatusPage,
    );
  });

  test("every kind lists at least one relation, and every relation belongs to exactly one kind", () => {
    const seen: Map<UsedByRelation, UsedByRecordKind> = new Map();

    for (const recordKind of Object.values(UsedByRecordKind)) {
      const relations: ReadonlyArray<UsedByRelationDescription> =
        getUsedByRelations(recordKind);

      expect(relations.length).toBeGreaterThan(0);

      for (const description of relations) {
        expect(seen.has(description.relation)).toBe(false);
        seen.set(description.relation, recordKind);
      }
    }

    expect(Array.from(seen.keys()).sort()).toEqual(
      Object.values(UsedByRelation).sort(),
    );
  });

  test("a monitor lists what the issue names, status pages first", () => {
    expect(
      USED_BY_RELATIONS[UsedByRecordKind.Monitor].map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      ),
    ).toEqual([
      UsedByRelation.MonitorStatusPages,
      UsedByRelation.MonitorGroups,
      UsedByRelation.MonitorSlos,
      UsedByRelation.MonitorScheduledMaintenance,
      UsedByRelation.MonitorDependents,
      UsedByRelation.MonitorRules,
      UsedByRelation.MonitorTemplates,
      UsedByRelation.MonitorWorkflows,
      UsedByRelation.MonitorDashboards,
    ]);
  });

  test("a schedule's policies, a service's monitors and SLOs, a status page's incidents and maintenance", () => {
    const relationsOf: (kind: UsedByRecordKind) => Array<UsedByRelation> = (
      kind: UsedByRecordKind,
    ): Array<UsedByRelation> => {
      return getUsedByRelations(kind).map(
        (description: UsedByRelationDescription): UsedByRelation => {
          return description.relation;
        },
      );
    };

    expect(relationsOf(UsedByRecordKind.OnCallSchedule)).toEqual([
      UsedByRelation.ScheduleOnCallPolicies,
    ]);
    expect(relationsOf(UsedByRecordKind.Service)).toEqual([
      UsedByRelation.ServiceMonitors,
      UsedByRelation.ServiceSlos,
    ]);
    expect(relationsOf(UsedByRecordKind.StatusPage)).toEqual([
      UsedByRelation.StatusPageOpenIncidents,
      UsedByRelation.StatusPageMaintenance,
    ]);
    expect(relationsOf(UsedByRecordKind.Team)[0]).toBe(
      UsedByRelation.TeamOnCallPolicies,
    );
    expect(relationsOf(UsedByRecordKind.Label)).toContain(
      UsedByRelation.LabelMonitors,
    );
  });

  test("the row kind and the record kind of each relation", () => {
    expect(getUsedByRowKind(UsedByRelation.MonitorStatusPages)).toBe(
      UsedByRowKind.StatusPage,
    );
    expect(getUsedByRowKind(UsedByRelation.ScheduleOnCallPolicies)).toBe(
      UsedByRowKind.OnCallDutyPolicy,
    );
    expect(getUsedByRowKind(UsedByRelation.StatusPageOpenIncidents)).toBe(
      UsedByRowKind.Incident,
    );
    expect(getUsedByRowKind(UsedByRelation.TeamOwnedSchedules)).toBe(
      UsedByRowKind.OnCallSchedule,
    );
    expect(getUsedByRowKind("Nope" as UsedByRelation)).toBeNull();

    expect(getUsedByRecordKindOfRelation(UsedByRelation.ServiceSlos)).toBe(
      UsedByRecordKind.Service,
    );
    expect(getUsedByRecordKindOfRelation(UsedByRelation.LabelAlerts)).toBe(
      UsedByRecordKind.Label,
    );
    expect(getUsedByRecordKindOfRelation("Nope" as UsedByRelation)).toBeNull();
  });

  test("kinds and relations are told from anything else", () => {
    expect(isUsedByRecordKind("monitor")).toBe(true);
    expect(isUsedByRecordKind("Monitor")).toBe(false);
    expect(isUsedByRecordKind("incident")).toBe(false);
    expect(isUsedByRecordKind(undefined)).toBe(false);
    expect(isUsedByRelation("MonitorSlos")).toBe(true);
    expect(isUsedByRelation("monitorSlos")).toBe(false);
    expect(isUsedByRelation(1)).toBe(false);
  });
});

describe("what a card and a dialog list", () => {
  test("a group's total counts what the reader may not see too", () => {
    expect(getUsedByGroupTotal({ count: 3, hiddenCount: 2 })).toBe(5);
    expect(getUsedByGroupTotal({ count: 0, hiddenCount: 0 })).toBe(0);
  });

  test("only groups with something in them, seen or hidden, in the kind's order", () => {
    const groups: Array<UsedByGroup> = getUsedByGroupsInUse(
      summary([
        group({ relation: UsedByRelation.MonitorStatusPages, count: 2 }),
        group({ relation: UsedByRelation.MonitorGroups }),
        group({ relation: UsedByRelation.MonitorSlos, hiddenCount: 1 }),
        group({ relation: UsedByRelation.MonitorWorkflows, count: 1 }),
      ]),
    );

    expect(
      groups.map((each: UsedByGroup): UsedByRelation => {
        return each.relation;
      }),
    ).toEqual([
      UsedByRelation.MonitorStatusPages,
      UsedByRelation.MonitorSlos,
      UsedByRelation.MonitorWorkflows,
    ]);
  });

  test("a page can leave out what it says otherwise", () => {
    const groups: Array<UsedByGroup> = getUsedByGroupsInUse(
      summary([
        group({ relation: UsedByRelation.MonitorStatusPages, count: 2 }),
        group({ relation: UsedByRelation.MonitorSlos, count: 1 }),
      ]),
      [UsedByRelation.MonitorSlos],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.relation).toBe(UsedByRelation.MonitorStatusPages);
  });

  test("nothing uses a record only when every group is empty, hidden ones included", () => {
    expect(isUsedByNothing(summary([group(), group()]))).toBe(true);
    expect(isUsedByNothing(summary([]))).toBe(true);
    expect(isUsedByNothing(summary([group({ hiddenCount: 1 })]))).toBe(false);
    expect(isUsedByNothing(summary([group({ count: 1 })]))).toBe(false);
  });
});

describe("the answers' shapes", () => {
  const goodSummary: UsedBySummary = summary([
    group({
      count: 1,
      rows: [{ id: "a", name: "Public status" }],
    }),
  ]);

  const goodPage: UsedByPage = {
    recordKind: UsedByRecordKind.OnCallSchedule,
    recordId: "68130000-0000-4000-8000-000000000002",
    relation: UsedByRelation.ScheduleOnCallPolicies,
    rowKind: UsedByRowKind.OnCallDutyPolicy,
    count: 1,
    hiddenCount: 0,
    pageStart: 0,
    pageSize: 50,
    rows: [{ id: "p", name: "Primary", detail: "Level 1" }],
  };

  test("a summary the server answers is read", () => {
    expect(isUsedBySummary(goodSummary)).toBe(true);
    expect(isUsedByPage(goodPage)).toBe(true);
  });

  const familySummary: UsedBySummary = summary([
    group({
      relation: UsedByRelation.MonitorRules,
      rowKind: UsedByRowKind.IncidentOnCallRule,
      count: 2,
      parts: [
        { rowKind: UsedByRowKind.IncidentOnCallRule, count: 1, hiddenCount: 0 },
        { rowKind: UsedByRowKind.AlertOwnerRule, count: 1, hiddenCount: 0 },
      ],
      rows: [
        {
          id: "r1",
          name: "Page the platform team",
          rowKind: UsedByRowKind.IncidentOnCallRule,
        },
        {
          id: "r2",
          name: "Database alerts",
          rowKind: UsedByRowKind.AlertOwnerRule,
          isOff: true,
        },
        {
          id: "r3",
          name: "Fast burn",
          rowKind: UsedByRowKind.SloBurnRateRule,
          linkId: "slo-1",
        },
      ],
    }),
  ]);

  test("a family's summary is read: its parts, and rows with their kind, link and switch", () => {
    expect(isUsedBySummary(familySummary)).toBe(true);
  });

  test("a family's summary with a part or a row of the wrong shape is not", () => {
    const family: UsedByGroup = familySummary.groups[0] as UsedByGroup;

    for (const broken of [
      { ...family, parts: "x" },
      { ...family, parts: [{ rowKind: "Thing", count: 1, hiddenCount: 0 }] },
      {
        ...family,
        parts: [
          { rowKind: UsedByRowKind.AlertOwnerRule, count: -1, hiddenCount: 0 },
        ],
      },
      { ...family, rows: [{ id: "r", name: "x", rowKind: "Thing" }] },
      { ...family, rows: [{ id: "r", name: "x", isOff: "yes" }] },
      { ...family, rows: [{ id: "r", name: "x", linkId: 7 }] },
    ]) {
      expect(isUsedBySummary({ ...familySummary, groups: [broken] })).toBe(
        false,
      );
    }
  });

  test("a selection's summary is counts only, and anything else is not one", () => {
    const bulk: UsedByBulkSummary = {
      recordKind: UsedByRecordKind.Monitor,
      recordCount: 3,
      groups: [
        {
          relation: UsedByRelation.MonitorStatusPages,
          rowKind: UsedByRowKind.StatusPage,
          count: 12,
          hiddenCount: 1,
        },
        {
          relation: UsedByRelation.MonitorRules,
          rowKind: UsedByRowKind.IncidentOnCallRule,
          count: 2,
          hiddenCount: 0,
          parts: [
            {
              rowKind: UsedByRowKind.IncidentOnCallRule,
              count: 2,
              hiddenCount: 0,
            },
          ],
        },
      ],
    };

    expect(isUsedByBulkSummary(bulk)).toBe(true);
    expect(isUsedByBulkSummary({ ...bulk, recordCount: -1 })).toBe(false);
    expect(isUsedByBulkSummary({ ...bulk, recordKind: "incident" })).toBe(
      false,
    );
    expect(
      isUsedByBulkSummary({
        ...bulk,
        groups: [{ ...bulk.groups[0], count: "12" }],
      }),
    ).toBe(false);
    expect(isUsedByBulkSummary(goodSummary)).toBe(false);
    expect(isUsedByBulkSummary(null)).toBe(false);
    // A selection holds what a list can select at once.
    expect(USED_BY_BULK_MAX_RECORDS).toBe(10000);
  });

  /*
   * The browser reads every answer through HTTPResponse. It once took any
   * answer holding count, skip and limit for a list of models in `data`: a
   * page held all three, and See all failed with "array is not iterable".
   * Only a real list envelope reads that way now (issue #7794).
   */
  test("a page and a summary read through HTTPResponse as the server sent them", () => {
    const page: unknown = new HTTPResponse(
      200,
      goodPage as unknown as JSONObject,
      {},
    ).data;
    const summary: unknown = new HTTPResponse(
      200,
      goodSummary as unknown as JSONObject,
      {},
    ).data;

    expect(isUsedByPage(page)).toBe(true);
    expect((page as UsedByPage).rows).toEqual(goodPage.rows);
    expect(isUsedBySummary(summary)).toBe(true);
  });

  test("a page that also says skip and limit still reads whole, its rows kept", () => {
    const body: JSONObject = {
      ...(goodPage as unknown as JSONObject),
      skip: 0,
      limit: 50,
    };

    const page: unknown = new HTTPResponse(200, body, {}).data;

    expect(isUsedByPage(page)).toBe(true);
    expect((page as UsedByPage).rows).toEqual(goodPage.rows);
  });

  test("anything else is an error to show, never a list to draw", () => {
    expect(isUsedBySummary(null)).toBe(false);
    expect(isUsedBySummary([])).toBe(false);
    expect(isUsedBySummary("<html>")).toBe(false);
    expect(isUsedBySummary({ ...goodSummary, recordKind: "incident" })).toBe(
      false,
    );
    expect(isUsedBySummary({ ...goodSummary, groups: "x" })).toBe(false);
    expect(
      isUsedBySummary({
        ...goodSummary,
        groups: [{ ...goodSummary.groups[0], count: -1 }],
      }),
    ).toBe(false);
    expect(
      isUsedBySummary({
        ...goodSummary,
        groups: [{ ...goodSummary.groups[0], count: 1.5 }],
      }),
    ).toBe(false);
    expect(
      isUsedBySummary({
        ...goodSummary,
        groups: [{ ...goodSummary.groups[0], rows: [{ id: 1, name: "x" }] }],
      }),
    ).toBe(false);
    expect(
      isUsedBySummary({
        ...goodSummary,
        groups: [{ ...goodSummary.groups[0], relation: "Elsewhere" }],
      }),
    ).toBe(false);
    expect(
      isUsedBySummary({
        ...goodSummary,
        groups: [{ ...goodSummary.groups[0], rowKind: "Thing" }],
      }),
    ).toBe(false);
    expect(isUsedByPage({ ...goodPage, pageStart: -1 })).toBe(false);
    expect(isUsedByPage({ ...goodPage, rows: [{ id: "p" }] })).toBe(false);
    expect(
      isUsedByPage({ ...goodPage, rows: [{ id: "p", name: "x", detail: 3 }] }),
    ).toBe(false);
    expect(isUsedByPage(goodSummary)).toBe(false);
  });
});

describe("a page of rows", () => {
  test("the default page size, and never more than the maximum", () => {
    expect(normalizeUsedByPageSize(undefined)).toBe(USED_BY_PAGE_SIZE);
    expect(normalizeUsedByPageSize("abc")).toBe(USED_BY_PAGE_SIZE);
    expect(normalizeUsedByPageSize(0)).toBe(USED_BY_PAGE_SIZE);
    expect(normalizeUsedByPageSize(-5)).toBe(USED_BY_PAGE_SIZE);
    expect(normalizeUsedByPageSize("20")).toBe(20);
    expect(normalizeUsedByPageSize(12.7)).toBe(12);
    expect(normalizeUsedByPageSize(100000)).toBe(USED_BY_MAX_PAGE_SIZE);
    expect(normalizeUsedByPageSize(Infinity)).toBe(USED_BY_PAGE_SIZE);
  });

  test("a page starts at 0 or a whole number of rows past it", () => {
    expect(normalizeUsedBySkip(undefined)).toBe(0);
    expect(normalizeUsedBySkip("x")).toBe(0);
    expect(normalizeUsedBySkip(-1)).toBe(0);
    expect(normalizeUsedBySkip("50")).toBe(50);
    expect(normalizeUsedBySkip(10.9)).toBe(10);
  });
});
