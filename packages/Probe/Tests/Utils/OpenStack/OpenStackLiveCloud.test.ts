import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OpenStackProbeMetrics from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackAccessRead,
  OpenStackCollectionJob,
  OpenStackCollectionOptions,
  OpenStackCollectionReport,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
  OpenStackCredential,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  BACKOFF_BASE_IN_MS,
  MAX_BACKOFF_IN_MS,
} from "../../../Utils/OpenStack/OpenStackBackoff";
import OpenStackCollector, {
  DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES,
  OpenStackCollectorDependencies,
} from "../../../Utils/OpenStack/OpenStackCollector";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
  OpenStackTransportHandle,
} from "../../../Utils/OpenStack/OpenStackHttp";
import { ReportedDatapoint, datapointsOf } from "./Helpers/CollectorHarness";

/*
 * The probe against a real cloud, over real TLS. Every other suite replays a recording through a
 * scripted transport or a local TLS server, and those recordings were made by curl. So only this
 * shows that a real Keystone, Nova, Neutron, Cinder, Glance and Placement accept the requests the
 * probe itself makes (its paging, its microversions, its field lists, changes-since), and that
 * its real socket, certificate and DNS code meets the failures a connection test names.
 *
 * A probe never sends a credential over plain HTTP and DevStack serves plain HTTP by default, so
 * this needs DevStack's tls-proxy. It runs in the rig (Tests/Ops/openstack-e2e/probe-live.sh,
 * `gh workflow run test.openstack-e2e.yaml -f probe_tls_only=true`), which makes the credentials
 * below, and is skipped anywhere else. It stops and starts real services, so it never runs on its
 * own against a cloud that matters.
 */
const isLive: boolean =
  process.env["RUN_OPENSTACK_LIVE_CLOUD_TESTS"] === "true";
const describeLive: typeof describe.skip = isLive ? describe : describe.skip;

// Only a live run asks for these: an empty secret would pass for one that went unsent.
function required(name: string): string {
  const value: string = process.env[name] || "";

  if (isLive && !value) {
    throw new Error(
      `${name} is not set: see Tests/Ops/openstack-e2e/probe-live.sh`,
    );
  }

  return value;
}

const LONG_TEST_IN_MS: number = 10 * 60 * 1000;

interface AnsweredRequest {
  method: string;
  path: string;
  status: number;
}

interface LiveRun {
  dependencies: OpenStackCollectorDependencies;
  answered: Array<AnsweredRequest>;
  // Moves what the probe takes the time to be, to get past a backoff without sitting through it.
  advance: (milliseconds: number) => void;
}

// The real transport and real addresses: only what was asked is noted, and never its headers.
function liveRun(): LiveRun {
  const answered: Array<AnsweredRequest> = [];
  let offset: number = 0;

  return {
    answered: answered,
    advance: (milliseconds: number): void => {
      offset += milliseconds;
    },
    dependencies: {
      ...DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES,
      memory: new OpenStackCollectorMemory(),
      clock: {
        ...DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES.clock,
        now: (): number => {
          return Date.now() + offset;
        },
      },
      createTransport: (
        data: Parameters<OpenStackCollectorDependencies["createTransport"]>[0],
      ): OpenStackTransportHandle => {
        const handle: OpenStackTransportHandle =
          DEFAULT_OPENSTACK_COLLECTOR_DEPENDENCIES.createTransport(data);
        const transport: OpenStackTransport = async (
          request: OpenStackHttpRequest,
        ): Promise<OpenStackHttpResponse> => {
          const response: OpenStackHttpResponse =
            await handle.transport(request);

          answered.push({
            method: request.method,
            path: new globalThis.URL(request.url).pathname,
            status: response.status,
          });

          return response;
        };

        return { transport: transport, close: handle.close };
      },
    },
  };
}

function run(command: string): void {
  execSync(command, { stdio: "inherit", shell: "/bin/bash" });
}

// A service that was stopped takes a moment to answer again, and the next test needs it to.
function waitUntilTheCliGetsAnAnswer(command: string): void {
  run(
    `for attempt in $(seq 1 60); do openstack --os-cloud devstack-admin ${command} >/dev/null 2>&1 && exit 0; sleep 5; done; exit 1`,
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, milliseconds);
  });
}

