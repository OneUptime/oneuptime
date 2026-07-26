import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import MetricTypeService from "../../../../Server/Services/MetricTypeService";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import ObjectID from "../../../../Types/ObjectID";
import Dictionary from "../../../../Types/Dictionary";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * indexMetricNameServiceNameMap keeps the MetricType catalog in sync with what
 * ingest just saw. It runs once per OTLP batch — 100-500 distinct metric names
 * for a kubelet scrape — so it must do as little Postgres work as possible:
 *
 *  - one batched SELECT for the whole batch, not one joined SELECT per name;
 *  - no SELECT at all once a shape has been confirmed (fingerprint cache);
 *  - no UPDATE unless something genuinely changed.
 *
 * The last one is a regression guard. description/unit are persisted as
 * `|| ""` but OTLP omits protobuf defaults, so an unset description arrives as
 * undefined. Comparing the raw values made `"" !== undefined` true forever, so
 * every metric without a description or unit was rewritten on every batch.
 *
 * Each test uses a fresh projectId so the per-process fingerprint cache in
 * MetricTypeService cannot leak state between cases.
 */

const METRIC_NAME: string = "http.server.duration";

type MetricTypeFields = {
  description: string | undefined;
  unit: string | undefined;
};

type FindByMock = () => Promise<Array<MetricType>>;
type UpdateOneByIdMock = () => Promise<number>;
type CreateMock = () => Promise<MetricType>;

type MockedCalls = {
  findBy: FindByMock;
  updateOneById: UpdateOneByIdMock;
  create: CreateMock;
};

/*
 * The model declares description/unit as optional, and the project compiles
 * with exactOptionalPropertyTypes, so an explicit `undefined` cannot be
 * assigned through the model type. Writing through this shape is the point of
 * the test — an absent OTLP field really does arrive as undefined.
 */
type WritableMetricTypeFields = {
  description: string | undefined;
  unit: string | undefined;
};

function buildMetricType(
  fields: MetricTypeFields,
  name: string = METRIC_NAME,
): MetricType {
  const metricType: MetricType = new MetricType();
  metricType.name = name;
  metricType.services = [];

  const writable: WritableMetricTypeFields =
    metricType as unknown as WritableMetricTypeFields;
  writable.description = fields.description;
  writable.unit = fields.unit;

  return metricType;
}

/**
 * Mocks the service so `stored` is what Postgres already holds. Pass an empty
 * array to model a metric name that does not exist yet.
 */
function mockStored(stored: Array<MetricType>): MockedCalls {
  const findBy: FindByMock = jest.fn(async (): Promise<Array<MetricType>> => {
    return stored;
  });
  const updateOneById: UpdateOneByIdMock = jest.fn(
    async (): Promise<number> => {
      return 1;
    },
  );
  const create: CreateMock = jest.fn(async (): Promise<MetricType> => {
    return stored[0] || new MetricType();
  });

  jest.spyOn(MetricTypeService, "findBy").mockImplementation(findBy as never);
  jest
    .spyOn(MetricTypeService, "updateOneById")
    .mockImplementation(updateOneById as never);
  jest.spyOn(MetricTypeService, "create").mockImplementation(create as never);

  return { findBy, updateOneById, create };
}

function storedRow(fields: MetricTypeFields, name?: string): MetricType {
  const row: MetricType = buildMetricType(fields, name);
  row.id = ObjectID.generate();
  return row;
}

function incoming(fields: MetricTypeFields): Dictionary<MetricType> {
  return { [METRIC_NAME]: buildMetricType(fields) };
}

describe("TelemetryUtil.indexMetricNameServiceNameMap", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does not write when a stored empty description/unit meets an omitted OTLP field", async () => {
    // What ingest stores for a metric with no description or unit.
    const calls: MockedCalls = mockStored([
      storedRow({ description: "", unit: "" }),
    ]);

    // What OTLP JSON delivers: the fields are simply absent.
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: incoming({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.updateOneById).not.toHaveBeenCalled();
    expect(calls.create).not.toHaveBeenCalled();
  });

  test("does not write when a stored null description/unit meets an omitted OTLP field", async () => {
    // Both columns are nullable, so legacy rows can hold null rather than "".
    const calls: MockedCalls = mockStored([
      storedRow({ description: undefined, unit: undefined }),
    ]);

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: incoming({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.updateOneById).not.toHaveBeenCalled();
  });

  test("still writes when the description genuinely changes", async () => {
    const calls: MockedCalls = mockStored([
      storedRow({ description: "", unit: "ms" }),
    ]);

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: incoming({
        description: "Duration of inbound HTTP requests",
        unit: "ms",
      }),
    });

    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("still writes when the unit genuinely changes", async () => {
    const calls: MockedCalls = mockStored([
      storedRow({ description: "", unit: "ms" }),
    ]);

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: incoming({ description: "", unit: "s" }),
    });

    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("still writes when a previously set description is cleared", async () => {
    /*
     * Stored "ms" meeting an omitted unit is a real divergence, not the
     * "" vs undefined false positive — the normalized forms differ.
     */
    const calls: MockedCalls = mockStored([
      storedRow({
        description: "Duration of inbound HTTP requests",
        unit: "ms",
      }),
    ]);

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: incoming({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("creates the metric type when it does not exist yet", async () => {
    const calls: MockedCalls = mockStored([]);

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: incoming({ description: "d", unit: "ms" }),
    });

    expect(calls.create).toHaveBeenCalledTimes(1);
    expect(calls.updateOneById).not.toHaveBeenCalled();
  });

  test("issues one batched SELECT for a whole batch, not one per metric name", async () => {
    const names: Array<string> = ["metric.a", "metric.b", "metric.c"];

    const calls: MockedCalls = mockStored(
      names.map((name: string) => {
        return storedRow({ description: "", unit: "" }, name);
      }),
    );

    const map: Dictionary<MetricType> = {};
    for (const name of names) {
      map[name] = buildMetricType(
        { description: undefined, unit: undefined },
        name,
      );
    }

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: ObjectID.generate(),
      metricNameServiceNameMap: map,
    });

    expect(calls.findBy).toHaveBeenCalledTimes(1);
    expect(calls.updateOneById).not.toHaveBeenCalled();
  });

  test("a repeat batch with an unchanged shape does zero Postgres work", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const calls: MockedCalls = mockStored([
      storedRow({ description: "", unit: "" }),
    ]);

    const batch: Dictionary<MetricType> = incoming({
      description: undefined,
      unit: undefined,
    });

    // First batch: one SELECT to confirm the shape.
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: batch,
    });
    expect(calls.findBy).toHaveBeenCalledTimes(1);

    // Second identical batch: served entirely from the fingerprint cache.
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: incoming({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.findBy).toHaveBeenCalledTimes(1);
    expect(calls.updateOneById).not.toHaveBeenCalled();
    expect(calls.create).not.toHaveBeenCalled();
  });

  test("a changed shape re-reads even after the previous shape was cached", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const calls: MockedCalls = mockStored([
      storedRow({ description: "", unit: "" }),
    ]);

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: incoming({
        description: undefined,
        unit: undefined,
      }),
    });
    expect(calls.findBy).toHaveBeenCalledTimes(1);

    // A new description is a different fingerprint, so the cache must miss.
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: incoming({
        description: "now documented",
        unit: undefined,
      }),
    });

    expect(calls.findBy).toHaveBeenCalledTimes(2);
    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });
});
