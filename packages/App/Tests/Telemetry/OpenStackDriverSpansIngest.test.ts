import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import OpenStackTraceEntityKeyResolver from "../../FeatureSet/Telemetry/Services/OpenStackTraceEntityKeys";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { OSPROFILER_DRIVER_SCOPE_NAME } from "Common/Utils/OpenStack/OpenStackTraces";
import { keyForOpenStackResource } from "Common/Utils/Telemetry/EntityKey";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Spans from OSProfiler's driver, end to end through the real OTLP walk and row builders, to
 * the rows ClickHouse would be handed. What these prove is what a unit test of the reader
 * cannot: that each thing it decides reaches the stored row, before the drop filters and
 * scrub rules read it, and that nobody else's spans are touched.
 *
 * The bodies here are written by hand from the driver's source, to pin one rule at a time.
 * OpenStackDriverSpansRecordings.test.ts runs what the driver really sent through the same
 * walk.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const CLOUD: string = "prod-east";
const TRACE_ID: string = "4e3e0ec6293840b1850409eb1d4b0dee";
const INSTANCE: string = "5f2a3a1c-7c11-4a55-9b1e-0a7a7d3f9c11";
const CLOUD_KEY: string = "the-cloud-key";

type OtlpAttribute = { key: string; value: JSONObject };

