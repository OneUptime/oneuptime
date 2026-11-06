import { describe, expect, test } from "@jest/globals";
import {
  OpenStackTraceRecording,
  RecordedSpan,
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
  joinOpenStackTraceToRequests,
} from "../../../Utils/OpenStack/OpenStackTraceLogs";
import {
  OSLO_MESSAGING_SCOPE_NAME,
  OSLO_MIDDLEWARE_SCOPE_NAME,
  OSPROFILER_DRIVER_SCOPE_NAME,
  OSPROFILER_SCOPE_SPAN_ATTRIBUTE,
  OpenStackDriverService,
  OpenStackDriverSpan,
  OpenStackStoredSpanKind,
  OpenStackTraceSource,
  getOpenStackTraceSource,
  isOpenStackNativeScope,
  isOpenStackTraceCarriedOverHttp,
  normalizeOSProfilerResourceInPlace,
  readOpenStackNativeSpanInPlace,
  readOpenStackSpanResources,
  readOpenStackTracedServices,
} from "../../../Utils/OpenStack/OpenStackTraces";

/*
 * OpenStack's own tracing, which needs nothing signed. The rules one at a time, by hand, and then
 * held to what oslo.middleware and oslo.messaging really sent on a real 2026.2 DevStack.
 */

const SERVICE: OpenStackDriverService = {
  service: "nova-api",
  component: "nova",
};

function read(data: {
  name?: string;
  kind?: OpenStackStoredSpanKind;
  parentSpanId?: string;
  attributes: JSONObject;
  status?: unknown;
  events?: unknown;
}): OpenStackDriverSpan {
  return readOpenStackNativeSpanInPlace({
    name: data.name || "HTTP GET /servers",
    kind: data.kind || "SPAN_KIND_SERVER",
    parentSpanId: data.parentSpanId || "",
    attributes: data.attributes,
    events: data.events,
    status: data.status,
    service: SERVICE,
  });
}

