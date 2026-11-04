import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OSPROFILER_ATTRIBUTES_NEVER_STORED,
  OSPROFILER_DRIVER_SCOPE_NAME,
  OpenStackDriverService,
  OpenStackDriverSpan,
  OpenStackTraceAttribute,
  OpenStackTraceResource,
  getOpenStackApiOfTracedService,
  getOpenStackPathInSpanName,
  getOpenStackTraceBootCommand,
  getOpenStackTraceDeleteCommand,
  getOpenStackTraceListCommand,
  getOpenStackTracedServiceName,
  getOpenStackTracedServiceOfApi,
  isOSProfilerDriverScope,
  isOpenStackDashedUuid,
  normalizeOSProfilerResourceInPlace,
  quoteForOpenStackCommand,
  readOSProfilerSpanInPlace,
  readOpenStackDriverParentSpanId,
  readOpenStackDriverService,
  readOpenStackDriverSpanKind,
  readOpenStackDriverSpanName,
  readOpenStackRequestResources,
  readOpenStackSpanResources,
  readOpenStackTraceId,
  readOpenStackTracedServices,
  withoutOpenStackCloudName,
} from "../../../Utils/OpenStack/OpenStackTraces";

/*
 * How a span from OSProfiler's OTLP driver is read, one rule at a time. The inputs here are
 * written by hand from the driver's source, osprofiler/drivers/otlp.py, to pin each rule on
 * its own. OpenStackTracesRecordings.test.ts holds the same rules to what the driver really
 * sent on real clouds, and where the two ever disagree, the recording is right.
 */

const INSTANCE: string = "5f2a3a1c-7c11-4a55-9b1e-0a7a7d3f9c11";
const VOLUME: string = "9d1f0f6e-1f3b-4d6a-8a55-7a4f7b1d2c33";
const NETWORK: string = "1b6f6d2a-0a5e-4f8c-9a77-3c2e1d0f9b44";
const PROJECT_HEX: string = "0a1b2c3d4e5f60718293a4b5c6d7e8f9";

describe("the service a driver's name means", () => {
  test.each([
    // <project>-<binary>, as Nova, Cinder and Neutron call init_from_conf.
    ["nova-nova-compute", "nova-compute", "nova"],
    ["nova-nova-conductor", "nova-conductor", "nova"],
    ["nova-nova-scheduler", "nova-scheduler", "nova"],
    ["cinder-cinder-api", "cinder-api", "cinder"],
    ["cinder-cinder-volume", "cinder-volume", "cinder"],
    ["neutron-neutron-server", "neutron-server", "neutron"],
    // What each names an application that is not a binary.
    ["nova-osapi_compute", "nova-api", "nova"],
    ["nova-metadata", "nova-api-metadata", "nova"],
    ["keystone-public", "keystone", "keystone"],
    ["glance-api", "glance-api", "glance"],
    ["placement-placement", "placement-api", "placement"],
  ])("%s is %s", (driverName: string, service: string, component: string) => {
    expect(readOpenStackDriverService(driverName)).toEqual({
      service,
      component,
    });
  });

  test("a [profiler_otlp] service_name_prefix comes off", () => {
    expect(readOpenStackDriverService("prod-eu-nova-nova-compute")).toEqual({
      service: "nova-compute",
      component: "nova",
    });
  });

  test("a project nobody knows keeps its name, rather than none", () => {
    expect(readOpenStackDriverService("acme-acme-thing")).toEqual({
      service: "acme-acme-thing",
      component: "acme",
    });
  });

  test("a binary that does not start with its project stays whole", () => {
    expect(readOpenStackDriverService("heat-engine").service).toBe(
      "heat-engine",
    );
  });

  test("two clouds in a project keep their services apart", () => {
    expect(
      getOpenStackTracedServiceName({ service: "nova-api", cloudName: "east" }),
    ).toBe("east/nova-api");
    expect(
      getOpenStackTracedServiceName({ service: "nova-api", cloudName: "west" }),
    ).toBe("west/nova-api");
  });

  test("a span from a machine that stamps no cloud is still named well", () => {
    expect(
      getOpenStackTracedServiceName({ service: "nova-api", cloudName: "" }),
    ).toBe("nova-api");
  });

  test("a page about one cloud names its services without it", () => {
    expect(
      withoutOpenStackCloudName({
        serviceName: "east/nova-api",
        cloudName: "east",
      }),
    ).toBe("nova-api");
    expect(
      withoutOpenStackCloudName({
        serviceName: "west/nova-api",
        cloudName: "east",
      }),
    ).toBe("west/nova-api");
  });

  test("an API's row and a trace's name for it go both ways", () => {
    for (const type of [
      "compute",
      "identity",
      "image",
      "network",
      "placement",
      "volume",
    ]) {
      expect(
        getOpenStackApiOfTracedService(getOpenStackTracedServiceOfApi(type)),
      ).toBe(type);
    }
    expect(getOpenStackApiOfTracedService("nova-compute")).toBeNull();
    expect(getOpenStackTracedServiceOfApi("not-a-service")).toBe("");
  });
});

