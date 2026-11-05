import { describe, expect, test } from "@jest/globals";
import {
  OpenStackTraceRecording,
  RecordedScene,
  RecordedSpan,
  getRecordedTraceReleases,
  traceIdOfPrinted,
} from "../../Helpers/OpenStackTraceRecordings";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackLogAttribute,
  stampOpenStackLogRecord,
} from "../../../Utils/OpenStack/OpenStackLogs";
import {
  OpenStackTraceLogRow,
  OpenStackTraceRequest,
  OpenStackTraceRequestMatch,
  OpenStackTraceSpanForLogs,
  joinOpenStackTraceToRequests,
} from "../../../Utils/OpenStack/OpenStackTraceLogs";
import {
  OSPROFILER_ATTRIBUTES_NEVER_STORED,
  OSPROFILER_DRIVER_SCOPE_NAME,
  OpenStackDriverService,
  OpenStackDriverSpan,
  OpenStackTraceResource,
  normalizeOSProfilerResourceInPlace,
  readOSProfilerSpanInPlace,
  readOpenStackSpanResources,
  readOpenStackTraceId,
} from "../../../Utils/OpenStack/OpenStackTraces";

/*
 * What OSProfiler's OTLP driver really sent, read the way ingest reads it. The driver is marked
 * experimental, and everything here was written from its source before anyone had seen it run,
 * so this is where that gets caught: a recording that disagrees with the code is right.
 *
 * Tests/Ops/openstack-e2e/traces-record.sh records these. The other tests of the driver's
 * spans are written by hand, to pin one rule at a time. This file holds the rules to a real
 * boot on each release.
 */

interface ReadSpan {
  recorded: RecordedSpan;
  service: OpenStackDriverService;
  read: OpenStackDriverSpan;
  attributes: JSONObject;
}

function readScene(
  recording: OpenStackTraceRecording,
  scene: string,
  folder: string = "driver",
): Array<ReadSpan> {
  const spans: Array<ReadSpan> = [];
  const services: Map<JSONObject, OpenStackDriverService> = new Map();

  for (const recorded of recording.spans(scene, folder)) {
    let service: OpenStackDriverService | undefined = services.get(
      recorded.block,
    );

    if (!service) {
      service = normalizeOSProfilerResourceInPlace(recorded.block)!;
      services.set(recorded.block, service);
    }

    const attributes: JSONObject = recorded.attributes;

    spans.push({
      recorded: recorded,
      service: service,
      attributes: attributes,
      read: readOSProfilerSpanInPlace({
        name: recorded.name,
        kind: recorded.kind as never,
        traceId: recorded.traceId,
        parentSpanId: recorded.parentSpanId,
        attributes: attributes,
        events: recorded.events,
        service: service,
      }),
    });
  }

  return spans;
}

function servicesOf(spans: Array<ReadSpan>): Array<string> {
  return Array.from(
    new Set(
      spans.map((span: ReadSpan): string => {
        return span.service.service;
      }),
    ),
  ).sort();
}

function instancesOf(spans: Array<ReadSpan>): Array<string> {
  const ids: Set<string> = new Set<string>();

  for (const span of spans) {
    for (const resource of readOpenStackSpanResources(span.attributes)) {
      if (resource.kind === OpenStackResourceKind.Instance) {
        ids.add(resource.id);
      }
    }
  }

  return Array.from(ids);
}

