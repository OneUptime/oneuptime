import MonitorTestService, {
  MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW,
  MONITOR_TEST_WINDOW_IN_MINUTES,
} from "../../../Server/Services/MonitorTestService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import MonitorTest from "../../../Models/DatabaseModels/MonitorTest";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import { JSONObject } from "../../../Types/JSON";
import { MAX_MONITOR_STEPS } from "../../../Types/Monitor/MonitorStepLimit";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A "TEST MONITOR" RUN IS WORK FOR A PROBE, AND A PROJECT ASKS FOR A
 * BOUNDED AMOUNT OF IT.
 *
 * Through the API - not the dashboard, whose own step check does not run
 * for such a request - one free project ran 1,238 tests of up to 5,000
 * steps each in an hour. The probe reports every step; the 6.2 million
 * reports filled the telemetry queue, held Valkey at a full core and
 * Postgres in row locks, and every project's probe results went unrecorded
 * for hours.
 *
 * A test is now refused, before anything else is checked, with more steps
 * than any monitor may have; and, once the base hook has checked its
 * references, when its project has asked for
 * MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW in the last
 * MONITOR_TEST_WINDOW_IN_MINUTES minutes. Three a minute is the most any
 * project on OneUptime Cloud ran.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

function stepsJSON(count: number): JSONObject {
  const steps: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    steps.push({
      _type: "MonitorStep",
      value: {
        id: ObjectID.generate().toString(),
        customCode: "1",
        monitorCriteria: {
          _type: "MonitorCriteria",
          value: { monitorCriteriaInstanceArray: [] },
        },
      },
    });
  }

  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: steps,
      defaultMonitorStatusId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  };
}

function testOf(stepCount: number): MonitorTest {
  const monitorTest: MonitorTest = new MonitorTest();
  monitorTest.monitorType = MonitorType.SyntheticMonitor;
  monitorTest.monitorSteps = MonitorSteps.fromJSON(stepsJSON(stepCount));
  monitorTest.probeId = ObjectID.generate();
  monitorTest.isInQueue = true;
  return monitorTest;
}

// The service's own check, as its create runs it before anything else.
function checkCreate(createBy: CreateBy<MonitorTest>): Promise<void> {
  return (
    MonitorTestService as unknown as {
      checkCreateBeforeReferences: (c: CreateBy<MonitorTest>) => Promise<void>;
    }
  ).checkCreateBeforeReferences(createBy);
}

// The create hook: the base hook's reference check (stubbed), then the count.
async function beforeCreate(createBy: CreateBy<MonitorTest>): Promise<void> {
  await (
    MonitorTestService as unknown as {
      onBeforeCreate: (
        c: CreateBy<MonitorTest>,
      ) => Promise<OnCreate<MonitorTest>>;
    }
  ).onBeforeCreate(createBy);
}

type CountByArgs = {
  query: Record<string, unknown>;
  props: Record<string, unknown>;
};

let recentTests: number = 0;
let countBy: jest.SpiedFunction<typeof MonitorTestService.countBy>;
// What ran, in order: the base hook's reference check and the count.
let ran: Array<string> = [];

