import { describe, expect, test } from "@jest/globals";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import XcpNgProbeCollectionStore, {
  XcpNgCollectionReportOutcome,
} from "../../../../Server/Utils/XcpNg/XcpNgProbeCollectionStore";
import XcpNgConnection from "../../../../Models/DatabaseModels/XcpNgConnection";
import { SubscriptionStatusUtil } from "../../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../../Types/ObjectID";
import XcpNgCollectionErrorCode from "../../../../Types/XcpNg/XcpNgCollectionError";
import XcpNgCollectionStatus from "../../../../Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionType from "../../../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgCollectionSummary,
} from "../../../../Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind from "../../../../Types/XcpNg/XcpNgXapiAccount";
import {
  DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
} from "../../../../Utils/XcpNg/XcpNgCollectionSettings";

/*
 * The database half of reading XCP-ng connections from a probe (#10996,
 * #10999), against a recording fake of the connection service: which
 * connections a probe is handed (claimed in one statement, its own, due,
 * with the secrets its kind needs), and what a report may write (only its
 * probe's, only the current settings' status, only what it may teach the
 * next read).
 */

const PROBE_ID: ObjectID = new ObjectID("4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0001");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7c0e9d1a-1111-4b2c-8d3e-000000000001",
);
const CONNECTION_ID: string = "9e8d7c6b-2222-4a1b-9c0d-000000000001";
const CONNECTION_ID_2: string = "9e8d7c6b-2222-4a1b-9c0d-000000000002";
const POOL_ID: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const HOST_UUID: string = "11111111-aaaa-4bbb-8ccc-000000000001";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

interface Query {
  sql: string;
  parameters: Array<unknown>;
}

interface FakeService {
  service: DatabaseService<XcpNgConnection>;
  queries: Array<Query>;
  findByCalls: Array<Record<string, unknown>>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
}

function fakeService(data: {
  claimedIds?: Array<string>;
  connections?: Array<XcpNgConnection>;
  connection?: XcpNgConnection | null;
}): FakeService {
  const queries: Array<Query> = [];
  const findByCalls: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  const service: unknown = {
    // A claim is one self-committing statement: a transaction fails the test.
    executeTransaction: async (): Promise<never> => {
      throw new Error("A claim must not open a transaction.");
    },
    getRepository: (): unknown => {
      return {
        manager: {
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            queries.push({ sql: sql, parameters: parameters });

            // The set-aside statement counts; the claim lists what it claimed.
            if (sql.includes('"claimed"')) {
              return (data.claimedIds || []).map((id: string) => {
                return { _id: id };
              });
            }

            return [];
          },
        },
      };
    },
    findBy: async (options: Record<string, unknown>): Promise<unknown> => {
      findByCalls.push(options);
      return data.connections || [];
    },
    findOneById: async (): Promise<unknown> => {
      return data.connection === undefined ? null : data.connection;
    },
    updateColumnsByIdWithoutHooks: async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      updates.push({ id: input.id.toString(), data: input.data });
    },
  };

  return {
    service: service as DatabaseService<XcpNgConnection>,
    queries: queries,
    findByCalls: findByCalls,
    updates: updates,
  };
}

function xenOrchestraRow(
  overrides: Record<string, unknown> = {},
): XcpNgConnection {
  const connection: XcpNgConnection = new XcpNgConnection();
  connection._id = CONNECTION_ID;
  connection.name = "Paris Xen Orchestra";
  connection.connectionType = XcpNgConnectionType.XenOrchestra;
  connection.address = "https://xo.example.com";
  connection.openMetricsSecret = "the-plugin-secret";
  connection.apiToken = "the-api-token";
  connection.collectionIntervalInMinutes = 1;
  connection.collectionSettingsVersion = 3;
  Object.assign(connection, overrides);
  return connection;
}

