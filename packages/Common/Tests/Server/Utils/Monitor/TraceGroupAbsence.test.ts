import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  ExpectedTraceGroup,
  TRACE_GROUP_EXPECTED_CACHE_MINUTES,
  TRACE_GROUP_EXPECTED_LIMIT,
  TRACE_GROUP_EXPECTED_LOOKBACK_DAYS,
  TraceGroupBreakdown,
  TraceGroupExpectedCache,
  mergeQuietGroups,
  toGroupLabels,
  traceStepCountsQuietGroups,
} from "../../../../Server/Utils/Monitor/TraceGroupAbsence";
import TraceGroupCriteriaFanOut from "../../../../Server/Utils/Monitor/TraceGroupCriteriaFanOut";
import TraceMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import { FanOutEntity } from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import TraceMonitorGroupResult from "../../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";

/*
 * #9711: a grouped Traces monitor that hears from each install of a mobile
 * app, and alerts on the one that went quiet - its group has no span in the
 * window, so it is counted as 0 from the week before - one alert per
 * install, and none when the whole app went quiet at once.
 */

const INSTALL: string = "resource.app.installation.id";

function stepWith(
  filters: Array<CriteriaFilter>,
  opensAlerts: boolean = true,
): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorType: MonitorType.Traces,
    monitorName: "Kiosk Ordering",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    ...instance.data!,
    filters: filters,
    createAlerts: opensAlerts,
    createIncidents: false,
  };
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };
  step.setMonitorCriteria(criteria);
  return step;
}

function spanCount(filterType: FilterType, value: number): CriteriaFilter {
  return { checkOn: CheckOn.SpanCount, filterType, value };
}

describe("which grouped monitors count the groups that went quiet", () => {
  test.each([
    ["fewer than 1", spanCount(FilterType.LessThan, 1)],
    ["at most 0", spanCount(FilterType.LessThanOrEqualTo, 0)],
    ["exactly 0", spanCount(FilterType.EqualTo, 0)],
    ["fewer than 5", spanCount(FilterType.LessThan, 5)],
  ])(
    "a criteria matching no span (%s) does",
    (_label: string, filter: CriteriaFilter) => {
      expect(traceStepCountsQuietGroups(stepWith([filter]))).toBe(true);
    },
  );

  test.each([
    ["more than 10", spanCount(FilterType.GreaterThan, 10)],
    ["at least 1", spanCount(FilterType.GreaterThanOrEqualTo, 1)],
    ["more than 0", spanCount(FilterType.GreaterThan, 0)],
  ])(
    "a criteria that needs spans (%s) reads nothing more",
    (_label: string, filter: CriteriaFilter) => {
      expect(traceStepCountsQuietGroups(stepWith([filter]))).toBe(false);
    },
  );

  test("a recovery criteria that matches 0 opens nothing, so reads nothing more", () => {
    expect(
      traceStepCountsQuietGroups(
        stepWith([spanCount(FilterType.LessThanOrEqualTo, 10)], false),
      ),
    ).toBe(false);
  });

  test("an anomaly condition has no number to match 0 with", () => {
    expect(
      traceStepCountsQuietGroups(
        stepWith([
          {
            checkOn: CheckOn.SpanCount,
            filterType: FilterType.AnomalouslyLow,
            value: undefined,
          },
        ]),
      ),
    ).toBe(false);
  });

  test("another check, or no step, does not", () => {
    expect(
      traceStepCountsQuietGroups(
        stepWith([
          {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.LessThan,
            value: 1,
          },
        ]),
      ),
    ).toBe(false);
    expect(traceStepCountsQuietGroups(undefined)).toBe(false);
  });

  test("a week back, a fleet's worth of groups, read again every ten minutes", () => {
    expect(TRACE_GROUP_EXPECTED_LOOKBACK_DAYS).toBe(7);
    expect(TRACE_GROUP_EXPECTED_LIMIT).toBe(1000);
    expect(TRACE_GROUP_EXPECTED_CACHE_MINUTES).toBe(10);
  });
});

