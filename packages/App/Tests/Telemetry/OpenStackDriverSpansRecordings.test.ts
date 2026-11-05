import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  OpenStackTraceRecording,
  RecordedSpan,
  getRecordedTraceReleases,
  traceIdOfPrinted,
} from "Common/Tests/Helpers/OpenStackTraceRecordings";
import {
  OSLO_MESSAGING_SCOPE_NAME,
  OSLO_MIDDLEWARE_SCOPE_NAME,
  OSPROFILER_DRIVER_SCOPE_NAME,
} from "Common/Utils/OpenStack/OpenStackTraces";
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
 * What the agent's traces profile would have sent for a real signed boot, through the real OTLP
 * walk and row builders, to the rows ClickHouse would be handed. This is the "done when" as far
 * as it can be held without a running OneUptime: one trace, named by OpenStack service, tied to
 * the instance it made.
 *
 * Tests/Ops/openstack-e2e/traces-record.sh records what the agent's real collector config would
 * have sent. Nothing has gone from a cloud to a running OneUptime this way yet.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD: string = "devstack";
const CLOUD_KEY: string = "the-cloud-key";

// One id per name, as the Service table would give them.
const SERVICE_IDS: Map<string, ObjectID> = new Map<string, ObjectID>();

function serviceIdOf(name: string): ObjectID {
  let id: ObjectID | undefined = SERVICE_IDS.get(name);

  if (!id) {
    id = ObjectID.generate();
    SERVICE_IDS.set(name, id);
  }

  return id;
}

function nameOfServiceId(id: string): string {
  for (const [name, known] of SERVICE_IDS) {
    if (known.toString() === id) {
      return name;
    }
  }

  return "";
}

/*
 * A recording is from the day it was made, and ingest keeps what is recent. The gaps between
 * spans are what matter, so they are kept and the whole is moved up to now.
 */
function movedToNow(otlp: JSONObject): JSONObject {
  const now: bigint = BigInt(Date.now()) * BigInt(1000000);
  let newest: bigint = BigInt(0);

  const spansOf: () => Array<JSONObject> = (): Array<JSONObject> => {
    const spans: Array<JSONObject> = [];

    for (const block of otlp["resourceSpans"] as Array<JSONObject>) {
      for (const scope of block["scopeSpans"] as Array<JSONObject>) {
        spans.push(...(scope["spans"] as Array<JSONObject>));
      }
    }

    return spans;
  };

  for (const span of spansOf()) {
    const end: bigint = BigInt(span["endTimeUnixNano"] as string);
    newest = end > newest ? end : newest;
  }

  const shift: bigint = now - newest;

  for (const span of spansOf()) {
    span["startTimeUnixNano"] = (
      BigInt(span["startTimeUnixNano"] as string) + shift
    ).toString();
    span["endTimeUnixNano"] = (
      BigInt(span["endTimeUnixNano"] as string) + shift
    ).toString();
  }

  return otlp;
}