describe.each(getRecordedTraceReleases())(
  "what the driver sent on %s",
  (release: string) => {
    const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
      release,
    );

    describe("a signed boot", () => {
      test("is one trace, the one the client printed", () => {
        const scene: RecordedScene = recording.scene("signed-boot");
        const spans: Array<RecordedSpan> = recording.spans("signed-boot");

        expect(scene.exitCode).toBe(0);
        expect(scene.traceIds).toHaveLength(1);

        const traces: Set<string> = new Set(
          spans.map((span: RecordedSpan): string => {
            return span.traceId;
          }),
        );

        expect(Array.from(traces)).toEqual([
          traceIdOfPrinted(scene.traceIds[0]!),
        ]);
        expect(readOpenStackTraceId(`Trace ID: ${scene.traceIds[0]}`)).toBe(
          spans[0]!.traceId,
        );
      });

      test("crosses these services, named as an operator knows them", () => {
        expect(servicesOf(readScene(recording, "signed-boot"))).toEqual(
          expect.arrayContaining([
            "glance-api",
            "keystone",
            "neutron-server",
            "nova-api",
            "nova-compute",
          ]),
        );
      });

      test("every span is in the driver's scope, and nothing else in it says what cloud", () => {
        const otlp: JSONObject = recording.otlp("signed-boot");

        for (const block of otlp["resourceSpans"] as Array<JSONObject>) {
          for (const scopeBlock of block["scopeSpans"] as Array<JSONObject>) {
            expect((scopeBlock["scope"] as JSONObject)["name"]).toBe(
              OSPROFILER_DRIVER_SCOPE_NAME,
            );
          }

          const keys: Array<string> = (
            (block["resource"] as JSONObject)["attributes"] as Array<JSONObject>
          ).map((attribute: JSONObject): string => {
            return attribute["key"] as string;
          });

          expect(keys).toContain("service.name");
          expect(
            keys.filter((key: string): boolean => {
              return key.startsWith("openstack.") || key === "host.name";
            }),
          ).toEqual([]);
        }
      });

      test("is tied to the instance it made, and to no other", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-boot");

        expect(instancesOf(spans)).toEqual([
          recording.instance("instance_booted").id,
        ]);
      });

      test("names what it was made from, too", () => {
        const kinds: Set<OpenStackResourceKind> = new Set();

        for (const span of readScene(recording, "signed-boot")) {
          for (const resource of readOpenStackSpanResources(span.attributes)) {
            kinds.add(resource.kind);
          }
        }

        expect(Array.from(kinds)).toEqual(
          expect.arrayContaining([
            OpenStackResourceKind.Instance,
            OpenStackResourceKind.Image,
            // What Nova asks Neutron is what names these.
            OpenStackResourceKind.Network,
            OpenStackResourceKind.Project,
          ]),
        );
      });

      test("every span gets a name a person can read, the same each time", () => {
        for (const span of readScene(recording, "signed-boot")) {
          expect(span.read.name).not.toContain("WSGI_");
          expect(span.read.name).not.toContain("REQUESTS_");
          // An instance's id in a name would make every operation its own.
          expect(span.read.name).not.toContain(
            recording.instance("instance_booted").id,
          );
        }
      });

      test("what the driver's rstrip ate from a word is put back", () => {
        const names: Array<string> = readScene(recording, "signed-boot").map(
          (span: ReadSpan): string => {
            return span.read.name;
          },
        );

        expect(
          names.some((name: string): boolean => {
            return name.startsWith("vif_driver ");
          }),
        ).toBe(true);
        expect(
          names.some((name: string): boolean => {
            return name.startsWith("vif_drive ");
          }),
        ).toBe(false);
      });

      test("each kind of span is stored as what it is", () => {
        for (const span of readScene(recording, "signed-boot")) {
          const functionName: unknown = span.attributes["name"];

          if (span.recorded.name.startsWith("WSGI_")) {
            expect(span.read.kind).toBe("SPAN_KIND_SERVER");
          } else if (String(functionName).includes(".rpcapi.")) {
            expect(span.read.kind).toBe("SPAN_KIND_PRODUCER");
          } else if (
            String(functionName).includes(".manager.") ||
            String(functionName).startsWith("oslo_messaging.rpc.server.")
          ) {
            expect(span.read.kind).toBe("SPAN_KIND_CONSUMER");
          } else {
            // compute_api and neutron_api, which the driver calls CLIENT for their names.
            expect(span.read.kind).toBe("SPAN_KIND_INTERNAL");
          }
        }
      });

      test("a call from nova-api to nova-compute has both of its ends", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-boot");
        const consumers: Array<ReadSpan> = spans.filter(
          (span: ReadSpan): boolean => {
            return (
              span.read.kind === "SPAN_KIND_CONSUMER" &&
              span.service.service === "nova-compute"
            );
          },
        );
        const fromApi: Array<ReadSpan> = consumers.filter(
          (consumer: ReadSpan): boolean => {
            return spans.some((candidate: ReadSpan): boolean => {
              return (
                candidate.recorded.spanId === consumer.recorded.parentSpanId &&
                candidate.read.kind === "SPAN_KIND_PRODUCER" &&
                candidate.service.service === "nova-api"
              );
            });
          },
        );

        expect(fromApi.length).toBeGreaterThan(0);
      });

      test("a call that only finds a method is not kept, and nothing was under it", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-boot");
        const dropped: Array<ReadSpan> = spans.filter(
          (span: ReadSpan): boolean => {
            return span.read.saysNothing;
          },
        );

        // A share of it, which is smaller on threads: there the trace holds later work too.
        expect(dropped.length).toBeGreaterThan(spans.length / 10);

        for (const span of dropped) {
          expect(span.attributes["name"]).toBe(
            "nova.network.neutron.ClientWrapper.proxy",
          );
          expect(
            Number((span.recorded.endNano - span.recorded.startNano) / 1000n),
          ).toBeLessThan(5000);
          expect(
            spans.some((candidate: ReadSpan): boolean => {
              return candidate.recorded.parentSpanId === span.recorded.spanId;
            }),
          ).toBe(false);
        }
      });

      test("the first span of each of the client's requests is a root", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-boot");
        const roots: Array<ReadSpan> = spans.filter(
          (span: ReadSpan): boolean => {
            return span.read.parentSpanId === "";
          },
        );

        // A boot with --wait is a few lookups, a POST and some polls.
        expect(roots.length).toBeGreaterThan(5);

        for (const root of roots) {
          // OSProfiler before 4.4.0 gives it the trace ID's low half, which is never sent.
          expect(["", root.recorded.traceId.slice(16)]).toContain(
            root.recorded.parentSpanId,
          );
          expect(root.service.service).not.toBe("nova-compute");
        }
      });

      test("nova-compute's build names its parent, which only arrives if the conductor sends", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-boot");
        const ids: Set<string> = new Set(
          spans.map((span: ReadSpan): string => {
            return span.recorded.spanId;
          }),
        );
        const built: ReadSpan | undefined = spans.find(
          (span: ReadSpan): boolean => {
            return String(span.attributes["name"]).endsWith(
              "ComputeManager.build_and_run_instance",
            );
          },
        );

        expect(built).toBeDefined();
        expect(built!.read.parentSpanId).not.toBe("");
        // On eventlet (2025.2) the conductor sends nothing, and on threads (2026.2) it does.
        expect(ids.has(built!.read.parentSpanId)).toBe(
          servicesOf(spans).includes("nova-conductor"),
        );
      });

      test("nova-compute's work is under the call that started it", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-boot");
        const built: ReadSpan = spans.find((span: ReadSpan): boolean => {
          return String(span.attributes["name"]).endsWith(
            "ComputeManager.build_and_run_instance",
          );
        })!;
        const under: Array<ReadSpan> = spans.filter(
          (span: ReadSpan): boolean => {
            return span.read.parentSpanId === built.recorded.spanId;
          },
        );

        expect(
          under.map((span: ReadSpan): string => {
            return span.service.service;
          }),
        ).toEqual(expect.arrayContaining(["keystone", "neutron-server"]));
      });

      test("no span holds a request ID, so the join to logs has to be the guess it is", () => {
        for (const span of recording.spans("signed-boot")) {
          expect(JSON.stringify(span.wire)).not.toContain("req-");
        }
      });
    });

    describe("from a trace to the logs of its requests", () => {
      type JournalLine = ReturnType<OpenStackTraceRecording["journal"]>[number];

      function logRows(scene: string): Array<OpenStackTraceLogRow> {
        return recording
          .journal(scene)
          .map((line: JournalLine): OpenStackTraceLogRow => {
            const stamp: { attributes: Record<string, string>; body: string } =
              stampOpenStackLogRecord({
                attributes: { "journald.unit": line.unit },
                body: line.message,
                severityNumber: 9,
              });

            return {
              time: new Date(line.time * 1000),
              body: stamp.body,
              attributes: stamp.attributes,
            };
          });
      }

      function spansForLogs(scene: string): Array<OpenStackTraceSpanForLogs> {
        return readScene(recording, scene).map(
          (span: ReadSpan): OpenStackTraceSpanForLogs => {
            return {
              service: span.service.service,
              method: String(span.attributes["http.method"] || ""),
              path: String(span.attributes["http.path"] || ""),
              startAt: new Date(Number(span.recorded.startNano / 1000000n)),
              endAt: new Date(Number(span.recorded.endNano / 1000000n)),
              attributes: span.attributes,
            };
          },
        );
      }

      test("the request Nova says made the instance comes first, and sure", () => {
        const requests: Array<OpenStackTraceRequest> =
          joinOpenStackTraceToRequests({
            spans: spansForLogs("signed-boot"),
            logs: logRows("signed-boot"),
          });

        expect(requests[0]!.rootId).toBe(
          recording.requestIdOf("instance_booted"),
        );
        expect(requests[0]!.match).toBe(
          OpenStackTraceRequestMatch.NamesInstance,
        );
      });

      test("so it does with DEBUG lines gone, as a project's first drop filter has them", () => {
        const logs: Array<OpenStackTraceLogRow> = logRows("signed-boot").filter(
          (row: OpenStackTraceLogRow): boolean => {
            return (
              (row.attributes as JSONObject)[OpenStackLogAttribute.Level] !==
              "DEBUG"
            );
          },
        );

        expect(logs.length).toBeGreaterThan(0);

        const requests: Array<OpenStackTraceRequest> =
          joinOpenStackTraceToRequests({
            spans: spansForLogs("signed-boot"),
            logs: logs,
          });

        expect(requests[0]!.rootId).toBe(
          recording.requestIdOf("instance_booted"),
        );
        expect(requests[0]!.match).toBe(
          OpenStackTraceRequestMatch.NamesInstance,
        );
      });

      test("its lines name services the trace itself cannot show", () => {
        const rows: Array<OpenStackTraceLogRow> = logRows("signed-boot");
        const root: string = recording.requestIdOf("instance_booted");
        const services: Set<string> = new Set();

        for (const row of rows) {
          const attributes: JSONObject = (row.attributes || {}) as JSONObject;

          if (attributes[OpenStackLogAttribute.RequestRootId] === root) {
            services.add(String(attributes[OpenStackLogAttribute.Service]));
          }
        }

        /*
         * The conductor and the scheduler send no span on a stock cloud, and write their
         * lines all the same, which is why a trace has to link to its logs.
         */
        expect(Array.from(services)).toEqual(
          expect.arrayContaining(["nova-conductor", "nova-scheduler"]),
        );
      });
    });

    describe("what is never stored", () => {
      test("the driver really does write what a call was handed, secrets and all", () => {
        const text: string = JSON.stringify(recording.otlp("signed-boot"));

        for (const key of ["args", "kwargs"]) {
          expect(text).toContain(`"key":"${key}"`);
        }
        // Scrubbed for this fixture: the point is where the real one was.
        expect(text).toContain("admin_password");
      });

      test("the agent's profile takes it all out before it leaves the machine", () => {
        const text: string = JSON.stringify(
          recording.otlp("signed-boot", "agent"),
        );

        for (const key of OSPROFILER_ATTRIBUTES_NEVER_STORED) {
          expect(text).not.toContain(`"key":"${key}"`);
        }
        expect(text).not.toContain("admin_password");
      });

      test("what comes some other way is taken out on arrival", () => {
        const scenes: Array<string> = ["signed-boot", "signed-volume"];

        for (const scene of scenes) {
          for (const span of readScene(recording, scene)) {
            for (const key of OSPROFILER_ATTRIBUTES_NEVER_STORED) {
              expect(span.attributes[key]).toBeUndefined();
            }
            expect(JSON.stringify(span.attributes)).not.toContain(
              "admin_password",
            );
            expect(JSON.stringify(span.attributes)).not.toContain(
              "auth_password",
            );
          }
        }
      });

      test("the HMAC key turned up nowhere it was recorded", () => {
        const row: RegExp = /^\d+ /;
        const lines: Array<string> = recording
          .text("key-check.txt")
          .split("\n")
          .filter((line: string): boolean => {
            return row.test(line);
          });

        expect(lines.length).toBeGreaterThan(10);

        for (const line of lines) {
          expect(line.startsWith("0 ")).toBe(true);
        }
      });
    });

    describe("what a span says went wrong", () => {
      test("a name looked up as an id first is no failure, and the event stays", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-show");
        const lookedUp: Array<ReadSpan> = spans.filter(
          (span: ReadSpan): boolean => {
            return JSON.stringify(span.recorded.events || []).includes(
              "InstanceNotFound",
            );
          },
        );

        expect(recording.scene("signed-show").exitCode).toBe(0);
        expect(lookedUp).toHaveLength(1);
        expect(lookedUp[0]!.read.isFailed).toBe(false);
        expect(lookedUp[0]!.read.statusMessage).toBe("");
      });

      test("nothing in a boot that worked is failed", () => {
        for (const span of readScene(recording, "signed-boot")) {
          expect(span.read.isFailed).toBe(false);
        }
      });
    });

    describe("a request that lists things", () => {
      test("is about none of them", () => {
        // It is Nova asking Neutron for every instance's ports that shows this.
        const spans: Array<ReadSpan> = readScene(recording, "signed-list");
        const asked: Array<ReadSpan> = spans.filter(
          (span: ReadSpan): boolean => {
            const query: unknown = span.attributes["http.query"];

            return (
              typeof query === "string" && query.split("device_id=").length > 2
            );
          },
        );

        // The recording really does ask for several instances at once.
        expect(asked.length).toBeGreaterThan(0);
        expect(instancesOf(spans)).toEqual([]);
      });
    });

    describe("other services, each on its own", () => {
      test("a volume's request names the volume, and crosses Cinder and Nova", () => {
        expect(recording.scene("signed-volume").exitCode).toBe(0);

        const spans: Array<ReadSpan> = readScene(recording, "signed-volume");
        const volumes: Set<string> = new Set();

        for (const span of spans) {
          for (const resource of readOpenStackSpanResources(span.attributes)) {
            if (resource.kind === OpenStackResourceKind.Volume) {
              volumes.add(resource.id);
            }
          }
        }

        expect(volumes.size).toBe(1);
        expect(servicesOf(spans)).toEqual(
          expect.arrayContaining(["cinder-api", "nova-api"]),
        );
      });

      test("cinder-volume is in no trace, not even of the volume it made", () => {
        expect(servicesOf(readScene(recording, "signed-volume"))).not.toContain(
          "cinder-volume",
        );
      });

      test("nova-compute's part of attaching it is under the attach, or on threads under the boot before", () => {
        function attachedIn(scene: string): boolean {
          return readScene(recording, scene).some((span: ReadSpan): boolean => {
            return String(span.attributes["name"]).endsWith(
              "ComputeManager.attach_volume",
            );
          });
        }

        // The conductor only sends on threads, as the test of nova-compute's build says.
        const onThreads: boolean = servicesOf(
          readScene(recording, "signed-boot"),
        ).includes("nova-conductor");

        expect(attachedIn("signed-volume")).toBe(!onThreads);
        expect(attachedIn("signed-boot")).toBe(onThreads);
      });

      test("Neutron's own requests name what they made", () => {
        const kinds: Array<OpenStackResourceKind> = readScene(
          recording,
          "signed-network",
        ).flatMap((span: ReadSpan): Array<OpenStackResourceKind> => {
          return readOpenStackSpanResources(span.attributes).map(
            (resource: OpenStackTraceResource): OpenStackResourceKind => {
              return resource.kind;
            },
          );
        });

        expect(kinds).toEqual(
          expect.arrayContaining([
            OpenStackResourceKind.Network,
            OpenStackResourceKind.Subnet,
            OpenStackResourceKind.Router,
          ]),
        );
      });

      test("each `openstack` command in a shell is its own trace", () => {
        const scene: RecordedScene = recording.scene("signed-network");
        const traces: Set<string> = new Set(
          recording
            .spans("signed-network")
            .map((span: RecordedSpan): string => {
              return span.traceId;
            }),
        );

        expect(scene.traceIds.length).toBeGreaterThan(1);
        expect(traces.size).toBe(scene.traceIds.length);
      });

      test("the flag and the environment variable sign alike", () => {
        const spans: Array<ReadSpan> = readScene(recording, "signed-token");

        expect(recording.scene("signed-token").exitCode).toBe(0);
        expect(servicesOf(spans)).toEqual(["keystone"]);
      });
    });

    describe("what brings in what a stock cloud leaves out", () => {
      test("stock Placement says why it sends nothing, and goes on answering", () => {
        expect(recording.text("driver-log-lines.txt")).toContain(
          "no such option profiler_otlp in group [DEFAULT]",
        );
        expect(servicesOf(readScene(recording, "signed-boot"))).not.toContain(
          "placement-api",
        );
      });

      test.each(["signed-boot-placement", "signed-boot-osprofiler-fix"])(
        "with one line, in %s, a boot crosses Placement",
        (scene: string) => {
          const spans: Array<ReadSpan> = readScene(recording, scene);

          expect(recording.scene(scene).exitCode).toBe(0);
          expect(servicesOf(spans)).toContain("placement-api");
          expect(
            spans.some((span: ReadSpan): boolean => {
              return span.read.name.endsWith("/allocation_candidates");
            }),
          ).toBe(true);
        },
      );

      test("Placement's allocations tie it to the instance, as its other spans do", () => {
        const placement: Array<ReadSpan> = readScene(
          recording,
          "signed-boot-whole",
        ).filter((span: ReadSpan): boolean => {
          return span.service.service === "placement-api";
        });

        expect(instancesOf(placement).length).toBeGreaterThan(0);
      });

      test("with that and one worker each, a boot's trace has nothing missing", () => {
        const spans: Array<ReadSpan> = readScene(
          recording,
          "signed-boot-whole",
        );
        const ids: Set<string> = new Set(
          spans.map((span: ReadSpan): string => {
            return span.recorded.spanId;
          }),
        );

        expect(servicesOf(spans)).toEqual(
          expect.arrayContaining([
            "nova-conductor",
            "nova-scheduler",
            "placement-api",
          ]),
        );

        for (const span of spans) {
          if (span.read.parentSpanId) {
            expect(ids.has(span.read.parentSpanId)).toBe(true);
          }
        }
      });

      test("nova-scheduler's one span is where its work enters, so it counts as having sent", () => {
        const scheduler: Array<ReadSpan> = readScene(
          recording,
          "signed-boot-whole",
        ).filter((span: ReadSpan): boolean => {
          return span.service.service === "nova-scheduler";
        });

        expect(scheduler.length).toBeGreaterThan(0);

        for (const span of scheduler) {
          expect(span.read.kind).toBe("SPAN_KIND_CONSUMER");
          expect(span.read.name).toBe("rpc server.expected_exceptions");
        }
      });

      test("a scheduling that fails is a failed span, saying no valid host", () => {
        // Under its own trace on eventlet. On threads, under the one before: see the guide.
        const spans: Array<ReadSpan> = [
          ...readScene(recording, "signed-boot-failed-whole"),
          ...readScene(recording, "signed-boot-whole"),
        ];

        expect(
          spans.some((span: ReadSpan): boolean => {
            return (
              span.read.isFailed &&
              span.service.service === "nova-conductor" &&
              span.read.statusMessage.includes("NoValidHost") &&
              span.read.statusMessage.includes("No valid host was found")
            );
          }),
        ).toBe(true);
      });
    });

    describe("a request signed by hand, as #5749's check will sign one", () => {
      test("a real Nova accepted the signature, and its trace is the ID chosen", () => {
        const scene: RecordedScene = recording.scene("signed-by-header");
        const spans: Array<RecordedSpan> = recording.spans("signed-by-header");

        expect(scene.exitCode).toBe(0);
        expect(spans.length).toBeGreaterThan(0);

        for (const span of spans) {
          expect(span.traceId).toBe(traceIdOfPrinted(scene.traceIds[0]!));
        }

        // Keystone was called with the signature Nova passed on: it took nothing else.
        expect(
          spans.some((span: RecordedSpan): boolean => {
            return span.driverService === "keystone-public";
          }),
        ).toBe(true);
      });
    });

    describe("what it costs", () => {
      interface Described {
        spans: number;
        bytes: number;
      }

      function described(name: string): Described {
        const summary: {
          scenes: Array<{
            scene: string;
            traces: Array<{ driver: Described }>;
          }>;
        } = recording.json("summary.json");

        return summary.scenes.find((scene: { scene: string }) => {
          return scene.scene === name;
        })!.traces[0]!.driver;
      }

      test("off, or not signed, a request makes nothing and still succeeds", () => {
        for (const name of [
          "off-signed-list",
          "unsigned-list",
          "wrong-key-list",
          "off-again-signed-boot",
        ]) {
          const scene: RecordedScene = recording.scene(name);

          expect(scene.exitCode).toBe(0);
          expect(scene.spansMade).toBe(0);
        }
      });

      test("the client prints a Trace ID whether or not anything is traced", () => {
        expect(recording.scene("wrong-key-list").traceIds).toHaveLength(1);
        expect(recording.scene("off-signed-list").traceIds).toHaveLength(1);
        expect(recording.scene("unsigned-list").traceIds).toHaveLength(0);
      });

      test("with the local collector stopped, a signed request still succeeds", () => {
        for (const name of [
          "collector-down-signed-list",
          "collector-down-signed-boot",
        ]) {
          const scene: RecordedScene = recording.scene(name);

          expect(scene.exitCode).toBe(0);
          expect(scene.spansMade).toBe(0);
        }
      });

      test("trace_sqlalchemy is what costs, as the guide says, and trace_requests less", () => {
        const plain: Described = described("signed-boot");
        const sql: Described = described("signed-boot-sql");
        const requests: Described = described("signed-boot-requests");

        expect(sql.spans).toBeGreaterThan(plain.spans * 2);
        expect(requests.spans).toBeGreaterThan(plain.spans);
        expect(requests.spans).toBeLessThan(plain.spans * 3);
      });
    });
  },
);

