import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackAccessRead,
  OpenStackCollectionReport,
  OpenStackConnectionTestReport,
  OpenStackConnectionTestSummary,
  OpenStackCredential,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_ACCESS_READS,
  OpenStackAccessReadDefinition,
  classifyAccessFailure,
  classifyAccessList,
  getOpenStackAccessLevel,
} from "../../../Utils/OpenStack/OpenStackAccessCheck";
import { OpenStackApiError } from "../../../Utils/OpenStack/OpenStackCollectionErrors";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import { OpenStackCertificateError } from "../../../Utils/OpenStack/OpenStackTls";
import {
  AccessMatrixFile,
  AccessMatrixRead,
  answerAsCredential,
  loadAccessMatrix,
  ownProjectOf,
} from "./Helpers/AccessMatrix";
import {
  CollectorHarness,
  ReportedDatapoint,
  SECRET,
  collectionJob,
  connectionTestJob,
  createCollectorHarness,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  RECORDED_AUTH_URL,
  RECORDED_REGION,
  RecordedCloud,
  RecordedScene,
  createRecordedCloud,
  jsonAnswer,
  loadScene,
  recordedTokenBody,
} from "./Helpers/RecordedCloud";

/*
 * A connection test: log in, see what this credential can really read in each region, log
 * out. A person is waiting, and what they need back is which of the three levels of access
 * they have, which pages go without what, and the line that opens each. Every failure it
 * names has a test here or, where it takes a real socket, in OpenStackTlsAndHttp.test.ts.
 */

const HEALTHY: RecordedScene = loadScene("hibiscus-ovn", "healthy");

// A project of its own: what the docs tell a monitoring credential to live on.
const EMPTY_PROJECT: JSONObject = {
  id: "a-project-of-its-own",
  name: "ou-monitoring",
};

const PASSWORD_CREDENTIAL: OpenStackCredential = {
  kind: "password",
  username: "monitor",
  userDomainName: "Default",
  password: SECRET,
  projectName: "monitoring",
  projectDomainName: "Default",
};

async function runTest(data: {
  scene?: RecordedScene;
  answer?: (request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined;
  tokenOverrides?: JSONObject;
  credential?: OpenStackCredential;
  regions?: Array<string>;
  endpointInterface?: "public" | "internal" | "admin";
}): Promise<{
  report: OpenStackConnectionTestReport;
  summary: OpenStackConnectionTestSummary;
  cloud: RecordedCloud;
  harness: CollectorHarness;
}> {
  const cloud: RecordedCloud = createRecordedCloud(data.scene || HEALTHY, {
    answer: data.answer,
    tokenOverrides: data.tokenOverrides,
  });
  const harness: CollectorHarness = createCollectorHarness({
    transport: cloud.transport,
  });

  const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
    connectionTestJob({
      ...(data.credential ? { credential: data.credential } : {}),
      ...(data.regions ? { regions: data.regions } : {}),
      ...(data.endpointInterface
        ? { endpointInterface: data.endpointInterface }
        : {}),
    }),
    harness.dependencies,
  );

  return {
    report: report,
    summary: report.summary as OpenStackConnectionTestSummary,
    cloud: cloud,
    harness: harness,
  };
}

function readOf(
  summary: OpenStackConnectionTestSummary,
  service: OpenStackServiceType,
  read: string,
): OpenStackAccessRead {
  return summary.reads.find((candidate: OpenStackAccessRead): boolean => {
    return candidate.service === service && candidate.read === read;
  }) as OpenStackAccessRead;
}

