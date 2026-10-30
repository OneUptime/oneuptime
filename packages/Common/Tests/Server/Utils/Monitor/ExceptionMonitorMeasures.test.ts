import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionMonitorMeasureReader, {
  ExceptionMonitorMeasures,
} from "../../../../Server/Utils/Monitor/ExceptionMonitorMeasures";
import ExceptionMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../../Types/Monitor/MonitorStepExceptionMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";

/*
 * What an Exceptions monitor reads beyond its count, with the databases
 * mocked: nothing more for a plain count; new and regressed exceptions as
 * exception groups with the monitor's filters and the window; the usual
 * count as the window's own occurrence query moved to the day before; and
 * the criteria and the status timeline reading each.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const UNTIL: Date = new Date("2026-10-30T12:00:00.000Z");

interface CountCall {
  query: Record<string, unknown>;
}

let groupCalls: Array<CountCall>;
let occurrenceCalls: Array<CountCall>;
let groupCounts: Array<number>;
let previousOccurrences: number;

function stepWith(checkOns: Array<CheckOn>): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorType: MonitorType.Exceptions,
    monitorName: "Checkout",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    ...instance.data!,
    filters: checkOns.map((checkOn: CheckOn) => {
      return { checkOn, filterType: FilterType.GreaterThan, value: 0 };
    }),
  };
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };
  step.setMonitorCriteria(criteria);
  return step;
}

function config(
  overrides: Partial<MonitorStepExceptionMonitor> = {},
): MonitorStepExceptionMonitor {
  return {
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    telemetryServiceIds: [SERVICE_ID],
    exceptionTypes: ["TypeError"],
    environments: ["production"],
    message: "cart",
    lastXSecondsOfExceptions: 300,
    ...overrides,
  };
}

async function read(
  checkOns: Array<CheckOn>,
  overrides: Partial<MonitorStepExceptionMonitor> = {},
  exceptionCount: number = 40,
): Promise<ExceptionMonitorMeasures> {
  return await ExceptionMonitorMeasureReader.read({
    projectId: PROJECT_ID,
    monitorStep: stepWith(checkOns),
    config: config(overrides),
    countQuery: {
      projectId: PROJECT_ID,
      time: new InBetween(new Date(UNTIL.getTime() - 300000), UNTIL),
    },
    exceptionCount,
    evaluateUntil: UNTIL,
  });
}

beforeEach(() => {
  groupCalls = [];
  occurrenceCalls = [];
  groupCounts = [2, 1];
  previousOccurrences = 2880;

  jest.spyOn(TelemetryExceptionService, "countBy").mockImplementation((async (
    args: CountCall,
  ) => {
    groupCalls.push({ query: args.query });
    return new PositiveNumber(groupCounts.shift() || 0);
  }) as never);
  jest.spyOn(ExceptionInstanceService, "countBy").mockImplementation((async (
    args: CountCall,
  ) => {
    occurrenceCalls.push({ query: args.query });
    return new PositiveNumber(previousOccurrences);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExceptionMonitorMeasureReader.read", () => {
  test("a plain count reads nothing more", async () => {
    expect(await read([CheckOn.ExceptionCount])).toEqual({});
    expect(groupCalls).toHaveLength(0);
    expect(occurrenceCalls).toHaveLength(0);
  });

  test("new exceptions: open groups first seen in the window, with the monitor's filters", async () => {
    groupCounts = [3];
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.NewExceptionCount,
    ]);

    expect(measures).toEqual({ newExceptionCount: 3 });
    expect(groupCalls).toHaveLength(1);

    const query: Record<string, unknown> = groupCalls[0]!.query;
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["primaryEntityId"]).toEqual(new Includes([SERVICE_ID]));
    expect(query["exceptionType"]).toEqual(new Includes(["TypeError"]));
    expect(query["environment"]).toEqual(new Includes(["production"]));
    expect(query["message"]).toEqual(new Search("cart"));
    expect(query["isResolved"]).toBe(false);
    expect(query["isArchived"]).toBe(false);
    expect(JSON.stringify(query["firstSeenAt"])).toContain(
      "2026-10-30T11:55:00.000Z",
    );
    expect(JSON.stringify(query["firstSeenAt"])).toContain(
      "2026-10-30T12:00:00.000Z",
    );
  });

  test("regressed exceptions: groups that came back in the window and are still open", async () => {
    groupCounts = [1];
    const measures: ExceptionMonitorMeasures = await read(
      [CheckOn.RegressedExceptionCount],
      { includeResolved: true },
    );

    expect(measures).toEqual({ regressedExceptionCount: 1 });

    const query: Record<string, unknown> = groupCalls[0]!.query;
    expect(JSON.stringify(query["regressedAt"])).toContain(
      "2026-10-30T11:55:00.000Z",
    );
    // Resolved again since: fixed, whatever the monitor counts.
    expect(query["isResolved"]).toBe(false);
  });

  test("counting resolved and archived exceptions too leaves the status out of a new-exception query", async () => {
    await read([CheckOn.NewExceptionCount], {
      includeResolved: true,
      includeArchived: true,
    });

    expect("isResolved" in groupCalls[0]!.query).toBe(false);
    expect("isArchived" in groupCalls[0]!.query).toBe(false);
  });

  test("the increase: the window's own query over the day before, per window", async () => {
    // 2880 in the day before: 10 per five minutes; 40 now is 300% above.
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.ExceptionCountIncreasePercent,
    ]);

    expect(measures).toEqual({
      exceptionCountBaseline: 10,
      exceptionCountIncreasePercent: 300,
    });
    expect(occurrenceCalls).toHaveLength(1);

    const time: InBetween<Date> = occurrenceCalls[0]!.query[
      "time"
    ] as InBetween<Date>;
    expect(new Date(time.startValue).toISOString()).toBe(
      "2026-10-29T11:55:00.000Z",
    );
    expect(new Date(time.endValue).toISOString()).toBe(
      "2026-10-30T11:55:00.000Z",
    );
    // The rest of the window's query is kept.
    expect(occurrenceCalls[0]!.query["projectId"]).toBe(PROJECT_ID);
  });

  test("all three, read together", async () => {
    groupCounts = [2, 1];
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.NewExceptionCount,
      CheckOn.RegressedExceptionCount,
      CheckOn.ExceptionCountIncreasePercent,
    ]);

    expect(measures.newExceptionCount).toBe(2);
    expect(measures.regressedExceptionCount).toBe(1);
    expect(measures.exceptionCountIncreasePercent).toBe(300);
  });
});

describe("the criteria and the status timeline", () => {
  function response(
    overrides: Partial<ExceptionMonitorResponse> = {},
  ): ExceptionMonitorResponse {
    return {
      projectId: PROJECT_ID,
      exceptionCount: 40,
      exceptionQuery: {},
      monitorId: ObjectID.generate(),
      newExceptionCount: 2,
      regressedExceptionCount: 1,
      exceptionCountBaseline: 10,
      exceptionCountIncreasePercent: 300,
      ...overrides,
    };
  }

  function filter(checkOn: CheckOn, value: number): CriteriaFilter {
    return { checkOn, filterType: FilterType.GreaterThan, value };
  }

  test.each([
    [CheckOn.ExceptionCount, 39, true],
    [CheckOn.NewExceptionCount, 0, true],
    [CheckOn.NewExceptionCount, 2, false],
    [CheckOn.RegressedExceptionCount, 0, true],
    [CheckOn.ExceptionCountIncreasePercent, 200, true],
    [CheckOn.ExceptionCountIncreasePercent, 300, false],
  ])(
    "%s greater than %s matches: %s",
    async (checkOn: CheckOn, value: number, matches: boolean) => {
      const message: string | null =
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(),
          criteriaFilter: filter(checkOn, value),
        });

      expect(Boolean(message)).toBe(matches);
    },
  );

  test("a response from before the measures were read reads 0 for them", async () => {
    const message: string | null =
      await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: PROJECT_ID,
          exceptionCount: 40,
          exceptionQuery: {},
          monitorId: ObjectID.generate(),
        } as ExceptionMonitorResponse,
        criteriaFilter: filter(CheckOn.NewExceptionCount, 0),
      });

    expect(message).toBe(null);
  });

  test("another check is not an exception measure", () => {
    expect(
      ExceptionMonitorCriteria.getMeasuredValue(response(), CheckOn.LogCount),
    ).toBe(null);
  });

  test("the status timeline says what was seen, for each", () => {
    const describe: (checkOn: CheckOn) => string | null = (
      checkOn: CheckOn,
    ): string | null => {
      return MonitorCriteriaObservationBuilder.describeExceptionCountObservation(
        { dataToProcess: response(), checkOn },
      );
    };

    expect(describe(CheckOn.ExceptionCount)).toBe("Exception count was 40.");
    expect(describe(CheckOn.NewExceptionCount)).toBe(
      "2 exceptions were seen for the first time in the window.",
    );
    expect(describe(CheckOn.RegressedExceptionCount)).toBe(
      "1 resolved exception came back in the window.",
    );
    expect(describe(CheckOn.ExceptionCountIncreasePercent)).toBe(
      "Exception count was 40, 300% above the usual 10 per window over the day before.",
    );
  });
});
