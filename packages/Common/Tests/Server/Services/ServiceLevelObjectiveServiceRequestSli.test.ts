import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService, {
  SLO_LATENCY_THRESHOLD_ERROR_MESSAGE,
  SLO_LATENCY_THRESHOLD_REQUIRED_ERROR_MESSAGE,
  SLO_MAX_LATENCY_THRESHOLD_IN_MILLISECONDS,
} from "../../../Server/Services/ServiceLevelObjectiveService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What ServiceLevelObjectiveService holds a request SLO to.
 *
 *   - A latency threshold is a whole number of milliseconds from 1 to an
 *     hour, whatever the SLI type, so switching to Request Latency later
 *     finds a usable one.
 *   - A Request Latency SLO always has one: it is not created without one,
 *     not switched to without one, and its threshold is not cleared.
 *   - A change to what an SLO counts - its SLI type, services or latency
 *     threshold - is measured on the worker's next tick.
 *
 * Every create and update reaches these checks (a dashboard form, an API
 * key, Terraform, a workflow), so they are pinned on the hooks themselves.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8c000000-0000-4000-8000-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("8c000000-0000-4000-8000-000000000002");
const SERVICE_ID: ObjectID = new ObjectID(
  "8c000000-0000-4000-8000-000000000003",
);

type SloFields = Record<string, unknown>;

function makeSlo(fields: SloFields): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const writable: Record<string, unknown> = slo as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return slo;
}

function makeCreateBy(fields: SloFields): CreateBy<ServiceLevelObjective> {
  return {
    data: makeSlo({
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
      ...fields,
    }),
    props: { isRoot: true },
  };
}

function makeUpdateBy(data: SloFields): UpdateBy<ServiceLevelObjective> {
  return {
    query: { _id: SLO_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjective>;
}

// Calls a protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveService, args);
}

async function expectBadData(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(BadDataException);
  await expect(promise).rejects.toThrow(message);
}

/*
 * The rows an update writes, as the service reads them before it
 * (findRowsAndHoldUpdateToThem): stubbed, so a test says what is stored.
 */
function stubStoredRows(rows: Array<SloFields>): jest.SpyInstance {
  return jest
    .spyOn(
      ServiceLevelObjectiveService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<
          Array<ServiceLevelObjective>
        >;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockResolvedValue(
      rows.map((row: SloFields): ServiceLevelObjective => {
        return makeSlo({ _id: SLO_ID.toString(), ...row });
      }),
    );
}

describe("ServiceLevelObjectiveService.onBeforeCreate - request SLIs", () => {
  beforeEach(() => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
    stubProjectDirectory({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates a Request Success SLO without a latency threshold", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.RequestSuccess,
          services: [{ _id: SERVICE_ID.toString() }],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a Request Latency SLO without a latency threshold", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({ sliType: SliType.RequestLatency }),
      ),
      SLO_LATENCY_THRESHOLD_REQUIRED_ERROR_MESSAGE,
    );
  });

  it("the refusal says what to set, in a sentence", () => {
    expect(SLO_LATENCY_THRESHOLD_REQUIRED_ERROR_MESSAGE).toMatch(
      /^A Request Latency SLO needs a latency threshold: .*latencyThresholdInMilliseconds, such as 300\.$/,
    );
    expect(SLO_LATENCY_THRESHOLD_ERROR_MESSAGE).toMatch(/\.$/);
    expect(SLO_MAX_LATENCY_THRESHOLD_IN_MILLISECONDS).toBe(3600000);
  });

  const accepted: Array<{ label: string; value: unknown; stored: number }> = [
    { label: "1 ms", value: 1, stored: 1 },
    { label: "300 ms", value: 300, stored: 300 },
    { label: "an hour", value: 3600000, stored: 3600000 },
    // A number box hands its value over as a string.
    { label: 'the string "250"', value: "250", stored: 250 },
    { label: 'the string " 500 "', value: " 500 ", stored: 500 },
  ];

  for (const threshold of accepted) {
    it(`accepts a latency threshold of ${threshold.label}, stored as a number`, async () => {
      const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
        sliType: SliType.RequestLatency,
        latencyThresholdInMilliseconds: threshold.value,
      });

      await callHook("onBeforeCreate", createBy);

      expect(createBy.data.latencyThresholdInMilliseconds).toBe(
        threshold.stored,
      );
    });
  }

  const rejected: Array<{ label: string; value: unknown }> = [
    { label: "0", value: 0 },
    { label: "a negative number", value: -5 },
    { label: "a fraction of a millisecond", value: 0.5 },
    { label: "a decimal", value: 250.5 },
    { label: "more than an hour", value: 3600001 },
    { label: "NaN", value: Number.NaN },
    { label: "a word", value: "fast" },
    { label: "an empty string", value: "" },
  ];

  for (const threshold of rejected) {
    it(`refuses a latency threshold of ${threshold.label}`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            sliType: SliType.RequestLatency,
            latencyThresholdInMilliseconds: threshold.value,
          }),
        ),
        SLO_LATENCY_THRESHOLD_ERROR_MESSAGE,
      );
    });
  }

  it("validates a threshold sent with any SLI type, for a later switch to Request Latency", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.MonitorUptime,
          latencyThresholdInMilliseconds: 0,
        }),
      ),
      SLO_LATENCY_THRESHOLD_ERROR_MESSAGE,
    );
  });
});

