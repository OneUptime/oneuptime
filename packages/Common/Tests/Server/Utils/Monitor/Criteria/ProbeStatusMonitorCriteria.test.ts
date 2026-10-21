import ProbeStatusMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ProbeStatusMonitorCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ProbeStatusMonitorResponse, {
  ProbeStatusMonitorProbe,
} from "../../../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { MockInstance } from "jest-mock";

/*
 * A Probe Status monitor's criteria: Connected Probes and Disconnected
 * Probes, compared as whole numbers, and - since both are recorded every
 * minute - optionally over a window. The root cause names the probes, which
 * is what the incident it opens tells whoever is paged.
 */

function probe(
  name: string,
  isConnected: boolean,
  isGlobalProbe: boolean = false,
): ProbeStatusMonitorProbe {
  return {
    probeId: ObjectID.generate().toString(),
    probeName: name,
    isGlobalProbe: isGlobalProbe,
    isConnected: isConnected,
  };
}

function response(
  probes: Array<ProbeStatusMonitorProbe>,
): ProbeStatusMonitorResponse {
  const connected: number = probes.filter(
    (item: ProbeStatusMonitorProbe): boolean => {
      return item.isConnected;
    },
  ).length;

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probes: probes,
    connectedProbeCount: connected,
    disconnectedProbeCount: probes.length - connected,
    missingProbeIds: [],
    checkedAt: new Date(),
  };
}

const oneDown: ProbeStatusMonitorResponse = response([
  probe("Frankfurt", true),
  probe("Singapore", false),
]);
const allUp: ProbeStatusMonitorResponse = response([
  probe("Frankfurt", true),
  probe("Singapore", true),
]);

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  value: number | string | undefined,
): CriteriaFilter {
  return { checkOn: checkOn, filterType: filterType, value: value };
}

async function evaluate(
  dataToProcess: ProbeStatusMonitorResponse | ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return ProbeStatusMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: dataToProcess,
    criteriaFilter: criteriaFilter,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProbeStatusMonitorCriteria: Disconnected Probes", () => {
  test("a probe down: 'greater than 0' is met, and the cause names the probe", async () => {
    const result: string | null = await evaluate(
      oneDown,
      filter(CheckOn.DisconnectedProbes, FilterType.GreaterThan, 0),
    );

    expect(result).not.toBeNull();
    expect(result).toContain("Disconnected Probes");
    expect(result).toContain("1");
    expect(result!.endsWith("1 of 2 probes is disconnected: Singapore.")).toBe(
      true,
    );
  });

  test("every probe up: 'greater than 0' is not met, 'equal to 0' is", async () => {
    expect(
      await evaluate(
        allUp,
        filter(CheckOn.DisconnectedProbes, FilterType.GreaterThan, 0),
      ),
    ).toBeNull();

    const online: string | null = await evaluate(
      allUp,
      filter(CheckOn.DisconnectedProbes, FilterType.EqualTo, 0),
    );

    expect(online).not.toBeNull();
    expect(online!.endsWith("All 2 probes are connected.")).toBe(true);
  });

  test("a value written as text, as the dashboard saves it, is compared as a number", async () => {
    expect(
      await evaluate(
        oneDown,
        filter(
          CheckOn.DisconnectedProbes,
          FilterType.GreaterThanOrEqualTo,
          "1",
        ),
      ),
    ).not.toBeNull();
    expect(
      await evaluate(
        oneDown,
        filter(CheckOn.DisconnectedProbes, FilterType.GreaterThan, "1"),
      ),
    ).toBeNull();
  });

  test("every whole-number comparison the form offers", async () => {
    const cases: Array<[FilterType, number, boolean]> = [
      [FilterType.GreaterThan, 0, true],
      [FilterType.GreaterThanOrEqualTo, 1, true],
      [FilterType.GreaterThanOrEqualTo, 2, false],
      [FilterType.LessThan, 2, true],
      [FilterType.LessThan, 1, false],
      [FilterType.LessThanOrEqualTo, 1, true],
      [FilterType.EqualTo, 1, true],
      [FilterType.EqualTo, 0, false],
      [FilterType.NotEqualTo, 0, true],
      [FilterType.NotEqualTo, 1, false],
    ];

    for (const [filterType, value, isMet] of cases) {
      const result: string | null = await evaluate(
        oneDown,
        filter(CheckOn.DisconnectedProbes, filterType, value),
      );

      expect({ filterType, value, isMet: result !== null }).toEqual({
        filterType,
        value,
        isMet,
      });
    }
  });
});