describe("a span of oslo.middleware's", () => {
  test("reads as the driver's do: the method, and the path with its id out", () => {
    const attributes: JSONObject = {
      "http.method": "GET",
      "http.url":
        "https://192.0.2.10/compute/v2.1/servers/55c85623-13cb-4004-be02-5439eddab35f",
      "http.route": "/servers/55c85623-13cb-4004-be02-5439eddab35f",
      "http.status_code": "200",
    };

    expect(read({ name: "HTTP GET /servers/x", attributes }).name).toBe(
      "GET /compute/v2.1/servers/{id}",
    );
    expect(attributes["http.path"]).toBe(
      "/compute/v2.1/servers/55c85623-13cb-4004-be02-5439eddab35f",
    );
    expect(attributes["openstack.service"]).toBe("nova-api");
    expect(attributes["openstack.component"]).toBe("nova");
  });

  test("names the part its path names, for that part's page to find", () => {
    const attributes: JSONObject = {
      "http.method": "DELETE",
      "http.url":
        "http://192.0.2.10/compute/v2.1/servers/55c85623-13cb-4004-be02-5439eddab35f",
    };

    read({ attributes });

    expect(readOpenStackSpanResources(attributes)).toEqual(
      expect.arrayContaining([
        {
          kind: OpenStackResourceKind.Instance,
          id: "55c85623-13cb-4004-be02-5439eddab35f",
        },
      ]),
    );
  });

  test("keeps neither the address it was asked at nor a secret in its query", () => {
    const attributes: JSONObject = {
      "http.method": "GET",
      "http.url":
        "http://10.1.2.3/compute/v2.1/servers?name=web&password=hunter2",
      "http.route": "/servers",
    };

    read({ attributes });

    expect(attributes["http.url"]).toBeUndefined();
    expect(attributes["http.path"]).toBe("/compute/v2.1/servers");
    expect(String(attributes["http.query"])).toContain("name=web");
    expect(JSON.stringify(attributes)).not.toContain("hunter2");
    expect(JSON.stringify(attributes)).not.toContain("10.1.2.3");
  });

  test("a console's token in a path goes, in the route too", () => {
    const attributes: JSONObject = {
      "http.method": "GET",
      "http.url": "http://x/compute/v2.1/os-console-auth-tokens/secret-token",
      "http.route": "/os-console-auth-tokens/secret-token",
    };

    read({ attributes });

    expect(JSON.stringify(attributes)).not.toContain("secret-token");
  });

  test("keeps what it knows, and nothing else it was handed", () => {
    const attributes: JSONObject = {
      "http.method": "GET",
      "http.user_agent": "python-novaclient",
      args: "(admin_password='nope')",
      kwargs: "{}",
      "some.new.attribute": "unread",
      "resource.openstack.cloud.name": "prod",
      "scope.name": OSLO_MIDDLEWARE_SCOPE_NAME,
    };

    read({ attributes });

    expect(attributes["args"]).toBeUndefined();
    expect(attributes["kwargs"]).toBeUndefined();
    expect(attributes["some.new.attribute"]).toBeUndefined();
    expect(attributes["http.user_agent"]).toBe("python-novaclient");
    expect(attributes["resource.openstack.cloud.name"]).toBe("prod");
    expect(attributes["scope.name"]).toBe(OSLO_MIDDLEWARE_SCOPE_NAME);
  });

  test.each([
    ["200", false, ""],
    ["404", false, ""],
    ["409", false, ""],
    ["500", true, "HTTP 500"],
    ["503", true, "HTTP 503"],
  ])(
    "a request answered %s, failed: %s",
    (code: string, isFailed: boolean, message: string) => {
      const span: OpenStackDriverSpan = read({
        attributes: { "http.method": "GET", "http.status_code": code },
      });

      expect(span.isFailed).toBe(isFailed);
      expect(span.statusMessage).toBe(message);
    },
  );

  test("a long hostile URL costs a read of it and no more", () => {
    const url: string = `http://${"a".repeat(200000)}/${"b/".repeat(200000)}?${"c=".repeat(200000)}`;
    const attributes: JSONObject = { "http.method": "GET", "http.url": url };
    const before: number = Date.now();

    read({ attributes });

    // Deterministic work, measured only to catch something quadratic: 400000 segments.
    expect(Date.now() - before).toBeLessThan(5000);
  });
});

describe("a span of oslo.messaging's", () => {
  test("stands as it came: its name, kind and parent", () => {
    const span: OpenStackDriverSpan = read({
      name: "conductor.schedule_and_build_instances",
      kind: "SPAN_KIND_PRODUCER",
      parentSpanId: "aaaaaaaaaaaaaaaa",
      attributes: {
        "messaging.system": "rabbitmq",
        "messaging.operation": "cast",
        "messaging.destination.name": "conductor",
        "rpc.method": "schedule_and_build_instances",
        "openstack.request_id": "req-1",
      },
    });

    expect(span.name).toBe("conductor.schedule_and_build_instances");
    expect(span.kind).toBe("SPAN_KIND_PRODUCER");
    expect(span.parentSpanId).toBe("aaaaaaaaaaaaaaaa");
    expect(span.isFailed).toBe(false);
    expect(span.saysNothing).toBe(false);
  });

  test("what a call raised is a failure, with a secret in it gone", () => {
    const span: OpenStackDriverSpan = read({
      name: "select_destinations receive",
      kind: "SPAN_KIND_CONSUMER",
      attributes: { "rpc.method": "select_destinations" },
      status: {
        code: 2,
        message: "NoValidHost: password=hunter2 No valid host was found",
      },
    });

    expect(span.isFailed).toBe(true);
    expect(span.statusMessage).toContain("No valid host was found");
    expect(span.statusMessage).not.toContain("hunter2");
  });

  test("what it says went wrong is its first line, and not the traceback under it", () => {
    expect(
      read({
        name: "scheduler.select_destinations",
        kind: "SPAN_KIND_PRODUCER",
        attributes: { "rpc.method": "select_destinations" },
        status: {
          code: 2,
          message:
            'NoValidHost_Remote: No valid host was found. \nTraceback (most recent call last):\n\n  File "/opt/stack/nova/nova/conductor/manager.py"',
        },
      }).statusMessage,
    ).toBe("NoValidHost_Remote: No valid host was found.");
  });

  test("a status that is no error is no failure", () => {
    expect(
      read({
        name: "object_action receive",
        kind: "SPAN_KIND_CONSUMER",
        attributes: { "rpc.method": "object_action" },
        status: { code: 1 },
      }).isFailed,
    ).toBe(false);
  });
});

