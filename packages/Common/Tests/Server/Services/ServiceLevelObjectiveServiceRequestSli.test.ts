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
    // Which of the services' requests count (#8444).
    {
      label: "the request filter",
      data: { requestFilter: "@http.route:/checkout*" },
    },
    { label: "the request filter cleared", data: { requestFilter: null } },
    // What a Metric SLO counts (#8445).
    {
      label: "the metric",
      data: {
        metricQueryConfig: {
          metricName: "http.server.request.duration",
          kind: "Histogram",
          goodAtOrUnder: 0.3,
        },
      },
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

/*
 * A request SLO's request filter (#8444): a traces search of span
 * attributes and the span's name. Stored trimmed, empty as no filter, and
 * refused with what to write instead when the counting could not read it -
 * from the dashboard, the API, Terraform or a workflow alike.
 */
describe("ServiceLevelObjectiveService - a request filter", () => {
  beforeEach(() => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
    stubProjectDirectory({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a filter on create, trimmed", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      sliType: SliType.RequestSuccess,
      requestFilter: "  @http.route:/checkout* -@http.route:/health  ",
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.requestFilter).toBe(
      "@http.route:/checkout* -@http.route:/health",
    );
  });

  it("stores an empty filter as no filter", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      sliType: SliType.RequestSuccess,
      requestFilter: "   ",
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.requestFilter).toBeNull();
  });

  it("refuses free text on create, saying what a filter is", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.RequestSuccess,
          requestFilter: "checkout",
        }),
      ),
      '"checkout" is neither',
    );
  });

  it("refuses the Traces explorer's status field, which would match no span's attributes", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.RequestSuccess,
          requestFilter: "@http.route:/checkout* status:error",
        }),
      ),
      '"status:error" is neither',
    );
  });

  it("refuses a filter that is not text", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.RequestSuccess,
          requestFilter: 42,
        }),
      ),
      "The request filter must be text",
    );
  });

  it("validates a filter on update, and clears one to null", async () => {
    stubStoredRows([{ sliType: SliType.RequestSuccess }]);

    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      requestFilter: ' name:"POST /checkout" ',
    });

    await callHook("onBeforeUpdate", updateBy);

    expect(updateBy.data.requestFilter).toBe('name:"POST /checkout"');

    const cleared: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      requestFilter: "",
    });

    await callHook("onBeforeUpdate", cleared);

    expect(cleared.data.requestFilter).toBeNull();
  });

  it("refuses a filter too long to count with on update", async () => {
    stubStoredRows([{ sliType: SliType.RequestSuccess }]);

    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ requestFilter: `@k:${"a".repeat(600)}` }),
      ),
      "at most 500 characters",
    );
  });

  it("leaves an update that names no filter alone", async () => {
    stubStoredRows([{ sliType: SliType.RequestSuccess }]);

    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      name: "Checkout",
    });

    await callHook("onBeforeUpdate", updateBy);

    expect("requestFilter" in (updateBy.data as Record<string, unknown>)).toBe(
      false,
    );
  });
});

/*
 * A Metric SLO's metric (#8445): a counter whose good events match a
 * condition, or a histogram whose good observations are at or under a
 * value. Stored as the counting reads it, and a Metric SLO is never left
 * with one it cannot count with - from the dashboard, the API, Terraform
 * or a workflow alike.
 */