function xapiRow(overrides: Record<string, unknown> = {}): XcpNgConnection {
  const connection: XcpNgConnection = new XcpNgConnection();
  connection._id = CONNECTION_ID_2;
  connection.name = "Lab pool";
  connection.connectionType = XcpNgConnectionType.Xapi;
  connection.address = "https://10.0.0.10";
  connection.username = "root";
  connection.password = "the-root-password";
  connection.collectionIntervalInMinutes = 5;
  connection.collectionSettingsVersion = 7;
  Object.assign(connection, overrides);
  return connection;
}

function savedConnection(
  overrides: Record<string, unknown> = {},
): XcpNgConnection {
  const connection: XcpNgConnection = new XcpNgConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Paris Xen Orchestra";
  connection.connectionType = XcpNgConnectionType.XenOrchestra;
  connection.collectionProbeId = PROBE_ID;
  connection.collectionSettingsVersion = 3;
  connection.isApiTokenSet = true;
  Object.assign(connection, {
    collectionProbe: {
      _id: PROBE_ID.toString(),
      isGlobalProbe: false,
      projectId: PROJECT_ID,
    },
    ...overrides,
  });
  return connection;
}

function summary(
  overrides: Partial<XcpNgCollectionSummary> = {},
): XcpNgCollectionSummary {
  return {
    connectionType: XcpNgConnectionType.XenOrchestra,
    pools: [
      {
        poolId: POOL_ID,
        poolName: "Production",
        hostCount: 3,
        runningHostCount: 2,
        vmCount: 9,
        runningVmCount: 6,
        storageRepositoryCount: 4,
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function report(
  overrides: Partial<XcpNgCollectionReport> = {},
): XcpNgCollectionReport {
  return {
    xcpNgConnectionId: CONNECTION_ID,
    settingsVersion: 3,
    collectedAt: "2026-11-18T07:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
    summary: summary(),
    ...overrides,
  };
}

describe("XcpNgProbeCollectionStore.claimDueConnections", () => {
  test("claims in one statement, for this probe, skipping the reads still running", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CONNECTION_ID],
      connections: [xenOrchestraRow()],
    });

    const jobs: Array<XcpNgCollectionJob> =
      await XcpNgProbeCollectionStore.claimDueConnections(fake.service, {
        probeId: PROBE_ID,
        runningXcpNgConnectionIds: [CONNECTION_ID_2],
        limit: 4,
      });

    const claim: Query = fake.queries.find((query: Query) => {
      return query.sql.includes('"claimed"');
    })!;

    expect(claim.sql).toContain("FOR NO KEY UPDATE OF c SKIP LOCKED");
    expect(claim.sql).toContain('UPDATE "XcpNgConnection"');
    expect(claim.parameters[0]).toBe(PROBE_ID.toString());
    expect(claim.parameters[2]).toBe(4);
    expect(claim.parameters[3]).toEqual(
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    );
    expect(claim.parameters[4]).toEqual([CONNECTION_ID_2]);
    expect(claim.parameters.slice(6)).toEqual([
      DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
      MIN_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
      MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
    ]);

    expect(jobs).toEqual([
      {
        xcpNgConnectionId: CONNECTION_ID,
        connectionName: "Paris Xen Orchestra",
        connectionType: XcpNgConnectionType.XenOrchestra,
        address: "https://xo.example.com",
        collectionIntervalInMinutes: 1,
        settingsVersion: 3,
        openMetricsSecret: "the-plugin-secret",
        apiToken: "the-api-token",
      },
    ]);
  });

  test("reads nothing more when nothing was claimed", async () => {
    const fake: FakeService = fakeService({ claimedIds: [] });

    expect(
      await XcpNgProbeCollectionStore.claimDueConnections(fake.service, {
        probeId: PROBE_ID,
        runningXcpNgConnectionIds: [],
        limit: 4,
      }),
    ).toEqual([]);
    expect(fake.findByCalls).toEqual([]);
  });

  test("hands the connections out in the order they were claimed: the longest due first", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CONNECTION_ID_2, CONNECTION_ID],
      connections: [xenOrchestraRow(), xapiRow()],
    });

    const jobs: Array<XcpNgCollectionJob> =
      await XcpNgProbeCollectionStore.claimDueConnections(fake.service, {
        probeId: PROBE_ID,
        runningXcpNgConnectionIds: [],
        limit: 4,
      });

    expect(
      jobs.map((job: XcpNgCollectionJob) => {
        return job.xcpNgConnectionId;
      }),
    ).toEqual([CONNECTION_ID_2, CONNECTION_ID]);
  });
});