beforeEach(() => {
  recentTests = 0;
  ran = [];
  countBy = jest
    .spyOn(MonitorTestService, "countBy")
    .mockImplementation(async (): Promise<PositiveNumber> => {
      ran.push("count");
      return new PositiveNumber(recentTests);
    });

  // The references are checked by the base hook, pinned by its own suites.
  jest
    .spyOn(
      ProjectReferencesService.prototype as unknown as {
        onBeforeCreate: (
          c: CreateBy<MonitorTest>,
        ) => Promise<OnCreate<MonitorTest>>;
      },
      "onBeforeCreate",
    )
    .mockImplementation(async (createBy: CreateBy<MonitorTest>) => {
      ran.push("references");
      return { createBy: createBy, carryForward: undefined };
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor test with more steps than any monitor may have is refused", () => {
  test("the 5,000 steps that flooded the probes: a bad request, refused without reading anything", async () => {
    await expect(
      checkCreate({ data: testOf(5000), props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow(BadDataException);
    await expect(
      checkCreate({ data: testOf(5000), props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow("at most 100 steps, and this one has 5000");
    expect(countBy).not.toHaveBeenCalled();
  });

  test("one past the limit", async () => {
    await expect(
      checkCreate({
        data: testOf(MAX_MONITOR_STEPS + 1),
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(`this one has ${MAX_MONITOR_STEPS + 1}`);
  });

  test("however it is asked for: the master admin and OneUptime itself are held to it too", async () => {
    await expect(
      checkCreate({
        data: testOf(MAX_MONITOR_STEPS + 1),
        props: { tenantId: PROJECT_ID, isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
    await expect(
      checkCreate({
        data: testOf(MAX_MONITOR_STEPS + 1),
        props: { tenantId: PROJECT_ID, isMasterAdmin: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("up to the limit goes on", async () => {
    await expect(
      checkCreate({
        data: testOf(MAX_MONITOR_STEPS),
        props: { tenantId: PROJECT_ID },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("a project asks for a bounded number of monitor tests", () => {
  test("thirty in ten minutes: ten times the most any project ran in a minute", () => {
    expect(MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW).toBe(30);
    expect(MONITOR_TEST_WINDOW_IN_MINUTES).toBe(10);
  });

  test("counts the project's own tests of the window, whoever is asking", async () => {
    const before: number = Date.now();

    await beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } });

    expect(countBy).toHaveBeenCalledTimes(1);

    const args: CountByArgs = countBy.mock
      .calls[0]![0] as unknown as CountByArgs;

    expect(String(args.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(args.props["isRoot"]).toBe(true);

    // createdAt >= now - the window: a Raw operator with the date its one parameter.
    const parameters: Array<unknown> = Object.values(
      (
        args.query["createdAt"] as {
          objectLiteralParameters: Record<string, unknown>;
        }
      ).objectLiteralParameters,
    );

    expect(parameters).toHaveLength(1);

    const since: Date = parameters[0] as Date;

    expect(since).toBeInstanceOf(Date);
    const windowInMs: number = MONITOR_TEST_WINDOW_IN_MINUTES * 60 * 1000;

    expect(since.getTime()).toBeGreaterThanOrEqual(before - windowInMs - 1000);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now() - windowInMs + 1000);
  });

  test("the project of a create without a tenant is the test's own", async () => {
    const monitorTest: MonitorTest = testOf(1);
    monitorTest.projectId = PROJECT_ID;

    await beforeCreate({ data: monitorTest, props: {} });

    const args: CountByArgs = countBy.mock
      .calls[0]![0] as unknown as CountByArgs;
    expect(String(args.query["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("below the limit, a test goes on", async () => {
    recentTests = MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW - 1;

    await expect(
      beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } }),
    ).resolves.toBeUndefined();
  });

  test("at the limit, the next is refused as too many requests, saying when to come back", async () => {
    recentTests = MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW;

    await expect(
      beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow(TooManyRequestsException);
    await expect(
      beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow(
      "This project has run 30 monitor tests in the last 10 minutes, the most it may. Try again in a few minutes.",
    );
  });

  test("the 1,238 tests an hour of the flood are refused long before", async () => {
    recentTests = 200;

    await expect(
      beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow(TooManyRequestsException);
  });

  test("a create with no project to count against counts nothing", async () => {
    await expect(
      beforeCreate({ data: testOf(1), props: {} }),
    ).resolves.toBeUndefined();
    expect(countBy).not.toHaveBeenCalled();
  });

  test("the references are checked first, so another project's id is answered before anything is counted", async () => {
    await beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } });

    expect(ran).toEqual(["references", "count"]);
  });

  test("a refused reference is answered as it is, and nothing is counted", async () => {
    jest
      .spyOn(
        ProjectReferencesService.prototype as unknown as {
          onBeforeCreate: (
            c: CreateBy<MonitorTest>,
          ) => Promise<OnCreate<MonitorTest>>;
        },
        "onBeforeCreate",
      )
      .mockRejectedValue(new BadDataException("Probe not found"));

    await expect(
      beforeCreate({ data: testOf(1), props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow("Probe not found");
    expect(countBy).not.toHaveBeenCalled();
  });
});