function scanAsIngest(
  report: OpenStackCollectionReport,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const prepared: JSONArray = OpenStackProbeMetrics.prepare({
    resourceMetrics: report.resourceMetrics,
    cloudName: "devstack",
  }).resourceMetrics;

  for (const resource of prepared as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;
        const body: JSONObject = metric["gauge"] as JSONObject;

        for (const datapoint of body["dataPoints"] as Array<JSONObject>) {
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

describeLive("the probe against a real cloud, over real TLS", () => {
  const authUrl: string = required("OPENSTACK_LIVE_AUTH_URL");
  const host: string = required("OPENSTACK_LIVE_HOST");
  const outputDir: string = required("OPENSTACK_LIVE_OUTPUT_DIR");
  const region: string = process.env["OPENSTACK_LIVE_REGION"] || "RegionOne";

  const admin: OpenStackCredential = {
    kind: "applicationCredential",
    id: required("OPENSTACK_LIVE_ADMIN_CREDENTIAL_ID"),
    secret: required("OPENSTACK_LIVE_ADMIN_CREDENTIAL_SECRET"),
  };
  const reader: OpenStackCredential = {
    kind: "applicationCredential",
    id: required("OPENSTACK_LIVE_READER_CREDENTIAL_ID"),
    secret: required("OPENSTACK_LIVE_READER_CREDENTIAL_SECRET"),
  };
  const password: (projectName: string) => OpenStackCredential = (
    projectName: string,
  ): OpenStackCredential => {
    return {
      kind: "password",
      username: required("OPENSTACK_LIVE_USER"),
      password: required("OPENSTACK_LIVE_PASSWORD"),
      userDomainName: "Default",
      projectName: projectName,
      projectDomainName: "Default",
    };
  };

  // What the API really presents, read from the first test, and what every later one trusts.
  let fingerprint: string = "";

  function testJob(
    overrides: Partial<OpenStackConnectionTestJob>,
  ): OpenStackConnectionTestJob {
    return {
      openStackCloudConnectionTestId: "live-test",
      authUrl: authUrl,
      credential: admin,
      regions: [],
      endpointInterface: "public",
      trustedCertificateFingerprints: fingerprint ? [fingerprint] : [],
      ...overrides,
    };
  }

  function collectionJob(
    options?: OpenStackCollectionOptions,
  ): OpenStackCollectionJob {
    return {
      openStackCloudId: "live-cloud",
      cloudName: "devstack",
      authUrl: authUrl,
      credential: admin,
      regions: [region],
      endpointInterface: "public",
      trustedCertificateFingerprints: [fingerprint],
      collectionIntervalInMinutes: 2,
      settingsVersion: 1,
      ...(options ? { options: options } : {}),
    };
  }

  // Kept for a person to read, and for the next fixture.
  function keep(name: string, value: unknown): void {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, `${name}.json`),
      // A collection that failed has no summary, and that is worth keeping too.
      JSON.stringify(value ?? null, null, 2),
    );
  }

  function points(
    report: OpenStackCollectionReport,
    metric: string,
  ): Array<ReportedDatapoint> {
    return datapointsOf(report.resourceMetrics).filter(
      (point: ReportedDatapoint): boolean => {
        return point.metric === metric;
      },
    );
  }

  function valueOf(
    report: OpenStackCollectionReport,
    metric: string,
  ): number | undefined {
    return points(report, metric)[0]?.value;
  }

  beforeAll(() => {
    expect(authUrl.startsWith("https://")).toBe(true);
  });

  describe("what a connection test names, on a real network", () => {
    test(
      "no certificate trusted: DevStack's own authority is not one the probe trusts, and it says what it saw",
      async () => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({ trustedCertificateFingerprints: [] }),
            liveRun().dependencies,
          );

        keep("test-untrusted", report);

        expect(report.status).toBe("Failed");
        expect(report.errorCode).toBe(
          OpenStackCollectionErrorCode.UntrustedCertificate,
        );
        expect(report.presentedCertificate?.fingerprint256).toMatch(
          /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/,
        );

        fingerprint = report.presentedCertificate?.fingerprint256 as string;
      },
      LONG_TEST_IN_MS,
    );

    test(
      "that certificate trusted, and an admin's credential: every read answers",
      async () => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(testJob({}), liveRun().dependencies);

        keep("test-full-view", report);

        expect(report.errorCode).toBeUndefined();
        expect(report.status).toBe("Succeeded");
        expect(report.summary?.accessLevel).toBe("FullView");
        expect(report.summary?.regionsInCatalog).toContain(region);
        expect(
          (report.summary?.reads || []).filter(
            (read: OpenStackAccessRead): boolean => {
              return (
                read.access === "Failing" ||
                read.access === "Refused" ||
                read.access === "OwnProjectOnly"
              );
            },
          ),
        ).toEqual([]);
      },
      LONG_TEST_IN_MS,
    );

    test(
      "another certificate trusted: the certificate changed, and nothing is sent",
      async () => {
        const answered: LiveRun = liveRun();
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({
              trustedCertificateFingerprints: [
                "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
              ],
            }),
            answered.dependencies,
          );

        expect(report.errorCode).toBe(
          OpenStackCollectionErrorCode.CertificateChanged,
        );
        expect(report.presentedCertificate?.fingerprint256).toBe(fingerprint);
        expect(answered.answered).toEqual([]);
      },
      LONG_TEST_IN_MS,
    );

    test.each([
      [
        "DNS: a name that has no address",
        (): string => {
          return "https://keystone.does-not-exist.invalid:5000/v3";
        },
        OpenStackCollectionErrorCode.AddressNotFound,
      ],
      [
        "TCP: nothing listens on the port",
        (): string => {
          return `https://${host}:1/v3`;
        },
        OpenStackCollectionErrorCode.ConnectionRefused,
      ],
      [
        "TLS: a port that doesn't speak it, which is RabbitMQ's",
        (): string => {
          return `https://${host}:5672/v3`;
        },
        OpenStackCollectionErrorCode.TlsFailed,
      ],
    ])(
      "%s",
      async (
        _name: string,
        address: () => string,
        code: OpenStackCollectionErrorCode,
      ) => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({ authUrl: address() }),
            liveRun().dependencies,
          );

        expect(report.status).toBe("Failed");
        expect(report.errorCode).toBe(code);
        expect(JSON.stringify(report)).not.toContain(admin.secret);
      },
      LONG_TEST_IN_MS,
    );

    test(
      "a refused credential",
      async () => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({
              credential: {
                kind: "applicationCredential",
                id: admin.kind === "applicationCredential" ? admin.id : "",
                secret: "not-the-secret",
              },
            }),
            liveRun().dependencies,
          );

        expect(report.errorCode).toBe(
          OpenStackCollectionErrorCode.InvalidCredential,
        );
      },
      LONG_TEST_IN_MS,
    );

    test(
      "the right password on a project it has no role on: the wrong project, said so",
      async () => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({ credential: password("ou-payments") }),
            liveRun().dependencies,
          );

        keep("test-wrong-project", report);

        expect(report.errorCode).toBe(
          OpenStackCollectionErrorCode.WrongProjectScope,
        );
      },
      LONG_TEST_IN_MS,
    );

    test(
      "that password on its own project logs in",
      async () => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({ credential: password("ou-research") }),
            liveRun().dependencies,
          );

        expect(report.summary?.projectName).toBe("ou-research");
        expect(report.errorCode).not.toBe(
          OpenStackCollectionErrorCode.InvalidCredential,
        );
      },
      LONG_TEST_IN_MS,
    );

    test(
      "a plain reader: what is missing is said per service, with what goes without it",
      async () => {
        const report: OpenStackConnectionTestReport =
          await OpenStackCollector.test(
            testJob({ credential: reader }),
            liveRun().dependencies,
          );

        keep("test-reader", report);

        expect(report.summary?.accessLevel).toBe("ProjectView");

        const hypervisors: OpenStackAccessRead | undefined =
          report.summary?.reads.find((read: OpenStackAccessRead): boolean => {
            return read.read === "hypervisors";
          });

        expect(hypervisors?.access).toBe("Refused");
        expect(hypervisors?.goesWithout).toBeTruthy();
      },
      LONG_TEST_IN_MS,
    );
  });

  describe("a collection", () => {
    test(
      "reads every service, and what it reads fills the rows the pages read",
      async () => {
        const live: LiveRun = liveRun();
        const report: OpenStackCollectionReport =
          await OpenStackCollector.collect(collectionJob(), live.dependencies);

        keep("collection-first", report);
        keep("collection-first-requests", live.answered);

        // A 400 is a request the real service will not take, which no recording could show.
        expect(
          live.answered.filter((request: AnsweredRequest): boolean => {
            return request.status === 400 || request.status >= 500;
          }),
        ).toEqual([]);

        expect(report.errorMessage).toBeUndefined();
        expect(report.status).toBe("Succeeded");

        for (const service of report.summary?.services || []) {
          expect({
            service: service.service,
            outcome: (service as OpenStackServiceSummary).outcome,
          }).toEqual({
            service: service.service,
            outcome: expect.stringMatching(/^(Succeeded|NotDeployed)$/),
          });
        }

        const rows: Array<OpenStackResourceBufferEntry> = scanAsIngest(report);
        const named: (
          kind: OpenStackResourceKind,
          name: string,
        ) => OpenStackResourceBufferEntry | undefined = (
          kind: OpenStackResourceKind,
          name: string,
        ): OpenStackResourceBufferEntry | undefined => {
          return rows.find((row: OpenStackResourceBufferEntry): boolean => {
            return row.kind === kind && row.name === name;
          });
        };

        for (const kind of [
          OpenStackResourceKind.Api,
          OpenStackResourceKind.Service,
          OpenStackResourceKind.Hypervisor,
          OpenStackResourceKind.Instance,
          OpenStackResourceKind.Flavor,
          OpenStackResourceKind.Network,
          OpenStackResourceKind.Subnet,
          OpenStackResourceKind.Router,
          OpenStackResourceKind.FloatingIp,
          OpenStackResourceKind.Volume,
          OpenStackResourceKind.StoragePool,
          OpenStackResourceKind.Snapshot,
          OpenStackResourceKind.Image,
          OpenStackResourceKind.Project,
        ]) {
          expect({
            kind,
            has: rows.some((row: OpenStackResourceBufferEntry): boolean => {
              return row.kind === kind;
            }),
          }).toEqual({ kind, has: true });
        }

        // What this cloud really holds, from estate.sh.
        expect(
          named(OpenStackResourceKind.Instance, "ou-running")?.facts[
            "addressIpv4"
          ],
        ).toBeTruthy();
        expect(
          named(OpenStackResourceKind.Instance, "ou-failed")?.facts[
            "faultMessage"
          ],
        ).toContain("No valid host");

        const pool: unknown = named(OpenStackResourceKind.Volume, "ou-vol-used")
          ?.facts["pool"];

        expect(
          rows.some((row: OpenStackResourceBufferEntry): boolean => {
            return (
              row.kind === OpenStackResourceKind.StoragePool &&
              row.name === pool
            );
          }),
        ).toBe(true);

        // Nothing secret goes anywhere near what is sent.
        expect(JSON.stringify(report)).not.toContain(admin.secret);

        // The second one asks Nova with changes-since, which a real Nova has to take.
        live.answered.length = 0;

        const next: OpenStackCollectionReport =
          await OpenStackCollector.collect(collectionJob(), live.dependencies);

        keep("collection-second-requests", live.answered);

        expect(next.status).toBe("Succeeded");
        expect(next.summary?.instanceReadModes?.[region]).toBe("Incremental");
        expect(
          live.answered.filter((request: AnsweredRequest): boolean => {
            return request.status === 400 || request.status >= 500;
          }),
        ).toEqual([]);
      },
      LONG_TEST_IN_MS,
    );

    test(
      "Project limits and Ports are requests a real cloud takes too",
      async () => {
        const live: LiveRun = liveRun();
        const report: OpenStackCollectionReport =
          await OpenStackCollector.collect(
            collectionJob({ collectProjectLimits: true, collectPorts: true }),
            live.dependencies,
          );

        keep("collection-options-requests", live.answered);

        expect(report.status).toBe("Succeeded");
        expect(
          live.answered.filter((request: AnsweredRequest): boolean => {
            return request.status === 400 || request.status >= 500;
          }),
        ).toEqual([]);
        expect(valueOf(report, "openstack_neutron_ports")).toBeGreaterThan(0);
        expect(
          points(report, "openstack_nova_limits_vcpus_max").length,
        ).toBeGreaterThan(0);
      },
      LONG_TEST_IN_MS,
    );
  });

  describe("what the issue promises when a service goes", () => {
    const NEUTRON_UNIT: string = required("OPENSTACK_LIVE_NEUTRON_UNIT");
    const KEYSTONE_UNIT: string = required("OPENSTACK_LIVE_KEYSTONE_UNIT");

    afterAll(() => {
      run(`sudo systemctl start ${NEUTRON_UNIT} ${KEYSTONE_UNIT}`);
    });

    test(
      "a failing Neutron leaves Nova's data intact",
      async () => {
        run(`sudo systemctl stop ${NEUTRON_UNIT}`);

        try {
          const report: OpenStackCollectionReport =
            await OpenStackCollector.collect(
              collectionJob(),
              liveRun().dependencies,
            );

          keep("collection-neutron-down", report.summary);

          expect(report.status).toBe("PartiallySucceeded");
          expect(valueOf(report, "openstack_neutron_up")).toBe(0);
          expect(valueOf(report, "openstack_nova_up")).toBe(1);
          expect(
            points(report, "openstack_nova_server_status").length,
          ).toBeGreaterThan(0);
          expect(
            points(report, "openstack_cinder_volume_gb").length,
          ).toBeGreaterThan(0);
        } finally {
          run(`sudo systemctl start ${NEUTRON_UNIT}`);
          waitUntilTheCliGetsAnAnswer("network list -f value -c ID");
        }
      },
      LONG_TEST_IN_MS,
    );

    test(
      "a Keystone outage backs off instead of hammering it, and comes back",
      async () => {
        const live: LiveRun = liveRun();

        run(`sudo systemctl stop ${KEYSTONE_UNIT}`);

        try {
          const report: OpenStackCollectionReport =
            await OpenStackCollector.collect(
              collectionJob(),
              live.dependencies,
            );

          keep("collection-keystone-down", {
            summary: report.summary,
            errorCode: report.errorCode,
            errorMessage: report.errorMessage,
            requests: live.answered,
          });

          expect(report.status).toBe("Failed");
          expect(report.errorCode).toBe(
            OpenStackCollectionErrorCode.KeystoneFailing,
          );

          const asked: number = live.answered.length;

          expect(asked).toBeGreaterThan(0);

          // Right away, and half a minute on: nothing goes near it.
          await OpenStackCollector.collect(collectionJob(), live.dependencies);
          expect(live.answered.length).toBe(asked);

          live.advance(BACKOFF_BASE_IN_MS / 2);
          await OpenStackCollector.collect(collectionJob(), live.dependencies);
          expect(live.answered.length).toBe(asked);
        } finally {
          run(`sudo systemctl start ${KEYSTONE_UNIT}`);
          waitUntilTheCliGetsAnAnswer("token issue -f value -c id");
        }

        /*
         * Past the longest it waits, it is tried again, and it answers. Each service asks Keystone
         * about a token too, so one may take a moment longer to come back than Keystone did.
         */
        let after: OpenStackCollectionReport | undefined = undefined;

        for (
          let attempt: number = 0;
          attempt < 6 && after?.status !== "Succeeded";
          attempt++
        ) {
          await sleep(attempt === 0 ? 0 : 20_000);
          live.advance(MAX_BACKOFF_IN_MS + 60_000);
          after = await OpenStackCollector.collect(
            collectionJob(),
            live.dependencies,
          );
        }

        keep("collection-keystone-back", after?.summary);

        expect(after?.status).toBe("Succeeded");
      },
      LONG_TEST_IN_MS,
    );
  });
});