describe("ProbeStatusMonitorCriteria: Connected Probes", () => {
  test("redundancy: 'fewer than 2 connected' is met when one of two is gone", async () => {
    const result: string | null = await evaluate(
      oneDown,
      filter(CheckOn.ConnectedProbes, FilterType.LessThan, 2),
    );

    expect(result).not.toBeNull();
    expect(result).toContain("Connected Probes");
    expect(
      await evaluate(
        allUp,
        filter(CheckOn.ConnectedProbes, FilterType.LessThan, 2),
      ),
    ).toBeNull();
  });

  test("'at least 1 connected' holds while one is left", async () => {
    expect(
      await evaluate(
        oneDown,
        filter(CheckOn.ConnectedProbes, FilterType.GreaterThanOrEqualTo, 1),
      ),
    ).not.toBeNull();
    expect(
      await evaluate(
        response([probe("Frankfurt", false), probe("Singapore", false)]),
        filter(CheckOn.ConnectedProbes, FilterType.GreaterThanOrEqualTo, 1),
      ),
    ).toBeNull();
  });
});

describe("ProbeStatusMonitorCriteria: what it does not judge", () => {
  test("a check of another monitor type is not claimed", async () => {
    expect(
      await evaluate(
        oneDown,
        filter(CheckOn.IsOnline, FilterType.False, undefined),
      ),
    ).toBeNull();
    expect(
      await evaluate(
        oneDown,
        filter(CheckOn.ResponseTime, FilterType.GreaterThan, 0),
      ),
    ).toBeNull();
  });

  test("a probe's check result is not a Probe Status evaluation", async () => {
    const probeCheck: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      isOnline: false,
      monitoredAt: new Date(),
    };

    expect(
      await evaluate(
        probeCheck,
        filter(CheckOn.DisconnectedProbes, FilterType.GreaterThanOrEqualTo, 0),
      ),
    ).toBeNull();
  });

  test("a missing or unreadable value never matches", async () => {
    for (const value of [undefined, "", "lots"]) {
      expect(
        await evaluate(
          oneDown,
          filter(CheckOn.DisconnectedProbes, FilterType.GreaterThan, value),
        ),
      ).toBeNull();
    }
  });

  test("a probe that is gone is counted neither way", async () => {
    const gone: ProbeStatusMonitorResponse = {
      ...allUp,
      missingProbeIds: [ObjectID.generate().toString()],
    };

    expect(
      await evaluate(
        gone,
        filter(CheckOn.DisconnectedProbes, FilterType.GreaterThan, 0),
      ),
    ).toBeNull();
  });
});

describe("ProbeStatusMonitorCriteria over a window", () => {
  const windowed: CriteriaFilter = {
    checkOn: CheckOn.DisconnectedProbes,
    filterType: FilterType.GreaterThan,
    value: 0,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
    },
  };

  test("asks for the window of the monitor this evaluation belongs to", async () => {
    const spy: MockInstance<
      typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
    > = jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({ earlyReturn: null, value: [1, 1, 1, 1, 1] });

    await ProbeStatusMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: oneDown,
      criteriaFilter: windowed,
      monitoringInterval: "* * * * *",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const call: Parameters<
      typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
    >[0] = spy.mock.calls[0]![0];
    expect(call.projectId.toString()).toBe(oneDown.projectId.toString());
    expect(call.monitorId.toString()).toBe(oneDown.monitorId.toString());
    expect(call.criteriaFilter).toBe(windowed);
    expect(call.monitoringInterval).toBe("* * * * *");
  });

  test("a monitor without an interval of its own is sized as the every-minute sweep it gets", async () => {
    const spy: MockInstance<
      typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
    > = jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({ earlyReturn: null, value: [1, 1, 1, 1, 1] });

    // As MonitorCriteriaEvaluator passes it: the monitor row has none.
    await ProbeStatusMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: oneDown,
      criteriaFilter: windowed,
      monitoringInterval: undefined,
    });

    expect(spy.mock.calls[0]![0].monitoringInterval).toBe("* * * * *");
  });

  test("a probe down for the whole window is met", async () => {
    jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({ earlyReturn: null, value: [1, 1, 1, 1, 1] });

    expect(await evaluate(oneDown, windowed)).not.toBeNull();
  });

  test("a quick restart inside the window is not: one healthy sample is enough", async () => {
    jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({ earlyReturn: null, value: [1, 1, 0, 1, 1] });

    expect(await evaluate(oneDown, windowed)).toBeNull();
  });

  test("a window that is still filling decides what the no-data policy says", async () => {
    jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({ earlyReturn: { result: null }, value: undefined });

    expect(await evaluate(oneDown, windowed)).toBeNull();

    jest
      .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
      .mockResolvedValue({
        earlyReturn: { result: "Disconnected Probes has no data." },
        value: undefined,
      });

    expect(await evaluate(oneDown, windowed)).toBe(
      "Disconnected Probes has no data.",
    );
  });

  test("without a window, this evaluation's own count decides", async () => {
    const spy: MockInstance<
      typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
    > = jest.spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter");

    expect(
      await evaluate(
        oneDown,
        filter(CheckOn.DisconnectedProbes, FilterType.GreaterThan, 0),
      ),
    ).not.toBeNull();

    // Called, but it returns before reading anything.
    const result: Awaited<
      ReturnType<typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter>
    > = await (spy.mock.results[0]!.value as ReturnType<
      typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
    >);
    expect(result).toEqual({ earlyReturn: null, value: undefined });
  });
});