describe("a block of OTLP, on the wire", () => {
  function block(data: {
    scope: string;
    serviceName?: string;
    cloudName?: string;
  }): JSONObject {
    return {
      resource: {
        attributes: [
          ...(data.serviceName
            ? [
                {
                  key: "service.name",
                  value: { stringValue: data.serviceName },
                },
              ]
            : []),
          ...(data.cloudName
            ? [
                {
                  key: "openstack.cloud.name",
                  value: { stringValue: data.cloudName },
                },
              ]
            : []),
        ],
      },
      scopeSpans: [{ scope: { name: data.scope }, spans: [] }],
    };
  }

  function attributesOf(resourceSpans: JSONObject): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const attribute of (resourceSpans["resource"] as JSONObject)[
      "attributes"
    ] as Array<JSONObject>) {
      out[attribute["key"] as string] = (attribute["value"] as JSONObject)[
        "stringValue"
      ];
    }

    return out;
  }

  test("the driver's scope is the only thing that says it is the driver's", () => {
    expect(
      isOSProfilerDriverScope({ name: OSPROFILER_DRIVER_SCOPE_NAME }),
    ).toBe(true);
    expect(isOSProfilerDriverScope({ name: "my.app" })).toBe(false);
    expect(isOSProfilerDriverScope(undefined)).toBe(false);
    expect(isOSProfilerDriverScope("osprofiler.drivers.otlp")).toBe(false);
  });

  test("its service gets the name operators know, under its cloud", () => {
    const resourceSpans: JSONObject = block({
      scope: OSPROFILER_DRIVER_SCOPE_NAME,
      serviceName: "nova-nova-compute",
      cloudName: "east",
    });

    const read: OpenStackDriverService | null =
      normalizeOSProfilerResourceInPlace(resourceSpans);

    expect(read).toEqual({ service: "nova-compute", component: "nova" });
    expect(attributesOf(resourceSpans)).toEqual({
      "service.name": "east/nova-compute",
      "openstack.cloud.name": "east",
      [OpenStackTraceAttribute.DriverService]: "nova-nova-compute",
    });
  });

  test("anyone else's block is left exactly as it came", () => {
    const resourceSpans: JSONObject = block({
      scope: "my.app",
      serviceName: "nova-nova-compute",
      cloudName: "east",
    });
    const before: string = JSON.stringify(resourceSpans);

    expect(normalizeOSProfilerResourceInPlace(resourceSpans)).toBeNull();
    expect(JSON.stringify(resourceSpans)).toBe(before);
  });

  test("a block with no name, and a malformed one, are left alone", () => {
    expect(
      normalizeOSProfilerResourceInPlace(
        block({ scope: OSPROFILER_DRIVER_SCOPE_NAME }),
      ),
    ).toBeNull();
    expect(normalizeOSProfilerResourceInPlace({})).toBeNull();
    expect(
      normalizeOSProfilerResourceInPlace({ scopeSpans: "not a list" }),
    ).toBeNull();
    expect(
      normalizeOSProfilerResourceInPlace({
        scopeSpans: [{ scope: { name: OSPROFILER_DRIVER_SCOPE_NAME } }],
      }),
    ).toBeNull();
  });
});

