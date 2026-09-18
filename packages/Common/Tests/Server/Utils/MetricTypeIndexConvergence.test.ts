import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import MetricTypeService from "../../../Server/Services/MetricTypeService";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Regression suite for the metric-catalog writer on the ingest hot path.
 *
 * `indexMetricNameServiceNameMap` reconciles one MetricType row per (project,
 * metric name). It runs once per distinct metric name per batch, and it was
 * the only per-batch Postgres writer in the pipeline with no fence, no cache
 * and no dedup of any kind. Two independent defects made it write on EVERY
 * batch, forever:
 *
 *  1. THE DIFF WAS STRUCTURALLY UNSATISFIABLE. Rows are created with
 *     `description || ""`, so the stored value is `""` when OTLP omits the
 *     field — but the incoming value for that same case is `undefined`,
 *     because protobuf omits unset scalars. `"" !== undefined` is true, so
 *     "has anything changed?" answered YES on every batch for every metric
 *     without a description or unit. The counter-semantics fields right below
 *     already had the correct `!== undefined` guard; description and unit were
 *     simply left behind.
 *
 *  2. THE WRITE SHIPPED THE WHOLE RELATION. `services` is an EntityArray, and
 *     its mere presence as a key routes DatabaseService to
 *     `getRepository().save()` — a real BEGIN/COMMIT that reloads the entity,
 *     bumps `version`, and DELETEs then re-INSERTs junction rows, holding the
 *     row's write lock across every round trip. It was the only multi-
 *     round-trip lock hold on the ingest path.
 *
 * Defect 2 was also silently LOSING DATA: save() deletes any association not
 * present in the array it is given, and each worker only knows the services in
 * its own batch. Two workers therefore deleted each other's associations and
 * re-inserted them next batch — permanent churn, with real service-to-metric
 * links missing from the UI in between.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const METRIC_TYPE_ID: ObjectID = ObjectID.generate();
const SERVICE_A: ObjectID = ObjectID.generate();
const SERVICE_B: ObjectID = ObjectID.generate();

type ScalarUpdate = { id: ObjectID; data: Record<string, unknown> };
type AttachCall = { metricTypeId: ObjectID; serviceIds: Array<ObjectID> };

let cache: Map<string, string>;
let scalarUpdates: Array<ScalarUpdate>;
let attachCalls: Array<AttachCall>;
let creates: Array<MetricType>;
let saveUpdates: Array<unknown>;
let existingRow: MetricType | null;

/** A stored row as findOneBy would return it. */
function storedRow(overrides?: Partial<MetricType>): MetricType {
  const row: MetricType = new MetricType();
  row.id = METRIC_TYPE_ID;
  row._id = METRIC_TYPE_ID.toString();
  row.name = "http.server.duration";
  // Created via `description || ""` — this is the value that is really stored.
  row.description = "";
  row.unit = "";
  row.services = [];
  return Object.assign(row, overrides || {});
}

/** The batch's view of a metric, as the ingest pipeline builds it. */
function incoming(overrides?: Partial<MetricType>): MetricType {
  const metric: MetricType = new MetricType();
  metric.services = [];
  return Object.assign(metric, overrides || {});
}

function serviceRef(id: ObjectID): Service {
  const service: Service = new Service();
  service.id = id;
  return service;
}

function batch(metric: MetricType): Dictionary<MetricType> {
  return { "http.server.duration": metric };
}