/*
 * What decided how this is written up, on the one release each was recorded on. Each is a fact
 * about a version of something else, so a new recording that disagrees means the guide is out of
 * date, and that is what these are for.
 */
describe("what hung Hibiscus", () => {
  const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
    "hibiscus-ovn",
  );

  test("a worker of Neutron's API, in OpenTelemetry's fork handler, on a command", () => {
    const stack: string = recording.text("fork-hang.txt");

    expect(stack).toContain("neutron-api");
    expect(stack).toContain("TracerProvider._handle_fork");
    expect(stack).toContain("Popen._execute_child");
    expect(stack).toContain("oslo_concurrency/processutils.py");
  });

  test("that is the SDK 2026.2 pins", () => {
    expect(recording.text("versions.txt")).toContain(
      "opentelemetry-sdk===1.44.0",
    );
  });

  test("below it, as the guide installs, every service comes back with the driver on", () => {
    const installed: string = recording
      .text("versions.txt")
      .split("What is installed in its place:")[1]!;
    const answers: Array<string> = recording
      .text("which-services-start.txt")
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("/etc/");
      });

    expect(installed).toMatch(/opentelemetry-sdk +1\.43\.0/);
    expect(answers.join("\n")).toContain("devstack@neutron-rpc-server): yes");
    expect(answers.length).toBeGreaterThan(5);

    for (const answer of answers) {
      expect(answer.endsWith(": yes")).toBe(true);
    }
  });
});

