import { describe, expect, test } from "@jest/globals";
import {
  OpenStackTraceRecording,
  RecordedSpan,
} from "../../Helpers/OpenStackTraceRecordings";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackLogAttribute } from "../../../Utils/OpenStack/OpenStackLogs";
import {
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
    // The other is only the same service at the same moment, and says so.
    expect(requests[1]).toMatchObject({
      rootId: "req-other",
      match: OpenStackTraceRequestMatch.SameMoment,
    });
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
 * What really came. `native-with-osprofiler-boot` was signed, and oslo's spans in it are their own
 * traces beside OSProfiler's, which is the shape a cloud with the guide's setup sends.
 */
describe("on a real 2026.2", () => {
  const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
    "hibiscus-ovn",
  );
  const SCENE: string = "native-with-osprofiler-boot";

  interface Read {
    recorded: RecordedSpan;
    service: string;
    read: OpenStackDriverSpan;
  }

  function readBoot(): Array<Read> {
    const services: Map<JSONObject, OpenStackDriverService> = new Map();
    const spans: Array<Read> = [];

    for (const recorded of recording.spans(SCENE, "native")) {
      if (recorded.scopeName === OSPROFILER_DRIVER_SCOPE_NAME) {
        continue;
      }

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

  function theBoot(spans: Array<Read>): Array<Read> {
    const root: Read = spans.find((span: Read): boolean => {
      return span.read.name === "POST /compute/v2.1/servers";
    })!;

    return spans.filter((span: Read): boolean => {
      return span.recorded.traceId === root.recorded.traceId;
    });
  }

  test("a boot is one trace from Nova's API through its conductor and scheduler to its compute", () => {
    const boot: Array<Read> = theBoot(readBoot());

    expect(
      Array.from(
        new Set(
          boot.map((span: Read): string => {
            return span.service;
          }),
        ),
      ).sort(),
    ).toEqual(["nova-api", "nova-compute", "nova-conductor", "nova-scheduler"]);

    const ids: Set<string> = new Set(
      boot.map((span: Read): string => {
        return span.recorded.spanId;
      }),
    );

    for (const span of boot) {
      // Each hop names the one before it: nothing here is a guess from the time it ran.
      if (span.read.name !== "POST /compute/v2.1/servers") {
        expect(ids.has(span.read.parentSpanId)).toBe(true);
      }
    }
  });

  test("its RPC spans each hold one request's ID, and its HTTP span none", () => {
    const boot: Array<Read> = theBoot(readBoot());
    const named: Set<string> = new Set<string>();

    for (const span of boot) {
      const requestId: unknown =
        span.recorded.attributes["openstack.request_id"];

      if (span.recorded.scopeName === OSLO_MESSAGING_SCOPE_NAME) {
        expect(typeof requestId).toBe("string");
        named.add(requestId as string);
      } else {
        expect(requestId).toBeUndefined();
      }
    }

    expect(named.size).toBe(1);
  });

  test("every span says which service it is, in the word an operator knows", () => {
    const words: Set<string> = new Set<string>();

    for (const span of readBoot()) {
      words.add(span.service);
      expect(span.recorded.attributes["openstack.service"]).toBe(span.service);
      expect(span.recorded.attributes["http.url"]).toBeUndefined();
    }

    expect(Array.from(words)).toEqual(
      expect.arrayContaining(["nova-api", "neutron-server", "glance-api"]),
    );
    expect(Array.from(words)).not.toContain("nova-nova-compute");
    expect(Array.from(words)).not.toContain("nova-osapi_compute");
  });

  test("nothing crosses an HTTP call as OpenStack ships it", () => {
    const spans: Array<Read> = readBoot();
    const carried: Array<Read> = spans.filter((span: Read): boolean => {
      return (
        span.recorded.scopeName === OSLO_MIDDLEWARE_SCOPE_NAME &&
        Boolean(span.recorded.parentSpanId)
      );
    });

    expect(carried).toEqual([]);
  });
});