describe("ServiceLevelObjectiveService - a Metric SLO's metric", () => {
  /*
   * Whether a read made to judge the update asked for the stored metric.
   * The feed's snapshot reads it too, so the SLO's feed can say what the
   * metric was (readFeedSnapshotBeforeUpdate). It is told apart by the name
   * it always reads with it.
   */
  function isFeedSnapshotRead(call: Array<unknown>): boolean {
    return Boolean((call[1] as Record<string, unknown>)?.["name"]);
  }

  function readTheStoredMetric(stored: jest.SpyInstance): boolean {
    return stored.mock.calls.some((call: Array<unknown>): boolean => {
      return (
        !isFeedSnapshotRead(call) &&
        Boolean((call[1] as Record<string, unknown>)?.["metricQueryConfig"])
      );
    });
  }

  const COUNTER: SloFields = {
    metricName: "http_requests_total",
    kind: "Counter",
    goodFilter: "@http.response.status_code:<500",
  };

  beforeEach(() => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
    stubProjectDirectory({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a metric on create, as the counting reads it", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      sliType: SliType.Metric,
      metricQueryConfig: {
        metricName: "  http_requests_total ",
        kind: "Counter",
        goodFilter: " @http.response.status_code:<500 ",
        goodAtOrUnder: 0.3,
      },
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.metricQueryConfig).toEqual(COUNTER);
  });

  it("refuses a Metric SLO with no metric, saying what to choose", async () => {
    await expectBadData(
      callHook("onBeforeCreate", makeCreateBy({ sliType: SliType.Metric })),
      "Choose the metric this SLO counts",
    );
  });

  it("refuses a counter with no good condition, and a histogram with no value", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.Metric,
          metricQueryConfig: { metricName: "m", kind: "Counter" },
        }),
      ),
      "Say which of the counter's events are good",
    );
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.Metric,
          metricQueryConfig: {
            metricName: "http.server.request.duration",
            kind: "Histogram",
            goodAtOrUnder: -1,
          },
        }),
      ),
      "Enter the value a good observation stays at or under",
    );
  });

  it("refuses a metric that is not an object, saying what one looks like", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          sliType: SliType.Metric,
          metricQueryConfig: "http_requests_total",
        }),
      ),
      "The metric query must be an object",
    );
  });

  it("leaves another SLI type's half-filled metric alone", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      sliType: SliType.RequestSuccess,
      metricQueryConfig: { metricName: "m" },
    });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();
  });

  it("refuses switching an SLO to Metric while it has no metric it can count", async () => {
    stubStoredRows([{ sliType: SliType.RequestSuccess }]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ sliType: SliType.Metric })),
      "Choose the metric this SLO counts",
    );
  });

  it("switches an SLO to Metric with a metric it can count, without reading the stored one", async () => {
    const stored: jest.SpyInstance = stubStoredRows([]);
    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      sliType: SliType.Metric,
      metricQueryConfig: COUNTER,
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();
    expect(readTheStoredMetric(stored)).toBe(false);
  });

  it("reads the metric it replaces only for the feed, to say what it was", async () => {
    const stored: jest.SpyInstance = stubStoredRows([
      { sliType: SliType.Metric, metricQueryConfig: COUNTER },
    ]);

    await callHook(
      "onBeforeUpdate",
      makeUpdateBy({
        sliType: SliType.Metric,
        metricQueryConfig: { ...COUNTER, metricName: "rpc_requests_total" },
      }),
    );

    const feedReads: Array<Array<unknown>> =
      stored.mock.calls.filter(isFeedSnapshotRead);

    expect(feedReads).toHaveLength(1);
    expect(
      (feedReads[0]![1] as Record<string, unknown>)["metricQueryConfig"],
    ).toBe(true);
    expect(readTheStoredMetric(stored)).toBe(false);
  });

  it("refuses clearing a Metric SLO's metric, and changing it to one it cannot count", async () => {
    stubStoredRows([{ sliType: SliType.Metric, metricQueryConfig: COUNTER }]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ metricQueryConfig: null })),
      "Choose the metric this SLO counts",
    );
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ metricQueryConfig: { ...COUNTER, goodFilter: "ok" } }),
      ),
      '"ok" is not one',
    );
  });

  it("stores an edited metric as the counting reads it", async () => {
    stubStoredRows([{ sliType: SliType.Metric, metricQueryConfig: COUNTER }]);

    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      metricQueryConfig: { ...COUNTER, filter: "  @http.route:/checkout*  " },
    });

    await callHook("onBeforeUpdate", updateBy);

    expect(
      (updateBy.data as Record<string, unknown>)["metricQueryConfig"],
    ).toEqual({ ...COUNTER, filter: "@http.route:/checkout*" });
  });

  it("an update that touches neither the SLI type nor the metric never reads the stored metric", async () => {
    const stored: jest.SpyInstance = stubStoredRows([]);

    await callHook("onBeforeUpdate", makeUpdateBy({ name: "Checkout" }));

    expect(readTheStoredMetric(stored)).toBe(false);
  });
});