describe("XcpNgProbeCollectionStore.toJob", () => {
  test("hands a Xen Orchestra its secret and token, and nothing of a pool's", () => {
    const job: XcpNgCollectionJob | null = XcpNgProbeCollectionStore.toJob(
      xenOrchestraRow({
        username: "stray",
        password: "stray",
        trustedCertificateFingerprint: FINGERPRINT.toLowerCase(),
      }),
    );

    expect(job?.openMetricsSecret).toBe("the-plugin-secret");
    expect(job?.apiToken).toBe("the-api-token");
    expect(job?.username).toBeUndefined();
    expect(job?.password).toBeUndefined();
    // The canonical spelling, whatever was stored.
    expect(job?.trustedCertificateFingerprint).toBe(FINGERPRINT);
  });

  test("hands a pool its account and what the last read learned", () => {
    const job: XcpNgCollectionJob | null = XcpNgProbeCollectionStore.toJob(
      xapiRow({
        openMetricsSecret: "stray",
        xapiPoolId: POOL_ID,
        xapiMasterAddress: "https://10.0.0.11",
        xapiPoolHosts: [
          {
            uuid: HOST_UUID,
            name: "xcp-01",
            address: "10.0.0.11",
            certificateFingerprint: FINGERPRINT,
            isMaster: true,
          },
        ],
        messageWatermark: {
          readUntil: "2026-11-18T07:00:00.000Z",
          uuidsAtReadUntil: ["m1"],
        },
      }),
    );

    expect(job).toMatchObject({
      connectionType: XcpNgConnectionType.Xapi,
      username: "root",
      password: "the-root-password",
      xapiPoolId: POOL_ID,
      xapiMasterAddress: "https://10.0.0.11",
      messageWatermark: {
        readUntil: "2026-11-18T07:00:00.000Z",
        uuidsAtReadUntil: ["m1"],
      },
    });
    expect(job?.xapiPoolHosts).toHaveLength(1);
    expect(job?.openMetricsSecret).toBeUndefined();
  });

  test("hands out no job a probe could not read", () => {
    expect(
      XcpNgProbeCollectionStore.toJob(
        xenOrchestraRow({ openMetricsSecret: undefined }),
      ),
    ).toBeNull();
    expect(
      XcpNgProbeCollectionStore.toJob(xapiRow({ password: undefined })),
    ).toBeNull();
    expect(
      XcpNgProbeCollectionStore.toJob(xapiRow({ address: undefined })),
    ).toBeNull();
    expect(
      XcpNgProbeCollectionStore.toJob(xapiRow({ connectionType: "Something" })),
    ).toBeNull();
  });

  test("bounds the interval it hands out", () => {
    expect(
      XcpNgProbeCollectionStore.toJob(
        xenOrchestraRow({ collectionIntervalInMinutes: 900 }),
      )?.collectionIntervalInMinutes,
    ).toBe(MAX_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES);
    expect(
      XcpNgProbeCollectionStore.toJob(
        xenOrchestraRow({ collectionIntervalInMinutes: 0 }),
      )?.collectionIntervalInMinutes,
    ).toBe(DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES);
  });
});

