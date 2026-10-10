import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import BadDataException from "Common/Types/Exception/BadDataException";
import VMwareCollectionErrorCode from "Common/Types/VMware/VMwareCollectionError";
import {
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
  VMwarePresentedCertificate,
} from "Common/Types/VMware/VMwareProbeCollection";
import { VCenterAddress } from "Common/Utils/VMware/VMwareVCenterAddress";
import VMwareCollector, {
  MAX_COLLECTION_TIME_IN_MS,
  VMwareCollectorDependencies,
  VMwareTransportHandle,
  formatDuration,
  formatSize,
  getCollectionBudgetInMs,
  resolveVCenterAddress,
} from "../../../Utils/VMware/VMwareCollector";
import VSphereSessionCache, {
  getSessionKey,
} from "../../../Utils/VMware/VSphereSessionCache";
import {
  VSphereHttpRequest,
  VSphereHttpResponse,
  VSphereTransport,
} from "../../../Utils/VMware/VSphereSoapClient";
import { VSphereCertificateError } from "../../../Utils/VMware/VSphereTls";
import {
  RecordedExchange,
  ReplayTransport,
  createReplayTransport,
  loadExchanges,
  soapEnvelope,
  soapFault,
} from "./Helpers/ReplayTransport";

/*
 * One collection, or one connection test, end to end against recorded
 * vSphere answers: the address check, the transport, the session kept
 * between collections, the time and size limits, and the exact sentence a
 * person reads for every way it can fail. Never the password.
 */

const PASSWORD: string = "n0t-in-any-report!";
const USERNAME: string = "oneuptime@vsphere.local";
const RECORDED_COOKIE: string = "187c076f-596a-44e5-9007-14d9adb15408";
const STARTED_AT: Date = new Date("2026-10-10T12:00:00.000Z");
const TRUSTED_FINGERPRINT: string =
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

function collectionJob(
  overrides: Partial<VMwareCollectionJob> = {},
): VMwareCollectionJob {
  return {
    vmwareVCenterId: "vcenter-1",
    vcenterName: "Lab",
    vcenterUrl: "https://vcsa.example.com",
    username: USERNAME,
    password: PASSWORD,
    collectionIntervalInMinutes: 2,
    settingsVersion: 7,
    ...overrides,
  };
}

function testJob(
  overrides: Partial<VMwareConnectionTestJob> = {},
): VMwareConnectionTestJob {
  return {
    vmwareVCenterConnectionTestId: "test-1",
    vcenterUrl: "https://vcsa.example.com",
    username: USERNAME,
    password: PASSWORD,
    ...overrides,
  };
}

function sessionKeyOf(job: VMwareCollectionJob): string {
  return getSessionKey({
    vmwareVCenterId: job.vmwareVCenterId,
    vcenterUrl: job.vcenterUrl,
    username: job.username,
    password: job.password,
    trustedFingerprint: job.trustedCertificateFingerprint || null,
  });
}

interface OpenedTransport {
  address: VCenterAddress;
  pinnedAddresses: Array<string>;
  trustedFingerprint: string | null;
  isClosed: boolean;
}

interface Harness {
  dependencies: VMwareCollectorDependencies;
  opened: Array<OpenedTransport>;
  resolved: Array<string>;
}

// The collector's dependencies, around a transport the test scripts.
function harness(data: {
  transport: VSphereTransport;
  resolve?: ((url: string) => Promise<Array<string>>) | undefined;
  overrides?: Partial<VMwareCollectorDependencies> | undefined;
}): Harness {
  const opened: Array<OpenedTransport> = [];
  const resolved: Array<string> = [];
  let calls: number = 0;

  const dependencies: VMwareCollectorDependencies = {
    resolve: async (url: string): Promise<Array<string>> => {
      resolved.push(url);

      if (data.resolve) {
        return await data.resolve(url);
      }

      return ["192.0.2.10"];
    },
    createTransport: (transportData: {
      address: VCenterAddress;
      pinnedAddresses: Array<string>;
      trustedFingerprint: string | null;
    }): VMwareTransportHandle => {
      const entry: OpenedTransport = {
        address: transportData.address,
        pinnedAddresses: transportData.pinnedAddresses,
        trustedFingerprint: transportData.trustedFingerprint,
        isClosed: false,
      };
      opened.push(entry);

      return {
        transport: data.transport,
        close: (): void => {
          entry.isClosed = true;
        },
      };
    },
    // The first call starts the collection; it ends 1.5 s later.
    now: (): Date => {
      calls++;
      return calls === 1 ? STARTED_AT : new Date(STARTED_AT.getTime() + 1500);
    },
    scopeVersion: "test",
    collectVsan: true,
    ...(data.overrides || {}),
  };

  return { dependencies: dependencies, opened: opened, resolved: resolved };
}