function refusingOn(
  prefix: string,
  status: number = 403,
): (request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined {
  return (request: OpenStackHttpRequest) => {
    return request.method === "GET" &&
      new globalThis.URL(request.url).pathname.startsWith(prefix)
      ? { status: status, headers: {}, body: "" }
      : undefined;
  };
}

function loginAnswering(
  status: number,
  body: string = "",
): (request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined {
  return (request: OpenStackHttpRequest) => {
    return request.method === "POST"
      ? { status: status, headers: {}, body: body }
      : undefined;
  };
}

describe("a credential that can read everything", () => {
  test("reads everything, and is told what it is", async () => {
    const { report, summary } = await runTest({});

    expect(report).toMatchObject({
      openStackCloudConnectionTestId: "test-1",
      status: "Succeeded",
    });
    expect(report.errorCode).toBeUndefined();
    expect(summary).toMatchObject({
      credentialKind: "applicationCredential",
      projectName: "admin",
      roleNames: ["admin"],
      hasAccessRules: false,
      isUnrestricted: false,
      canProbablyWrite: true,
      regionsInCatalog: [RECORDED_REGION],
      accessLevel: "FullView",
    });
    expect(summary.servicesByRegion[RECORDED_REGION]?.sort()).toEqual(
      Object.values(OpenStackServiceType).sort(),
    );
    expect(summary.reads).toHaveLength(OPENSTACK_ACCESS_READS.length);

    for (const read of summary.reads) {
      expect([read.read, read.access]).toEqual([read.read, "ReadsEverything"]);
      expect(read.fix).toBeUndefined();
      expect(read.goesWithout).toBeUndefined();
    }
  });

  test("the token it bought is given back, and the secret goes no further than the login", async () => {
    const { report, cloud } = await runTest({});

    const deletes: Array<OpenStackHttpRequest> = cloud.requests.filter(
      (request: OpenStackHttpRequest): boolean => {
        return request.method === "DELETE";
      },
    );

    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.headers["X-Subject-Token"]).toBe(
      "a-token-from-the-recording",
    );
    expect(cloud.requests[cloud.requests.length - 1]?.method).toBe("DELETE");

    expect(
      cloud.requests.filter((request: OpenStackHttpRequest): boolean => {
        return JSON.stringify(request).includes(SECRET);
      }),
    ).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  test("nothing is asked to change but the token it logs out", async () => {
    const { cloud } = await runTest({});

    expect(
      cloud.requests
        .map((request: OpenStackHttpRequest) => {
          return request.method;
        })
        .filter((method: string): boolean => {
          return method !== "GET";
        }),
    ).toEqual(["POST", "DELETE"]);
  });

  test("it asks each the way a collection would, so it finds what a collection would", async () => {
    const { cloud } = await runTest({});

    const compute: OpenStackHttpRequest | undefined = cloud.requests.find(
      (request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/os-hypervisors/detail");
      },
    );
    const volume: OpenStackHttpRequest | undefined = cloud.requests.find(
      (request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/volume/v3/volumes/detail");
      },
    );

    expect(compute?.headers["OpenStack-API-Version"]).toBe("compute 2.87");
    expect(volume?.headers["OpenStack-API-Version"]).toBe("volume 3.50");
    expect(volume?.url).toContain("all_tenants=1");
  });

  test("nothing about a test is kept, so a test and a collection never share a token", async () => {
    const { harness } = await runTest({});

    expect(harness.memory.sessionCount()).toBe(0);
    expect(harness.memory.backoff.size()).toBe(0);
  });
});

/*
 * The real answers each kind of credential got on real clouds, every release we record. What
 * level each adds up to is what the docs tell people to look for.
 */
describe.each([
  "hibiscus-ovn",
  "gazpacho-ovs",
  "gazpacho-ovn",
  "flamingo-ovn",
  "epoxy-ovn",
])("what each level of access really read, on %s", (release: string) => {
  const SCENE: RecordedScene = loadScene(release, "healthy");

  const READER_ROLES: JSONObject = {
    roles: [{ id: "r", name: "reader" }],
  };

  async function asCredential(
    credential: string,
    file: AccessMatrixFile,
    tokenOverrides: JSONObject = {},
  ): Promise<{
    report: OpenStackConnectionTestReport;
    summary: OpenStackConnectionTestSummary;
  }> {
    const ownProjectId: string = ownProjectOf(SCENE, credential);

    return await runTest({
      scene: SCENE,
      answer: answerAsCredential({
        scene: SCENE,
        reads: loadAccessMatrix(release, file),
        credential: credential,
        ownProjectId: ownProjectId,
      }),
      tokenOverrides: {
        project: { id: ownProjectId, name: credential },
        ...tokenOverrides,
      },
    });
  }

  test("an admin: Full view", async () => {
    const { summary } = await asCredential("admin", "matrix");

    expect(summary.accessLevel).toBe("FullView");
    expect(summary.canProbablyWrite).toBe(true);
  });

  test("a plain reader on one project: Project view, whatever Neutron's 200s suggest", async () => {
    const { report, summary } = await asCredential(
      "reader",
      "matrix",
      READER_ROLES,
    );

    expect(report.status).toBe("Succeeded");
    expect(summary.accessLevel).toBe("ProjectView");
    // On a project that holds things, which on many clouds is enough.
    expect(summary.canProbablyWrite).toBe(true);

    // Refused outright.
    expect(
      readOf(summary, OpenStackServiceType.Compute, "services"),
    ).toMatchObject({ access: "Refused", reason: "HTTP 403" });
    expect(
      readOf(summary, OpenStackServiceType.Placement, "resource providers")
        .access,
    ).toBe("Refused");

    // Not refused, and not read: a 200 with nothing in it, which is all a reader gets.
    expect(
      readOf(summary, OpenStackServiceType.Network, "agents"),
    ).toMatchObject({
      access: "OwnProjectOnly",
      reason: "a 200 with nothing here to tell by",
    });

    // The `public` network is anyone's, and is no sign of reading other projects'.
    expect(
      readOf(summary, OpenStackServiceType.Network, "networks"),
    ).toMatchObject({
      access: "OwnProjectOnly",
      reason: "every row is in one project",
    });

    // public's subnets are in the admin project, and say no more than public did.
    expect(
      readOf(summary, OpenStackServiceType.Network, "subnets").access,
    ).toBe("OwnProjectOnly");

    // What Cinder holds for its own project.
    expect(
      readOf(summary, OpenStackServiceType.Volume, "volumes, all projects")
        .access,
    ).toBe("OwnProjectOnly");
  });

  test("a gap says what goes without it, and what opens it", async () => {
    const { summary } = await asCredential("reader", "matrix", READER_ROLES);

    const services: OpenStackAccessRead = readOf(
      summary,
      OpenStackServiceType.Compute,
      "services",
    );

    expect(services.goesWithout).toContain("Services page");
    expect(services.fix).toContain(
      '"os_compute_api:os-services:list": "rule:context_is_admin or role:oneuptime_monitoring"',
    );

    // Neutron decides this one in its code, so no policy line is offered for it.
    expect(
      readOf(summary, OpenStackServiceType.Network, "routers").fix,
    ).toContain("no policy line opens it");
  });

  test("the monitoring role on an empty project, with the policy files: Infrastructure only", async () => {
    const { report, summary } = await asCredential(
      "monitoring-role",
      "matrix",
      READER_ROLES,
    );

    expect(report.status).toBe("Succeeded");

    for (const [service, read] of [
      [OpenStackServiceType.Compute, "services"],
      [OpenStackServiceType.Compute, "hypervisors"],
      [OpenStackServiceType.Compute, "servers, all projects"],
      [OpenStackServiceType.Placement, "resource providers"],
      [OpenStackServiceType.Network, "agents"],
      [OpenStackServiceType.Network, "IP availabilities"],
      [OpenStackServiceType.Identity, "projects"],
    ] as const) {
      expect([read, readOf(summary, service, read).access]).toEqual([
        read,
        "ReadsEverything",
      ]);
    }

    /*
     * Every release answers these 403 from Cinder's own code, after policy has already
     * passed, so no policy line opens them. They are what only a full view reads, and
     * say so, rather than sending a person to look for a line that is not there.
     */
    for (const read of ["services", "pools"]) {
      const refused: OpenStackAccessRead = readOf(
        summary,
        OpenStackServiceType.Volume,
        read,
      );

      expect(refused.access).toBe("Refused");
      expect(refused.fix).toContain("Cinder's own code asks for an admin");
      expect(refused.fix).toContain("Full view");
    }

    expect(summary.accessLevel).toBe("InfrastructureOnly");

    // Its project holds nothing, and these are scoped to it.
    for (const [service, read] of [
      [OpenStackServiceType.Network, "routers"],
      [OpenStackServiceType.Network, "floating IPs"],
      [OpenStackServiceType.Volume, "volumes, all projects"],
      [OpenStackServiceType.Volume, "snapshots, all projects"],
    ] as const) {
      expect({ read, found: readOf(summary, service, read) }).toMatchObject({
        read,
        found: {
          access: "OwnProjectOnly",
          reason: "a 200 with nothing here to tell by",
        },
      });
    }
  });

  test("the same role before the policy files: its own project, and nothing else", async () => {
    const { summary } = await asCredential(
      "monitoring-role",
      "matrix-default-policy",
      READER_ROLES,
    );

    expect(
      readOf(summary, OpenStackServiceType.Compute, "services").access,
    ).toBe("Refused");
    expect(summary.accessLevel).toBe("ProjectView");
  });

  test("the role on a project that holds things reads what that project holds", async () => {
    const { summary } = await asCredential(
      "role-on-a-project",
      "matrix",
      READER_ROLES,
    );

    expect(
      readOf(summary, OpenStackServiceType.Compute, "hypervisors").access,
    ).toBe("ReadsEverything");
    expect(
      readOf(summary, OpenStackServiceType.Volume, "volumes, all projects")
        .access,
    ).toBe("OwnProjectOnly");
  });

  test("access rules, with each service told about them: it reads everything, and cannot write", async () => {
    const { report, summary } = await asCredential(
      "monitoring-admin-get",
      "matrix-access-rules",
      {
        application_credential: {
          id: "x",
          name: "ou-read-only",
          restricted: true,
          access_rules: [{ path: "/**", method: "GET", service: "compute" }],
        },
      },
    );

    expect(report.status).toBe("Succeeded");
    expect(summary).toMatchObject({
      hasAccessRules: true,
      // It holds the admin role, and the rules are what stop it writing.
      canProbablyWrite: false,
      accessLevel: "FullView",
    });
  });

  /*
   * And what the collection then is, at those levels. The exporter says
   * openstack_placement_up 0 for a reader, because every call it made failed. An API that
   * answered 403 is not down, so the probe says 1, and no alert fires on it.
   */
  async function collectAs(
    credential: string,
    file: AccessMatrixFile,
  ): Promise<OpenStackCollectionReport> {
    const ownProjectId: string = ownProjectOf(SCENE, credential);

    const harness: CollectorHarness = createCollectorHarness({
      transport: createRecordedCloud(SCENE, {
        answer: answerAsCredential({
          scene: SCENE,
          reads: loadAccessMatrix(release, file),
          credential: credential,
          ownProjectId: ownProjectId,
        }),
        tokenOverrides: {
          project: { id: ownProjectId, name: credential },
          roles: [{ id: "r", name: "reader" }],
        },
      }).transport,
    });

    return await OpenStackCollector.collect(
      collectionJob({
        credential: { kind: "applicationCredential", id: "a", secret: "b" },
      }),
      harness.dependencies,
    );
  }

  function upValues(report: OpenStackCollectionReport): Record<string, number> {
    const values: Record<string, number> = {};

    for (const point of datapointsOf(report.resourceMetrics)) {
      if (
        point.metric.startsWith("openstack_") &&
        point.metric.endsWith("_up")
      ) {
        values[point.metric] = point.value;
      }
    }

    return values;
  }

  const ALL_UP: Record<string, number> = {
    openstack_identity_up: 1,
    openstack_nova_up: 1,
    openstack_placement_up: 1,
    openstack_neutron_up: 1,
    openstack_cinder_up: 1,
    openstack_glance_up: 1,
  };

  test("a reader's collection: its own project's instances, which only a probe can list", async () => {
    const report: OpenStackCollectionReport = await collectAs(
      "reader",
      "matrix",
    );

    expect(report.status).toBe("Succeeded");

    const instances: Array<ReportedDatapoint> = datapointsOf(
      report.resourceMetrics,
    ).filter((point: ReportedDatapoint): boolean => {
      return point.metric === "openstack_nova_server_status";
    });

    expect(
      instances
        .map((point: ReportedDatapoint) => {
          return point.labels["name"];
        })
        .sort(),
    ).toEqual(["ou-failed", "ou-running", "ou-stopped"]);
    expect(report.summary?.instanceCount).toBe(3);

    expect(upValues(report)).toEqual(ALL_UP);

    expect(report.summary?.warnings.join(" ")).toContain("refused");
  });

  test("a reader's collection leaves off what it may not read, and sends no zero for it", async () => {
    const report: OpenStackCollectionReport = await collectAs(
      "reader",
      "matrix",
    );

    const names: Set<string> = new Set(
      datapointsOf(report.resourceMetrics).map((point: ReportedDatapoint) => {
        return point.metric;
      }),
    );

    expect(names.has("openstack_nova_agent_state")).toBe(false);
    expect(names.has("openstack_nova_vcpus_used")).toBe(false);
    expect(names.has("openstack_placement_resource_total")).toBe(false);
    expect(names.has("openstack_cinder_pool_capacity_total_gb")).toBe(false);
    expect(names.has("openstack_nova_flavors")).toBe(true);
  });

  test("the monitoring role's collection: every API up, and Neutron's 409 no failure", async () => {
    const report: OpenStackCollectionReport = await collectAs(
      "monitoring-role",
      "matrix",
    );

    expect(report.status).toBe("Succeeded");
    expect(upValues(report)).toEqual(ALL_UP);

    const names: Set<string> = new Set(
      datapointsOf(report.resourceMetrics).map((point: ReportedDatapoint) => {
        return point.metric;
      }),
    );

    expect(names.has("openstack_nova_vcpus_used")).toBe(true);
    expect(names.has("openstack_placement_resource_total")).toBe(true);
    expect(names.has("openstack_neutron_agent_state")).toBe(true);
    expect(names.has("openstack_neutron_security_groups")).toBe(false);

    expect(report.summary?.warnings.join(" ")).not.toContain("security groups");

    // Every project's instances: what the Nova policy line opens.
    expect(report.summary?.instanceCount).toBe(4);
  });

  test("access rules told to every service: all of it, as an admin reads it", async () => {
    const report: OpenStackCollectionReport = await collectAs(
      "monitoring-admin-get",
      "matrix-access-rules",
    );

    expect(report.status).toBe("Succeeded");
    expect(upValues(report)).toEqual(ALL_UP);
    expect(report.summary?.warnings).toEqual([]);
  });
});

/*
 * What was recorded while Nova, Neutron and the rest had no service_type set for their
 * keystonemiddleware: every read answered 401 before any route was looked at, except Glance,
 * which had it set already. That is the one way a right credential looks like a wrong one,
 * so the test has to name it.
 */
describe("access rules, with services not told about them", () => {
  function refusedByMiddleware(
    request: OpenStackHttpRequest,
  ): OpenStackHttpResponse | undefined {
    const pathname: string = new globalThis.URL(request.url).pathname;

    return request.method === "GET" &&
      pathname !== "/compute/" &&
      !pathname.startsWith("/image/")
      ? { status: 401, headers: {}, body: "" }
      : undefined;
  }

  const WITH_RULES: JSONObject = {
    application_credential: {
      id: "x",
      name: "ou-read-only",
      restricted: true,
      access_rules: [{ path: "/v2/images", method: "GET", service: "image" }],
    },
  };

  test("every 401 says what to look at", async () => {
    const { report, summary } = await runTest({
      answer: refusedByMiddleware,
      tokenOverrides: WITH_RULES,
    });

    expect(report.status).toBe("Succeeded");
    expect(summary.hasAccessRules).toBe(true);
    expect(summary.canProbablyWrite).toBe(false);
    expect(summary.accessLevel).toBe("Other");

    const projects: OpenStackAccessRead = readOf(
      summary,
      OpenStackServiceType.Identity,
      "projects",
    );

    expect(projects).toMatchObject({ access: "Refused", reason: "HTTP 401" });
    expect(projects.fix).toContain("keystonemiddleware has no service_type");

    expect(readOf(summary, OpenStackServiceType.Image, "images").access).toBe(
      "ReadsEverything",
    );
  });

  test("a collection on them: refused, not down, and what it could read is there", async () => {
    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      createCollectorHarness({
        transport: createRecordedCloud(HEALTHY, {
          answer: refusedByMiddleware,
          tokenOverrides: WITH_RULES,
        }).transport,
      }).dependencies,
    );

    expect(report.status).toBe("Succeeded");

    const outcomes: Record<string, string> = {};

    for (const service of report.summary?.services || []) {
      outcomes[service.service] = service.outcome;
    }

    expect(outcomes).toEqual({
      identity: "Refused",
      compute: "Refused",
      placement: "Refused",
      network: "Refused",
      volume: "Refused",
      image: "Succeeded",
    });

    expect(report.summary?.warnings.join(" ")).toContain(
      "keystonemiddleware has no service_type",
    );
  });
});

describe("what can stop it before it reads anything", () => {
  test.each([
    ["nothing", ""],
    ["plain HTTP", "http://keystone.example.com:5000"],
    ["a user in the address", "https://me:pw@keystone.example.com:5000"],
    ["loopback", "https://127.0.0.1:5000"],
    ["the metadata address", "https://169.254.169.254"],
  ])("%s: never leaves the probe", async (_name: string, authUrl: string) => {
    let wasAsked: boolean = false;

    const harness: CollectorHarness = createCollectorHarness({
      transport: async (): Promise<OpenStackHttpResponse> => {
        wasAsked = true;
        return { status: 500, headers: {}, body: "" };
      },
    });

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: authUrl }),
      harness.dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.InvalidAddress);
    expect(wasAsked).toBe(false);
    expect(harness.transportsOpened()).toBe(0);
  });

  test.each([
    ["ENOTFOUND", OpenStackCollectionErrorCode.AddressNotFound],
    ["ECONNREFUSED", OpenStackCollectionErrorCode.ConnectionRefused],
    ["ETIMEDOUT", OpenStackCollectionErrorCode.ConnectionTimedOut],
    ["ECONNRESET", OpenStackCollectionErrorCode.ConnectionFailed],
    ["EPROTO", OpenStackCollectionErrorCode.TlsFailed],
  ])(
    "%s reads as %s",
    async (errorCode: string, code: OpenStackCollectionErrorCode) => {
      const harness: CollectorHarness = createCollectorHarness({
        transport: async (): Promise<OpenStackHttpResponse> => {
          throw Object.assign(new Error("It broke."), { code: errorCode });
        },
      });

      const report: OpenStackConnectionTestReport =
        await OpenStackCollector.test(
          connectionTestJob(),
          harness.dependencies,
        );

      expect(report.status).toBe("Failed");
      expect(report.errorCode).toBe(code);
      expect(harness.transportsClosed()).toBe(1);
    },
  );

  test("a certificate not trusted says what it showed, so a person can trust it", async () => {
    const presented: {
      fingerprint256: string;
      subject: string;
      issuer: string;
      isSelfSigned: boolean;
    } = {
      fingerprint256: "AA:BB",
      subject: "CN=keystone",
      issuer: "CN=keystone",
      isSelfSigned: true,
    };

    const harness: CollectorHarness = createCollectorHarness({
      transport: async (): Promise<OpenStackHttpResponse> => {
        throw new OpenStackCertificateError({
          kind: "untrusted",
          presentedCertificate: presented,
          message: "Not trusted.",
        });
      },
    });

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob(),
      harness.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      presentedCertificate: presented,
    });
  });

  test("an application credential refused", async () => {
    const { report, cloud } = await runTest({ answer: loginAnswering(401) });

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.InvalidCredential,
    );
    expect(report.errorMessage).toContain("application credential");
    // Nothing can be told apart for one of these by asking again.
    expect(cloud.requests).toHaveLength(1);
  });

  test("a password that is wrong: asked once more without a project, and refused again", async () => {
    const bodies: Array<JSONObject> = [];

    const { report, cloud } = await runTest({
      credential: PASSWORD_CREDENTIAL,
      answer: (request: OpenStackHttpRequest) => {
        if (request.method !== "POST") {
          return undefined;
        }

        bodies.push(JSON.parse(request.body as string) as JSONObject);

        return { status: 401, headers: {}, body: "" };
      },
    });

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.InvalidCredential,
    );
    expect(cloud.requests).toHaveLength(2);
    expect((bodies[1]?.["auth"] as JSONObject)["scope"]).toBe("unscoped");
  });

  test("a password that is right, on a project it has no role on: wrong project, said so", async () => {
    const { report } = await runTest({
      credential: PASSWORD_CREDENTIAL,
      answer: (request: OpenStackHttpRequest) => {
        if (request.method !== "POST") {
          return undefined;
        }

        const body: JSONObject = JSON.parse(
          request.body as string,
        ) as JSONObject;

        return (body["auth"] as JSONObject)["scope"] === "unscoped"
          ? jsonAnswer(201, { token: {} }, { "x-subject-token": "unscoped" })
          : { status: 401, headers: {}, body: "" };
      },
    });

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.WrongProjectScope,
    );
    expect(report.errorMessage).toBe(
      "Keystone accepted user monitor, but not on project monitoring in domain Default: the project does not exist there, or the user has no role on it.",
    );
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  test("a password Keystone said 403 to", async () => {
    const { report } = await runTest({
      credential: PASSWORD_CREDENTIAL,
      answer: loginAnswering(403),
    });

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.WrongProjectScope,
    );
  });

  test.each([500, 502, 503, 429])(
    "Keystone answering %s",
    async (status: number) => {
      const { report } = await runTest({ answer: loginAnswering(status) });

      expect(report.errorCode).toBe(
        OpenStackCollectionErrorCode.KeystoneFailing,
      );
      expect(report.errorMessage).toContain(`HTTP ${status}`);
    },
  );

  test.each([
    ["404", 404, ""],
    ["a redirect", 302, ""],
    ["a 200 with no token", 200, "<html>Welcome</html>"],
  ])(
    "something that is not Keystone: %s",
    async (_name: string, status: number, body: string) => {
      const { report } = await runTest({
        answer: loginAnswering(status, body),
      });

      expect(report.errorCode).toBe(OpenStackCollectionErrorCode.NotKeystone);
      expect(report.errorMessage).toContain(RECORDED_AUTH_URL);
      expect(report.errorMessage).toContain("auth_url from your clouds.yaml");
    },
  );

  test("a token with no catalog, and the token still given back", async () => {
    const { report, cloud } = await runTest({
      tokenOverrides: { catalog: [] },
    });

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.NoCatalog);
    expect(report.errorMessage).toContain("Scope the credential to a project");
    expect(cloud.requests[cloud.requests.length - 1]?.method).toBe("DELETE");
  });

  test("a region the catalog does not name: a person asked for it, so it is not skipped", async () => {
    const { report, cloud } = await runTest({
      regions: [RECORDED_REGION, "Gone"],
    });

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.RegionNotFound);
    expect(report.errorMessage).toBe(
      `The catalog has no region named Gone. It names ${RECORDED_REGION}.`,
    );
    expect(cloud.requests[cloud.requests.length - 1]?.method).toBe("DELETE");
  });

  test("a failed logout does not change what the test found", async () => {
    const { report } = await runTest({
      answer: (request: OpenStackHttpRequest) => {
        if (request.method === "DELETE") {
          throw new Error("Access rules do not list this.");
        }

        return undefined;
      },
    });

    expect(report.status).toBe("Succeeded");
  });
});