describe.each(getRecordedTraceReleases())(
  "a real signed boot on %s, through the real ingest",
  (release: string) => {
    const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
      release,
    );
    let insert: jest.SpiedFunction<typeof SpanService.insertJsonRows>;

    beforeAll(() => {
      TelemetryFanInWriter.configure({
        maxWaitMs: 10,
        maxBatchRows: 500,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 5,
      });
    });

    beforeEach(() => {
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

      jest
        .spyOn(service, "resolveTelemetryResource")
        .mockImplementation(((data: { attributes: JSONArray }) => {
          const name: unknown = (data.attributes as Array<JSONObject>)
            .filter((attribute: JSONObject): boolean => {
              return attribute["key"] === "service.name";
            })
            .map((attribute: JSONObject): unknown => {
              return (attribute["value"] as JSONObject)["stringValue"];
            })[0];

          return Promise.resolve({
            serviceName: name,
            primaryEntityId: serviceIdOf(name as string),
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
        .mockResolvedValue(undefined as never) as unknown as jest.SpiedFunction<
        typeof SpanService.insertJsonRows
      >;
    });

    afterEach(async () => {
      await TelemetryFanInWriter.flushAll();
      jest.restoreAllMocks();
    });

    async function rowsOfBoot(): Promise<Array<JSONObject>> {
      await OtelTracesIngestService.processTracesFromQueue({
        projectId: PROJECT_ID,
        headers: {},
        body: movedToNow(recording.otlp("signed-boot", "agent")),
      } as unknown as TelemetryRequest);
      await TelemetryFanInWriter.flushAll();

      const rows: Array<JSONObject> = [];

      for (const call of insert.mock.calls) {
        rows.push(...(call[0] as Array<JSONObject>));
      }

      return rows;
    }

    function attributesOf(row: JSONObject): JSONObject {
      return row["attributes"] as JSONObject;
    }

    test("every span the agent sent that says anything becomes a row of one trace", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();
      const sent: Array<RecordedSpan> = recording.spans("signed-boot", "agent");

      expect(rows).toHaveLength(
        sent.filter((span: RecordedSpan): boolean => {
          return (
            span.attributes["name"] !==
            "nova.network.neutron.ClientWrapper.proxy"
          );
        }).length,
      );
      expect(
        Array.from(
          new Set(
            rows.map((row: JSONObject): unknown => {
              return row["traceId"];
            }),
          ),
        ),
      ).toEqual([
        traceIdOfPrinted(recording.scene("signed-boot").traceIds[0]!),
      ]);
    });

    test("each service is under its cloud, by the name an operator knows", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();
      const services: Set<string> = new Set(
        rows.map((row: JSONObject): string => {
          return nameOfServiceId(String(row["primaryEntityId"]));
        }),
      );

      expect(Array.from(services)).toEqual(
        expect.arrayContaining([
          `${CLOUD}/nova-api`,
          `${CLOUD}/nova-compute`,
          `${CLOUD}/neutron-server`,
          `${CLOUD}/keystone`,
          `${CLOUD}/glance-api`,
        ]),
      );
    });

    test("the rows are tied to the instance it made, by the key its page reads", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();
      const instance: string = recording.instance("instance_booted").id;
      const key: string = keyForOpenStackResource(PROJECT_ID.toString(), {
        cloudName: CLOUD,
        kind: OpenStackResourceKind.Instance,
        id: instance,
      });
      const named: Array<JSONObject> = rows.filter(
        (row: JSONObject): boolean => {
          return (row["entityKeys"] as Array<string>).includes(key);
        },
      );

      expect(named.length).toBeGreaterThan(0);

      for (const row of named) {
        expect(attributesOf(row)["openstack.instance_id"]).toBe(instance);
      }

      // Every row is the cloud's, whatever else it is.
      for (const row of rows) {
        expect(row["entityKeys"] as Array<string>).toContain(CLOUD_KEY);
      }
    });

    test("nova-api's own span of the boot's POST is named for the call", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();
      const post: JSONObject | undefined = rows.find(
        (row: JSONObject): boolean => {
          return (
            nameOfServiceId(String(row["primaryEntityId"])) ===
              `${CLOUD}/nova-api` &&
            String(row["name"]).startsWith("POST ") &&
            String(row["name"]).endsWith("/servers")
          );
        },
      );

      expect(post).toBeDefined();
      expect(post!["kind"]).toBe("SPAN_KIND_SERVER");
      expect(post!["isEntrySpan"]).toBe(true);
    });

    test("what it says about itself is on every row: cloud, region and machine", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();

      for (const row of rows) {
        const attributes: JSONObject = attributesOf(row);

        expect(attributes["resource.openstack.cloud.name"]).toBe(CLOUD);
        // What the card above a trace finds a trace's spans by.
        expect(attributes["scope.name"]).toBe(OSPROFILER_DRIVER_SCOPE_NAME);
        expect(attributes["resource.openstack.region.name"]).toBeTruthy();
        expect(attributes["resource.openstack.node.name"]).toBeTruthy();
        expect(attributes["openstack.service"]).toBeTruthy();
      }
    });

    test("OpenStack's own spans, signed by nobody, are read the same way where a release has them", async () => {
      if (release !== "hibiscus-ovn") {
        return;
      }

      await OtelTracesIngestService.processTracesFromQueue({
        projectId: PROJECT_ID,
        headers: {},
        body: movedToNow(recording.otlp("native-always-on-boot", "native")),
      } as unknown as TelemetryRequest);
      await TelemetryFanInWriter.flushAll();

      const rows: Array<JSONObject> = [];

      for (const call of insert.mock.calls) {
        rows.push(...(call[0] as Array<JSONObject>));
      }

      const oslo: Array<JSONObject> = rows.filter((row: JSONObject) => {
        return [OSLO_MESSAGING_SCOPE_NAME, OSLO_MIDDLEWARE_SCOPE_NAME].includes(
          String(attributesOf(row)["scope.name"]),
        );
      });
      const post: JSONObject | undefined = oslo.find((row: JSONObject) => {
        return row["name"] === "POST /compute/v2.1/servers";
      });

      expect(oslo.length).toBeGreaterThan(100);
      expect(post).toBeDefined();
      expect(post!["kind"]).toBe("SPAN_KIND_SERVER");
      expect(post!["isRootSpan"]).toBe(true);
      expect(attributesOf(post!)["openstack.service"]).toBe("nova-api");
      expect(attributesOf(post!)["http.url"]).toBeUndefined();

      const boot: Array<JSONObject> = oslo.filter((row: JSONObject) => {
        return row["traceId"] === post!["traceId"];
      });

      expect(
        new Set(
          boot.map((row: JSONObject): unknown => {
            return attributesOf(row)["openstack.service"];
          }),
        ),
      ).toEqual(
        new Set([
          "nova-api",
          "nova-conductor",
          "nova-scheduler",
          "nova-compute",
        ]),
      );
      expect(
        boot.map((row: JSONObject): unknown => {
          return row["kind"];
        }),
      ).toContain("SPAN_KIND_CONSUMER");
    });

    test("a call that only finds a method is on no row, and no row's parent", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();

      for (const row of rows) {
        expect(attributesOf(row)["name"]).not.toBe(
          "nova.network.neutron.ClientWrapper.proxy",
        );
      }
    });

    test("what a call was handed is on no row", async () => {
      const text: string = JSON.stringify(await rowsOfBoot());

      expect(text).not.toContain("admin_password");
      expect(text).not.toContain('"kwargs"');
      expect(text).not.toContain('"db.params"');
    });

    test("only what really has no parent is a root", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();
      const roots: Array<JSONObject> = rows.filter(
        (row: JSONObject): boolean => {
          return row["isRootSpan"] === true;
        },
      );

      expect(roots.length).toBeGreaterThan(0);

      for (const root of roots) {
        expect(root["parentSpanId"]).toBe("");
      }

      // Spans under what sent nothing keep the parent they named, which the waterfall reports.
      const ids: Set<unknown> = new Set(
        rows.map((row: JSONObject): unknown => {
          return row["spanId"];
        }),
      );
      const orphans: Array<JSONObject> = rows.filter(
        (row: JSONObject): boolean => {
          return row["isRootSpan"] !== true && !ids.has(row["parentSpanId"]);
        },
      );

      expect(orphans.length).toBeGreaterThan(0);

      for (const orphan of orphans) {
        expect(orphan["parentSpanId"]).toBeTruthy();
      }
    });

    test("the control plane can be drawn: spans whose parent is another service's", async () => {
      const rows: Array<JSONObject> = await rowsOfBoot();
      const serviceOfSpan: Map<unknown, string> = new Map();

      for (const row of rows) {
        serviceOfSpan.set(
          row["spanId"],
          nameOfServiceId(String(row["primaryEntityId"])),
        );
      }

      const calls: Set<string> = new Set();

      for (const row of rows) {
        const from: string | undefined = serviceOfSpan.get(row["parentSpanId"]);
        const to: string = nameOfServiceId(String(row["primaryEntityId"]));

        if (from && from !== to) {
          calls.add(`${from} -> ${to}`);
        }
      }

      expect(Array.from(calls)).toEqual(
        expect.arrayContaining([
          `${CLOUD}/nova-api -> ${CLOUD}/neutron-server`,
          `${CLOUD}/nova-api -> ${CLOUD}/glance-api`,
          `${CLOUD}/nova-compute -> ${CLOUD}/neutron-server`,
          `${CLOUD}/neutron-server -> ${CLOUD}/nova-api`,
          `${CLOUD}/nova-api -> ${CLOUD}/nova-compute`,
        ]),
      );
    });
  },
);