describe("mergeQuietGroups", () => {
  const fingerprintOf: (install: string) => string = (
    install: string,
  ): string => {
    return MetricSeriesFingerprint.computeFingerprint({ [INSTALL]: install });
  };

  test("an install expected and silent in the window is counted as 0, and named quiet", () => {
    const merged: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [
        { values: ["kiosk-a"], count: 40 },
        { values: ["kiosk-b"], count: 12 },
      ],
      windowGroupCount: 2,
      expectedGroups: [["kiosk-a"], ["kiosk-c"], ["kiosk-b"]],
      limit: 100,
    });

    expect(merged.quietGroupCount).toBe(1);
    expect(merged.totalGroupCount).toBe(3);
    expect(merged.groups).toEqual([
      {
        fingerprint: fingerprintOf("kiosk-c"),
        labels: { [INSTALL]: "kiosk-c" },
        spanCount: 0,
        isQuiet: true,
      },
      {
        fingerprint: fingerprintOf("kiosk-a"),
        labels: { [INSTALL]: "kiosk-a" },
        spanCount: 40,
      },
      {
        fingerprint: fingerprintOf("kiosk-b"),
        labels: { [INSTALL]: "kiosk-b" },
        spanCount: 12,
      },
    ]);
  });

  test("a quiet install keeps the fingerprint its group had while it reported, so its alert resolves when it reports again", () => {
    const quiet: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [],
      windowGroupCount: 0,
      expectedGroups: [["kiosk-c"]],
      limit: 100,
    });
    const back: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [{ values: ["kiosk-c"], count: 3 }],
      windowGroupCount: 1,
      expectedGroups: [["kiosk-c"]],
      limit: 100,
    });

    expect(quiet.groups[0]!.fingerprint).toBe(back.groups[0]!.fingerprint);
    expect(back.groups[0]!.isQuiet).toBeUndefined();
    expect(back.quietGroupCount).toBe(0);
  });

  test("the quiet ones come first, so a cap never cuts one for a busy install", () => {
    const merged: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: Array.from(
        { length: 5 },
        (_unused: unknown, index: number) => {
          return { values: [`busy-${index}`], count: 100 - index };
        },
      ),
      windowGroupCount: 5,
      expectedGroups: [["quiet-1"], ["quiet-2"]],
      limit: 3,
    });

    expect(
      merged.groups.map((group: TraceMonitorGroupResult) => {
        return group.labels[INSTALL];
      }),
    ).toEqual(["quiet-1", "quiet-2", "busy-0"]);
    expect(merged.totalGroupCount).toBe(7);
  });

  test("a span that names no install is no install, and an install expected twice is quiet once", () => {
    const merged: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL],
      windowGroups: [],
      windowGroupCount: 0,
      expectedGroups: [[""], ["kiosk-c"], ["kiosk-c"]],
      limit: 100,
    });

    expect(merged.quietGroupCount).toBe(1);
    expect(merged.groups).toHaveLength(1);
  });

  test("with nothing expected, the window's groups are as they were read", () => {
    const merged: TraceGroupBreakdown = mergeQuietGroups({
      groupByAttributes: [INSTALL, "app.screen.name"],
      windowGroups: [{ values: ["kiosk-a", "MenuActivity"], count: 9 }],
      windowGroupCount: 4,
      expectedGroups: [],
      limit: 100,
    });

    expect(merged).toEqual({
      groups: [
        {
          fingerprint: MetricSeriesFingerprint.computeFingerprint({
            [INSTALL]: "kiosk-a",
            "app.screen.name": "MenuActivity",
          }),
          labels: { [INSTALL]: "kiosk-a", "app.screen.name": "MenuActivity" },
          spanCount: 9,
        },
      ],
      totalGroupCount: 4,
      quietGroupCount: 0,
    });
  });

  test("labels have one value per group-by key, a missing one empty", () => {
    expect(toGroupLabels([INSTALL, "host.name"], ["kiosk-a"])).toEqual({
      [INSTALL]: "kiosk-a",
      "host.name": "",
    });
  });
});