/*
 * A credential never goes to a plain HTTP cloud over a probe. Those clouds turn on TLS or use
 * the agent, and a person asking whether theirs can be collected is told exactly that.
 */
describe("a catalog on plain HTTP", () => {
  function catalogOn(networkUrl: string, computeUrl: string): JSONObject {
    return {
      catalog: [
        {
          type: "compute",
          name: "nova",
          endpoints: [
            {
              url: computeUrl,
              interface: "public",
              region_id: RECORDED_REGION,
            },
          ],
        },
        {
          type: "network",
          name: "neutron",
          endpoints: [
            {
              url: networkUrl,
              interface: "public",
              region_id: RECORDED_REGION,
            },
          ],
        },
      ],
    };
  }

  test("is said to be the problem, with the way out, and nothing goes near it", async () => {
    const { report, summary, cloud } = await runTest({
      tokenOverrides: catalogOn(
        "http://10.0.0.5:9696",
        "https://openstack.example/compute/v2.1",
      ),
    });

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.InsecureEndpoint,
    );
    expect(report.errorMessage).toBe(
      "The catalog puts Networking (Neutron) on plain HTTP, such as http://10.0.0.5:9696. A credential's token is never sent unencrypted, so the probe read none of them. Turn on TLS for these APIs, pick another endpoint interface, or use the OpenStack agent for this cloud.",
    );

    for (const request of cloud.requests) {
      expect(request.url.startsWith("https://")).toBe(true);
    }

    // Each read it would have made says so, and what goes without it.
    const networks: OpenStackAccessRead = readOf(
      summary,
      OpenStackServiceType.Network,
      "networks",
    );

    expect(networks.access).toBe("Failing");
    expect(networks.reason).toBe(
      "The catalog names http://10.0.0.5:9696, plain HTTP. A token is never sent unencrypted.",
    );
    expect(networks.fix).toBe(
      "Turn on TLS for this API, pick another endpoint interface, or use the OpenStack agent for this cloud.",
    );
    expect(networks.goesWithout).toBeTruthy();

    // The catalog still names it: what the rest of the cloud is, it says as ever.
    expect(summary.servicesByRegion[RECORDED_REGION]).toContain(
      OpenStackServiceType.Network,
    );
  });

  test("every service on it is named once, whichever regions they answer in", async () => {
    const { report } = await runTest({
      tokenOverrides: catalogOn("http://10.0.0.5:9696", "http://10.0.0.5:8774"),
    });

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.InsecureEndpoint,
    );
    expect(report.errorMessage).toContain(
      "The catalog puts Compute (Nova), Networking (Neutron) on plain HTTP, such as http://10.0.0.5:8774.",
    );
  });

  test("a URL the probe will not speak to for another reason is not called plain HTTP", async () => {
    const { report, summary } = await runTest({
      tokenOverrides: catalogOn(
        "https://169.254.169.254/latest",
        "https://openstack.example/compute/v2.1",
      ),
    });

    expect(report.errorCode).not.toBe(
      OpenStackCollectionErrorCode.InsecureEndpoint,
    );
    expect(
      readOf(summary, OpenStackServiceType.Network, "networks").reason,
    ).toContain("a loopback, link-local or cloud metadata address");
  });

  test("a certificate nobody trusted is still asked about first", async () => {
    const { report } = await runTest({
      tokenOverrides: catalogOn(
        "http://10.0.0.5:9696",
        "https://openstack.example/compute/v2.1",
      ),
      answer: (
        request: OpenStackHttpRequest,
      ): OpenStackHttpResponse | undefined => {
        if (request.url.includes("/compute/") && request.method === "GET") {
          throw new OpenStackCertificateError({
            kind: "untrusted",
            message: "Not trusted.",
            presentedCertificate: {
              fingerprint256: "AB",
              subject: "CN=nova",
              issuer: "CN=CA",
              isSelfSigned: false,
            },
          });
        }

        return undefined;
      },
    });

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.UntrustedCertificate,
    );
  });
});

