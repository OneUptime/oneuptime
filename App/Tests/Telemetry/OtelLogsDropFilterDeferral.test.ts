/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The log record hot loop was restructured so the drop filter evaluates a
 * row that omits ONLY the three ingest-generated stamps (_id, createdAt,
 * retentionDate); those are computed after the keep/drop decision, so a
 * dropped record never pays for ObjectID generation, the ingestion stamp
 * or retention resolution. Everything else — severity, body, attributes,
 * attributeKeys, trace/span/session ids, timings — is present at
 * evaluation time exactly as before.
 *
 * Separately, the per-record attribute map is now assembled with a single
 * ordered Object.assign over (resource attrs, record attrs, once-per-scope
 * prefixed scope attrs), which must preserve the historical collision
 * precedence and key insertion order.
 *
 * These tests drive the REAL OTLP walk (processLogsFromQueue) with all
 * backend touchpoints mocked, and read the rows the loop hands the fan-in
 * submit path.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "logs-deferral-test";

const TIME_MS: number = Date.UTC(2026, 7, 10, 10, 0, 0, 0);
const TIME_NANO: string = `${TIME_MS}000000`;

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

/*
 * The exact field order of a completed log row. The evaluation-row +
 * stamp-spread reconstruction must keep this byte-identical to the
 * pre-restructure one-shot literal.
 */
const EXPECTED_LOG_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "time",
  "timeUnixNano",
  "severityNumber",
  "severityText",
  "attributes",
  "attributeKeys",
  "traceId",
  "spanId",
  "sessionId",
  "body",
  "observedTimeUnixNano",
  "droppedAttributesCount",
  "flags",
  "retentionDate",
];

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function dropFilter(filterQuery: string): LoadedLogDropFilter {
  /*
   * No id on the model on purpose: recordDrop() short-circuits without one,
   * keeping the drop-recorder (and its Redis surface) out of this suite.
   */
  const filter: LogDropFilter = new LogDropFilter();
  filter.action = LogDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

type LogRecordInput = {
  severityNumber?: number;
  body?: string;
  attributes?: Array<OtlpAttribute>;
};

function logsRequest(data: {
  records: Array<LogRecordInput>;
  resourceAttributes?: Array<OtlpAttribute>;
  scope?: JSONObject;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", SERVICE_NAME),
              ...(data.resourceAttributes || []),
            ],
          },
          scopeLogs: [
            {
              scope: data.scope ?? { name: "otel-lib", version: "7.7.7" },
              logRecords: data.records.map((record: LogRecordInput) => {
                return {
                  timeUnixNano: TIME_NANO,
                  severityNumber: record.severityNumber ?? 9,
                  traceId: TRACE_ID_HEX,
                  spanId: SPAN_ID_HEX,
                  body: { stringValue: record.body ?? "hello world" },
                  attributes: record.attributes ?? [],
                };
              }),
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function setupIngestMocks(
  dropFilters: Array<LoadedLogDropFilter>,
): Array<JSONObject> {
  const capturedRows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest
    .spyOn(service, "submitLogsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      // Drain like the real fan-in submit path (it splices the shared buffer).
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      capturedRows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.splice(0, rows.length);
      return Promise.resolve();
    });

  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue(dropFilters);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);

  return capturedRows;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("log row golden equivalence (kept rows)", () => {
  test("a kept row carries the historical field order, stamps, values and ids", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([]);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          {
            severityNumber: 17,
            body: "hello world",
            attributes: [stringAttribute("custom.key", "custom-value")],
          },
        ],
        resourceAttributes: [stringAttribute("session.id", "sess-1")],
      }),
    );

    expect(rows).toHaveLength(1);
    const row: JSONObject = rows[0]!;

    expect(Object.keys(row)).toEqual(EXPECTED_LOG_ROW_KEY_ORDER);

    // Generated stamps: shape only, they are ingest-time values.
    expect(typeof row["_id"]).toBe("string");
    expect((row["_id"] as string).length).toBeGreaterThan(0);
    expect(typeof row["createdAt"]).toBe("string");
    expect(typeof row["retentionDate"]).toBe("string");

    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
    expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(row["entityKeys"]).toEqual([]);
    expect(row["serviceEntityKey"]).toBe("");

    expect(row["time"]).toBe(
      OneUptimeDate.toClickhouseDateTime64(
        OneUptimeDate.fromUnixNano(Number(TIME_NANO)),
        Number(TIME_NANO),
      ),
    );
    expect(row["timeUnixNano"]).toBe(TIME_NANO);
    expect(row["severityNumber"]).toBe(17);
    expect(row["severityText"]).toBe(LogSeverity.Error);
    expect(row["traceId"]).toBe(TRACE_ID_HEX);
    expect(row["spanId"]).toBe(SPAN_ID_HEX);
    // Resource-level session.id arrives prefixed and still resolves.
    expect(row["sessionId"]).toBe("sess-1");
    expect(row["body"]).toBe("hello world");
    expect(row["observedTimeUnixNano"]).toBe("0");
    expect(row["droppedAttributesCount"]).toBe(0);
    expect(row["flags"]).toBe(0);

    const attributes: JSONObject = row["attributes"] as JSONObject;
    expect(attributes["custom.key"]).toBe("custom-value");
    expect(attributes["resource.service.name"]).toBe(SERVICE_NAME);
    expect(attributes["oneuptime.service.id"]).toBe(SERVICE_ID.toString());
  });

  test("attribute precedence: resource < record attributes < scope.*, with unchanged key order", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([]);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          {
            attributes: [
              stringAttribute("resource.collide", "from-record"),
              stringAttribute("scope.name", "record-tries-to-be-scope"),
            ],
          },
        ],
        resourceAttributes: [stringAttribute("collide", "from-resource")],
        scope: { name: "otel-lib", version: "7.7.7" },
      }),
    );

    expect(rows).toHaveLength(1);
    const attributes: JSONObject = rows[0]!["attributes"] as JSONObject;

    // Record attribute beats the (prefixed) resource attribute on collision.
    expect(attributes["resource.collide"]).toBe("from-record");
    // The scope envelope beats a record attribute that spoofs its key.
    expect(attributes["scope.name"]).toBe("otel-lib");
    expect(attributes["scope.version"]).toBe("7.7.7");

    /*
     * attributeKeys for logs is deliberately UNSORTED (PR #3113): it must
     * be exactly the map's own key order — resource keys first, then new
     * record keys, then new scope keys.
     */
    expect(rows[0]!["attributeKeys"]).toEqual(Object.keys(attributes));
    const keys: Array<string> = rows[0]!["attributeKeys"] as Array<string>;
    expect(keys.indexOf("resource.collide")).toBeLessThan(
      keys.indexOf("scope.version"),
    );
  });

  test("records in one scope own independent attribute maps", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([]);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          { attributes: [stringAttribute("record.index", "one")] },
          { attributes: [stringAttribute("record.index", "two")] },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    const first: JSONObject = rows[0]!;
    const second: JSONObject = rows[1]!;

    expect(first["attributes"]).not.toBe(second["attributes"]);
    expect(first["attributeKeys"]).not.toBe(second["attributeKeys"]);

    (first["attributes"] as JSONObject)["mutated.key"] = "mutated";
    expect((second["attributes"] as JSONObject)["mutated.key"]).toBeUndefined();

    expect((first["attributes"] as JSONObject)["record.index"]).toBe("one");
    expect((second["attributes"] as JSONObject)["record.index"]).toBe("two");
    // Both still share the scope stamp the once-per-scope hoist provides.
    expect((first["attributes"] as JSONObject)["scope.name"]).toBe("otel-lib");
    expect((second["attributes"] as JSONObject)["scope.name"]).toBe("otel-lib");
  });
});