beforeEach(() => {
  cache = new Map<string, string>();
  scalarUpdates = [];
  attachCalls = [];
  creates = [];
  saveUpdates = [];
  existingRow = storedRow();

  jest
    .spyOn(GlobalCache, "setStringIfChanged")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        const full: string = `${namespace}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      cache.delete(`${namespace}:${key}`);
    });

  jest.spyOn(MetricTypeService, "findOneBy").mockImplementation(async () => {
    return existingRow;
  });

  jest
    .spyOn(MetricTypeService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
      scalarUpdates.push({
        id: input.id,
        data: { ...(input.data as Record<string, unknown>) },
      });
    });

  jest
    .spyOn(MetricTypeService, "attachServices")
    .mockImplementation(
      async (input: {
        metricTypeId: ObjectID;
        serviceIds: Array<ObjectID>;
      }) => {
        attachCalls.push({
          metricTypeId: input.metricTypeId,
          serviceIds: [...input.serviceIds],
        });
      },
    );

  jest
    .spyOn(MetricTypeService, "create")
    .mockImplementation(async (input: { data: MetricType }) => {
      creates.push(input.data);
      return input.data;
    });

  /*
   * The transactional relation-writing path. Nothing on the ingest path may
   * reach it — if this records a call, the multi-round-trip lock hold is back.
   */
  jest
    .spyOn(MetricTypeService, "updateOneById")
    .mockImplementation(async (input: unknown) => {
      saveUpdates.push(input);
      return 1;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the diff converges instead of re-firing every batch", () => {
  /*
   * The headline regression. A metric with no description and no unit — the
   * overwhelmingly common case — used to report a change on every single
   * batch, forever.
   */
  test("a metric with no description or unit writes nothing", async () => {
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming()),
    });

    expect(scalarUpdates).toHaveLength(0);
    expect(attachCalls).toHaveLength(0);
    expect(saveUpdates).toHaveLength(0);
  });

  /*
   * The specific comparison that was wrong: stored `""` against incoming
   * `undefined`. Checked with the fence disabled so it is the DIFF being
   * tested, not the throttle in front of it.
   */
  test("stored empty-string against incoming undefined is not a change", async () => {
    jest.spyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);

    for (let i: number = 0; i < 5; i++) {
      await TelemetryUtil.indexMetricNameServiceNameMap({
        projectId: PROJECT_ID,
        metricNameServiceNameMap: batch(incoming()),
      });
    }

    expect(scalarUpdates).toHaveLength(0);
  });

  test("an unchanged description is not a change", async () => {
    jest.spyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);
    existingRow = storedRow({ description: "Duration", unit: "ms" });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ description: "Duration", unit: "ms" }),
      ),
    });

    expect(scalarUpdates).toHaveLength(0);
  });

  test("a genuinely new description is written", async () => {
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    expect(scalarUpdates).toHaveLength(1);
    expect(scalarUpdates[0]!.data["description"]).toBe("Duration");
  });

  /*
   * Absent means "this producer didn't say", not "clear it" — the same rule
   * the counter-semantics fields have always used. A producer that omits the
   * description must not wipe one another producer supplied, or the two flip-
   * flop the row forever.
   */
  test("an omitted description never clears a stored one", async () => {
    jest.spyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);
    existingRow = storedRow({ description: "Duration", unit: "ms" });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming()),
    });

    expect(scalarUpdates).toHaveLength(0);
  });

  test("counter semantics still converge", async () => {
    jest.spyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);
    existingRow = storedRow({ isMonotonic: true });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ isMonotonic: true })),
    });

    expect(scalarUpdates).toHaveLength(0);
  });

  test("a changed isMonotonic is written", async () => {
    existingRow = storedRow({ isMonotonic: false });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ isMonotonic: true })),
    });

    expect(scalarUpdates[0]!.data["isMonotonic"]).toBe(true);
  });
});

describe("the write never reopens the transactional relation path", () => {
  /*
   * `services` present as a key — even as an empty array — routes
   * DatabaseService to save(). The scalar write must therefore carry only
   * scalar columns.
   */
  test("a scalar-only change takes the single-statement path", async () => {
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    expect(saveUpdates).toHaveLength(0);
    expect(scalarUpdates).toHaveLength(1);
  });

  test("the scalar write carries no `services` key at all", async () => {
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    expect(Object.keys(scalarUpdates[0]!.data)).not.toContain("services");
  });

  test("the scalar write carries only the columns that changed", async () => {
    existingRow = storedRow({ description: "Duration" });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ description: "Duration", unit: "ms" }),
      ),
    });

    expect(Object.keys(scalarUpdates[0]!.data)).toEqual(["unit"]);
  });

  /*
   * The data-loss fix. Associations are added, never replaced — a worker that
   * only knows its own batch's services must not be able to express "and
   * delete every other one".
   */
  test("a new association is added additively", async () => {
    existingRow = storedRow({ services: [serviceRef(SERVICE_A)] });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ services: [serviceRef(SERVICE_B)] }),
      ),
    });

    expect(saveUpdates).toHaveLength(0);
    expect(attachCalls).toHaveLength(1);
    expect(
      attachCalls[0]!.serviceIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SERVICE_B.toString()]);
  });

  test("only the missing associations are sent", async () => {
    existingRow = storedRow({ services: [serviceRef(SERVICE_A)] });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ services: [serviceRef(SERVICE_A), serviceRef(SERVICE_B)] }),
      ),
    });

    expect(
      attachCalls[0]!.serviceIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SERVICE_B.toString()]);
  });

  test("an already-associated service writes nothing", async () => {
    jest.spyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);
    existingRow = storedRow({ services: [serviceRef(SERVICE_A)] });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ services: [serviceRef(SERVICE_A)] }),
      ),
    });

    expect(attachCalls).toHaveLength(0);
    expect(scalarUpdates).toHaveLength(0);
  });
});

describe("the fence keeps the steady state off the database entirely", () => {
  /*
   * Fenced BEFORE the lookup, so a repeat batch costs no SELECT either — the
   * read fan-out was as much of the pool pressure as the write.
   */
  test("a repeated batch does not even read", async () => {
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    const readsAfterFirst: number = (MetricTypeService.findOneBy as jest.Mock)
      .mock.calls.length;

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    expect((MetricTypeService.findOneBy as jest.Mock).mock.calls.length).toBe(
      readsAfterFirst,
    );
  });

  /*
   * The batch's service set must be part of the fence KEY. `servicesInMap`
   * holds only the services in THIS batch, so keying on the metric name alone
   * would let a batch from service A satisfy the fence and suppress the
   * association a concurrent batch from service B still needs.
   */
  test("a different service set is not suppressed by the fence", async () => {
    existingRow = storedRow({ services: [] });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ services: [serviceRef(SERVICE_A)] }),
      ),
    });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({ services: [serviceRef(SERVICE_B)] }),
      ),
    });

    expect(attachCalls).toHaveLength(2);
  });

  test("a changed scalar re-opens the fence within the window", async () => {
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    existingRow = storedRow({ description: "Duration" });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Latency" })),
    });

    expect(scalarUpdates).toHaveLength(2);
    expect(scalarUpdates[1]!.data["description"]).toBe("Latency");
  });

  test("a cache outage fails open so the catalog still converges", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfChanged")
      .mockRejectedValue(new Error("redis down"));

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    expect(scalarUpdates).toHaveLength(1);
  });
});

describe("one bad metric cannot stop the rest of the batch", () => {
  /*
   * The loop used to let any failure escape, and the only caller just logs —
   * so a single unwritable row silently stopped every REMAINING metric name in
   * the batch from being indexed at all.
   */
  test("a failure on one metric still indexes the others", async () => {
    jest
      .spyOn(MetricTypeService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        const data: Record<string, unknown> = input.data as Record<
          string,
          unknown
        >;
        if (data["description"] === "poison") {
          throw new Error("value too long for type character varying(100)");
        }
        scalarUpdates.push({ id: input.id, data: { ...data } });
      });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: {
        "metric.bad": incoming({ description: "poison" }),
        "metric.good": incoming({ description: "fine" }),
      },
    });

    expect(scalarUpdates).toHaveLength(1);
    expect(scalarUpdates[0]!.data["description"]).toBe("fine");
  });

  test("does not throw at the caller", async () => {
    jest
      .spyOn(MetricTypeService, "updateColumnsByIdWithoutHooks")
      .mockRejectedValue(new Error("connection terminated"));

    await expect(
      TelemetryUtil.indexMetricNameServiceNameMap({
        projectId: PROJECT_ID,
        metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
      }),
    ).resolves.toBeUndefined();
  });

  test("re-opens the fence after a failure so the next batch retries", async () => {
    let fail: boolean = true;
    jest
      .spyOn(MetricTypeService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        if (fail) {
          throw new Error("transient");
        }
        scalarUpdates.push({
          id: input.id,
          data: { ...(input.data as Record<string, unknown>) },
        });
      });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    fail = false;

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    expect(scalarUpdates).toHaveLength(1);
  });
});

describe("first contact and the create race", () => {
  test("creates the row when none exists", async () => {
    existingRow = null;

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({
          description: "Duration",
          services: [serviceRef(SERVICE_A)],
        }),
      ),
    });

    expect(creates).toHaveLength(1);
    expect(creates[0]!.name).toBe("http.server.duration");
    expect(creates[0]!.description).toBe("Duration");
    expect(creates[0]!.services).toHaveLength(1);
  });

  /*
   * Uniqueness on (projectId, name) is enforced in application code, not by a
   * database constraint, so two workers can both decide to create the same
   * metric. The loser must reconcile against the winner rather than surfacing
   * a spurious error and abandoning the rest of the batch.
   */
  test("a lost create race reconciles against the winning row", async () => {
    existingRow = null;

    jest
      .spyOn(MetricTypeService, "create")
      .mockRejectedValue(
        new Error("Metric Type with this name already exists"),
      );

    jest
      .spyOn(MetricTypeService, "findOneBy")
      .mockImplementationOnce(async () => {
        return null;
      })
      .mockImplementation(async () => {
        return storedRow({ services: [] });
      });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(
        incoming({
          description: "Duration",
          services: [serviceRef(SERVICE_A)],
        }),
      ),
    });

    expect(scalarUpdates).toHaveLength(1);
    expect(attachCalls).toHaveLength(1);
  });

  test("a create failure with no winner is reported, not swallowed silently", async () => {
    existingRow = null;

    jest
      .spyOn(MetricTypeService, "create")
      .mockRejectedValue(new Error("null value in column violates not-null"));

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: batch(incoming({ description: "Duration" })),
    });

    // Reported via the per-metric catch; the fence is re-opened for a retry.
    expect(cache.size).toBe(0);
  });
});
