import DatabaseService from "../../../../Server/Services/DatabaseService";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DataSecurityComplianceSettingService from "../../../../Server/Services/DataSecurityComplianceSettingService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import ProjectReferenceCheck from "../../../../Server/Utils/Database/ProjectReferenceCheck";
import logger from "../../../../Server/Utils/Logger";
import KubernetesClusterCompliance from "../../../../Server/Utils/Kubernetes/KubernetesClusterCompliance";
import KubernetesClusterComplianceSummary, {
  ComplianceSummaryRefreshResult,
} from "../../../../Server/Utils/Kubernetes/KubernetesClusterComplianceSummary";
import DataSecurityComplianceSetting from "../../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import Entities from "../../../../Models/DatabaseModels/Index";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { DataStoreResourceKind } from "../../../../Types/DataSecurity/DataStoreResource";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  ExtractedInventoryRecord,
  ParsedKubernetesResource,
  extractInventoryResource,
} from "../../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import { KubernetesComplianceRequirementResult } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KubernetesComplianceSummary,
  readKubernetesComplianceSummary,
  summarizeKubernetesCompliance,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import ObjectID from "../../../../Types/ObjectID";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../../Helpers/KubernetesEventRecords";
import { DataSource } from "typeorm";

/*
 * A KUBERNETES CLUSTER'S COMPLIANCE FOLLOW-UPS, ON A MIGRATED POSTGRES
 * (#9874, #9876, #9880).
 *
 * Opt in with RUN_POSTGRES_KUBERNETES_COMPLIANCE_TESTS=true against a
 * database the registered migrations (1809186710000-AddKubernetesCompliance
 * AcceptancesAndSummaries included) have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_KUBERNETES_COMPLIANCE_TESTS=true \
 *   KUBERNETES_COMPLIANCE_TEST_DATABASE_HOST=127.0.0.1 \
 *   KUBERNETES_COMPLIANCE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Utils/Kubernetes/KubernetesCompliancePostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped; CI runs it in
 * .github/workflows/postgres-schema-drift.yaml once every migration is
 * applied. Why a real Postgres:
 *
 *   - #9880: the agent's snapshots go through the extractor and the
 *     inventory's upsert, and the compliance read's hand-written SQL - the
 *     workloads by `"kind" = ANY($3)`, their template blocks out of the
 *     spec's JSONB - scores a CronJob between runs from its template.
 *   - #9874: an acceptance is made and changed through the settings
 *     service, whose update hook reads the rows it writes through
 *     findRowsAndHoldUpdateToThem (UpdateChecksReadHeldRows): here the
 *     update path's own read and hold run.
 *   - #9876: the summary is written on the cluster's row in one hook-free
 *     statement, read back through the model, and the job's run scores the
 *     clusters that are due.
 *
 * The tables it writes are structure-only clones (LIKE ... INCLUDING ALL)
 * in a uniquely named schema that is the connection's first search_path
 * entry and is dropped afterwards; every other table a read joins (a user's
 * name) is found, empty, in public. Every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_KUBERNETES_COMPLIANCE_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock(
  "../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return {};
  },
);

// The audit trail is written elsewhere; its coverage has its own suites.
jest.mock("../../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

const TABLES: Array<string> = [
  "KubernetesResource",
  "KubernetesCluster",
  "DataSecurityComplianceSetting",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const ACCEPTING_USER: ObjectID = ObjectID.generate();
const RENEWING_USER: ObjectID = ObjectID.generate();
const SEEN: Date = new Date("2026-11-19T11:55:00.000Z");
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

const PRIVILEGED_TEMPLATE: PlainValue = {
  metadata: { labels: { app: "agent" } },
  spec: {
    hostNetwork: true,
    containers: [
      {
        name: "agent",
        image: "ghcr.io/acme/agent:2",
        securityContext: { privileged: true },
      },
    ],
  },
};

const HARDENED_POD_SPEC: PlainValue = {
  serviceAccountName: "api",
  securityContext: {
    runAsNonRoot: true,
    seccompProfile: { type: "RuntimeDefault" },
  },
  automountServiceAccountToken: false,
  containers: [
    {
      name: "api",
      image: "ghcr.io/acme/api:1",
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"] },
      },
    },
  ],
};

// An object as the agent's k8sobjects pull sends it, through the extractor.
function snapshot(
  resourceType: string,
  object: PlainValue,
): ParsedKubernetesResource {
  const record: ExtractedInventoryRecord | null = extractInventoryResource({
    resourceType,
    logBody: JSON.stringify(toOtlpAnyValue(object)),
    lastSeenAt: SEEN,
  });

  expect(record).not.toBeNull();

  return record!.resource;
}

// A cluster with a hardened API, a privileged DaemonSet and a CronJob between runs.
function inventory(): Array<ParsedKubernetesResource> {
  return [
    snapshot("deployments", {
      kind: "Deployment",
      metadata: { name: "api", namespace: "payments", uid: "d-1" },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "api" } },
        template: { metadata: {}, spec: HARDENED_POD_SPEC },
      },
    }),
    snapshot("pods", {
      kind: "Pod",
      metadata: {
        name: "api-7d9f8-abcde",
        namespace: "payments",
        uid: "p-1",
        labels: { "pod-template-hash": "7d9f8" },
        ownerReferences: [
          { kind: "ReplicaSet", name: "api-7d9f8", uid: "rs-1" },
        ],
      },
      spec: HARDENED_POD_SPEC,
      status: { phase: "Running" },
    }),
    snapshot("daemonsets", {
      kind: "DaemonSet",
      metadata: { name: "cilium", namespace: "kube-system", uid: "ds-1" },
      spec: { template: PRIVILEGED_TEMPLATE },
    }),
    snapshot("pods", {
      kind: "Pod",
      metadata: {
        name: "cilium-x1",
        namespace: "kube-system",
        uid: "p-2",
        ownerReferences: [{ kind: "DaemonSet", name: "cilium", uid: "ds-1" }],
      },
      spec: (PRIVILEGED_TEMPLATE as { spec: PlainValue }).spec,
      status: { phase: "Running" },
    }),
    // Between runs: its Jobs and their pods are cleaned up.
    snapshot("cronjobs", {
      kind: "CronJob",
      metadata: { name: "nightly-backup", namespace: "ops", uid: "cj-1" },
      spec: {
        schedule: "0 2 * * *",
        jobTemplate: { spec: { template: PRIVILEGED_TEMPLATE } },
      },
    }),
    snapshot("namespaces", {
      kind: "Namespace",
      metadata: { name: "payments", uid: "ns-1" },
      status: { phase: "Active" },
    }),
  ];
}

function requirementOf(
  framework: KubernetesComplianceFrameworkResponse,
  requirement: string,
): KubernetesComplianceRequirementResult {
  return framework.requirements.find(
    (each: KubernetesComplianceRequirementResult): boolean => {
      return each.requirement === requirement;
    },
  )!;
}

function baselineOf(
  response: KubernetesComplianceResponse,
): KubernetesComplianceFrameworkResponse {
  return response.frameworks.find(
    (each: KubernetesComplianceFrameworkResponse): boolean => {
      return each.framework === KubernetesComplianceFramework.PssBaseline;
    },
  )!;
}

describePostgres("A Kubernetes cluster's compliance on Postgres", () => {
  const schema: string = `k8s_compliance_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let clusterId: ObjectID;

  async function insertCluster(
    name: string,
    fields: { connected?: boolean; refreshedAt?: Date | null } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."KubernetesCluster"
         ("_id", "projectId", "name", "slug", "clusterIdentifier", "version",
          "otelCollectorStatus", "complianceSummaryRefreshedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $3, $3, 1, $4, $5, $6, $6)`,
      [
        id.toString(),
        PROJECT_ID.toString(),
        name,
        fields.connected === false ? "disconnected" : "connected",
        fields.refreshedAt || null,
        new Date("2026-11-01T00:00:00.000Z"),
      ],
    );

    return id;
  }

  async function read(now: Date = NOW): Promise<KubernetesComplianceResponse> {
    return await KubernetesClusterCompliance.readCompliance({
      projectId: PROJECT_ID,
      cluster: { id: clusterId, name: "prod-eu", provider: null },
      now,
    });
  }

  async function accept(
    data: Partial<DataSecurityComplianceSetting>,
  ): Promise<DataSecurityComplianceSetting> {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    setting.projectId = PROJECT_ID;
    setting.resourceType = DataStoreResourceKind.KubernetesCluster;
    setting.resourceId = clusterId;
    setting.framework = KubernetesComplianceFramework.PssBaseline;
    setting.requirement = "Privileged Containers";
    setting.namespace = "kube-system";
    setting.objectKind = "DaemonSet";
    setting.objectName = "cilium";
    setting.note = "Cilium's agent programs the node's network.";
    setting.isEnabled = false;
    Object.assign(setting, data);

    return await DataSecurityComplianceSettingService.create({
      data: setting,
      props: { isRoot: true, userId: ACCEPTING_USER },
    });
  }

  async function storedSetting(id: ObjectID): Promise<{
    isEnabled: boolean;
    note: string | null;
    expiresAt: Date | null;
    turnedOffAt: Date | null;
    turnedOffByUserId: string | null;
  }> {
    const rows: Array<{
      isEnabled: boolean;
      note: string | null;
      expiresAt: Date | null;
      turnedOffAt: Date | null;
      turnedOffByUserId: string | null;
    }> = await database.query(
      `SELECT "isEnabled", "note", "expiresAt", "turnedOffAt", "turnedOffByUserId"
         FROM "${schema}"."DataSecurityComplianceSetting" WHERE "_id" = $1`,
      [id.toString()],
    );

    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["KUBERNETES_COMPLIANCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["KUBERNETES_COMPLIANCE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["KUBERNETES_COMPLIANCE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);
    // Workflows run elsewhere; the project's rows are other suites' to check.
    jest
      .spyOn(DatabaseService.prototype as never, "onTriggerWorkflow" as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectReferenceCheck, "validateCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectReferenceCheck, "validateUpdate")
      .mockResolvedValue(undefined as never);

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    clusterId = await insertCluster("prod-eu");
    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: clusterId,
      resources: inventory(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      try {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await database.destroy();
      }
    }
  });

  describe("a workload that runs no pod (#9880)", () => {
    test("a CronJob between runs is scored from the template its snapshot carried", async () => {
      const response: KubernetesComplianceResponse = await read();
      const privileged: KubernetesComplianceRequirementResult = requirementOf(
        baselineOf(response),
        "Privileged Containers",
      );

      expect(response.podCount).toBe(2);
      expect(response.templateCount).toBe(1);
      expect(
        privileged.findings.map(
          (finding: {
            object: { kind: string; name: string };
            isFromTemplate?: boolean | undefined;
            podCount?: number | undefined;
          }) => {
            return [
              finding.object.kind,
              finding.object.name,
              finding.isFromTemplate === true,
              finding.podCount || 0,
            ];
          },
        ),
      ).toEqual([
        ["DaemonSet", "cilium", false, 1],
        ["CronJob", "nightly-backup", true, 0],
      ]);
      // The Deployment runs a pod: read from it, passing.
      expect(baselineOf(response).workloadsEvaluated).toBe(3);
      expect(baselineOf(response).workloadsFromTemplates).toBe(1);
    });
  });

  describe("an accepted finding (#9874)", () => {
    test("made through the settings service, it is read back and accepts the DaemonSet's finding alone", async () => {
      const made: DataSecurityComplianceSetting = await accept({
        expiresAt: new Date("2027-05-01T00:00:00.000Z"),
      });
      const response: KubernetesComplianceResponse = await read();
      const baseline: KubernetesComplianceFrameworkResponse =
        baselineOf(response);
      const privileged: KubernetesComplianceRequirementResult = requirementOf(
        baseline,
        "Privileged Containers",
      );

      expect(privileged.status).toBe(ComplianceRequirementStatus.Failing);
      expect(
        privileged.findings.map((finding: { object: { name: string } }) => {
          return finding.object.name;
        }),
      ).toEqual(["nightly-backup"]);
      expect(privileged.accepted).toEqual([
        expect.objectContaining({
          object: {
            kind: "DaemonSet",
            namespace: "kube-system",
            name: "cilium",
          },
          acceptanceId: made.id!.toString(),
        }),
      ]);
      // It turned nothing off for kube-system.
      expect(baseline.turnedOffNamespaces).toEqual([]);
      expect(baseline.acceptances).toEqual([
        expect.objectContaining({
          id: made.id!.toString(),
          requirement: "Privileged Containers",
          note: "Cilium's agent programs the node's network.",
          expiresAt: "2027-05-01T00:00:00.000Z",
          isExpired: false,
          isOnCluster: true,
        }),
      ]);
      expect((await storedSetting(made.id!)).turnedOffByUserId).toBe(
        ACCEPTING_USER.toString(),
      );
    });

    test("once it expires the finding fails again; accepted again, the update's held rows say who and when anew", async () => {
      const made: DataSecurityComplianceSetting = await accept({
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      });
      const firstAcceptedAt: Date = (await storedSetting(made.id!))
        .turnedOffAt!;

      // Read after its expiry: it fails again.
      const later: KubernetesComplianceResponse = await read(
        new Date("2027-01-02T00:00:00.000Z"),
      );

      expect(baselineOf(later).acceptances![0]!.isExpired).toBe(true);
      expect(
        requirementOf(baselineOf(later), "Privileged Containers").findings,
      ).toHaveLength(2);

      // Its expiry passes: as the database stores it.
      await database.query(
        `UPDATE "${schema}"."DataSecurityComplianceSetting" SET "expiresAt" = $2 WHERE "_id" = $1`,
        [made.id!.toString(), new Date("2026-11-01T00:00:00.000Z")],
      );

      await DataSecurityComplianceSettingService.updateOneById({
        id: made.id!,
        data: {
          isEnabled: false,
          note: "Still needed until Cilium 1.17.",
          expiresAt: new Date("2027-06-01T00:00:00.000Z"),
        },
        props: { isRoot: true, userId: RENEWING_USER },
      });

      const renewed: {
        isEnabled: boolean;
        note: string | null;
        expiresAt: Date | null;
        turnedOffAt: Date | null;
        turnedOffByUserId: string | null;
      } = await storedSetting(made.id!);

      expect(renewed.note).toBe("Still needed until Cilium 1.17.");
      expect(new Date(renewed.expiresAt!).toISOString()).toBe(
        "2027-06-01T00:00:00.000Z",
      );
      expect(renewed.turnedOffByUserId).toBe(RENEWING_USER.toString());
      expect(new Date(renewed.turnedOffAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(firstAcceptedAt).getTime(),
      );
      expect(
        requirementOf(baselineOf(await read()), "Privileged Containers")
          .acceptedCount,
      ).toBe(1);
    });

    test("revoked, it accepts nothing and names nobody; its row stays, to accept again", async () => {
      const made: DataSecurityComplianceSetting = await accept({});

      await DataSecurityComplianceSettingService.updateOneById({
        id: made.id!,
        data: { isEnabled: true },
        props: { isRoot: true, userId: RENEWING_USER },
      });

      const revoked: {
        isEnabled: boolean;
        turnedOffAt: Date | null;
        turnedOffByUserId: string | null;
      } = await storedSetting(made.id!);

      expect(revoked).toMatchObject({
        isEnabled: true,
        turnedOffAt: null,
        turnedOffByUserId: null,
      });
      expect(baselineOf(await read()).acceptances).toEqual([]);
    });

    test("an expiry on a setting that accepts nothing is refused, and nothing is written", async () => {
      const turnedOff: DataSecurityComplianceSetting =
        await DataSecurityComplianceSettingService.create({
          data: (() => {
            const setting: DataSecurityComplianceSetting =
              new DataSecurityComplianceSetting();
            setting.projectId = PROJECT_ID;
            setting.resourceType = DataStoreResourceKind.KubernetesCluster;
            setting.resourceId = clusterId;
            setting.framework = KubernetesComplianceFramework.PssBaseline;
            setting.namespace = "ops";
            setting.isEnabled = false;
            return setting;
          })(),
          props: { isRoot: true, userId: ACCEPTING_USER },
        });

      await expect(
        DataSecurityComplianceSettingService.updateOneById({
          id: turnedOff.id!,
          data: { expiresAt: new Date("2027-06-01T00:00:00.000Z") },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);
      expect((await storedSetting(turnedOff.id!)).expiresAt).toBeNull();
    });
  });

  describe("the cluster's summary (#9876)", () => {
    test("is written on the cluster's row in one statement, as the answer summarizes, leaving its updatedAt and version", async () => {
      const before: Array<{ updatedAt: Date; version: number }> =
        await database.query(
          `SELECT "updatedAt", "version" FROM "${schema}"."KubernetesCluster" WHERE "_id" = $1`,
          [clusterId.toString()],
        );

      const summary: KubernetesComplianceSummary =
        await KubernetesClusterComplianceSummary.refresh(
          {
            id: clusterId,
            projectId: PROJECT_ID,
            name: "prod-eu",
            provider: null,
          },
          NOW,
        );
      const after: Array<{
        updatedAt: Date;
        version: number;
        complianceSummaryRefreshedAt: Date;
      }> = await database.query(
        `SELECT "updatedAt", "version", "complianceSummaryRefreshedAt" FROM "${schema}"."KubernetesCluster" WHERE "_id" = $1`,
        [clusterId.toString()],
      );
      const throughModel: KubernetesCluster | null =
        await KubernetesClusterService.findOneById({
          id: clusterId,
          select: {
            complianceSummary: true,
            complianceSummaryRefreshedAt: true,
          },
          props: { isRoot: true },
        });

      expect(summary).toEqual(summarizeKubernetesCompliance(await read(), NOW));
      expect(
        readKubernetesComplianceSummary(throughModel?.complianceSummary),
      ).toEqual(summary);
      expect(
        new Date(after[0]!.complianceSummaryRefreshedAt).toISOString(),
      ).toBe(NOW.toISOString());
      expect(new Date(after[0]!.updatedAt).getTime()).toBe(
        new Date(before[0]!.updatedAt).getTime(),
      );
      expect(after[0]!.version).toBe(before[0]!.version);
      expect(
        summary.frameworks.find((framework: { framework: string }) => {
          return (
            framework.framework === KubernetesComplianceFramework.PssBaseline
          );
        })?.failingControls,
      ).toEqual(
        expect.arrayContaining([
          {
            requirement: "Privileged Containers",
            title: "Privileged Containers",
            failingCount: 2,
          },
        ]),
      );
    });

    test("the job's run scores the clusters due, oldest first, and leaves a fresh one", async () => {
      const fresh: ObjectID = await insertCluster("fresh", {
        refreshedAt: new Date(NOW.getTime() - 60 * 1000),
      });
      const silentOld: ObjectID = await insertCluster("silent-old", {
        connected: false,
        refreshedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
      });

      const result: ComplianceSummaryRefreshResult =
        await KubernetesClusterComplianceSummary.refreshDueClusters({
          now: NOW,
        });
      const rows: Array<{ _id: string; complianceSummaryRefreshedAt: Date }> =
        await database.query(
          `SELECT "_id", "complianceSummaryRefreshedAt" FROM "${schema}"."KubernetesCluster"`,
        );
      const refreshedAt: (id: ObjectID) => string = (id: ObjectID): string => {
        return new Date(
          rows.find((row: { _id: string }) => {
            return row._id === id.toString();
          })!.complianceSummaryRefreshedAt,
        ).toISOString();
      };

      expect(result).toEqual({ refreshed: 2, failed: 0, left: 0 });
      expect(refreshedAt(clusterId)).toBe(NOW.toISOString());
      expect(refreshedAt(silentOld)).toBe(NOW.toISOString());
      expect(refreshedAt(fresh)).toBe(
        new Date(NOW.getTime() - 60 * 1000).toISOString(),
      );
    });
  });
});