describe("what each service can be missing", () => {
  test.each([
    ["Keystone", "/identity/v3/", OpenStackServiceType.Identity, "projects"],
    ["Nova", "/compute/v2.1/", OpenStackServiceType.Compute, "services"],
    [
      "Placement",
      "/placement/",
      OpenStackServiceType.Placement,
      "resource providers",
    ],
    ["Neutron", "/networking/", OpenStackServiceType.Network, "agents"],
    ["Cinder", "/volume/", OpenStackServiceType.Volume, "pools"],
    ["Glance", "/image/", OpenStackServiceType.Image, "images"],
  ])(
    "%s refusing costs that service's reads, and nobody else's",
    async (
      _name: string,
      prefix: string,
      service: OpenStackServiceType,
      read: string,
    ) => {
      const { report, summary } = await runTest({
        answer: refusingOn(prefix),
      });

      expect(report.status).toBe("Succeeded");

      expect(readOf(summary, service, read)).toMatchObject({
        access: "Refused",
        reason: "HTTP 403",
      });
      expect(readOf(summary, service, read).fix).toBeTruthy();
      expect(readOf(summary, service, read).goesWithout).toBeTruthy();

      for (const other of summary.reads) {
        if (other.service !== service) {
          expect([other.read, other.access]).toEqual([
            other.read,
            "ReadsEverything",
          ]);
        }
      }

      expect(summary.warnings.join(" ")).toContain("cannot read everything");
    },
  );

  test("every read refused: Failed, with the list of what each would need", async () => {
    const { report, summary } = await runTest({
      answer: (request: OpenStackHttpRequest) => {
        return request.method === "GET" &&
          new globalThis.URL(request.url).pathname !== "/compute/"
          ? { status: 403, headers: {}, body: "" }
          : undefined;
      },
    });

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.NoPermission);
    expect(report.errorMessage).toContain("The list below");
    expect(summary.reads).toHaveLength(OPENSTACK_ACCESS_READS.length);
    expect(summary.accessLevel).toBe("Other");
  });

  test("a service that is failing is not a refusal, and is told apart", async () => {
    const { report, summary } = await runTest({
      answer: refusingOn("/networking/", 500),
    });

    expect(report.status).toBe("Succeeded");
    expect(
      readOf(summary, OpenStackServiceType.Network, "agents"),
    ).toMatchObject({
      access: "Failing",
      reason: "HTTP 500",
    });
    expect(
      readOf(summary, OpenStackServiceType.Network, "agents").fix,
    ).toBeUndefined();
  });

  test("a service that does not answer says why, in the sentence a collection would", async () => {
    const { summary } = await runTest({
      answer: (request: OpenStackHttpRequest) => {
        if (
          new globalThis.URL(request.url).pathname.startsWith("/networking/")
        ) {
          throw Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          });
        }

        return undefined;
      },
    });

    expect(
      readOf(summary, OpenStackServiceType.Network, "agents"),
    ).toMatchObject({
      access: "Failing",
    });
    expect(
      readOf(summary, OpenStackServiceType.Network, "agents").reason,
    ).toContain("refused the connection");
  });

  test("a service with a certificate of its own: the test stops at it, because a person has to decide", async () => {
    const presented: {
      fingerprint256: string;
      subject: string;
      issuer: string;
      isSelfSigned: boolean;
      host: string;
      port: number;
    } = {
      fingerprint256: "CC:DD",
      subject: "CN=nova",
      issuer: "CN=nova",
      isSelfSigned: true,
      host: "nova.example.com",
      port: 8774,
    };

    const { report, summary } = await runTest({
      answer: (request: OpenStackHttpRequest) => {
        if (new globalThis.URL(request.url).pathname.startsWith("/compute/")) {
          throw new OpenStackCertificateError({
            kind: "changed",
            presentedCertificate: presented,
            message: "nova.example.com:8774 showed another certificate.",
          });
        }

        return undefined;
      },
    });

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.CertificateChanged,
      errorMessage: "nova.example.com:8774 showed another certificate.",
      presentedCertificate: presented,
    });

    // Everything else was still read, and is there to see.
    expect(readOf(summary, OpenStackServiceType.Network, "agents").access).toBe(
      "ReadsEverything",
    );
  });

  test("a Nova that will not say what it speaks is still asked", async () => {
    const { report, summary, cloud } = await runTest({
      answer: (request: OpenStackHttpRequest) => {
        return new globalThis.URL(request.url).pathname === "/compute/"
          ? { status: 500, headers: {}, body: "" }
          : undefined;
      },
    });

    expect(report.status).toBe("Succeeded");
    expect(
      readOf(summary, OpenStackServiceType.Compute, "services").access,
    ).toBe("ReadsEverything");
    expect(
      cloud.requests.find((request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/os-services");
      })?.headers["OpenStack-API-Version"],
    ).toBeUndefined();
  });

  test("a service not in this region's catalog is not deployed, and says what that costs", async () => {
    const { report, summary } = await runTest({
      tokenOverrides: {
        catalog: (
          (recordedTokenBody(HEALTHY)["token"] as JSONObject)[
            "catalog"
          ] as Array<JSONObject>
        ).filter((service: JSONObject): boolean => {
          return (
            service["type"] !== "block-storage" &&
            service["type"] !== "volumev3"
          );
        }),
      },
    });

    expect(report.status).toBe("Succeeded");
    expect(summary.servicesByRegion[RECORDED_REGION]).not.toContain(
      OpenStackServiceType.Volume,
    );
    expect(readOf(summary, OpenStackServiceType.Volume, "pools")).toMatchObject(
      {
        access: "NotDeployed",
        reason: "not in this region's catalog",
      },
    );
    expect(
      readOf(summary, OpenStackServiceType.Volume, "pools").goesWithout,
    ).toContain("storage pools");
    expect(
      readOf(summary, OpenStackServiceType.Volume, "pools").fix,
    ).toBeUndefined();
  });

  test("an older cloud's Cinder, under the type it had then", async () => {
    const { summary } = await runTest({
      tokenOverrides: {
        catalog: (
          (recordedTokenBody(HEALTHY)["token"] as JSONObject)[
            "catalog"
          ] as Array<JSONObject>
        ).map((service: JSONObject): JSONObject => {
          return service["type"] === "block-storage"
            ? { ...service, type: "volumev3" }
            : service;
        }),
      },
    });

    expect(summary.servicesByRegion[RECORDED_REGION]).toContain(
      OpenStackServiceType.Volume,
    );
    expect(readOf(summary, OpenStackServiceType.Volume, "pools").access).toBe(
      "ReadsEverything",
    );
  });

  test("a route this cloud does not have is told from a refusal", async () => {
    const { summary } = await runTest({
      answer: refusingOn("/volume/v3/backups", 404),
    });

    expect(
      readOf(summary, OpenStackServiceType.Volume, "backups, all projects"),
    ).toMatchObject({ access: "NotDeployed" });
  });

  test("every region it was asked about has its own reads, and Keystone only once", async () => {
    const catalog: Array<JSONObject> = [
      {
        type: "compute",
        name: "nova",
        endpoints: [
          {
            url: "https://openstack.example/compute/v2.1",
            interface: "public",
            region_id: "RegionOne",
          },
          {
            url: "https://openstack.example/compute/v2.1",
            interface: "public",
            region_id: "RegionTwo",
          },
        ],
      },
    ];

    const { summary } = await runTest({
      tokenOverrides: { catalog: catalog },
    });

    expect(summary.regionsInCatalog).toEqual(["RegionOne", "RegionTwo"]);

    const servicesRead: (region: string) => Array<OpenStackAccessRead> = (
      region: string,
    ): Array<OpenStackAccessRead> => {
      return summary.reads.filter((read: OpenStackAccessRead): boolean => {
        return (
          read.regionName === region &&
          read.service === OpenStackServiceType.Compute
        );
      });
    };

    expect(servicesRead("RegionOne").length).toBeGreaterThan(0);
    expect(servicesRead("RegionTwo").length).toBe(
      servicesRead("RegionOne").length,
    );

    expect(
      summary.reads.filter((read: OpenStackAccessRead): boolean => {
        return (
          read.service === OpenStackServiceType.Identity &&
          read.regionName === "RegionTwo"
        );
      }),
    ).toEqual([]);
  });

  test("an interface the catalog does not have reads nothing but Keystone", async () => {
    const { summary } = await runTest({ endpointInterface: "internal" });

    expect(summary.servicesByRegion[RECORDED_REGION]).toEqual([
      OpenStackServiceType.Identity,
    ]);
  });
});

