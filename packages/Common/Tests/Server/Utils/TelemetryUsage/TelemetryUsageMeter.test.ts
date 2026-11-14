let mockIsBillingEnabled: boolean = false;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import ProjectService from "../../../../Server/Services/ProjectService";
import TelemetryUsageBillingService from "../../../../Server/Services/TelemetryUsageBillingService";
import logger from "../../../../Server/Utils/Logger";
import TelemetryUsageMeter, {
  TelemetryUsageMeterSummary,
} from "../../../../Server/Utils/TelemetryUsage/TelemetryUsageMeter";
import Project from "../../../../Models/DatabaseModels/Project";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import { TELEMETRY_USAGE_PRODUCT_TYPES } from "../../../../Types/Telemetry/TelemetryUsage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The TelemetryUsage:MeterTelemetryUsage worker job's loop, where billing is
 * off (issue #5916): every project, one at a time, each signal of it on its
 * own, bounded by a deadline and by the run's lock - and one project's or
 * signal's failure stopping none of the others.
 */

const NOW: Date = new Date("2026-10-23T08:00:00.000Z");
const DEADLINE: Date = new Date("2026-10-23T10:00:00.000Z");

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);
const PROJECT_C: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000003",
);

function project(id: ObjectID | undefined): Project {
  const value: Project = new Project();

  if (id) {
    value.id = id;
  }

  return value;
}

let findAllBy: jest.SpyInstance;
let meter: jest.SpyInstance;
let metered: Array<string>;
let clock: Date;

beforeEach(() => {
  mockIsBillingEnabled = false;
  metered = [];
  clock = NOW;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return clock;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {});

  findAllBy = jest
    .spyOn(ProjectService, "findAllBy")
    .mockResolvedValue([
      project(PROJECT_A),
      project(PROJECT_B),
      project(PROJECT_C),
    ] as never);

  meter = jest
    .spyOn(
      TelemetryUsageBillingService,
      "meterUnstagedTelemetryUsageForProject",
    )
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        productType: ProductType;
      }): Promise<void> => {
        metered.push(`${data.projectId.toString()}:${data.productType}`);
      },
    );
});

afterEach(() => {
  mockIsBillingEnabled = false;
  jest.restoreAllMocks();
});

async function run(
  shouldContinue: () => boolean = (): boolean => {
    return true;
  },
): Promise<TelemetryUsageMeterSummary> {
  return await TelemetryUsageMeter.meterAllProjects({
    deadline: DEADLINE,
    shouldContinue: shouldContinue,
  });
}

describe("the metering loop", () => {
  test("meters every signal of every project, one project at a time", async () => {
    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary).toEqual({
      stopReason: "done",
      projectsMetered: 3,
      failures: 0,
    });

    const expected: Array<string> = [];

    for (const id of [PROJECT_A, PROJECT_B, PROJECT_C]) {
      for (const productType of TELEMETRY_USAGE_PRODUCT_TYPES) {
        expected.push(`${id.toString()}:${productType}`);
      }
    }

    expect(metered).toEqual(expected);
  });

  test("reads the projects as root, ids only, oldest first, so every run goes in the same order", async () => {
    await run();

    expect(findAllBy).toHaveBeenCalledTimes(1);
    expect(findAllBy.mock.calls[0]![0]).toEqual({
      // Never a sample project (#6808): it is in nobody's usage.
      query: { isSampleProject: false },
      select: { _id: true },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  });

  test("a signal that fails is counted, logged and retried next run; the rest carry on", async () => {
    meter.mockImplementation(
      async (data: {
        projectId: ObjectID;
        productType: ProductType;
      }): Promise<void> => {
        if (
          data.projectId.toString() === PROJECT_B.toString() &&
          data.productType === ProductType.Logs
        ) {
          throw new Error("Timeout exceeded: elapsed 120 seconds");
        }

        metered.push(`${data.projectId.toString()}:${data.productType}`);
      },
    );

    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary).toEqual({
      stopReason: "done",
      projectsMetered: 3,
      failures: 1,
    });
    expect(metered).toContain(`${PROJECT_B.toString()}:${ProductType.Metrics}`);
    expect(metered).toContain(
      `${PROJECT_C.toString()}:${ProductType.SecurityEvents}`,
    );
    expect(metered).not.toContain(
      `${PROJECT_B.toString()}:${ProductType.Logs}`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      `TelemetryUsage: could not count the ${ProductType.Logs} usage of project ${PROJECT_B.toString()}; the next run tries again.`,
    );
  });

  test("a project that fails on every signal stops none of the others", async () => {
    meter.mockImplementation(
      async (data: {
        projectId: ObjectID;
        productType: ProductType;
      }): Promise<void> => {
        if (data.projectId.toString() === PROJECT_A.toString()) {
          throw new Error("ClickHouse is down");
        }

        metered.push(`${data.projectId.toString()}:${data.productType}`);
      },
    );

    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary.failures).toBe(TELEMETRY_USAGE_PRODUCT_TYPES.length);
    expect(metered).toHaveLength(2 * TELEMETRY_USAGE_PRODUCT_TYPES.length);
  });

  test("stops starting new work at its deadline, and leaves the rest to the next run", async () => {
    meter.mockImplementation(
      async (data: {
        projectId: ObjectID;
        productType: ProductType;
      }): Promise<void> => {
        metered.push(`${data.projectId.toString()}:${data.productType}`);

        // The first project's last signal runs the clock past the deadline.
        if (
          data.projectId.toString() === PROJECT_A.toString() &&
          data.productType === ProductType.SecurityEvents
        ) {
          clock = DEADLINE;
        }
      },
    );

    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary).toEqual({
      stopReason: "deadline",
      projectsMetered: 1,
      failures: 0,
    });
    expect(metered).toHaveLength(TELEMETRY_USAGE_PRODUCT_TYPES.length);
  });

  test("stops between signals once it loses its lock", async () => {
    let calls: number = 0;

    const summary: TelemetryUsageMeterSummary = await run((): boolean => {
      calls++;
      // The lock is lost after the second signal of the first project.
      return calls <= 2;
    });

    expect(summary.stopReason).toBe("lost-lock");
    expect(metered).toEqual([
      `${PROJECT_A.toString()}:${TELEMETRY_USAGE_PRODUCT_TYPES[0]}`,
      `${PROJECT_A.toString()}:${TELEMETRY_USAGE_PRODUCT_TYPES[1]}`,
    ]);
  });

  test("a run already past its deadline meters nothing", async () => {
    clock = new Date(DEADLINE.getTime() + 1000);

    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary.stopReason).toBe("deadline");
    expect(metered).toEqual([]);
  });

  test("skips a project row with no id", async () => {
    findAllBy.mockResolvedValue([project(undefined), project(PROJECT_C)]);

    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary.projectsMetered).toBe(1);
    expect(metered).toHaveLength(TELEMETRY_USAGE_PRODUCT_TYPES.length);
  });

  test("does nothing where billing is on - not even read the projects", async () => {
    mockIsBillingEnabled = true;

    const summary: TelemetryUsageMeterSummary = await run();

    expect(summary).toEqual({
      stopReason: "billing-enabled",
      projectsMetered: 0,
      failures: 0,
    });
    expect(findAllBy).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();
  });
});