describe("TraceGroupExpectedCache", () => {
  beforeEach(() => {
    TraceGroupExpectedCache.clear();
  });

  test("reads a monitor's expected groups once per ten minutes", async () => {
    let reads: number = 0;
    const load: () => Promise<Array<ExpectedTraceGroup>> = async () => {
      reads++;
      return [{ values: ["kiosk-a"], context: { "device.name": "Lane 1" } }];
    };
    const at: (minutes: number) => Date = (minutes: number): Date => {
      return new Date(Date.UTC(2026, 10, 19, 10, minutes));
    };

    // A group's context is kept with it, as read (#9925).
    expect(
      await TraceGroupExpectedCache.read({ key: "m1", now: at(0), load }),
    ).toEqual([{ values: ["kiosk-a"], context: { "device.name": "Lane 1" } }]);
    await TraceGroupExpectedCache.read({ key: "m1", now: at(9), load });
    expect(reads).toBe(1);

    await TraceGroupExpectedCache.read({ key: "m1", now: at(10), load });
    expect(reads).toBe(2);

    // Another monitor, or the same one with other filters, reads its own.
    await TraceGroupExpectedCache.read({ key: "m2", now: at(10), load });
    expect(reads).toBe(3);
  });

  test("a read that fails is not kept", async () => {
    await expect(
      TraceGroupExpectedCache.read({
        key: "m1",
        now: new Date(),
        load: async () => {
          throw new Error("ClickHouse is away");
        },
      }),
    ).rejects.toThrow("ClickHouse is away");

    expect(
      await TraceGroupExpectedCache.read({
        key: "m1",
        now: new Date(),
        load: async (): Promise<Array<ExpectedTraceGroup>> => {
          return [{ values: ["kiosk-a"] }];
        },
      }),
    ).toEqual([{ values: ["kiosk-a"] }]);
  });
});

function groupedResponse(
  groups: Array<TraceMonitorGroupResult>,
  extra: Partial<TraceMonitorResponse> = {},
): TraceMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    spanCount: groups.reduce(
      (total: number, group: TraceMonitorGroupResult) => {
        return total + group.spanCount;
      },
      0,
    ),
    spanQuery: {},
    groupByAttributes: [INSTALL],
    groupBreakdown: groups,
    totalGroupCount: groups.length,
    ...extra,
  };
}

const QUIET_KIOSK: TraceMonitorGroupResult = {
  fingerprint: "fp-c",
  labels: { [INSTALL]: "kiosk-c" },
  spanCount: 0,
  isQuiet: true,
};

const BUSY_KIOSK: TraceMonitorGroupResult = {
  fingerprint: "fp-a",
  labels: { [INSTALL]: "kiosk-a" },
  spanCount: 40,
};

describe("the criteria of a grouped Traces monitor", () => {
  const FEWER_THAN_ONE: CriteriaFilter = spanCount(FilterType.LessThan, 1);

  test("holds for the monitor while one install is quiet, naming it", async () => {
    const message: string | null =
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: groupedResponse([BUSY_KIOSK, QUIET_KIOSK]) as never,
        criteriaFilter: FEWER_THAN_ONE,
      });

    expect(message).toContain(
      "For resource.app.installation.id = kiosk-c, which sent no span in the window:",
    );
  });

  test("does not hold while every install reports", async () => {
    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: groupedResponse([BUSY_KIOSK]) as never,
        criteriaFilter: FEWER_THAN_ONE,
      }),
    ).toBeNull();
  });

  test("holds for no group in a quiet window, where none is judged", async () => {
    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: groupedResponse([], { isQuietWindow: true }) as never,
        criteriaFilter: FEWER_THAN_ONE,
      }),
    ).toBeNull();
  });

  test("an anomaly condition is never judged per group", async () => {
    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: groupedResponse([QUIET_KIOSK]) as never,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyLow,
          value: undefined,
        },
      }),
    ).toBeNull();
  });

  test("an ungrouped monitor is judged on its one count, as before", async () => {
    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          spanCount: 0,
          spanQuery: {},
        } as never,
        criteriaFilter: FEWER_THAN_ONE,
      }),
    ).toBeTruthy();
  });
});