describe("XcpNgProbeCollectionStore.recordCollectionReport", () => {
  test("hears only the connection's own probe", async () => {
    const fake: FakeService = fakeService({
      connection: savedConnection({ collectionProbeId: OTHER_PROBE_ID }),
    });

    const outcome: XcpNgCollectionReportOutcome =
      await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report(),
      });

    expect(outcome.accepted).toBe(false);
    expect(fake.updates).toEqual([]);
  });

  test("refuses a report that names no connection", async () => {
    const fake: FakeService = fakeService({ connection: savedConnection() });

    expect(
      (
        await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
          probeId: PROBE_ID,
          report: report({ xcpNgConnectionId: "not-an-id" }),
        })
      ).accepted,
    ).toBe(false);
  });

  test("records a success of the current settings: status, summary, and the token's expiry", async () => {
    const fake: FakeService = fakeService({ connection: savedConnection() });

    const outcome: XcpNgCollectionReportOutcome =
      await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report({
          summary: summary({
            apiToken: {
              expiresAt: "2026-12-01T00:00:00.000Z",
              isReadOnly: true,
              canReadAlarms: true,
              canReadMessages: true,
              canReadBackupLogs: true,
            },
          }),
        }),
      });

    expect(outcome).toMatchObject({
      accepted: true,
      isCurrent: true,
      connectionType: XcpNgConnectionType.XenOrchestra,
    });

    const values: Record<string, unknown> = fake.updates[0]!.data;
    expect(values["collectionStatus"]).toBe(XcpNgCollectionStatus.Succeeded);
    expect(values["collectionErrorCode"]).toBeNull();
    expect(values["presentedCertificate"]).toBeNull();
    expect(values["apiTokenExpiresAt"]).toEqual(
      new Date("2026-12-01T00:00:00.000Z"),
    );
    expect(
      (values["collectionSummary"] as XcpNgCollectionSummary).pools,
    ).toHaveLength(1);
  });

  test("lets a renewed token be warned about again", async () => {
    const fake: FakeService = fakeService({
      connection: savedConnection({
        apiTokenExpiresAt: new Date("2026-11-20T00:00:00.000Z"),
      }),
    });

    await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
      probeId: PROBE_ID,
      report: report({
        summary: summary({
          apiToken: { expiresAt: "2027-02-01T00:00:00.000Z" },
        }),
      }),
    });

    expect(fake.updates[0]!.data["apiTokenExpiryWarnedAt"]).toBeNull();
  });

  test("never writes an old read's status over newer settings", async () => {
    const fake: FakeService = fakeService({
      connection: savedConnection({ collectionSettingsVersion: 4 }),
    });

    const outcome: XcpNgCollectionReportOutcome =
      await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report({
          status: "Failed",
          errorCode: XcpNgCollectionErrorCode.WrongSecret,
        }),
      });

    expect(outcome.isCurrent).toBe(false);
    expect(Object.keys(fake.updates[0]!.data)).toEqual(["lastCollectionAt"]);
  });

  test("records a failure with its words, and the certificate only when trusting it is the fix", async () => {
    const presented: Record<string, unknown> = {
      fingerprint256: FINGERPRINT,
      subject: "O=Xen Orchestra",
      issuer: "O=Xen Orchestra",
      isSelfSigned: true,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2036-01-01T00:00:00.000Z",
      verificationError: "self-signed certificate",
    };

    const trustFake: FakeService = fakeService({
      connection: savedConnection(),
    });
    await XcpNgProbeCollectionStore.recordCollectionReport(trustFake.service, {
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: XcpNgCollectionErrorCode.UntrustedCertificate,
        errorMessage: "Xen Orchestra presented a certificate nobody trusted.",
        presentedCertificate: presented as never,
        summary: undefined,
      }),
    });

    expect(trustFake.updates[0]!.data).toMatchObject({
      collectionStatus: XcpNgCollectionStatus.Failed,
      collectionErrorCode: XcpNgCollectionErrorCode.UntrustedCertificate,
      collectionError: "Xen Orchestra presented a certificate nobody trusted.",
    });
    expect(
      (
        trustFake.updates[0]!.data["presentedCertificate"] as Record<
          string,
          unknown
        >
      )["fingerprint256"],
    ).toBe(FINGERPRINT);

    const otherFake: FakeService = fakeService({
      connection: savedConnection(),
    });
    await XcpNgProbeCollectionStore.recordCollectionReport(otherFake.service, {
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: XcpNgCollectionErrorCode.WrongSecret,
        errorMessage: "   ",
        presentedCertificate: presented as never,
      }),
    });

    expect(otherFake.updates[0]!.data["presentedCertificate"]).toBeNull();
    // No words of its own: the code's title.
    expect(otherFake.updates[0]!.data["collectionError"]).toBe(
      "Xen Orchestra refused the secret",
    );
  });

  test("reads an unknown code as an internal error", async () => {
    const fake: FakeService = fakeService({ connection: savedConnection() });

    await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: "Made up" as unknown as XcpNgCollectionErrorCode,
      }),
    });

    expect(fake.updates[0]!.data["collectionErrorCode"]).toBe(
      XcpNgCollectionErrorCode.Internal,
    );
  });

  test("keeps what an XAPI read learned for the next one: the account, the pool, its master and hosts, the watermark", async () => {
    const fake: FakeService = fakeService({
      connection: savedConnection({
        connectionType: XcpNgConnectionType.Xapi,
        isApiTokenSet: false,
      }),
    });

    await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
      probeId: PROBE_ID,
      report: report({
        summary: summary({
          connectionType: XcpNgConnectionType.Xapi,
          account: {
            kind: XcpNgXapiAccountKind.Root,
            name: "root",
            roles: [],
          },
        }),
        xapiPoolId: POOL_ID.toUpperCase(),
        xapiMasterAddress: "https://10.0.0.11",
        xapiPoolHosts: [
          {
            uuid: HOST_UUID,
            name: "xcp-01",
            address: "10.0.0.11",
            certificateFingerprint: FINGERPRINT.toLowerCase(),
            isMaster: true,
          },
        ],
        messageWatermark: {
          readUntil: "2026-11-18T07:06:40Z",
          uuidsAtReadUntil: [],
        },
      }),
    });

    expect(fake.updates[0]!.data).toMatchObject({
      xapiAccountKind: XcpNgXapiAccountKind.Root,
      xapiPoolId: POOL_ID,
      xapiMasterAddress: "https://10.0.0.11",
      xapiPoolHosts: [
        {
          uuid: HOST_UUID,
          name: "xcp-01",
          address: "10.0.0.11",
          certificateFingerprint: FINGERPRINT,
          isMaster: true,
        },
      ],
      messageWatermark: {
        readUntil: "2026-11-18T07:06:40.000Z",
        uuidsAtReadUntil: [],
      },
    });
  });

  test("keeps no master that is not an https address", async () => {
    const fake: FakeService = fakeService({
      connection: savedConnection({ connectionType: XcpNgConnectionType.Xapi }),
    });

    await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
      probeId: PROBE_ID,
      report: report({
        summary: summary({ connectionType: XcpNgConnectionType.Xapi }),
        xapiMasterAddress: "http://10.0.0.11",
      }),
    });

    expect(fake.updates[0]!.data["xapiMasterAddress"]).toBeUndefined();
  });

  test("teaches a Xen Orchestra nothing of a pool's", async () => {
    const fake: FakeService = fakeService({ connection: savedConnection() });

    await XcpNgProbeCollectionStore.recordCollectionReport(fake.service, {
      probeId: PROBE_ID,
      report: report({ xapiPoolId: POOL_ID }),
    });

    expect(fake.updates[0]!.data["xapiPoolId"]).toBeUndefined();
  });
});