describe("drop filter behavior on the evaluation row", () => {
  test("a severity drop filter still drops matching records", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("severityText = 'Error'"),
    ]);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          { severityNumber: 17, body: "error record" },
          { severityNumber: 9, body: "info record" },
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!["body"]).toBe("info record");
  });

  test("filters on sessionId and attributes see their values at evaluation time", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("sessionId = 'sess-drop'"),
      dropFilter("custom.key = 'drop-me'"),
    ]);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          {
            body: "dropped by attribute filter",
            attributes: [stringAttribute("custom.key", "drop-me")],
          },
          { body: "kept" },
        ],
        resourceAttributes: [stringAttribute("session.id", "sess-keep")],
      }),
    );

    // The attribute filter dropped record one; the session filter matched none.
    expect(rows).toHaveLength(1);
    expect(rows[0]!["body"]).toBe("kept");
    expect(rows[0]!["sessionId"]).toBe("sess-keep");
  });

  test("a session drop filter drops via the resource-level session.id", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("sessionId = 'sess-drop'"),
    ]);

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [{ body: "session record" }],
        resourceAttributes: [stringAttribute("session.id", "sess-drop")],
      }),
    );

    expect(rows).toHaveLength(0);
  });
});

describe("deferral proof: dropped records skip the ingest-generated stamps", () => {
  test("a dropped record generates no id; the kept sibling still gets one", async () => {
    setupIngestMocks([dropFilter("severityText = 'Error'")]);

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          { severityNumber: 17, body: "error one" },
          { severityNumber: 21, body: "fatal two" },
        ],
      }),
    );

    /*
     * Severity 17 maps to Error and is dropped; severity 21 maps to Fatal,
     * does not match the filter, and is kept. Exactly ONE id generated —
     * zero for the dropped record (the deferral contract) and one for the
     * kept row (generation still happens post-filter).
     */
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  test("every record dropped means zero id generations", async () => {
    setupIngestMocks([dropFilter("body LIKE 'noisy%'")]);

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [
          { body: "noisy healthcheck 1" },
          { body: "noisy healthcheck 2" },
          { body: "noisy healthcheck 3" },
        ],
      }),
    );

    expect(generateSpy).not.toHaveBeenCalled();
  });

  test("without filters, exactly one id per record is generated", async () => {
    setupIngestMocks([]);

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelLogsIngestService.processLogsFromQueue(
      logsRequest({
        records: [{ body: "one" }, { body: "two" }],
      }),
    );

    expect(generateSpy).toHaveBeenCalledTimes(2);
  });
});