describe("what it warns about", () => {
  test("a password can do whatever its account can", async () => {
    const { summary } = await runTest({ credential: PASSWORD_CREDENTIAL });

    expect(summary.credentialKind).toBe("password");
    expect(summary.warnings[0]).toContain(
      "an application credential is better",
    );
    expect(summary.canProbablyWrite).toBe(true);
  });

  test("a password with no admin role reads less, and may not write", async () => {
    const { summary } = await runTest({
      credential: PASSWORD_CREDENTIAL,
      tokenOverrides: {
        project: EMPTY_PROJECT,
        roles: [{ id: "r", name: "reader" }],
      },
    });

    expect(summary.canProbablyWrite).toBe(false);
  });

  test("--unrestricted can make more credentials", async () => {
    const { summary } = await runTest({
      tokenOverrides: {
        application_credential: {
          id: "x",
          name: "y",
          restricted: false,
        },
      },
    });

    expect(summary.isUnrestricted).toBe(true);
    expect(summary.warnings[0]).toContain("--unrestricted");
  });

  test("a plain admin credential can write, and there is a way to stop that", async () => {
    const { summary } = await runTest({});

    expect(summary.warnings[0]).toContain("it can write");
  });

  test("access rules, on a project of its own, leave nothing to warn about", async () => {
    const { summary } = await runTest({
      tokenOverrides: {
        project: EMPTY_PROJECT,
        application_credential: {
          id: "x",
          name: "y",
          restricted: true,
          access_rules: [{ path: "/**", method: "GET", service: "compute" }],
        },
      },
    });

    expect(summary.canProbablyWrite).toBe(false);
    expect(summary.warnings).toEqual([]);
  });

  /*
   * Where Cinder has enforce_new_defaults off, any role on a project can write to it. So a
   * read-only role on a real project is not read-only, and only asking finds that out.
   */
  describe("a project that holds things", () => {
    const READER_ON_PAYMENTS: JSONObject = {
      project: { id: ownProjectOf(HEALTHY, "reader"), name: "ou-payments" },
      roles: [{ id: "r", name: "reader" }],
    };

    test("says what it holds, and what to do about it", async () => {
      const { summary } = await runTest({ tokenOverrides: READER_ON_PAYMENTS });

      expect(summary.canProbablyWrite).toBe(true);

      const warning: string | undefined = summary.warnings.find(
        (text: string): boolean => {
          return text.startsWith("This credential's project holds things");
        },
      );

      expect(warning).toContain(`in region ${RECORDED_REGION}`);
      expect(warning).toContain("instances, volumes, networks, routers");
      expect(warning).toContain("enforce_new_defaults");
      expect(warning).toContain("a project of its own");
    });

    test("access rules are what stop it writing, wherever it is", async () => {
      const { summary } = await runTest({
        tokenOverrides: {
          ...READER_ON_PAYMENTS,
          application_credential: {
            id: "x",
            name: "y",
            restricted: true,
            access_rules: [{ path: "/**", method: "GET", service: "compute" }],
          },
        },
      });

      expect(summary.canProbablyWrite).toBe(false);
    });

    test("each list is asked for one row, and Neutron's for the credential's own project", async () => {
      const { cloud } = await runTest({ tokenOverrides: READER_ON_PAYMENTS });

      const asked: (path: string) => globalThis.URLSearchParams | undefined = (
        path: string,
      ): globalThis.URLSearchParams | undefined => {
        const request: OpenStackHttpRequest | undefined = cloud.requests.find(
          (candidate: OpenStackHttpRequest): boolean => {
            const url: globalThis.URL = new globalThis.URL(candidate.url);

            return (
              url.pathname === path && url.searchParams.get("limit") === "1"
            );
          },
        );

        return request
          ? new globalThis.URL(request.url).searchParams
          : undefined;
      };

      expect(asked("/compute/v2.1/servers")?.has("all_tenants")).toBe(false);
      expect(asked("/volume/v3/volumes")?.has("all_tenants")).toBe(false);

      for (const path of [
        "/networking/v2.0/networks",
        "/networking/v2.0/routers",
        "/networking/v2.0/floatingips",
      ]) {
        expect(asked(path)?.get("project_id")).toBe(
          ownProjectOf(HEALTHY, "reader"),
        );
        expect(asked(path)?.getAll("fields")).toEqual(["id"]);
      }
    });

    test("a project with nothing in it holds nothing", async () => {
      const { summary } = await runTest({
        tokenOverrides: {
          project: EMPTY_PROJECT,
          roles: [{ id: "r", name: "reader" }],
        },
      });

      expect(summary.warnings.join(" ")).not.toContain("holds things");
    });

    test("what cannot be asked tells nothing either way, and stops nothing", async () => {
      const { report, summary } = await runTest({
        tokenOverrides: READER_ON_PAYMENTS,
        answer: (request: OpenStackHttpRequest) => {
          return new globalThis.URL(request.url).searchParams.get("limit") ===
            "1"
            ? { status: 500, headers: {}, body: "" }
            : undefined;
        },
      });

      expect(report.status).toBe("Succeeded");
      expect(summary.warnings.join(" ")).not.toContain("holds things");
    });

    test("a token with no project has none to ask about", async () => {
      const { cloud } = await runTest({
        tokenOverrides: { project: {} },
      });

      expect(
        cloud.requests.some((request: OpenStackHttpRequest): boolean => {
          return (
            new globalThis.URL(request.url).pathname === "/compute/v2.1/servers"
          );
        }),
      ).toBe(false);
    });
  });
});