describe("OpenStack's own tracing, on the release that ships it", () => {
  const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
    "hibiscus-ovn",
  );

  interface NativeScene {
    spans: number;
    spansByScope: Record<string, number>;
    traces: number;
    tracesAcrossServices: number;
    requestIdsOnSpans: Array<string>;
    attributeKeys: Record<string, number>;
  }

  const native: Record<string, NativeScene> = recording.json<
    Record<string, NativeScene>
  >("native-summary.json");

  test("oslo.messaging alone sends nothing, and says why on every call", () => {
    expect(native["native-messaging-boot"]!.spans).toBe(0);
    expect(recording.text("driver-log-lines.txt")).toContain(
      "has no attribute 'trace_exporter'",
    );
  });

  test("with oslo.middleware too, no trace crosses two services", () => {
    const both: NativeScene = native["native-both-boot"]!;

    expect(both.spansByScope["oslo_middleware.tracing"]).toBeGreaterThan(50);
    expect(both.traces).toBeGreaterThan(50);
    expect(both.tracesAcrossServices).toBe(0);
  });

  test("its HTTP spans hold no request ID, and its RPC spans do", () => {
    const keys: Record<string, number> =
      native["native-both-boot"]!.attributeKeys;

    expect(
      keys["oslo_middleware.tracing | openstack.request_id"],
    ).toBeUndefined();
    expect(keys["oslo.messaging | openstack.request_id"]).toBeGreaterThan(0);
  });

  test("an idle minute of it sends nothing", () => {
    expect(native["native-both-idle"]!.spans).toBe(0);
  });
});
