import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "../../../Utils/OpenStack/OpenStackLogs";
import {
  getOpenStackPartAuditAttributes,
  getOpenStackPartChangeAttributes,
  getOpenStackPartLogAttributes,
} from "../../../Utils/OpenStack/OpenStackPartLogFacts";
import {
  OpenStackRequestJoin,
  OpenStackRequestSummary,
  OpenStackTrailRow,
  joinOpenStackRequest,
  readOpenStackLineRequest,
  summarizeOpenStackRequests,
} from "../../../Utils/OpenStack/OpenStackRequestTrail";

/*
 * One request followed across a cloud's services, and the part each of a cloud's logs and changes
 * belongs to. Pure: the pages read the rows, and these say what they mean.
 */

const REQUEST: string = "req-2d6c83a1-8d7d-4f53-a5a2-5cf0f9a5e0c1";
const OTHER: string = "req-a3f19c06-14e8-4a0c-9c9d-1a7b0d5a3e22";
const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";

function row(
  service: string,
  time: string,
  rootId: string = REQUEST,
  severityText: string = "Information",
  host: string = "controller",
): OpenStackTrailRow {
  return {
    time: new Date(time),
    severityText,
    attributes: {
      [OpenStackLogAttribute.Service]: service,
      [OpenStackLogAttribute.RequestRootId]: rootId,
      [OpenStackLogAttribute.Host]: host,
    },
  };
}

describe("the requests a part's lines belong to", () => {
  test("the one that failed comes first, then the newest", () => {
    const summaries: Array<OpenStackRequestSummary> =
      summarizeOpenStackRequests([
        row("nova-api", "2026-10-30T10:05:00Z", "req-newest"),
        row("nova-api", "2026-10-30T10:01:00Z", "req-older"),
        row("nova-conductor", "2026-10-30T10:00:01Z", "req-failed", "Error"),
        row("nova-api", "2026-10-30T10:00:00Z", "req-failed"),
      ]);

    expect(
      summaries.map((summary: OpenStackRequestSummary): string => {
        return summary.rootId;
      }),
    ).toEqual(["req-failed", "req-newest", "req-older"]);
    expect(summaries[0]?.failed).toBe(true);
    expect(summaries[0]?.services).toEqual(["nova-api", "nova-conductor"]);
    expect(summaries[0]?.lineCount).toBe(2);
    expect(summaries[0]?.firstAt?.toISOString()).toBe(
      "2026-10-30T10:00:00.000Z",
    );
    expect(summaries[0]?.lastAt?.toISOString()).toBe(
      "2026-10-30T10:00:01.000Z",
    );
  });

  test("a line that names no request is nobody's", () => {
    expect(
      summarizeOpenStackRequests([
        { time: new Date(), attributes: {} },
        { time: new Date(), attributes: null },
        { time: null },
        {
          time: new Date(),
          attributes: { [OpenStackLogAttribute.RequestRootId]: 12 },
        },
      ]),
    ).toEqual([]);
  });

  test("a time that is no time costs the line nothing", () => {
    const summaries: Array<OpenStackRequestSummary> =
      summarizeOpenStackRequests([
        {
          time: "not a time",
          attributes: { [OpenStackLogAttribute.RequestRootId]: REQUEST },
        },
      ]);

    expect(summaries[0]?.lineCount).toBe(1);
    expect(summaries[0]?.firstAt).toBeNull();
  });

  test.each(["Error", "Fatal"])("%s fails it", (severity: string) => {
    expect(
      summarizeOpenStackRequests([
        row("nova-api", "2026-10-30T10:00:00Z", REQUEST, severity),
      ])[0]?.failed,
    ).toBe(true);
  });

  test("a warning does not", () => {
    expect(
      summarizeOpenStackRequests([
        row("nova-api", "2026-10-30T10:00:00Z", REQUEST, "Warning"),
      ])[0]?.failed,
    ).toBe(false);
  });
});

