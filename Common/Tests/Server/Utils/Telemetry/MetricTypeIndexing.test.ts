import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import MetricTypeService from "../../../../Server/Services/MetricTypeService";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import ObjectID from "../../../../Types/ObjectID";
import Dictionary from "../../../../Types/Dictionary";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * indexMetricNameServiceNameMap keeps the MetricType catalog in sync with what
 * ingest just saw. It must only write when something actually changed —
 * updateOneById is expensive (a _findBy SELECT plus save()'s own load SELECT),
 * and this runs once per distinct metric name on every OTLP batch.
 *
 * Regression guard: description/unit are persisted as `|| ""` but OTLP omits
 * protobuf defaults, so an unset description arrives as undefined. Comparing
 * the raw values made `"" !== undefined` true forever, so every metric without
 * a description or unit was treated as changed on every single batch.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const METRIC_TYPE_ID: ObjectID = ObjectID.generate();

type StoredMetricTypeFields = {
  description: string | undefined;
  unit: string | undefined;
};

type UpdateOneByIdMock = () => Promise<number>;
type CreateMock = () => Promise<MetricType>;

type MockedCalls = {
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

function buildMetricType(fields: StoredMetricTypeFields): MetricType {
  const metricType: MetricType = new MetricType();
  metricType.name = "http.server.duration";
  metricType.services = [];

  const writable: WritableMetricTypeFields =
    metricType as unknown as WritableMetricTypeFields;
  writable.description = fields.description;
  writable.unit = fields.unit;

  return metricType;
}

function mockStoredMetricType(stored: StoredMetricTypeFields): MockedCalls {
  const existing: MetricType = buildMetricType(stored);
  existing.id = METRIC_TYPE_ID;

  jest
    .spyOn(MetricTypeService, "findOneBy")
    .mockImplementation(async (): Promise<MetricType | null> => {
      return existing;
    });

  const updateOneById: UpdateOneByIdMock = jest.fn(
    async (): Promise<number> => {
      return 1;
    },
  );
  const create: CreateMock = jest.fn(async (): Promise<MetricType> => {
    return existing;
  });

  jest
    .spyOn(MetricTypeService, "updateOneById")
    .mockImplementation(updateOneById as never);
  jest.spyOn(MetricTypeService, "create").mockImplementation(create as never);

  return { updateOneById, create };
}

function incomingMetricType(
  fields: StoredMetricTypeFields,
): Dictionary<MetricType> {
  return { "http.server.duration": buildMetricType(fields) };
}

describe("TelemetryUtil.indexMetricNameServiceNameMap", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does not write when a stored empty description/unit meets an omitted OTLP field", async () => {
    // What ingest actually stores for a metric with no description or unit.
    const calls: MockedCalls = mockStoredMetricType({
      description: "",
      unit: "",
    });

    // What OTLP JSON delivers: the fields are simply absent.
    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: incomingMetricType({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.updateOneById).not.toHaveBeenCalled();
    expect(calls.create).not.toHaveBeenCalled();
  });

  test("does not write when a stored null description/unit meets an omitted OTLP field", async () => {
    // Both columns are nullable, so legacy rows can hold null rather than "".
    const calls: MockedCalls = mockStoredMetricType({
      description: undefined,
      unit: undefined,
    });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: incomingMetricType({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.updateOneById).not.toHaveBeenCalled();
  });

  test("still writes when the description genuinely changes", async () => {
    const calls: MockedCalls = mockStoredMetricType({
      description: "",
      unit: "ms",
    });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: incomingMetricType({
        description: "Duration of inbound HTTP requests",
        unit: "ms",
      }),
    });

    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("still writes when the unit genuinely changes", async () => {
    const calls: MockedCalls = mockStoredMetricType({
      description: "",
      unit: "ms",
    });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: incomingMetricType({
        description: "",
        unit: "s",
      }),
    });

    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("still writes when a previously set description is cleared", async () => {
    /*
     * Stored "ms" meeting an omitted unit is a real divergence, not the
     * "" vs undefined false positive — the normalized forms differ.
     */
    const calls: MockedCalls = mockStoredMetricType({
      description: "Duration of inbound HTTP requests",
      unit: "ms",
    });

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: PROJECT_ID,
      metricNameServiceNameMap: incomingMetricType({
        description: undefined,
        unit: undefined,
      }),
    });

    expect(calls.updateOneById).toHaveBeenCalledTimes(1);
  });
});