describe("who sent a trace", () => {
  test.each([
    [OSPROFILER_DRIVER_SCOPE_NAME, OpenStackTraceSource.OSProfiler],
    [OSLO_MESSAGING_SCOPE_NAME, OpenStackTraceSource.Native],
    [OSLO_MIDDLEWARE_SCOPE_NAME, OpenStackTraceSource.Native],
    ["some.other.library", null],
  ])("%s is %s", (scope: string, source: OpenStackTraceSource | null) => {
    expect(
      getOpenStackTraceSource({ [OSPROFILER_SCOPE_SPAN_ATTRIBUTE]: scope }),
    ).toBe(source);
  });

  test("only oslo's scopes count as oslo's", () => {
    expect(isOpenStackNativeScope({ name: OSLO_MESSAGING_SCOPE_NAME })).toBe(
      true,
    );
    expect(isOpenStackNativeScope({ name: OSPROFILER_DRIVER_SCOPE_NAME })).toBe(
      false,
    );
    expect(isOpenStackNativeScope(null)).toBe(false);
    expect(isOpenStackNativeScope("oslo.messaging")).toBe(false);
  });

  test("a page reads both, and whether a trace was carried over HTTP", () => {
    const span: (scope: string, parent: string) => JSONObject = (
      scope: string,
      parent: string,
    ): JSONObject => {
      return {
        traceId: "t",
        startTime: "2026-11-05T05:57:44Z",
        parentSpanId: parent,
        attributes: { [OSPROFILER_SCOPE_SPAN_ATTRIBUTE]: scope },
      };
    };

    expect(
      readOpenStackTracedServices([
        span(OSLO_MIDDLEWARE_SCOPE_NAME, ""),
        span(OSLO_MESSAGING_SCOPE_NAME, "aaaaaaaaaaaaaaaa"),
      ]),
    ).toMatchObject({
      sources: [OpenStackTraceSource.Native],
      carriedOverHttp: false,
    });
    expect(
      readOpenStackTracedServices([
        span(OSLO_MIDDLEWARE_SCOPE_NAME, "aaaaaaaaaaaaaaaa"),
        span(OSPROFILER_DRIVER_SCOPE_NAME, ""),
      ]),
    ).toMatchObject({
      sources: [OpenStackTraceSource.Native, OpenStackTraceSource.OSProfiler],
      carriedOverHttp: true,
    });
    expect(
      isOpenStackTraceCarriedOverHttp(
        span(OSPROFILER_DRIVER_SCOPE_NAME, "aaaaaaaaaaaaaaaa"),
      ),
    ).toBe(false);
  });
});