describe("ServiceLevelObjectiveService.onBeforeUpdate - request SLIs", () => {
  beforeEach(() => {
    stubProjectDirectory({});
    jest.spyOn(ServiceLevelObjectiveService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("validates and coerces a latency threshold", async () => {
    stubStoredRows([{ sliType: SliType.RequestLatency }]);

    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      latencyThresholdInMilliseconds: "400",
    });

    await callHook("onBeforeUpdate", updateBy);

    expect(updateBy.data.latencyThresholdInMilliseconds).toBe(400);

    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ latencyThresholdInMilliseconds: 9999999 }),
      ),
      SLO_LATENCY_THRESHOLD_ERROR_MESSAGE,
    );
  });

  it("switching to Request Latency with a threshold reads nothing more", async () => {
    const stored: jest.SpyInstance = stubStoredRows([]);

    await callHook(
      "onBeforeUpdate",
      makeUpdateBy({
        sliType: SliType.RequestLatency,
        latencyThresholdInMilliseconds: 300,
      }),
    );

    /*
     * The feed's snapshot reads the two columns too, to say what changed
     * (it also reads the name); the threshold check itself reads nothing.
     */
    expect(
      stored.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          JSON.stringify(call[1]) ===
          JSON.stringify({
            _id: true,
            sliType: true,
            latencyThresholdInMilliseconds: true,
          })
        );
      }),
    ).toBe(false);
  });

  it("switching to Request Latency keeps the threshold the SLO already has", async () => {
    stubStoredRows([
      { sliType: SliType.RequestSuccess, latencyThresholdInMilliseconds: 250 },
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ sliType: SliType.RequestLatency }),
      ),
    ).resolves.toBeDefined();
  });

  it("refuses switching to Request Latency with no threshold anywhere", async () => {
    stubStoredRows([{ sliType: SliType.MonitorUptime }]);

    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ sliType: SliType.RequestLatency }),
      ),
      SLO_LATENCY_THRESHOLD_REQUIRED_ERROR_MESSAGE,
    );
  });

  it("refuses clearing the threshold of a Request Latency SLO", async () => {
    stubStoredRows([
      { sliType: SliType.RequestLatency, latencyThresholdInMilliseconds: 300 },
    ]);

    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ latencyThresholdInMilliseconds: null }),
      ),
      SLO_LATENCY_THRESHOLD_REQUIRED_ERROR_MESSAGE,
    );
  });

  it("clears the threshold of an SLO that switches away from Request Latency in the same write", async () => {
    stubStoredRows([
      { sliType: SliType.RequestLatency, latencyThresholdInMilliseconds: 300 },
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({
          sliType: SliType.RequestSuccess,
          latencyThresholdInMilliseconds: null,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("clears the threshold of a Request Success SLO", async () => {
    stubStoredRows([
      { sliType: SliType.RequestSuccess, latencyThresholdInMilliseconds: 300 },
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ latencyThresholdInMilliseconds: null }),
      ),
    ).resolves.toBeDefined();
  });

  it("an update of neither reads nothing for it - the worker's writes included", async () => {
    const stored: jest.SpyInstance = stubStoredRows([]);

    await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ currentSliPercentage: 99.5, goodEventCount: 10 }),
    );

    expect(stored).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService.onUpdateSuccess - re-evaluation on what a request SLO counts", () => {
  let updateOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);

    jest.spyOn(ServiceLevelObjectiveService, "findOneById").mockResolvedValue(
      makeSlo({
        _id: SLO_ID.toString(),
        projectId: PROJECT_ID,
        name: "Checkout",
      }),
    );

    jest.spyOn(ServiceLevelObjectiveService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);

    jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stamps(): Array<{ data: { nextEvaluationAt?: Date } }> {
    return updateOneByIdSpy.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as { data: { nextEvaluationAt?: Date } };
      })
      .filter((call: { data: { nextEvaluationAt?: Date } }): boolean => {
        return call.data.nextEvaluationAt instanceof Date;
      });
  }

  const changes: Array<{ label: string; data: SloFields }> = [
    { label: "the SLI type", data: { sliType: SliType.RequestLatency } },
    {
      label: "the services",
      data: { services: [{ _id: SERVICE_ID.toString() }] },
    },
    { label: "the services cleared", data: { services: [] } },
    {
      label: "the latency threshold",
      data: { latencyThresholdInMilliseconds: 450 },
    },
  ];

  for (const change of changes) {
    it(`measures again on the next tick when ${change.label} changes`, async () => {
      const onUpdate: OnUpdate<ServiceLevelObjective> = {
        updateBy: makeUpdateBy(change.data),
        carryForward: null,
      };

      await callHook("onUpdateSuccess", onUpdate, [SLO_ID]);

      expect(stamps()).toHaveLength(1);
    });
  }

  it("the worker's own state write is not a change of what it counts", async () => {
    const onUpdate: OnUpdate<ServiceLevelObjective> = {
      updateBy: makeUpdateBy({
        goodEventCount: 10,
        totalEventCount: 10,
        errorBudgetRemainingEvents: 0.01,
      }),
      carryForward: null,
    };

    await callHook("onUpdateSuccess", onUpdate, [SLO_ID]);

    expect(stamps()).toHaveLength(0);
  });
});