describe("what a request names", () => {
  test.each([
    // DevStack puts each API under a prefix, and Kolla-Ansible on a port of its own.
    [`/compute/v2.1/servers/${INSTANCE}`],
    [`/v2.1/servers/${INSTANCE}`],
    [`/compute/v2.1/servers/${INSTANCE}/action`],
    // Placement calls an instance a consumer, which is what ties a boot's calls to it.
    [`/placement/allocations/${INSTANCE}`],
    [`/allocations/${INSTANCE}`],
  ])("%s names the instance", (path: string) => {
    expect(readOpenStackRequestResources({ path })).toEqual([
      { kind: OpenStackResourceKind.Instance, id: INSTANCE },
    ]);
  });

  test.each([
    ["ports", "device_id", OpenStackResourceKind.Instance],
    ["attachments", "instance_id", OpenStackResourceKind.Instance],
    ["ports", "network_id", OpenStackResourceKind.Network],
  ])(
    "GET /%s?%s names it in the query",
    (collection: string, parameter: string, kind: OpenStackResourceKind) => {
      expect(
        readOpenStackRequestResources({
          path: `/${collection}`,
          query: `limit=1&${parameter}=${INSTANCE}&fields=id`,
        }),
      ).toEqual([{ kind, id: INSTANCE }]);
    },
  );

  test("Cinder's project is right after the version, and Keystone's id has no dashes", () => {
    expect(
      readOpenStackRequestResources({
        path: `/volume/v3/${PROJECT_HEX}/volumes/${VOLUME}`,
      }),
    ).toEqual([
      { kind: OpenStackResourceKind.Project, id: PROJECT_HEX },
      { kind: OpenStackResourceKind.Volume, id: VOLUME },
    ]);
  });

  test("a volume attached to an instance names both", () => {
    expect(
      readOpenStackRequestResources({
        path: `/v2.1/servers/${INSTANCE}/os-volume_attachments/${VOLUME}`,
      }),
    ).toEqual([
      { kind: OpenStackResourceKind.Instance, id: INSTANCE },
      { kind: OpenStackResourceKind.Volume, id: VOLUME },
    ]);
  });

  test("the other kinds a request can name", () => {
    expect(
      readOpenStackRequestResources({
        path: `/networking/v2.0/networks/${NETWORK}`,
      }),
    ).toEqual([{ kind: OpenStackResourceKind.Network, id: NETWORK }]);
    expect(
      readOpenStackRequestResources({ path: `/image/v2/images/${INSTANCE}` }),
    ).toEqual([{ kind: OpenStackResourceKind.Image, id: INSTANCE }]);
    expect(
      readOpenStackRequestResources({
        path: `/identity/v3/projects/${PROJECT_HEX}`,
      }),
    ).toEqual([{ kind: OpenStackResourceKind.Project, id: PROJECT_HEX }]);
  });

  test("a word in a path's place is not an id", () => {
    expect(
      readOpenStackRequestResources({ path: "/compute/v2.1/servers/detail" }),
    ).toEqual([]);
    expect(
      readOpenStackRequestResources({ path: "/v2.1/flavors/ou.tiny" }),
    ).toEqual([]);
    expect(readOpenStackRequestResources({ path: "/" })).toEqual([]);
    expect(readOpenStackRequestResources({})).toEqual([]);
    expect(
      readOpenStackRequestResources({ query: "device_id=not-an-id" }),
    ).toEqual([]);
  });

  test("an id under a word nobody knows names nothing", () => {
    expect(
      readOpenStackRequestResources({ path: `/v2.1/widgets/${INSTANCE}` }),
    ).toEqual([]);
  });

  test("the same part said twice is one", () => {
    expect(
      readOpenStackRequestResources({
        path: `/v2.1/servers/${INSTANCE}`,
        query: `device_id=${INSTANCE}`,
      }),
    ).toEqual([{ kind: OpenStackResourceKind.Instance, id: INSTANCE }]);
  });

  test("however many a request says, a span holds a few", () => {
    const query: string = Array.from({ length: 200 })
      .map((_value: unknown, index: number): string => {
        return `device_id=${index.toString(16).padStart(32, "0")}`;
      })
      .join("&");

    expect(
      readOpenStackRequestResources({ query }).length,
    ).toBeLessThanOrEqual(8);
  });

  test("what a stored span says it touched reads back", () => {
    const resources: Array<OpenStackTraceResource> = readOpenStackSpanResources(
      {
        "openstack.instance_id": INSTANCE,
        "openstack.volume_id": VOLUME,
        "http.path": "/ignored",
      },
    );

    expect(resources).toEqual([
      { kind: OpenStackResourceKind.Instance, id: INSTANCE },
      { kind: OpenStackResourceKind.Volume, id: VOLUME },
    ]);
    expect(readOpenStackSpanResources(null)).toEqual([]);
  });

  test("a path of a megabyte is read in a moment", () => {
    const path: string = `/servers/${"x/".repeat(512 * 1024)}`;
    const started: number = Date.now();

    readOpenStackRequestResources({ path, query: "a=b&".repeat(256 * 1024) });

    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("the name a span is stored under", () => {
  test("the same call has the same name, whichever instance it is about", () => {
    expect(
      getOpenStackPathInSpanName(`/compute/v2.1/servers/${INSTANCE}/action`),
    ).toBe("/compute/v2.1/servers/{id}/action");
    expect(
      getOpenStackPathInSpanName(`/volume/v3/${PROJECT_HEX}/volumes/${VOLUME}`),
    ).toBe("/volume/v3/{id}/volumes/{id}");
    expect(getOpenStackPathInSpanName("/v2.1/os-hypervisors/12")).toBe(
      "/v2.1/os-hypervisors/{id}",
    );
    expect(getOpenStackPathInSpanName("/v2.1/flavors/ou.tiny")).toBe(
      "/v2.1/flavors/ou.tiny",
    );
    expect(getOpenStackPathInSpanName("/")).toBe("/");
  });

  test("a request a service answered", () => {
    expect(
      readOpenStackDriverSpanName({
        name: `WSGI_POST_/v2.1/servers/${INSTANCE}/action`,
        attributes: {
          "http.method": "POST",
          "http.path": `/v2.1/servers/${INSTANCE}/action`,
        },
      }),
    ).toBe("POST /v2.1/servers/{id}/action");
  });

  test("a request a service sent", () => {
    expect(
      readOpenStackDriverSpanName({
        name: "REQUESTS_PUT_10.0.0.1",
        attributes: {
          "http.method": "PUT",
          "http.path": `/placement/allocations/${INSTANCE}`,
        },
      }),
    ).toBe("PUT /placement/allocations/{id}");
  });

  test("a statement", () => {
    expect(
      readOpenStackDriverSpanName({ name: "SQL_SELECT", attributes: {} }),
    ).toBe("SQL SELECT");
  });

  test("a traced function says which, with its package left to its attribute", () => {
    expect(
      readOpenStackDriverSpanName({
        name: "rpc",
        attributes: {
          name: "nova.compute.manager.ComputeManager.build_and_run_instance",
        },
      }),
    ).toBe("rpc ComputeManager.build_and_run_instance");
  });

  test("what the driver's rstrip ate is put back", () => {
    expect(
      readOpenStackDriverSpanName({
        name: "schedule",
        attributes: { name: "nova.scheduler.manager.SchedulerManager.select" },
      }),
    ).toBe("scheduler SchedulerManager.select");
  });

  test("a word with nothing to go with it stays", () => {
    expect(
      readOpenStackDriverSpanName({ name: "vif_driver", attributes: {} }),
    ).toBe("vif_driver");
  });
});

describe("the kind a span is stored with", () => {
  test("an RPC call's two sides are what they are, so a service map can draw them", () => {
    expect(
      readOpenStackDriverSpanKind({
        kind: "SPAN_KIND_INTERNAL",
        name: "rpc",
        attributes: {
          name: "nova.conductor.rpcapi.ComputeTaskAPI.schedule_and_build_instances",
        },
      }),
    ).toBe("SPAN_KIND_PRODUCER");
    expect(
      readOpenStackDriverSpanKind({
        kind: "SPAN_KIND_INTERNAL",
        name: "rpc",
        attributes: {
          name: "nova.conductor.manager.ComputeTaskManager.schedule_and_build_instances",
        },
      }),
    ).toBe("SPAN_KIND_CONSUMER");
  });

  test("a request a service answered is an entry", () => {
    expect(
      readOpenStackDriverSpanKind({
        kind: "SPAN_KIND_SERVER",
        name: "WSGI_GET_/v2.1/servers",
        attributes: {},
      }),
    ).toBe("SPAN_KIND_SERVER");
  });

  test("what the driver called anything else stands", () => {
    expect(
      readOpenStackDriverSpanKind({
        kind: "SPAN_KIND_CLIENT",
        name: "neutron_api",
        attributes: { name: "nova.network.neutron.API.allocate_for_instance" },
      }),
    ).toBe("SPAN_KIND_CLIENT");
    expect(
      readOpenStackDriverSpanKind({
        kind: "SPAN_KIND_INTERNAL",
        name: "rpc",
        attributes: {},
      }),
    ).toBe("SPAN_KIND_INTERNAL");
  });
});

describe("the parent a span really has", () => {
  const traceId: string = "4e3e0ec6293840b1850409eb1d4b0dee";

  test("before 4.4.0 a first span's parent is the low half of the trace: never sent", () => {
    expect(
      readOpenStackDriverParentSpanId({
        traceId,
        parentSpanId: "850409eb1d4b0dee",
      }),
    ).toBe("");
  });

  test("from 4.4.0 it has none", () => {
    expect(readOpenStackDriverParentSpanId({ traceId, parentSpanId: "" })).toBe(
      "",
    );
  });

  test("any other parent stands", () => {
    expect(
      readOpenStackDriverParentSpanId({
        traceId,
        parentSpanId: "1c089ea828fe4f3d",
      }),
    ).toBe("1c089ea828fe4f3d");
  });
});

describe("one span, read as it arrives", () => {
  function read(data: {
    name?: string;
    attributes?: JSONObject;
    events?: unknown;
    parentSpanId?: string;
  }): { span: OpenStackDriverSpan; attributes: JSONObject } {
    const attributes: JSONObject = { ...(data.attributes || {}) };
    const span: OpenStackDriverSpan = readOSProfilerSpanInPlace({
      name: data.name || "rpc",
      kind: "SPAN_KIND_INTERNAL",
      traceId: "4e3e0ec6293840b1850409eb1d4b0dee",
      parentSpanId: data.parentSpanId || "1c089ea828fe4f3d",
      attributes: attributes,
      events: data.events,
      service: { service: "nova-compute", component: "nova" },
    });

    return { span, attributes };
  }

  test("what a call was handed never reaches storage", () => {
    const { attributes } = read({
      attributes: {
        args: "(<nova.compute.manager.ComputeManager object>,)",
        kwargs:
          "{'admin_password': 'hunter2', 'injected_files': [], 'user_data': 'c2VjcmV0'}",
        result: "'something'",
        "db.params": '{"password": "hunter2"}',
        "db.statement": "SELECT 1",
      },
    });

    for (const key of OSPROFILER_ATTRIBUTES_NEVER_STORED) {
      expect(attributes[key]).toBeUndefined();
    }
    expect(JSON.stringify(attributes)).not.toContain("hunter2");
    expect(attributes["db.statement"]).toBe("SELECT 1");
  });

  test("an attribute nobody has read is dropped, because the driver is experimental", () => {
    const { attributes } = read({
      attributes: {
        "http.path": "/v2.1/servers",
        "function.something_new": "password=hunter2",
        kwargs_v2: "{'admin_password': 'hunter2'}",
      },
    });

    expect(attributes["http.path"]).toBe("/v2.1/servers");
    expect(attributes["function.something_new"]).toBeUndefined();
    expect(attributes["kwargs_v2"]).toBeUndefined();
  });

  test("what ingest and the collector put there stays", () => {
    const { attributes } = read({
      attributes: {
        "resource.openstack.cloud.name": "east",
        "resource.openstack.node.name": "compute-01",
        "scope.name": OSPROFILER_DRIVER_SCOPE_NAME,
        "oneuptime.service.name": "east/nova-compute",
      },
    });

    expect(attributes["resource.openstack.cloud.name"]).toBe("east");
    expect(attributes["resource.openstack.node.name"]).toBe("compute-01");
    expect(attributes["scope.name"]).toBe(OSPROFILER_DRIVER_SCOPE_NAME);
    expect(attributes["oneuptime.service.name"]).toBe("east/nova-compute");
  });

  test("it says which service it is from, in the words logs use", () => {
    const { attributes } = read({});

    expect(attributes["openstack.service"]).toBe("nova-compute");
    expect(attributes["openstack.component"]).toBe("nova");
  });

  test("it says what it touched", () => {
    const { attributes } = read({
      name: `WSGI_PUT_/placement/allocations/${INSTANCE}`,
      attributes: {
        "http.method": "PUT",
        "http.path": `/placement/allocations/${INSTANCE}`,
      },
    });

    expect(attributes["openstack.instance_id"]).toBe(INSTANCE);
  });

  test("a secret in a query goes, and what names a part stays", () => {
    const { attributes } = read({
      attributes: {
        "http.path": "/v2.0/ports",
        "http.query": `device_id=${INSTANCE}&token=gAAAAABhunter2`,
      },
    });

    expect(attributes["http.query"]).not.toContain("hunter2");
    expect(attributes["openstack.instance_id"]).toBe(INSTANCE);
  });

  test("a console's token, the one secret an API holds in its path, goes", () => {
    const { attributes } = read({
      attributes: {
        "http.path": `/v2.1/os-console-auth-tokens/${INSTANCE}`,
      },
    });

    expect(attributes["http.path"]).toBe(
      "/v2.1/os-console-auth-tokens/[REDACTED]",
    );
  });

  test("a span that succeeded says nothing of failure", () => {
    const { span } = read({});

    expect(span.isFailed).toBe(false);
    expect(span.statusMessage).toBe("");
  });

  test("a failure is the driver's attribute and event, read as a failure", () => {
    const events: unknown = [
      {
        name: "log",
        attributes: [
          {
            key: "error.kind",
            value: { stringValue: "nova.exception.NoValidHost" },
          },
          {
            key: "message",
            value: { stringValue: "No valid host was found." },
          },
        ],
      },
    ];
    const { span } = read({ attributes: { error: true }, events });

    expect(span.isFailed).toBe(true);
    expect(span.statusMessage).toBe(
      "nova.exception.NoValidHost: No valid host was found.",
    );
  });

  test("a secret in a failure's words goes", () => {
    const events: Array<JSONObject> = [
      {
        name: "log",
        attributes: [
          {
            key: "message",
            value: { stringValue: "login failed password=hunter2" },
          },
        ],
      },
    ];
    const { span } = read({ attributes: { error: true }, events });

    expect(JSON.stringify(events)).not.toContain("hunter2");
    expect(span.statusMessage).not.toContain("hunter2");
  });

  test("a failure's words are kept to a reasonable length", () => {
    const { span } = read({
      attributes: { error: true },
      events: [
        {
          name: "log",
          attributes: [
            { key: "message", value: { stringValue: "x".repeat(100000) } },
          ],
        },
      ],
    });

    expect(span.statusMessage.length).toBeLessThanOrEqual(1024);
  });

  test("a call a service sent that was answered with a server's error failed", () => {
    expect(read({ attributes: { status_code: 503 } }).span.isFailed).toBe(true);
    expect(read({ attributes: { status_code: "503" } }).span.isFailed).toBe(
      true,
    );
  });

  test("a 404 is what looking a name up is, not a failure", () => {
    expect(read({ attributes: { status_code: 404 } }).span.isFailed).toBe(
      false,
    );
  });

  test("events that are not what the driver writes are left alone", () => {
    expect(read({ events: "not a list" }).span.isFailed).toBe(false);
    expect(read({ events: [null, { attributes: "no" }] }).span.isFailed).toBe(
      false,
    );
  });
});

describe("from what the client prints to the trace", () => {
  const hex: string = "4e3e0ec6293840b1850409eb1d4b0dee";

  test.each([
    ["the bare ID", "4e3e0ec6-2938-40b1-8504-09eb1d4b0dee"],
    ["the whole line", "Trace ID: 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee"],
    ["with space around it", "  Trace ID: 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee\n"],
    ["in capitals", "4E3E0EC6-2938-40B1-8504-09EB1D4B0DEE"],
    ["already as OTLP's", hex],
    [
      "from the line that shows the command",
      "osprofiler trace show --html 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee ",
    ],
  ])("%s", (_name: string, text: string) => {
    expect(readOpenStackTraceId(text)).toBe(hex);
  });

  test.each([
    ["nothing", ""],
    ["no ID", "Trace ID:"],
    // The low half is all it holds, and a trace cannot be found from it.
    ["the short ID the client also prints", "850409eb1d4b0dee"],
    ["a request ID", "req-4e3e0ec6-2938-40b1-8504"],
  ])("%s is not one", (_name: string, text: string) => {
    expect(readOpenStackTraceId(text)).toBeNull();
  });

  test("null and undefined are not one", () => {
    expect(readOpenStackTraceId(null)).toBeNull();
    expect(readOpenStackTraceId(undefined)).toBeNull();
  });

  test("a dashed ID is told apart from one that only looks like it", () => {
    expect(isOpenStackDashedUuid("4e3e0ec6-2938-40b1-8504-09eb1d4b0dee")).toBe(
      true,
    );
    expect(isOpenStackDashedUuid("4e3e0ec6-2938-40b1-8504-09eb1d4b0de")).toBe(
      false,
    );
    expect(isOpenStackDashedUuid("4e3e0ec6x2938-40b1-8504-09eb1d4b0dee")).toBe(
      false,
    );
    expect(isOpenStackDashedUuid("ge3e0ec6-2938-40b1-8504-09eb1d4b0dee")).toBe(
      false,
    );
  });

  test("a megabyte pasted is read in a moment", () => {
    const started: number = Date.now();

    readOpenStackTraceId("-".repeat(1024 * 1024));

    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("the commands that sign a request", () => {
  test("listing changes nothing, and names a region only when asked", () => {
    expect(getOpenStackTraceListCommand({})).toBe("openstack server list");
    expect(getOpenStackTraceListCommand({ regionName: "RegionTwo" })).toBe(
      "openstack --os-region-name RegionTwo server list",
    );
  });

  test("a boot asks for what this cloud has", () => {
    expect(
      getOpenStackTraceBootCommand({
        flavor: "m1.tiny",
        image: "cirros-0.6.2",
        network: "private",
      }),
    ).toBe(
      "openstack server create --wait --flavor m1.tiny --image cirros-0.6.2 --network private oneuptime-trace-test",
    );
  });

  test("what is not known is left for the person to fill in", () => {
    expect(getOpenStackTraceBootCommand({})).toBe(
      "openstack server create --wait --flavor <flavor> --image <image> --network <network> oneuptime-trace-test",
    );
  });

  test("a delete goes after what the boot made", () => {
    expect(getOpenStackTraceDeleteCommand({})).toBe(
      "openstack server delete --wait oneuptime-trace-test",
    );
  });

  test("a name a shell would read differently is quoted", () => {
    expect(quoteForOpenStackCommand("m1.tiny")).toBe("m1.tiny");
    expect(quoteForOpenStackCommand("Ubuntu 24.04")).toBe("'Ubuntu 24.04'");
    expect(quoteForOpenStackCommand("it's")).toBe("'it'\\''s'");
    expect(quoteForOpenStackCommand("$(reboot)")).toBe("'$(reboot)'");
    expect(quoteForOpenStackCommand("")).toBe("''");
    expect(
      getOpenStackTraceBootCommand({
        flavor: "m1.tiny",
        image: "Ubuntu 24.04",
        network: "private",
      }),
    ).toContain("--image 'Ubuntu 24.04'");
  });

  test("a region a shell would read differently is quoted", () => {
    expect(
      getOpenStackTraceListCommand({ regionName: "Region One" }),
    ).toBe("openstack --os-region-name 'Region One' server list");
  });
});

describe("what a cloud's spans say about its tracing", () => {
  test("nothing yet is nothing, not a mistake", () => {
    expect(readOpenStackTracedServices([])).toEqual({
      lastSpanAt: null,
      services: [],
      traceIds: [],
    });
  });

  test("which services have sent a span, and the newest trace first", () => {
    const read: ReturnType<typeof readOpenStackTracedServices> =
      readOpenStackTracedServices([
        {
          startTime: "2026-11-04T10:00:00Z",
          traceId: "older",
          attributes: { "openstack.service": "nova-api" },
        },
        {
          startTime: new Date("2026-11-04T12:00:00Z"),
          traceId: "newer",
          attributes: { "openstack.service": "neutron-server" },
        },
        {
          startTime: "2026-11-04T11:00:00Z",
          traceId: "older",
          attributes: { "openstack.service": "nova-api" },
        },
      ]);

    expect(read.services).toEqual(["neutron-server", "nova-api"]);
    expect(read.traceIds).toEqual(["newer", "older"]);
    expect(read.lastSpanAt?.toISOString()).toBe("2026-11-04T12:00:00.000Z");
  });

  test("a row that says little costs nothing", () => {
    const read: ReturnType<typeof readOpenStackTracedServices> =
      readOpenStackTracedServices([
        { startTime: null, traceId: null, attributes: null },
        { startTime: "not a date", traceId: "", attributes: {} },
        { attributes: { "openstack.service": 12 } as JSONObject },
      ]);

    expect(read).toEqual({ lastSpanAt: null, services: [], traceIds: [] });
  });
});