describe("XcpNgProbeCollectionStore sanitizers", () => {
  test("a summary keeps whole counts, bounded text and known pools only", () => {
    const sanitized: XcpNgCollectionSummary | null =
      XcpNgProbeCollectionStore.sanitizeSummary({
        connectionType: "Nonsense",
        pools: [
          {
            poolId: POOL_ID,
            hostCount: 2.7,
            runningHostCount: -3,
            vmCount: "7",
            poolName: "x".repeat(500),
          },
          { poolId: "" },
          "not a pool",
        ],
        warnings: ["one", 2, "  "],
        productName: "XCP-ng",
      });

    expect(sanitized?.connectionType).toBe(XcpNgConnectionType.XenOrchestra);
    expect(sanitized?.pools).toHaveLength(1);
    expect(sanitized?.pools[0]?.runningHostCount).toBe(0);
    expect(Number.isInteger(sanitized?.pools[0]?.hostCount)).toBe(true);
    expect((sanitized?.pools[0]?.poolName || "").length).toBeLessThan(500);
    expect(sanitized?.warnings).toEqual(["one"]);
    expect(sanitized?.productName).toBe("XCP-ng");
    expect(XcpNgProbeCollectionStore.sanitizeSummary(null)).toBeNull();
  });

  test("a token Xen Orchestra refused once its stored expiry passed is named expired, not wrong", () => {
    const now: Date = new Date("2026-12-02T00:00:00.000Z");

    expect(
      XcpNgProbeCollectionStore.sanitizeApiToken(
        { errorCode: XcpNgCollectionErrorCode.TokenRejected },
        {
          storedApiTokenExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
          now: now,
        },
      )?.errorCode,
    ).toBe(XcpNgCollectionErrorCode.TokenExpired);

    expect(
      XcpNgProbeCollectionStore.sanitizeApiToken(
        { errorCode: XcpNgCollectionErrorCode.TokenRejected },
        {
          storedApiTokenExpiresAt: new Date("2026-12-31T00:00:00.000Z"),
          now: now,
        },
      )?.errorCode,
    ).toBe(XcpNgCollectionErrorCode.TokenRejected);
  });

  test("a token's flags are kept only as booleans", () => {
    expect(
      XcpNgProbeCollectionStore.sanitizeApiToken({
        isReadOnly: "yes",
        canReadAlarms: true,
        canReadMessages: false,
        errorCode: "Invented",
      }),
    ).toEqual({ canReadAlarms: true, canReadMessages: false });
  });

  test("an account keeps a known kind, its name and its roles", () => {
    expect(
      XcpNgProbeCollectionStore.sanitizeAccount({
        kind: XcpNgXapiAccountKind.ReadOnly,
        name: "EXAMPLE\\oneuptime",
        roles: ["read-only", 3],
      }),
    ).toEqual({
      kind: XcpNgXapiAccountKind.ReadOnly,
      name: "EXAMPLE\\oneuptime",
      roles: ["read-only"],
    });
    expect(
      XcpNgProbeCollectionStore.sanitizeAccount({ kind: "Admin" }),
    ).toBeNull();
  });

  test("a pool's hosts keep a UUID and an address each, their fingerprints canonical", () => {
    expect(
      XcpNgProbeCollectionStore.sanitizePoolHosts([
        {
          uuid: HOST_UUID.toUpperCase(),
          name: "xcp-01",
          address: "10.0.0.11",
          certificateFingerprint: "not a fingerprint",
          isMaster: "yes",
        },
        { uuid: HOST_UUID },
        null,
      ]),
    ).toEqual([
      {
        uuid: HOST_UUID,
        name: "xcp-01",
        address: "10.0.0.11",
        certificateFingerprint: "",
        isMaster: false,
      },
    ]);
    expect(XcpNgProbeCollectionStore.sanitizePoolHosts("nope")).toEqual([]);
  });

  test("a watermark is a time and the message UUIDs of its second", () => {
    expect(
      XcpNgProbeCollectionStore.sanitizeWatermark({
        readUntil: "2026-11-18T07:06:40Z",
        uuidsAtReadUntil: ["a", "", 5, "x".repeat(65)],
      }),
    ).toEqual({
      readUntil: "2026-11-18T07:06:40.000Z",
      uuidsAtReadUntil: ["a"],
    });
    expect(
      XcpNgProbeCollectionStore.sanitizeWatermark({ readUntil: "never" }),
    ).toBeNull();
  });
});