describe("following a request across services", () => {
  const requestRows: Array<OpenStackTrailRow> = [
    row("nova-scheduler", "2026-10-30T10:00:02Z"),
    row("nova-api", "2026-10-30T10:00:00Z"),
    row(
      "nova-conductor",
      "2026-10-30T10:00:03Z",
      REQUEST,
      "Error",
      "controller.example.internal",
    ),
    row("nova-api", "2026-10-30T10:00:01Z"),
  ];

  test("says who joined, in the order they first wrote about it", () => {
    const join: OpenStackRequestJoin = joinOpenStackRequest({
      requestRows,
      windowRows: requestRows,
    });

    expect(
      join.joined.map((service: { service: string }): string => {
        return service.service;
      }),
    ).toEqual(["nova-api", "nova-scheduler", "nova-conductor"]);
    expect(join.joined[0]?.lineCount).toBe(2);
    expect(join.joined[2]?.failed).toBe(true);
    // By the machine's short name, as everything else about a host is.
    expect(join.joined[2]?.hosts).toEqual(["controller"]);
    expect(join.firstAt?.toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect(join.lastAt?.toISOString()).toBe("2026-10-30T10:00:03.000Z");
  });

  test("says who it could not join: a service busy with another request meanwhile", () => {
    const join: OpenStackRequestJoin = joinOpenStackRequest({
      requestRows,
      windowRows: [
        ...requestRows,
        row("neutron-server", "2026-10-30T10:00:02Z", OTHER),
        row("cinder-api", "2026-10-30T10:00:02Z", "req-yet-another"),
      ],
    });

    expect(join.notJoined).toEqual(["cinder-api", "neutron-server"]);
  });

  test("a service that joined is not also one it could not", () => {
    const join: OpenStackRequestJoin = joinOpenStackRequest({
      requestRows,
      windowRows: [row("nova-api", "2026-10-30T10:00:02Z", OTHER)],
    });

    expect(join.notJoined).toEqual([]);
  });

  test("a periodic task's line says nothing about whether a service was called", () => {
    const join: OpenStackRequestJoin = joinOpenStackRequest({
      requestRows,
      windowRows: [
        {
          time: new Date("2026-10-30T10:00:02Z"),
          attributes: { [OpenStackLogAttribute.Service]: "neutron-server" },
        },
      ],
    });

    expect(join.notJoined).toEqual([]);
  });

  test("nothing at all is nothing", () => {
    expect(joinOpenStackRequest({ requestRows: [], windowRows: [] })).toEqual({
      joined: [],
      notJoined: [],
      firstAt: null,
      lastAt: null,
    });
  });

  test("a line with no service of its own is still counted", () => {
    const join: OpenStackRequestJoin = joinOpenStackRequest({
      requestRows: [
        {
          time: new Date("2026-10-30T10:00:00Z"),
          attributes: { [OpenStackLogAttribute.RequestRootId]: REQUEST },
        },
      ],
      windowRows: [],
    });

    expect(join.joined[0]?.service).toBe("unknown");
  });
});

describe("the request a stored line belongs to", () => {
  test("is what it says, with the cloud it says it is of", () => {
    expect(
      readOpenStackLineRequest({
        [OpenStackLogAttribute.RequestRootId]: REQUEST,
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production",
      }),
    ).toEqual({ rootId: REQUEST, cloudName: "production" });
  });

  test.each([
    [null],
    [undefined],
    ["text"],
    [{}],
    [{ [OpenStackLogAttribute.RequestRootId]: REQUEST }],
    [{ [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production" }],
    [
      {
        [OpenStackLogAttribute.RequestRootId]: 12,
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production",
      },
    ],
    [
      {
        [OpenStackLogAttribute.RequestRootId]: "",
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production",
      },
    ],
  ])("%j has none", (attributes: unknown) => {
    expect(readOpenStackLineRequest(attributes)).toBeNull();
  });
});

describe("which logs are a part's", () => {
  test("an instance's name its UUID", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Instance,
        externalId: INSTANCE,
      }),
    ).toEqual({ [OpenStackLogAttribute.InstanceId]: INSTANCE });
  });

  test("a hypervisor's came from it, by its short name", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Hypervisor,
        externalId: "RegionOne/compute-01.example.internal",
        hypervisorName: "compute-01.example.internal",
      }),
    ).toEqual({ [OpenStackLogAttribute.Host]: "compute-01" });
  });

  test("a hypervisor named only by its row", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Hypervisor,
        externalId: "x",
        name: "compute-02.example.internal",
      }),
    ).toEqual({ [OpenStackLogAttribute.Host]: "compute-02" });
  });

  test("a worker's are its own, on its own machine", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Service,
        externalId: "RegionOne/compute/compute-01/nova-compute",
        name: "nova-compute",
        workerHost: "compute-01.example.internal",
      }),
    ).toEqual({
      [OpenStackLogAttribute.Service]: "nova-compute",
      [OpenStackLogAttribute.Host]: "compute-01",
    });
  });

  test("cinder-volume's host holds its backend, which no machine calls itself", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Service,
        externalId: "x",
        name: "cinder-volume",
        workerHost: "controller@lvmdriver-1",
      }),
    ).toEqual({
      [OpenStackLogAttribute.Service]: "cinder-volume",
      [OpenStackLogAttribute.Host]: "controller",
    });
  });

  test("a worker with no machine is all of its name", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Service,
        externalId: "x",
        name: "nova-compute",
      }),
    ).toEqual({ [OpenStackLogAttribute.Service]: "nova-compute" });
  });

  test.each([
    ["compute", "nova"],
    ["network", "neutron"],
    ["volume", "cinder"],
    ["image", "glance"],
    ["identity", "keystone"],
    ["placement", "placement"],
  ])("the %s API's are %s's", (name: string, component: string) => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Api,
        externalId: `RegionOne/${name}`,
        name,
      }),
    ).toEqual({ [OpenStackLogAttribute.Component]: component });
  });

  test.each([
    [OpenStackResourceKind.Volume],
    [OpenStackResourceKind.Network],
    [OpenStackResourceKind.Project],
    [OpenStackResourceKind.Flavor],
  ])("no line is said to be %s's", (kind: OpenStackResourceKind) => {
    expect(
      getOpenStackPartLogAttributes({ kind, externalId: "x", name: "y" }),
    ).toBeNull();
  });

  test("a part with nothing to go by has none", () => {
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Hypervisor,
        externalId: "x",
      }),
    ).toBeNull();
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Service,
        externalId: "x",
      }),
    ).toBeNull();
    expect(
      getOpenStackPartLogAttributes({
        kind: OpenStackResourceKind.Api,
        externalId: "x",
        name: "not-a-service",
      }),
    ).toBeNull();
  });
});