describe("classifyAccessList", () => {
  const OWN: string = "own-project";

  function classify(
    rows: Array<JSONObject>,
    overrides: Partial<Parameters<typeof classifyAccessList>[0]> = {},
  ): ReturnType<typeof classifyAccessList> {
    return classifyAccessList({
      body: { items: rows },
      key: "items",
      projectField: "project_id",
      ownProjectId: OWN,
      hasAdminRole: false,
      ...overrides,
    });
  }

  test("a list that is not per project: a 200 is the answer, empty or not", () => {
    expect(classify([], { projectField: "-" })).toEqual({
      access: "ReadsEverything",
    });
  });

  test("two projects' rows could not have been seen otherwise", () => {
    expect(
      classify([
        { project_id: OWN },
        { project_id: "another" },
        { project_id: "another" },
      ]),
    ).toEqual({
      access: "ReadsEverything",
      reason: "2 projects in 3 rows",
    });
  });

  test("one project's rows, and not its own", () => {
    expect(classify([{ project_id: "another" }]).access).toBe(
      "ReadsEverything",
    );
  });

  test("one project's rows, and its own: maybe that is all it sees", () => {
    expect(classify([{ project_id: OWN }])).toEqual({
      access: "OwnProjectOnly",
      reason: "every row is in one project",
    });
  });

  test("a token with no project cannot be told from another's", () => {
    expect(
      classify([{ project_id: "any" }], { ownProjectId: null }).access,
    ).toBe("OwnProjectOnly");
  });

  test("empty proves nothing", () => {
    expect(classify([])).toEqual({
      access: "OwnProjectOnly",
      reason: "a 200 with nothing here to tell by",
    });
  });

  test("empty, with the admin role, is the likely truth", () => {
    expect(classify([], { hasAdminRole: true }).access).toBe("ReadsEverything");
  });

  test.each([
    ["a shared network", { shared: true, project_id: "admin-project" }],
    [
      "an external network",
      { "router:external": true, project_id: "admin-project" },
    ],
    ["a public image", { visibility: "public", project_id: "admin-project" }],
    [
      "a community image",
      { visibility: "community", project_id: "admin-project" },
    ],
  ])(
    "%s is anyone's to see, and no sign of reading others'",
    (_name: string, row: JSONObject) => {
      expect(classify([{ project_id: OWN }, row])).toEqual({
        access: "OwnProjectOnly",
        reason: "every row is in one project",
      });
    },
  );

  test("a private image of another project is a sign", () => {
    expect(
      classify([
        { project_id: OWN },
        { visibility: "private", project_id: "another" },
      ]).access,
    ).toBe("ReadsEverything");
  });

  test("a list only rows it could not have seen tell by: any row proves it", () => {
    expect(classify([{ id: "a" }], { projectField: "*" }).access).toBe(
      "ReadsEverything",
    );
    expect(classify([], { projectField: "*" }).access).toBe("OwnProjectOnly");
    expect(classify([], { projectField: "*", hasAdminRole: true }).access).toBe(
      "ReadsEverything",
    );
  });

  test.each([
    ["no list at all", { other: [] }],
    ["not a list", { items: "many" }],
    ["rows that are not objects", { items: [null, 7] }],
  ])(
    "%s is nothing to tell by",
    (_name: string, body: Record<string, unknown>) => {
      expect(
        classifyAccessList({
          body: body as JSONObject,
          key: "items",
          projectField: "project_id",
          ownProjectId: OWN,
          hasAdminRole: false,
        }).access,
      ).toBe("OwnProjectOnly");
    },
  );
});