describe("TraceGroupCriteriaFanOut", () => {
  test("one entity per group, each judged on its own count", async () => {
    const response: TraceMonitorResponse = groupedResponse([
      BUSY_KIOSK,
      QUIET_KIOSK,
    ]);
    const entities: Array<FanOutEntity> =
      TraceGroupCriteriaFanOut.getGroupEntities({
        dataToProcess: response as unknown as DataToProcess,
      });

    expect(
      entities.map((entity: FanOutEntity) => {
        return entity.labels;
      }),
    ).toEqual([BUSY_KIOSK.labels, QUIET_KIOSK.labels]);

    const quietOne: TraceMonitorResponse = entities[1]!
      .dataToProcess as unknown as TraceMonitorResponse;

    expect(quietOne.spanCount).toBe(0);
    expect(quietOne.groupBreakdown).toBeUndefined();
    expect(quietOne.evaluatedGroup).toEqual(QUIET_KIOSK);

    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: quietOne as never,
        criteriaFilter: spanCount(FilterType.LessThan, 1),
      }),
    ).toContain("kiosk-c");
    expect(
      await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: entities[0]!.dataToProcess as never,
        criteriaFilter: spanCount(FilterType.LessThan, 1),
      }),
    ).toBeNull();
  });

  test("tells a grouped response, and a quiet window, from the rest", () => {
    expect(
      TraceGroupCriteriaFanOut.isGroupedResponse(
        groupedResponse([]) as unknown as DataToProcess,
      ),
    ).toBe(true);
    expect(
      TraceGroupCriteriaFanOut.isGroupedResponse({
        spanCount: 3,
      } as unknown as DataToProcess),
    ).toBe(false);
    expect(
      TraceGroupCriteriaFanOut.isQuietWindow(
        groupedResponse([], {
          isQuietWindow: true,
        }) as unknown as DataToProcess,
      ),
    ).toBe(true);
    expect(
      TraceGroupCriteriaFanOut.isQuietWindow(
        groupedResponse([QUIET_KIOSK]) as unknown as DataToProcess,
      ),
    ).toBe(false);
  });
});

describe("what the status timeline says of a grouped Traces monitor", () => {
  const say: (response: TraceMonitorResponse) => string | null = (
    response: TraceMonitorResponse,
  ): string | null => {
    return MonitorCriteriaObservationBuilder.describeFilterObservation({
      criteriaFilter: spanCount(FilterType.LessThan, 1),
      dataToProcess: response as unknown as DataToProcess,
    } as never);
  };

  test("the whole monitor: how many groups, and how many went quiet", () => {
    expect(say(groupedResponse([QUIET_KIOSK, BUSY_KIOSK]))).toBe(
      "Span count was 40 across 2 groups; 1 of them sent no span in the window, after sending spans in the week before it.",
    );
  });

  test("one group, judged alone", () => {
    expect(
      say({
        ...groupedResponse([]),
        groupBreakdown: undefined,
        spanCount: 0,
        evaluatedGroup: QUIET_KIOSK,
      }),
    ).toBe(
      "Span count for resource.app.installation.id = kiosk-c was 0: it sent spans in the week before the window, and none in it.",
    );
  });

  test("a quiet window says why no group was judged", () => {
    expect(say(groupedResponse([], { isQuietWindow: true }))).toBe(
      "No span matched in the window, from any group: the whole app went quiet, so no group was evaluated.",
    );
  });
});