function text(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function driverSpan(values: JSONObject): JSONObject {
  const now: string = `${Date.now()}000000`;

  return {
    traceId: TRACE_ID,
    spanId: "1c089ea828fe4f3d",
    parentSpanId: "2d19afb939ff5e4e",
    kind: 1,
    startTimeUnixNano: now,
    endTimeUnixNano: now,
    status: {},
    ...values,
  };
}

function body(data: {
  scope?: string;
  serviceName?: string;
  cloud?: string | null;
  spans: Array<JSONObject>;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              text("service.name", data.serviceName || "nova-nova-compute"),
              ...(data.cloud === null
                ? []
                : [text("openstack.cloud.name", data.cloud || CLOUD)]),
            ],
          },
          scopeSpans: [
            {
              scope: { name: data.scope || OSPROFILER_DRIVER_SCOPE_NAME },
              spans: data.spans,
            },
          ],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

describe("spans from OSProfiler's driver, through the real ingest", () => {
  let insert: jest.SpiedFunction<typeof SpanService.insertJsonRows>;
  let resourceAttributes: Array<JSONArray>;

  beforeAll(() => {
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    resourceAttributes = [];

    const service: Record<string, any> =
      OtelTracesIngestService as unknown as Record<string, any>;

    for (const method of [
      "autoDiscoverKubernetesCluster",
      "autoDiscoverDockerHost",
      "autoDiscoverPodmanHost",
      "autoDiscoverHost",
      "autoDiscoverServerless",
      "autoDiscoverCloudResource",
      "autoDiscoverRum",
    ]) {
      jest.spyOn(service, method).mockResolvedValue(null as never);
    }

    /*
     * What the Service row and the entity keys are read from: the attributes as they stand
     * when this is called, which is why they are copied here.
     */
    jest.spyOn(service, "resolveTelemetryResource").mockImplementation(((data: {
      attributes: JSONArray;
    }) => {
      resourceAttributes.push(JSON.parse(JSON.stringify(data.attributes)));

      return Promise.resolve({
        serviceName: "the-service",
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        entityKeys: [CLOUD_KEY],
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      });
    }) as never);

    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      .mockResolvedValue([] as never);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      .mockResolvedValue([] as never);
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockResolvedValue(undefined as never);

    insert = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined as never);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  async function rowsOf(request: TelemetryRequest): Promise<Array<JSONObject>> {
    await OtelTracesIngestService.processTracesFromQueue(request);
    await TelemetryFanInWriter.flushAll();

    const rows: Array<JSONObject> = [];

    for (const call of insert.mock.calls) {
      rows.push(...(call[0] as Array<JSONObject>));
    }

    return rows;
  }

  async function onlyRow(request: TelemetryRequest): Promise<JSONObject> {
    const rows: Array<JSONObject> = await rowsOf(request);

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  function serviceNameSeen(): string {
    const attribute: JSONObject | undefined = (
      resourceAttributes[0] as Array<JSONObject>
    ).find((candidate: JSONObject): boolean => {
      return candidate["key"] === "service.name";
    });

    return (attribute?.["value"] as JSONObject)["stringValue"] as string;
  }

  test("the Service row is named for the service an operator knows, under its cloud", async () => {
    await rowsOf(body({ spans: [driverSpan({ name: "rpc" })] }));

    expect(serviceNameSeen()).toBe(`${CLOUD}/nova-compute`);
  });

  test("the row says the service, in the words logs use", async () => {
    const row: JSONObject = await onlyRow(
      body({ spans: [driverSpan({ name: "rpc" })] }),
    );
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(attributes["openstack.service"]).toBe("nova-compute");
    expect(attributes["openstack.component"]).toBe("nova");
    expect(attributes["resource.osprofiler.service.name"]).toBe(
      "nova-nova-compute",
    );
  });

  test("what a call was handed is not in the row, or in what it was asked for", async () => {
    const row: JSONObject = await onlyRow(
      body({
        spans: [
          driverSpan({
            name: "rpc",
            attributes: [
              text("name", "nova.compute.manager.ComputeManager.build"),
              text("args", "(<ComputeManager>,)"),
              text("kwargs", "{'admin_password': 'hunter2'}"),
              text("db.params", '{"password": "hunter2"}'),
              text("something_new", "hunter2"),
            ],
          }),
        ],
      }),
    );

    expect(JSON.stringify(row)).not.toContain("hunter2");
    expect(row["attributeKeys"]).not.toContain("kwargs");
    expect(row["attributeKeys"]).not.toContain("args");
    expect(row["attributeKeys"]).not.toContain("db.params");
    expect(row["attributeKeys"]).not.toContain("something_new");
    expect(row["attributeKeys"]).toContain("name");
  });

  test("a call's name is what a waterfall wants, and its id is out of it", async () => {
    const row: JSONObject = await onlyRow(
      body({
        spans: [
          driverSpan({
            name: `WSGI_GET_/compute/v2.1/servers/${INSTANCE}`,
            kind: 2,
            attributes: [
              text("http.method", "GET"),
              text("http.path", `/compute/v2.1/servers/${INSTANCE}`),
            ],
          }),
        ],
      }),
    );

    expect(row["name"]).toBe("GET /compute/v2.1/servers/{id}");
    expect(row["kind"]).toBe("SPAN_KIND_SERVER");
    expect(row["isEntrySpan"]).toBe(true);
    expect((row["attributes"] as JSONObject)["http.path"]).toBe(
      `/compute/v2.1/servers/${INSTANCE}`,
    );
  });

  test("the side of an RPC call that answers is an entry, so a service map can draw it", async () => {
    const row: JSONObject = await onlyRow(
      body({
        spans: [
          driverSpan({
            name: "rpc",
            attributes: [
              text(
                "name",
                "nova.conductor.manager.ComputeTaskManager.schedule_and_build_instances",
              ),
            ],
          }),
        ],
      }),
    );

    expect(row["kind"]).toBe("SPAN_KIND_CONSUMER");
    expect(row["isEntrySpan"]).toBe(true);
  });

  test("a first span with the parent 4.3.0 gave it is a root", async () => {
    const row: JSONObject = await onlyRow(
      body({
        spans: [
          driverSpan({
            name: "WSGI_GET_/v2.1/servers",
            parentSpanId: TRACE_ID.slice(16),
          }),
        ],
      }),
    );

    expect(row["parentSpanId"]).toBe("");
    expect(row["isRootSpan"]).toBe(true);
  });

  test("a first span with no parent, as 4.4.0 sends it, is a root", async () => {
    const row: JSONObject = await onlyRow(
      body({
        spans: [driverSpan({ name: "WSGI_GET_/v2.1/servers", parentSpanId: "" })],
      }),
    );

    expect(row["isRootSpan"]).toBe(true);
  });

  test("any other parent stands", async () => {
    const row: JSONObject = await onlyRow(
      body({ spans: [driverSpan({ name: "rpc" })] }),
    );

    expect(row["parentSpanId"]).toBe("2d19afb939ff5e4e");
    expect(row["isRootSpan"]).toBe(false);
  });

  test("a failure the driver wrote as an attribute and an event is a failed span", async () => {
    const row: JSONObject = await onlyRow(
      body({
        spans: [
          driverSpan({
            name: "rpc",
            attributes: [{ key: "error", value: { boolValue: true } }],
            events: [
              {
                name: "log",
                timeUnixNano: `${Date.now()}000000`,
                attributes: [
                  text("error.kind", "nova.exception.NoValidHost"),
                  text("message", "No valid host was found. password=hunter2"),
                ],
              },
            ],
          }),
        ],
      }),
    );

    expect(row["statusCode"]).toBe(SpanStatus.Error);
    expect(row["statusMessage"]).toContain("nova.exception.NoValidHost");
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });

  test("a span that named an instance belongs to it, on its own row", async () => {
    const rows: Array<JSONObject> = await rowsOf(
      body({
        spans: [
          driverSpan({
            name: `WSGI_PUT_/placement/allocations/${INSTANCE}`,
            kind: 2,
            spanId: "aaaaaaaaaaaaaaaa",
            attributes: [
              text("http.method", "PUT"),
              text("http.path", `/placement/allocations/${INSTANCE}`),
            ],
          }),
          driverSpan({ name: "rpc", spanId: "bbbbbbbbbbbbbbbb" }),
        ],
      }),
    );
    const key: string = keyForOpenStackResource(PROJECT_ID.toString(), {
      cloudName: CLOUD,
      kind: OpenStackResourceKind.Instance,
      id: INSTANCE,
    });
    const named: JSONObject = rows.find((row: JSONObject): boolean => {
      return row["spanId"] === "aaaaaaaaaaaaaaaa";
    })!;
    const other: JSONObject = rows.find((row: JSONObject): boolean => {
      return row["spanId"] === "bbbbbbbbbbbbbbbb";
    })!;

    expect(named["entityKeys"]).toEqual([CLOUD_KEY, key]);
    expect((named["attributes"] as JSONObject)["openstack.instance_id"]).toBe(
      INSTANCE,
    );
    // The array is shared with its siblings, so its key must not reach them.
    expect(other["entityKeys"]).toEqual([CLOUD_KEY]);
  });

  test("a machine whose collector stamps no cloud is named, and joins to nothing", async () => {
    const row: JSONObject = await onlyRow(
      body({
        cloud: null,
        spans: [
          driverSpan({
            name: `WSGI_GET_/v2.1/servers/${INSTANCE}`,
            attributes: [
              text("http.method", "GET"),
              text("http.path", `/v2.1/servers/${INSTANCE}`),
            ],
          }),
        ],
      }),
    );

    expect(serviceNameSeen()).toBe("nova-compute");
    expect(row["entityKeys"]).toEqual([CLOUD_KEY]);
  });

  test("anyone else's spans are exactly as they would have been", async () => {
    const row: JSONObject = await onlyRow(
      body({
        scope: "my.instrumentation",
        serviceName: "nova-nova-compute",
        spans: [
          driverSpan({
            name: `WSGI_GET_/v2.1/servers/${INSTANCE}`,
            parentSpanId: TRACE_ID.slice(16),
            attributes: [
              text("kwargs", "mine to keep"),
              { key: "error", value: { boolValue: true } },
              text("http.path", `/v2.1/servers/${INSTANCE}`),
            ],
          }),
        ],
      }),
    );

    expect(serviceNameSeen()).toBe("nova-nova-compute");
    expect(row["name"]).toBe(`WSGI_GET_/v2.1/servers/${INSTANCE}`);
    expect(row["kind"]).toBe("SPAN_KIND_INTERNAL");
    expect(row["parentSpanId"]).toBe(TRACE_ID.slice(16));
    expect(row["isRootSpan"]).toBe(false);
    expect(row["statusCode"]).toBe(SpanStatus.Unset);
    expect((row["attributes"] as JSONObject)["kwargs"]).toBe("mine to keep");
    expect(
      (row["attributes"] as JSONObject)["openstack.instance_id"],
    ).toBeUndefined();
    expect(row["entityKeys"]).toEqual([CLOUD_KEY]);
  });
});

describe("the entity keys of one row", () => {
  const resolver: OpenStackTraceEntityKeyResolver =
    new OpenStackTraceEntityKeyResolver(PROJECT_ID);

  test("a row with nothing to join costs nothing, and is left alone", () => {
    const shared: Array<string> = [CLOUD_KEY];
    const row: JSONObject = {
      entityKeys: shared,
      attributes: { "resource.openstack.cloud.name": CLOUD },
    };

    expect(resolver.appendToSpanRow(row)).toBe(0);
    expect(row["entityKeys"]).toBe(shared);
  });

  test("it never changes the array a row shares with its siblings", () => {
    const shared: Array<string> = [CLOUD_KEY];
    const row: JSONObject = {
      entityKeys: shared,
      attributes: {
        "resource.openstack.cloud.name": CLOUD,
        "openstack.instance_id": INSTANCE,
      },
    };

    expect(resolver.appendToSpanRow(row)).toBe(1);
    expect(shared).toEqual([CLOUD_KEY]);
    expect(row["entityKeys"]).not.toBe(shared);
    expect(row["entityKeys"]).toHaveLength(2);
  });

  test("the same part twice is one key", () => {
    const row: JSONObject = {
      entityKeys: [
        keyForOpenStackResource(PROJECT_ID.toString(), {
          cloudName: CLOUD,
          kind: OpenStackResourceKind.Instance,
          id: INSTANCE,
        }),
      ],
      attributes: {
        "resource.openstack.cloud.name": CLOUD,
        "openstack.instance_id": INSTANCE,
      },
    };

    expect(resolver.appendToSpanRow(row)).toBe(0);
  });

  test("two clouds' parts of the same id are two keys", () => {
    expect(
      keyForOpenStackResource(PROJECT_ID.toString(), {
        cloudName: "east",
        kind: OpenStackResourceKind.Instance,
        id: INSTANCE,
      }),
    ).not.toBe(
      keyForOpenStackResource(PROJECT_ID.toString(), {
        cloudName: "west",
        kind: OpenStackResourceKind.Instance,
        id: INSTANCE,
      }),
    );
  });

  test("a scrub rule that took the cloud out leaves no identity", () => {
    expect(
      resolver.appendToSpanRow({
        attributes: { "openstack.instance_id": INSTANCE },
      }),
    ).toBe(0);
  });
});