describe("which traces a map is drawn from", () => {
  function row(
    traceId: string,
    service: string,
    startTime: string,
  ): JSONObject {
    return {
      traceId,
      startTime,
      attributes: { "openstack.service": service },
    };
  }

  test("those that cross the most services, the newest first among the same", () => {
    const read: ReturnType<typeof readOpenStackTracedServices> =
      readOpenStackTracedServices([
        // A poller asking one API, again and again, is what is newest on a busy cloud.
        row("poller-new", "nova-api", "2026-11-05T06:00:00Z"),
        row("poller-old", "nova-api", "2026-11-05T05:59:00Z"),
        row("boot", "nova-api", "2026-11-05T05:00:00Z"),
        row("boot", "nova-conductor", "2026-11-05T05:00:01Z"),
        row("boot", "nova-compute", "2026-11-05T05:00:02Z"),
        row("delete", "nova-api", "2026-11-05T05:30:00Z"),
        row("delete", "nova-compute", "2026-11-05T05:30:01Z"),
      ]);

    expect(read.traceIds).toEqual([
      "poller-new",
      "poller-old",
      "delete",
      "boot",
    ]);
    expect(read.widestTraceIds).toEqual([
      "boot",
      "delete",
      "poller-new",
      "poller-old",
    ]);
  });
});