describe("classifyAccessFailure", () => {
  function apiError(
    kind: ConstructorParameters<typeof OpenStackApiError>[0]["kind"],
    status: number,
  ): OpenStackApiError {
    return new OpenStackApiError({
      kind: kind,
      status: status,
      url: "https://x/",
      message: "No.",
    });
  }

  test.each([
    ["refused", 401, "Refused", "HTTP 401"],
    ["refused", 403, "Refused", "HTTP 403"],
    ["absent", 404, "NotDeployed", "HTTP 404: this cloud has no such API"],
    ["overloaded", 503, "Failing", "HTTP 503"],
    ["failing", 500, "Failing", "HTTP 500"],
    ["malformed", 200, "Failing", "HTTP 200"],
  ] as const)(
    "%s %s",
    (
      kind: ConstructorParameters<typeof OpenStackApiError>[0]["kind"],
      status: number,
      access: string,
      reason: string,
    ) => {
      expect(classifyAccessFailure(apiError(kind, status))).toEqual({
        access: access,
        reason: reason,
      });
    },
  );

  test("no answer", () => {
    expect(classifyAccessFailure(new Error("Gone."))).toEqual({
      access: "Failing",
      reason: "no answer",
    });
  });
});

describe("getOpenStackAccessLevel", () => {
  function reads(
    infrastructure: "ReadsEverything" | "Refused" | "OwnProjectOnly",
    projects: "ReadsEverything" | "OwnProjectOnly" | "Refused",
  ): Array<OpenStackAccessRead> {
    return OPENSTACK_ACCESS_READS.map(
      (definition: OpenStackAccessReadDefinition): OpenStackAccessRead => {
        return {
          regionName: RECORDED_REGION,
          service: definition.service,
          read: definition.read,
          access:
            definition.tells === "infrastructure"
              ? infrastructure
              : definition.tells === "projects"
                ? projects
                : "ReadsEverything",
        };
      },
    );
  }

  test.each([
    ["ReadsEverything", "ReadsEverything", "FullView"],
    ["ReadsEverything", "OwnProjectOnly", "InfrastructureOnly"],
    ["ReadsEverything", "Refused", "InfrastructureOnly"],
    ["Refused", "OwnProjectOnly", "ProjectView"],
    ["OwnProjectOnly", "OwnProjectOnly", "ProjectView"],
    // Nothing of its own to show for it either.
    ["Refused", "Refused", "Other"],
  ] as const)(
    "infrastructure %s, projects %s: %s",
    (
      infrastructure: "ReadsEverything" | "Refused" | "OwnProjectOnly",
      projects: "ReadsEverything" | "OwnProjectOnly" | "Refused",
      level: string,
    ) => {
      expect(getOpenStackAccessLevel(reads(infrastructure, projects))).toBe(
        level,
      );
    },
  );

  function withRefused(names: Array<string>): Array<OpenStackAccessRead> {
    return reads("ReadsEverything", "ReadsEverything").map(
      (read: OpenStackAccessRead): OpenStackAccessRead => {
        return names.includes(read.read) &&
          (read.service === OpenStackServiceType.Volume ||
            read.read === "hypervisors")
          ? { ...read, access: "Refused" }
          : read;
      },
    );
  }

  test("some infrastructure read and some not falls between the levels", () => {
    expect(getOpenStackAccessLevel(withRefused(["hypervisors"]))).toBe("Other");
  });

  test("what only an admin reads, missing, is not Full view, and no gap in infrastructure", () => {
    expect(getOpenStackAccessLevel(withRefused(["services", "pools"]))).toBe(
      "InfrastructureOnly",
    );
  });

  test("nothing read at all is not a level", () => {
    expect(getOpenStackAccessLevel([])).toBe("Other");
  });

  test("a service not deployed is no gap: a cloud without Cinder can still be Full view", () => {
    const withoutCinder: Array<OpenStackAccessRead> = reads(
      "ReadsEverything",
      "ReadsEverything",
    ).map((read: OpenStackAccessRead): OpenStackAccessRead => {
      return read.service === OpenStackServiceType.Volume
        ? { ...read, access: "NotDeployed" }
        : read;
    });

    expect(getOpenStackAccessLevel(withoutCinder)).toBe("FullView");
  });
});