function replaying(name: string): ReplayTransport {
  return createReplayTransport(loadExchanges(name));
}

function answer(
  soapMethod: string,
  body: string,
  status: number = 200,
): RecordedExchange {
  return {
    method: "POST",
    path: "/sdk",
    soapMethod: soapMethod,
    status: status,
    body: body,
  };
}

function cookieOf(request: VSphereHttpRequest): string | undefined {
  return request.headers["Cookie"];
}

const NOT_AUTHENTICATED: string = soapFault({
  faultType: "NotAuthenticated",
  faultString: "The session is not authenticated.",
});

const EMPTY_PROPERTIES: string = soapEnvelope(
  '<RetrievePropertiesExResponse xmlns="urn:vim25"></RetrievePropertiesExResponse>',
);

function presentedCertificate(): VMwarePresentedCertificate {
  return {
    fingerprint256: TRUSTED_FINGERPRINT.replace(/AA/g, "AB"),
    subject: "CN=vcsa.example.com",
    issuer: "CN=CA, O=VMware",
    isSelfSigned: false,
    verificationError: "unable to verify the first certificate",
  };
}

beforeEach(() => {
  VSphereSessionCache.clear();
});

afterEach(() => {
  VSphereSessionCache.clear();
});

describe("VMwareCollector.collect", () => {
  test("collects the recorded vCenter as the agent's metrics, and says what it found", async () => {
    const replay: ReplayTransport = replaying("vcsim-vcenter-collect.json");
    const setup: Harness = harness({ transport: replay.transport });
    const job: VMwareCollectionJob = collectionJob({
      trustedCertificateFingerprint: TRUSTED_FINGERPRINT,
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      job,
      setup.dependencies,
    );

    expect(report.errorMessage).toBeUndefined();
    expect(report).toMatchObject({
      vmwareVCenterId: "vcenter-1",
      settingsVersion: 7,
      status: "Succeeded",
      collectedAt: STARTED_AT.toISOString(),
      durationInMs: 1500,
    });
    expect(report.errorCode).toBeUndefined();
    expect(report.resourceMetrics).toHaveLength(24);
    expect(report.summary).toMatchObject({
      apiType: "VirtualCenter",
      datacenterCount: 1,
      clusterCount: 2,
      hostCount: 5,
      vmCount: 10,
      poweredOnVmCount: 10,
      templateCount: 0,
      datastoreCount: 1,
      resourcePoolCount: 5,
      resourceCount: 24,
    });
    expect(report.summary!.productName).toBeTruthy();
    expect(report.summary!.datapointCount).toBeGreaterThan(200);
    expect(report.summary!.warnings).toEqual([]);

    // Everything recorded was asked, in order, and nothing more.
    expect(replay.remaining()).toBe(0);

    // The address was checked, and the socket pinned to what it resolved to.
    expect(setup.resolved).toEqual(["https://vcsa.example.com"]);
    expect(setup.opened).toHaveLength(1);
    expect(setup.opened[0]).toMatchObject({
      address: { host: "vcsa.example.com", port: 443 },
      pinnedAddresses: ["192.0.2.10"],
      trustedFingerprint: TRUSTED_FINGERPRINT,
      isClosed: true,
    });

    // The session stays open for the next collection.
    expect(VSphereSessionCache.get(sessionKeyOf(job))).toBe(RECORDED_COOKIE);

    // The password went to vCenter - in the login - and nowhere else.
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    const login: VSphereHttpRequest | undefined = replay.requests.find(
      (request: VSphereHttpRequest) => {
        return Boolean(request.body?.includes("<Login "));
      },
    );
    expect(login?.body).toContain(`<password>${PASSWORD}</password>`);
    expect(login?.body).toContain(`<userName>${USERNAME}</userName>`);
    expect(
      replay.requests.filter((request: VSphereHttpRequest) => {
        return Boolean(request.body?.includes(PASSWORD));
      }),
    ).toHaveLength(1);
  });

  test("collects a standalone ESXi host the same way", async () => {
    const replay: ReplayTransport = replaying("vcsim-esx-collect.json");
    const setup: Harness = harness({ transport: replay.transport });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob({ vcenterUrl: "esx-01.example.com:8443" }),
      setup.dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary).toMatchObject({
      apiType: "HostAgent",
      datacenterCount: 1,
      clusterCount: 0,
      hostCount: 1,
    });
    expect(setup.resolved).toEqual(["https://esx-01.example.com:8443"]);
    expect(setup.opened[0]!.address.port).toBe(8443);
    expect(replay.remaining()).toBe(0);
  });

  test("the next collection reuses the session: no second login, the cookie on every call", async () => {
    const first: ReplayTransport = replaying("vcsim-vcenter-collect.json");
    await VMwareCollector.collect(
      collectionJob(),
      harness({ transport: first.transport }).dependencies,
    );

    const withoutLogin: Array<RecordedExchange> = loadExchanges(
      "vcsim-vcenter-collect.json",
    ).filter((exchange: RecordedExchange) => {
      return exchange.soapMethod !== "Login";
    });
    const second: ReplayTransport = createReplayTransport(withoutLogin);

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      harness({ transport: second.transport }).dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(second.remaining()).toBe(0);

    const soapCalls: Array<VSphereHttpRequest> = second.requests.filter(
      (request: VSphereHttpRequest) => {
        return request.method === "POST";
      },
    );
    expect(soapCalls.length).toBeGreaterThan(10);

    for (const request of soapCalls) {
      expect(cookieOf(request)).toBe(`vmware_soap_session=${RECORDED_COOKIE}`);
      expect(request.body).not.toContain(PASSWORD);
    }
  });

  test("a changed password never reuses the session opened with the old one", async () => {
    await VMwareCollector.collect(
      collectionJob(),
      harness({ transport: replaying("vcsim-vcenter-collect.json").transport })
        .dependencies,
    );

    // The full recording - Login included - must be played to the end.
    const replay: ReplayTransport = replaying("vcsim-vcenter-collect.json");
    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob({ password: "a-new-password" }),
      harness({ transport: replay.transport }).dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(replay.remaining()).toBe(0);
    expect(cookieOf(replay.requests[1]!)).toBeUndefined();
  });

  test("a session vCenter ended is renewed once, with the saved credentials", async () => {
    const job: VMwareCollectionJob = collectionJob();
    VSphereSessionCache.set(sessionKeyOf(job), "expired-session");

    const recorded: Array<RecordedExchange> = loadExchanges(
      "vcsim-vcenter-collect.json",
    );
    // versions, service content, then the first call answered NotAuthenticated.
    const replay: ReplayTransport = createReplayTransport([
      recorded[0]!,
      recorded[1]!,
      answer("CreateContainerView", NOT_AUTHENTICATED, 500),
      recorded[2]!, // Login
      ...recorded.slice(3),
    ]);

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      job,
      harness({ transport: replay.transport }).dependencies,
    );

    expect(report.status).toBe("Succeeded");
    expect(replay.remaining()).toBe(0);
    expect(cookieOf(replay.requests[2]!)).toBe(
      "vmware_soap_session=expired-session",
    );
    expect(replay.requests[3]!.body).toContain(
      `<password>${PASSWORD}</password>`,
    );
    expect(cookieOf(replay.requests[4]!)).toBe(
      `vmware_soap_session=${RECORDED_COOKIE}`,
    );
    expect(VSphereSessionCache.get(sessionKeyOf(job))).toBe(RECORDED_COOKIE);
  });

  test("a refused login is InvalidLogin: it names the user, never the password, and forgets the session", async () => {
    const job: VMwareCollectionJob = collectionJob();
    VSphereSessionCache.set(sessionKeyOf(job), "expired-session");

    const recorded: Array<RecordedExchange> = loadExchanges(
      "vcsim-vcenter-collect.json",
    );
    const refused: Array<RecordedExchange> = loadExchanges(
      "vcsim-invalid-login.json",
    );
    const replay: ReplayTransport = createReplayTransport([
      recorded[0]!,
      recorded[1]!,
      answer("CreateContainerView", NOT_AUTHENTICATED, 500),
      refused[2]!,
    ]);
    const setup: Harness = harness({ transport: replay.transport });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      job,
      setup.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.InvalidLogin,
    });
    expect(report.errorMessage).toBe(
      `vCenter at vcsa.example.com:443 refused the login for ${USERNAME}: the user name or password is wrong, or the account is locked. Use the full user name with its domain, such as oneuptime@vsphere.local.`,
    );
    expect(report.resourceMetrics).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    expect(VSphereSessionCache.get(sessionKeyOf(job))).toBeNull();
    expect(setup.opened[0]!.isClosed).toBe(true);
    expect(replay.remaining()).toBe(0);
  });

  test("a wrong password on the first login is InvalidLogin", async () => {
    const replay: ReplayTransport = replaying("vcsim-invalid-login.json");

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      harness({ transport: replay.transport }).dependencies,
    );

    expect(report.errorCode).toBe(VMwareCollectionErrorCode.InvalidLogin);
    expect(VSphereSessionCache.size()).toBe(0);
  });

  test("an address that is not one fails before anything is resolved or opened", async () => {
    const replay: ReplayTransport = createReplayTransport([]);
    const setup: Harness = harness({ transport: replay.transport });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob({ vcenterUrl: "http://vcsa.example.com" }),
      setup.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.InvalidAddress,
      errorMessage:
        "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
    });
    expect(setup.resolved).toEqual([]);
    expect(setup.opened).toEqual([]);
  });

  test("an address that resolves somewhere a probe never connects to is refused before connecting", async () => {
    const setup: Harness = harness({
      transport: createReplayTransport([]).transport,
      // The probe's own guard, as it runs: a multicast address is forbidden.
      resolve: resolveVCenterAddress,
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob({ vcenterUrl: "https://224.0.0.1" }),
      setup.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.AddressNotAllowed,
      errorMessage:
        "The probe does not connect to 224.0.0.1: it is, or resolves to, a loopback, link-local, cloud metadata or other reserved address. Enter the address vCenter answers on in your network.",
    });
    expect(setup.opened).toEqual([]);
  });

  test("a vCenter on a private address is connected to - it is where vCenter usually is", async () => {
    expect(await resolveVCenterAddress("https://10.20.30.40")).toEqual([
      "10.20.30.40",
    ]);
    expect(await resolveVCenterAddress("https://[fd12:3456::20]:8443")).toEqual(
      ["fd12:3456::20"],
    );
  });

  test("a host DNS does not know is AddressNotFound", async () => {
    const setup: Harness = harness({
      transport: createReplayTransport([]).transport,
      resolve: async (): Promise<Array<string>> => {
        // What the guard throws for a name that does not resolve.
        throw new BadDataException(
          "vCenter address hostname could not be resolved via DNS.",
        );
      },
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob({ vcenterUrl: "vcsa.nowhere.example" }),
      setup.dependencies,
    );

    expect(report).toMatchObject({
      errorCode: VMwareCollectionErrorCode.AddressNotFound,
      errorMessage:
        "The probe cannot find vcsa.nowhere.example in DNS. Check the spelling, or use vCenter's IP address.",
    });
    expect(setup.opened).toEqual([]);
  });

  test("an untrusted certificate fails with the certificate to trust, and forgets the session", async () => {
    const job: VMwareCollectionJob = collectionJob();
    VSphereSessionCache.set(sessionKeyOf(job), "a-session");
    const certificate: VMwarePresentedCertificate = presentedCertificate();

    const setup: Harness = harness({
      transport: async (): Promise<VSphereHttpResponse> => {
        throw new VSphereCertificateError({
          kind: "untrusted",
          presentedCertificate: certificate,
          message:
            "vcsa.example.com's certificate is not trusted by the probe. Nothing was sent.",
        });
      },
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      job,
      setup.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
      errorMessage:
        "vcsa.example.com's certificate is not trusted by the probe. Nothing was sent.",
      presentedCertificate: certificate,
    });
    expect(VSphereSessionCache.get(sessionKeyOf(job))).toBeNull();
    expect(setup.opened[0]!.isClosed).toBe(true);
  });

  test("a certificate other than the trusted one is CertificateChanged", async () => {
    const setup: Harness = harness({
      transport: async (): Promise<VSphereHttpResponse> => {
        throw new VSphereCertificateError({
          kind: "changed",
          presentedCertificate: presentedCertificate(),
          message: "vcsa.example.com presented a different certificate.",
        });
      },
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob({ trustedCertificateFingerprint: TRUSTED_FINGERPRINT }),
      setup.dependencies,
    );

    expect(report.errorCode).toBe(VMwareCollectionErrorCode.CertificateChanged);
    expect(report.presentedCertificate).toEqual(presentedCertificate());
    expect(setup.opened[0]!.trustedFingerprint).toBe(TRUSTED_FINGERPRINT);
  });

  test("a login that sees no datacenter is NoPermission, with how to fix it", async () => {
    const recorded: Array<RecordedExchange> = loadExchanges(
      "vcsim-vcenter-collect.json",
    );
    const replay: ReplayTransport = createReplayTransport([
      ...recorded.slice(0, 4), // versions, service content, login, root view
      answer("RetrievePropertiesEx", EMPTY_PROPERTIES), // folders
      answer("RetrievePropertiesEx", EMPTY_PROPERTIES), // datacenters
      answer("RetrievePropertiesEx", EMPTY_PROPERTIES), // compute resources
      answer("RetrievePropertiesEx", EMPTY_PROPERTIES), // resource pools
      answer("RetrievePropertiesEx", EMPTY_PROPERTIES), // vApps
      recorded[9]!, // DestroyView
      recorded[10]!, // performance counters
    ]);

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      harness({ transport: replay.transport }).dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.NoPermission,
      errorMessage: `${USERNAME} logged in but sees no datacenter. Give it the Read-Only role on the top-level vCenter object, with Propagate to children ticked.`,
    });
    expect(replay.remaining()).toBe(0);
  });

  test("a NoPermission fault while reading the inventory is NoPermission", async () => {
    const recorded: Array<RecordedExchange> = loadExchanges(
      "vcsim-vcenter-collect.json",
    );
    const replay: ReplayTransport = createReplayTransport([
      ...recorded.slice(0, 4),
      answer(
        "RetrievePropertiesEx",
        soapFault({
          faultType: "NoPermission",
          faultString: "Permission to perform this operation was denied.",
          detailXml: "<privilegeId>System.Read</privilegeId>",
        }),
        500,
      ),
      recorded[9]!, // the root view is still destroyed
    ]);

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      harness({ transport: replay.transport }).dependencies,
    );

    expect(report).toMatchObject({
      errorCode: VMwareCollectionErrorCode.NoPermission,
      errorMessage: `${USERNAME} may not read part of vCenter's inventory (NoPermission). Give it the Read-Only role on the top-level vCenter object, with Propagate to children ticked.`,
    });
    expect(replay.remaining()).toBe(0);
  });

  test("an address that is not vSphere says so", async () => {
    const setup: Harness = harness({
      transport: async (): Promise<VSphereHttpResponse> => {
        return { status: 404, headers: {}, body: "<html>Not Found</html>" };
      },
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      setup.dependencies,
    );

    expect(report.errorCode).toBe(VMwareCollectionErrorCode.NotVSphere);
    expect(report.errorMessage).toBe(
      "vcsa.example.com:443 is not a vSphere API: The address answered HTTP 404 for /sdk/vimServiceVersions.xml, which every vCenter Server and ESXi host serves. Enter the address of vCenter Server or a standalone ESXi host.",
    );
  });

  test("a collection larger than one upload is refused, pointing at the agent", async () => {
    const replay: ReplayTransport = replaying("vcsim-vcenter-collect.json");

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      harness({
        transport: replay.transport,
        overrides: { maxPayloadBytes: 20 * 1024 },
      }).dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(VMwareCollectionErrorCode.PayloadTooLarge);
    expect(report.errorMessage).toMatch(
      /^This vCenter's collection is \d+ KiB of metrics, more than the 20 KiB one probe upload takes\. Use the VMware agent for this vCenter\.$/,
    );
    expect(report.resourceMetrics).toBeUndefined();
  });

  test("a collection over its time budget is TimedOut, and the connection is closed", async () => {
    const setup: Harness = harness({
      transport: (): Promise<VSphereHttpResponse> => {
        // vCenter never answers.
        return new Promise<VSphereHttpResponse>(() => {});
      },
      overrides: { collectionTimeoutInMs: 20 },
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      setup.dependencies,
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.TimedOut,
      errorMessage:
        "Collecting vcsa.example.com took longer than 1 second. Collect it less often, or check vCenter's load.",
    });
    expect(setup.opened[0]!.isClosed).toBe(true);
  });

  test("a refused connection says which port to open", async () => {
    const setup: Harness = harness({
      transport: async (): Promise<VSphereHttpResponse> => {
        const error: Error & { code?: string } = new Error(
          "connect ECONNREFUSED 192.0.2.10:443",
        );
        error.code = "ECONNREFUSED";
        throw error;
      },
    });

    const report: VMwareCollectionReport = await VMwareCollector.collect(
      collectionJob(),
      setup.dependencies,
    );

    expect(report).toMatchObject({
      errorCode: VMwareCollectionErrorCode.ConnectionRefused,
      errorMessage:
        "vcsa.example.com:443 refused the connection: nothing listens on port 443 there. vCenter serves its API on HTTPS port 443 unless it was changed.",
    });
  });
});