describe("which changes are a part's", () => {
  test.each([
    [OpenStackResourceKind.Instance],
    [OpenStackResourceKind.Volume],
    [OpenStackResourceKind.Image],
    [OpenStackResourceKind.Network],
    [OpenStackResourceKind.Router],
  ])("a %s's are what its own id names", (kind: OpenStackResourceKind) => {
    expect(
      getOpenStackPartChangeAttributes({ kind, externalId: "abc" }),
    ).toEqual({ "cloud.resource_id": "abc" });
    expect(
      getOpenStackPartAuditAttributes({ kind, externalId: "abc" }),
    ).toEqual({ "openstack.audit.target_id": "abc" });
  });

  test("a hypervisor's are all that happened on the machine", () => {
    expect(
      getOpenStackPartChangeAttributes({
        kind: OpenStackResourceKind.Hypervisor,
        externalId: "x",
        hypervisorName: "compute-01.example.internal",
      }),
    ).toEqual({ "openstack.host": "compute-01" });
  });

  test("a worker's are its own on its machine", () => {
    expect(
      getOpenStackPartChangeAttributes({
        kind: OpenStackResourceKind.Service,
        externalId: "x",
        name: "nova-compute",
        workerHost: "compute-01",
      }),
    ).toEqual({
      "openstack.service": "nova-compute",
      "openstack.host": "compute-01",
    });
  });

  test("a flavor's row holds its region, which no notification says", () => {
    expect(
      getOpenStackPartChangeAttributes({
        kind: OpenStackResourceKind.Flavor,
        externalId: "RegionOne/f1",
      }),
    ).toBeNull();
  });

  test("an API has no change of its own, and a worker's calls name a record this cannot know", () => {
    expect(
      getOpenStackPartChangeAttributes({
        kind: OpenStackResourceKind.Api,
        externalId: "x",
        name: "compute",
      }),
    ).toBeNull();
    expect(
      getOpenStackPartAuditAttributes({
        kind: OpenStackResourceKind.Service,
        externalId: "x",
        name: "nova-compute",
      }),
    ).toBeNull();
  });
});