describe("the reads themselves", () => {
  test("each has what a person needs when it is missing", () => {
    for (const definition of OPENSTACK_ACCESS_READS) {
      expect(definition.goesWithout.length).toBeGreaterThan(0);
      expect(definition.fix.length).toBeGreaterThan(0);
      expect(definition.key.length).toBeGreaterThan(0);
    }
  });

  test("they ask for no more rows than it takes to tell", () => {
    for (const definition of OPENSTACK_ACCESS_READS) {
      const limit: unknown = definition.query?.["limit"];

      if (limit !== undefined) {
        expect(Number(limit)).toBeLessThanOrEqual(100);
      }
    }
  });

  /*
   * The same questions as the agent's troubleshoot.sh, in the same words, so a person gets
   * the same answer from either. Each read here has a line of the same name there, for
   * the same list, and the policy lines offered are the ones access/policy ships.
   */
  const TROUBLESHOOT: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../../agents/OpenStackAgent/troubleshoot.sh",
    ),
    "utf8",
  );

  const TABLE_START: number = TROUBLESHOOT.indexOf("<<'READS'");
  const TABLE: Array<Array<string>> = TROUBLESHOOT.substring(
    TROUBLESHOOT.indexOf("\n", TABLE_START) + 1,
    TROUBLESHOOT.indexOf("\nREADS\n", TABLE_START),
  )
    .split("\n")
    .map((line: string): Array<string> => {
      return line.split("|");
    });

  const SCRIPT_SERVICE: Record<OpenStackServiceType, string> = {
    [OpenStackServiceType.Identity]: "identity",
    [OpenStackServiceType.Compute]: "compute",
    [OpenStackServiceType.Placement]: "placement",
    [OpenStackServiceType.Network]: "network",
    [OpenStackServiceType.Volume]: "block-storage",
    [OpenStackServiceType.Image]: "image",
  };

  test.each(
    OPENSTACK_ACCESS_READS.map(
      (
        definition: OpenStackAccessReadDefinition,
      ): [string, OpenStackAccessReadDefinition] => {
        return [`${definition.service}: ${definition.read}`, definition];
      },
    ),
  )(
    "%s is troubleshoot.sh's read",
    (_name: string, definition: OpenStackAccessReadDefinition) => {
      const line: Array<string> | undefined = TABLE.find(
        (row: Array<string>): boolean => {
          return (
            row[0] === SCRIPT_SERVICE[definition.service] &&
            row[1] === definition.read
          );
        },
      );

      expect(line).toBeDefined();
      expect(line?.[3]).toBe(definition.key);

      expect(line?.[4]).toBe(definition.projectField);

      const scriptPath: string = (line?.[2] as string).split("?")[0] as string;

      expect(scriptPath.endsWith(definition.path)).toBe(true);
    },
  );

  const POLICY_LINE_FOLLOWS: string = "policy file on every controller: ";

  test.each(
    OPENSTACK_ACCESS_READS.filter(
      (definition: OpenStackAccessReadDefinition): boolean => {
        return definition.fix.includes(POLICY_LINE_FOLLOWS);
      },
    ).map(
      (
        definition: OpenStackAccessReadDefinition,
      ): [string, OpenStackAccessReadDefinition] => {
        return [`${definition.service}: ${definition.read}`, definition];
      },
    ),
  )(
    "%s offers a line the policy files ship",
    (_name: string, definition: OpenStackAccessReadDefinition) => {
      const line: string = definition.fix.substring(
        definition.fix.indexOf(POLICY_LINE_FOLLOWS) +
          POLICY_LINE_FOLLOWS.length,
      );
      const file: string = definition.fix.includes("nova's")
        ? "nova"
        : definition.fix.includes("placement's")
          ? "placement"
          : definition.fix.includes("neutron's")
            ? "neutron"
            : "keystone";

      expect(
        fs.readFileSync(
          path.resolve(
            __dirname,
            `../../../../../agents/OpenStackAgent/access/policy/${file}.yaml`,
          ),
          "utf8",
        ),
      ).toContain(line);
    },
  );

  test("the matrix these are checked against covers every one", () => {
    const matrix: Array<AccessMatrixRead> = loadAccessMatrix(
      "hibiscus-ovn",
      "matrix",
    );

    for (const definition of OPENSTACK_ACCESS_READS) {
      expect(
        matrix.some((read: AccessMatrixRead): boolean => {
          return (
            read.service === SCRIPT_SERVICE[definition.service] &&
            read.read === definition.read
          );
        }),
      ).toBe(true);
    }
  });
});