describe("VMwareCollector.test", () => {
  test("logs in, counts what the user can see, and logs out", async () => {
    const replay: ReplayTransport = replaying("vcsim-vcenter-test.json");
    const setup: Harness = harness({ transport: replay.transport });

    const report: VMwareConnectionTestReport = await VMwareCollector.test(
      testJob({ trustedCertificateFingerprint: TRUSTED_FINGERPRINT }),
      setup.dependencies,
    );

    expect(report).toMatchObject({
      vmwareVCenterConnectionTestId: "test-1",
      status: "Succeeded",
      durationInMs: 1500,
    });
    expect(report.summary).toMatchObject({
      apiType: "VirtualCenter",
      datacenterCount: 1,
      clusterCount: 2,
      hostCount: 5,
      vmCount: 10,
      poweredOnVmCount: 10,
      templateCount: 0,
      datastoreCount: 1,
      // Resource pools, not vApps.
      resourcePoolCount: 5,
      warnings: [],
    });
    // The recording ends with Logout: the test leaves no session behind.
    expect(replay.remaining()).toBe(0);
    expect(setup.opened[0]).toMatchObject({
      trustedFingerprint: TRUSTED_FINGERPRINT,
      isClosed: true,
    });
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
  });

  test("never reuses a collection's session, and keeps none", async () => {
    const job: VMwareCollectionJob = collectionJob();
    VSphereSessionCache.set(sessionKeyOf(job), "a-collection-session");

    const replay: ReplayTransport = replaying("vcsim-vcenter-test.json");
    await VMwareCollector.test(
      testJob(),
      harness({ transport: replay.transport }).dependencies,
    );

    expect(cookieOf(replay.requests[1]!)).toBeUndefined();
    expect(replay.requests[2]!.body).toContain("<Login ");
    expect(VSphereSessionCache.size()).toBe(1);
    expect(VSphereSessionCache.get(sessionKeyOf(job))).toBe(
      "a-collection-session",
    );
  });

  test("a wrong password is InvalidLogin", async () => {
    const report: VMwareConnectionTestReport = await VMwareCollector.test(
      testJob(),
      harness({ transport: replaying("vcsim-invalid-login.json").transport })
        .dependencies,
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(VMwareCollectionErrorCode.InvalidLogin);
    expect(report.errorMessage).toContain(USERNAME);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
  });

  test("a login that sees nothing is NoPermission - and the view is destroyed and the session ended all the same", async () => {
    const recorded: Array<RecordedExchange> = loadExchanges(
      "vcsim-vcenter-test.json",
    );
    const replay: ReplayTransport = createReplayTransport([
      ...recorded.slice(0, 4), // versions, service content, login, view
      answer("RetrievePropertiesEx", EMPTY_PROPERTIES),
      recorded[10]!, // DestroyView
      recorded[11]!, // Logout
    ]);

    const report: VMwareConnectionTestReport = await VMwareCollector.test(
      testJob(),
      harness({ transport: replay.transport }).dependencies,
    );

    expect(report.errorCode).toBe(VMwareCollectionErrorCode.NoPermission);
    expect(replay.remaining()).toBe(0);
  });

  test("an address a probe never connects to, and one that is not an address", async () => {
    const forbidden: VMwareConnectionTestReport = await VMwareCollector.test(
      testJob({ vcenterUrl: "https://239.1.2.3" }),
      harness({
        transport: createReplayTransport([]).transport,
        resolve: resolveVCenterAddress,
      }).dependencies,
    );
    expect(forbidden.errorCode).toBe(
      VMwareCollectionErrorCode.AddressNotAllowed,
    );

    const invalid: VMwareConnectionTestReport = await VMwareCollector.test(
      testJob({ vcenterUrl: "https://localhost" }),
      harness({ transport: createReplayTransport([]).transport }).dependencies,
    );
    expect(invalid).toMatchObject({
      errorCode: VMwareCollectionErrorCode.InvalidAddress,
      errorMessage:
        "OneUptime does not connect to loopback, link-local or cloud metadata addresses. Enter vCenter's own host name or IP address.",
    });
  });

  test("a test vCenter never finishes is TimedOut", async () => {
    const report: VMwareConnectionTestReport = await VMwareCollector.test(
      testJob(),
      harness({
        transport: (): Promise<VSphereHttpResponse> => {
          return new Promise<VSphereHttpResponse>(() => {});
        },
        overrides: { testTimeoutInMs: 20 },
      }).dependencies,
    );

    expect(report).toMatchObject({
      errorCode: VMwareCollectionErrorCode.TimedOut,
      errorMessage: "vcsa.example.com did not finish the test within 1 second.",
    });
  });
});

describe("VMwareCollector limits and wording", () => {
  test("a collection may take its interval, at least a minute and at most ten", () => {
    expect(getCollectionBudgetInMs(0)).toBe(60_000);
    expect(getCollectionBudgetInMs(1)).toBe(60_000);
    expect(getCollectionBudgetInMs(5)).toBe(5 * 60_000);
    expect(getCollectionBudgetInMs(60)).toBe(MAX_COLLECTION_TIME_IN_MS);
    expect(MAX_COLLECTION_TIME_IN_MS).toBe(10 * 60_000);
    expect(getCollectionBudgetInMs(Number.NaN)).toBe(60_000);
  });

  test("sizes and durations read as a person says them", () => {
    expect(formatSize(48 * 1024 * 1024)).toBe("48 MiB");
    expect(formatSize(300 * 1024)).toBe("300 KiB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MiB");
    expect(formatSize(100)).toBe("1 KiB");
    expect(formatSize(12.4 * 1024 * 1024)).toBe("12 MiB");
    expect(formatDuration(20)).toBe("1 second");
    expect(formatDuration(45_000)).toBe("45 seconds");
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(10 * 60_000)).toBe("10 minutes");
  });
});