describe("a trace's requests, when its spans name them", () => {
  function spanNaming(requestId: string): {
    service: string;
    method: string;
    path: string;
    startAt: Date;
    endAt: Date;
    attributes: JSONObject;
  } {
    return {
      service: "nova-conductor",
      method: "",
      path: "",
      startAt: new Date("2026-11-05T05:57:44Z"),
      endAt: new Date("2026-11-05T05:57:45Z"),
      attributes: { [OpenStackLogAttribute.RequestId]: requestId },
    };
  }

  test("they come first, and no line of them has to be read for that", () => {
    const requests: Array<OpenStackTraceRequest> = joinOpenStackTraceToRequests(
      {
        spans: [spanNaming("req-1")],
        logs: [],
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      rootId: "req-1",
      match: OpenStackTraceRequestMatch.NamedBySpan,
      services: ["nova-conductor"],
    });
  });

  test("a line of that request says which other services it reached", () => {
    const requests: Array<OpenStackTraceRequest> = joinOpenStackTraceToRequests(
      {
        spans: [spanNaming("req-1")],
        logs: [
          {
            time: "2026-11-05T05:57:44Z",
            attributes: {
              [OpenStackLogAttribute.RequestRootId]: "req-1",
              [OpenStackLogAttribute.RequestId]: "req-1",
              [OpenStackLogAttribute.Service]: "nova-scheduler",
            },
          },
          {
            time: "2026-11-05T05:57:44Z",
            attributes: {
              [OpenStackLogAttribute.RequestRootId]: "req-other",
              [OpenStackLogAttribute.RequestId]: "req-other",
              [OpenStackLogAttribute.Service]: "nova-conductor",
            },
          },
        ],
      },
    );

    expect(requests[0]).toMatchObject({
      rootId: "req-1",
      match: OpenStackTraceRequestMatch.NamedBySpan,
      services: ["nova-scheduler"],
    });
    // The other only shares its moments with the trace, which is no longer worth saying.
    expect(requests).toHaveLength(1);
  });

  test("a request called by another keeps the root its lines give it", () => {
    const requests: Array<OpenStackTraceRequest> = joinOpenStackTraceToRequests(
      {
        spans: [spanNaming("req-neutron")],
        logs: [
          {
            time: "2026-11-05T05:57:44Z",
            attributes: {
              [OpenStackLogAttribute.RequestRootId]: "req-nova",
              [OpenStackLogAttribute.RequestId]: "req-neutron",
              [OpenStackLogAttribute.Service]: "neutron-server",
            },
          },
        ],
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.rootId).toBe("req-nova");
    expect(requests[0]!.match).toBe(OpenStackTraceRequestMatch.NamedBySpan);
  });
});

/*
 * What really came. The guide's setup with nothing signed: native-always-on-* as OpenStack ships
 * it, and native-crossing-boot with the guide's line in keystoneauth.
 */
describe("on a real 2026.2, with nothing signed", () => {
  const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
    "hibiscus-ovn",
  );

  interface Read {
    recorded: RecordedSpan;
    service: string;
    read: OpenStackDriverSpan;
  }

  function readScene(scene: string): Array<Read> {
    const services: Map<JSONObject, OpenStackDriverService> = new Map();
    const spans: Array<Read> = [];

    for (const recorded of recording.spans(scene, "native")) {
      let service: OpenStackDriverService | undefined = services.get(
        recorded.block,
      );

      if (!service) {
        service = normalizeOSProfilerResourceInPlace(recorded.block)!;
        services.set(recorded.block, service);
      }

      spans.push({
        recorded,
        service: service.service,
        read: readOpenStackNativeSpanInPlace({
          name: recorded.name,
          kind: recorded.kind as never,
          parentSpanId: recorded.parentSpanId,
          attributes: recorded.attributes,
          events: recorded.events,
          status: recorded.wire["status"],
          service: service,
        }),
      });
    }

    return spans;
  }

  function isThePost(span: Read): boolean {
    return span.read.name === "POST /compute/v2.1/servers";
  }

  function theBoot(spans: Array<Read>): Array<Read> {
    const root: Read = spans.find(isThePost)!;

    return spans.filter((span: Read): boolean => {
      return span.recorded.traceId === root.recorded.traceId;
    });
  }

  function servicesOf(spans: Array<Read>): Array<string> {
    return Array.from(
      new Set(
        spans.map((span: Read): string => {
          return span.service;
        }),
      ),
    ).sort();
  }

  function logRows(scene: string): Array<OpenStackTraceLogRow> {
    return recording.journal(scene).map((line): OpenStackTraceLogRow => {
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

  describe("as OpenStack ships it", () => {
    const SCENE: string = "native-always-on-boot";

    test("the boot worked, and everything in it is oslo's", () => {
      expect(recording.scene(SCENE).exitCode).toBe(0);
      expect(recording.scene(SCENE).traceIds).toEqual([]);

      for (const span of readScene(SCENE)) {
        expect([
          OSLO_MESSAGING_SCOPE_NAME,
          OSLO_MIDDLEWARE_SCOPE_NAME,
        ]).toContain(span.recorded.scopeName);
      }
    });

    test("a boot is one trace from Nova's API through its conductor and scheduler to its compute", () => {
      const boot: Array<Read> = theBoot(readScene(SCENE));
      const ids: Set<string> = new Set(
        boot.map((span: Read): string => {
          return span.recorded.spanId;
        }),
      );

      expect(servicesOf(boot)).toEqual([
        "nova-api",
        "nova-compute",
        "nova-conductor",
        "nova-scheduler",
      ]);

      for (const span of boot) {
        // Each hop names the one before it: nothing here is a guess from the time it ran.
        if (!isThePost(span)) {
          expect(ids.has(span.read.parentSpanId)).toBe(true);
        }
      }
    });

    test("its RPC spans hold the request Nova says made the instance, and its HTTP span none", () => {
      const boot: Array<Read> = theBoot(readScene(SCENE));
      const asked: string = recording.requestIdOf("ou_trace_native_always");

      for (const span of boot) {
        const requestId: unknown =
          span.recorded.attributes["openstack.request_id"];

        if (span.recorded.scopeName === OSLO_MESSAGING_SCOPE_NAME) {
          expect(requestId).toBe(asked);
        } else {
          expect(requestId).toBeUndefined();
        }
      }
    });

    test("so its request is first among its logs, and sure, with every service that logged it", () => {
      const boot: Array<Read> = theBoot(readScene(SCENE));
      const requests: Array<OpenStackTraceRequest> =
        joinOpenStackTraceToRequests({
          spans: boot.map((span: Read) => {
            return {
              service: span.service,
              method: String(span.recorded.attributes["http.method"] || ""),
              path: String(span.recorded.attributes["http.path"] || ""),
              startAt: new Date(Number(span.recorded.startNano / 1000000n)),
              endAt: new Date(Number(span.recorded.endNano / 1000000n)),
              attributes: span.recorded.attributes,
            };
          }),
          logs: logRows(SCENE),
        });

      expect(requests[0]!.rootId).toBe(
        recording.requestIdOf("ou_trace_native_always"),
      );
      expect(requests[0]!.match).toBe(OpenStackTraceRequestMatch.NamedBySpan);
      expect(requests[0]!.services).toEqual(
        expect.arrayContaining([
          "nova-api",
          "nova-compute",
          "nova-conductor",
          "nova-scheduler",
        ]),
      );
    });

    test("nothing crosses an HTTP call: Nova asking Neutron is a trace of its own", () => {
      const spans: Array<Read> = readScene(SCENE);

      expect(servicesOf(spans)).toEqual(
        expect.arrayContaining(["neutron-server", "glance-api"]),
      );
      expect(servicesOf(theBoot(spans))).not.toContain("neutron-server");

      for (const span of spans) {
        if (span.recorded.scopeName === OSLO_MIDDLEWARE_SCOPE_NAME) {
          expect(span.recorded.parentSpanId).toBe("");
        }
      }
    });

    test("every span says which service it is, in the word an operator knows", () => {
      for (const span of readScene(SCENE)) {
        expect(span.recorded.attributes["openstack.service"]).toBe(
          span.service,
        );
        expect(span.recorded.attributes["http.url"]).toBeUndefined();
        expect(span.service).not.toContain("nova-nova");
        expect(span.service).not.toContain("osapi_compute");
      }
    });

    test("what a boot asks of the instance it made names that instance", () => {
      const instance: string = recording.instance("ou_trace_native_always").id;
      const named: Array<string> = readScene(SCENE).flatMap(
        (span: Read): Array<string> => {
          return readOpenStackSpanResources(span.recorded.attributes).map(
            (resource: { id: string }): string => {
              return resource.id;
            },
          );
        },
      );

      expect(named).toContain(instance);
    });
  });

  describe("with the guide's line in keystoneauth", () => {
    const SCENE: string = "native-crossing-boot";

    test("the boot's trace crosses Neutron and Glance as well, with nothing signed", () => {
      expect(recording.scene(SCENE).exitCode).toBe(0);
      expect(recording.scene(SCENE).traceIds).toEqual([]);
      expect(servicesOf(theBoot(readScene(SCENE)))).toEqual([
        "glance-api",
        "neutron-server",
        "nova-api",
        "nova-compute",
        "nova-conductor",
        "nova-scheduler",
      ]);
    });

    test("Neutron's spans sit under the call that made them, and a page can tell", () => {
      const boot: Array<Read> = theBoot(readScene(SCENE));
      const post: Read = boot.find(isThePost)!;
      const neutron: Array<Read> = boot.filter((span: Read): boolean => {
        return span.service === "neutron-server";
      });

      expect(neutron.length).toBeGreaterThan(0);

      for (const span of neutron) {
        expect(span.read.parentSpanId).toBe(post.recorded.spanId);
        expect(
          isOpenStackTraceCarriedOverHttp({
            parentSpanId: span.read.parentSpanId,
            attributes: {
              [OSPROFILER_SCOPE_SPAN_ATTRIBUTE]: span.recorded.scopeName,
            },
          }),
        ).toBe(true);
      }
    });

    test("what nova-compute does on a thread of its own stays outside, under the same request", () => {
      const spans: Array<Read> = readScene(SCENE);
      const boot: Array<Read> = theBoot(spans);
      const asked: string = recording.requestIdOf("ou_trace_native_crossing");
      const outside: Array<Read> = spans.filter((span: Read): boolean => {
        return (
          span.recorded.traceId !== boot[0]!.recorded.traceId &&
          span.recorded.attributes["openstack.request_id"] === asked
        );
      });

      expect(outside.length).toBeGreaterThan(0);
      expect(servicesOf(outside)).toContain("nova-compute");
      // The build is handed to its thread, so its span in the boot's trace has nothing under it.
      const built: Read = boot.find((span: Read): boolean => {
        return span.read.name === "build_and_run_instance receive";
      })!;

      expect(
        boot.filter((span: Read): boolean => {
          return span.read.parentSpanId === built.recorded.spanId;
        }),
      ).toEqual([]);
    });
  });

  test("cinder-volume is in no trace here either, though a volume was made and attached", () => {
    const spans: Array<Read> = readScene("native-always-on-volume");

    expect(recording.scene("native-always-on-volume").exitCode).toBe(0);
    expect(servicesOf(spans)).toEqual(
      expect.arrayContaining([
        "cinder-api",
        "cinder-scheduler",
        "nova-compute",
      ]),
    );
    expect(servicesOf(spans)).not.toContain("cinder-volume");
  });

  test("a scheduling that fails is a failed span, saying no valid host and no more", () => {
    const failed: Array<Read> = readScene(
      "native-always-on-failed-boot",
    ).filter((span: Read): boolean => {
      return span.read.isFailed;
    });

    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.service).toBe("nova-conductor");
    expect(failed[0]!.read.statusMessage).toContain("No valid host was found");
    expect(failed[0]!.read.statusMessage).not.toContain("Traceback");
  });

  describe("what leaving it on cost, as the docs and the guide say it did", () => {
    interface Summary {
      spans: number;
      spansTheCollectorSends: number;
    }

    interface Cost {
      answers: Record<string, { p50Milliseconds: number }>;
      cpuSecondsWhileQuietInAll: number;
      quietSeconds: number;
    }

    const summary: Record<string, Summary> = recording.json<
      Record<string, Summary>
    >("native-summary.json");
    const cost: Record<string, Cost> =
      recording.json<Record<string, Cost>>("native-cost.json");

    test("an idle minute makes about 33 spans, and the collector sends on about 2", () => {
      const idle: Summary = summary["native-always-on-idle"]!;

      expect(Math.round(idle.spans / 3)).toBe(33);
      expect(Math.round(idle.spansTheCollectorSends / 3)).toBe(2);
    });

    test("a boot makes about 220, and it sends on about 110", () => {
      const boot: Summary = summary["native-always-on-boot"]!;

      expect(Math.abs(boot.spans - 220)).toBeLessThan(20);
      expect(Math.abs(boot.spansTheCollectorSends - 110)).toBeLessThan(15);
    });

    test.each([
      ["compute", 48, 32],
      ["network", 16, 18],
      ["image", 5, 8],
    ])(
      "%s answered in about the time the table says, off and on",
      (api: string, off: number, on: number) => {
        expect(Math.round(cost["off"]!.answers[api]!.p50Milliseconds)).toBe(
          off,
        );
        expect(Math.round(cost["on"]!.answers[api]!.p50Milliseconds)).toBe(on);
      },
    );

    test("two quiet minutes cost about a CPU-second more", () => {
      const off: Cost = cost["off"]!;
      const on: Cost = cost["on"]!;

      expect(off.quietSeconds).toBe(120);
      expect(on.quietSeconds).toBe(120);
      expect(off.cpuSecondsWhileQuietInAll.toFixed(1)).toBe("3.0");
      expect(on.cpuSecondsWhileQuietInAll.toFixed(1)).toBe("3.9");
    });
  });

  test("an idle cloud's spans are nearly all nova-compute's object calls", () => {
    const spans: Array<Read> = readScene("native-always-on-idle");
    const objectCalls: Array<Read> = spans.filter((span: Read): boolean => {
      return ["object_action", "object_class_action_versions"].includes(
        String(span.recorded.attributes["rpc.method"]),
      );
    });

    expect(spans.length).toBeGreaterThan(0);
    expect(objectCalls.length / spans.length).toBeGreaterThan(0.8);
  });
});
