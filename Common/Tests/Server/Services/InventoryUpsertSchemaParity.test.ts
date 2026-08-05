import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import DockerResource from "../../../Models/DatabaseModels/DockerResource";
import DockerSwarmResource from "../../../Models/DatabaseModels/DockerSwarmResource";
import IoTDevice from "../../../Models/DatabaseModels/IoTDevice";
import KubernetesContainer from "../../../Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "../../../Models/DatabaseModels/KubernetesResource";
import PodmanResource from "../../../Models/DatabaseModels/PodmanResource";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import CephResourceService from "../../../Server/Services/CephResourceService";
import DockerResourceService from "../../../Server/Services/DockerResourceService";
import DockerSwarmResourceService from "../../../Server/Services/DockerSwarmResourceService";
import IoTDeviceService from "../../../Server/Services/IoTDeviceService";
import KubernetesContainerService from "../../../Server/Services/KubernetesContainerService";
import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
import PodmanResourceService from "../../../Server/Services/PodmanResourceService";
import ProxmoxResourceService from "../../../Server/Services/ProxmoxResourceService";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The contract that actually prevents issue #3006 from recurring:
 * EVERY bounded varchar column an inventory service writes through its
 * hand-built bulk INSERT must be clamped to the width the entity
 * declares.
 *
 * Rather than hand-listing column positions (which rot the moment a
 * column is added), each case here feeds a row whose every text field is
 * absurdly oversized, then reads the INSERT's own column list out of the
 * emitted SQL and looks each column's bound up in the entity metadata.
 * Any bounded column whose bound parameter still exceeds it is a row
 * that Postgres would reject with 22001 — aborting the whole 500-row
 * chunk and silently dropping every other resource in the flush.
 *
 * This is what fails if someone widens a column without updating the
 * sanitizer, narrows one without updating it, or adds a new bounded
 * column to an INSERT and forgets to clamp it at all.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const PARENT_ID: ObjectID = ObjectID.generate();
const OBSERVED_AT: Date = new Date("2026-08-05T00:00:00.000Z");

// Longer than the widest bounded varchar in the schema (500), by a lot.
const OVERSIZED: string = "x".repeat(4000);

interface RepositoryHolder {
  getRepository: () => unknown;
}

interface ColumnAudit {
  /** Bounded columns whose parameter is a string — the ones at risk. */
  checked: Array<string>;
  /** Bounded columns whose parameter would still blow the column up. */
  violations: Array<string>;
  /** Bounded columns clamped to exactly their declared bound. */
  clampedToBound: Array<string>;
}

interface UpsertCase {
  label: string;
  service: RepositoryHolder;
  model: BaseModel;
  /** Bounded string columns the INSERT is expected to carry. */
  boundedColumnCount: number;
  /** jsonb columns the INSERT carries as a serialized payload. */
  jsonPayloadColumnCount: number;
  invoke: () => Promise<void>;
}

function mockQueryRunner(service: RepositoryHolder): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue([]);
  jest
    .spyOn(service, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

/**
 * Pull the column list straight out of `INSERT INTO "X" (...)`, so the
 * audit follows the statement the service actually built rather than a
 * copy of it maintained here.
 */
function insertColumnList(sql: string): Array<string> {
  const match: RegExpMatchArray | null = sql.match(
    /INSERT INTO\s+"[A-Za-z]+"\s*\(([^)]+)\)/,
  );

  if (!match || !match[1]) {
    throw new Error(`Could not parse an INSERT column list out of: ${sql}`);
  }

  return match[1]
    .split(",")
    .map((column: string) => {
      return column.trim().replace(/^"|"$/g, "");
    })
    .filter((column: string) => {
      return column.length > 0;
    });
}

/**
 * Audit the first VALUES row of a bulk INSERT against the entity's
 * declared column widths. Parameters are positional, so the first
 * `columns.length` params are row one.
 */
function auditFirstRow(
  model: BaseModel,
  sql: string,
  params: Array<unknown>,
): ColumnAudit {
  const audit: ColumnAudit = {
    checked: [],
    violations: [],
    clampedToBound: [],
  };

  insertColumnList(sql).forEach((column: string, index: number) => {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (!metadata) {
      return;
    }

    const maxLength: number | undefined = getMaxLengthFromTableColumnType(
      metadata.type,
    );
    const value: unknown = params[index];

    if (maxLength === undefined || typeof value !== "string") {
      return;
    }

    audit.checked.push(column);

    if (value.length > maxLength) {
      audit.violations.push(
        `"${column}" is varchar(${maxLength}) but the parameter carries ${value.length} characters`,
      );
    }

    if (value.length === maxLength) {
      audit.clampedToBound.push(column);
    }
  });

  return audit;
}

const CASES: Array<UpsertCase> = [
  {
    label: "KubernetesResourceService.bulkUpsert",
    service: KubernetesResourceService,
    model: new KubernetesResource(),
    boundedColumnCount: 5,
    jsonPayloadColumnCount: 1,
    invoke: async (): Promise<void> => {
      await KubernetesResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        kubernetesClusterId: PARENT_ID,
        resources: [
          {
            kind: OVERSIZED,
            namespaceKey: OVERSIZED,
            name: OVERSIZED,
            uid: OVERSIZED,
            phase: OVERSIZED,
            isReady: true,
            hasMemoryPressure: null,
            hasDiskPressure: null,
            hasPidPressure: null,
            labels: { app: OVERSIZED },
            annotations: null,
            ownerReferences: null,
            spec: null,
            containerCount: 1,
            status: null,
            lastSeenAt: OBSERVED_AT,
            resourceCreationTimestamp: null,
          },
        ],
      });
    },
  },
  {
    label: "KubernetesContainerService.bulkUpsert",
    service: KubernetesContainerService,
    model: new KubernetesContainer(),
    boundedColumnCount: 6,
    jsonPayloadColumnCount: 0,
    invoke: async (): Promise<void> => {
      await KubernetesContainerService.bulkUpsert({
        projectId: PROJECT_ID,
        kubernetesClusterId: PARENT_ID,
        containers: [
          {
            podNamespaceKey: OVERSIZED,
            podName: OVERSIZED,
            name: OVERSIZED,
            image: OVERSIZED,
            state: OVERSIZED,
            reason: OVERSIZED,
            isReady: true,
            restartCount: 0,
            memoryLimitBytes: 1024,
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "DockerResourceService.bulkUpsert",
    service: DockerResourceService,
    model: new DockerResource(),
    boundedColumnCount: 5,
    jsonPayloadColumnCount: 1,
    invoke: async (): Promise<void> => {
      await DockerResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        dockerHostId: PARENT_ID,
        resources: [
          {
            kind: OVERSIZED,
            name: OVERSIZED,
            containerId: OVERSIZED,
            imageName: OVERSIZED,
            state: OVERSIZED,
            labels: { role: OVERSIZED },
            resourceCreationTimestamp: null,
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "DockerResourceService.bulkUpsertContainers",
    service: DockerResourceService,
    model: new DockerResource(),
    boundedColumnCount: 5,
    jsonPayloadColumnCount: 0,
    invoke: async (): Promise<void> => {
      await DockerResourceService.bulkUpsertContainers({
        projectId: PROJECT_ID,
        dockerHostId: PARENT_ID,
        containers: [
          {
            containerName: OVERSIZED,
            containerId: OVERSIZED,
            imageName: OVERSIZED,
            state: OVERSIZED,
            cpuPercent: 1,
            memoryBytes: 1024,
            observedAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "PodmanResourceService.bulkUpsert",
    service: PodmanResourceService,
    model: new PodmanResource(),
    boundedColumnCount: 5,
    jsonPayloadColumnCount: 1,
    invoke: async (): Promise<void> => {
      await PodmanResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        podmanHostId: PARENT_ID,
        resources: [
          {
            kind: OVERSIZED,
            name: OVERSIZED,
            containerId: OVERSIZED,
            imageName: OVERSIZED,
            state: OVERSIZED,
            labels: { role: OVERSIZED },
            resourceCreationTimestamp: null,
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "PodmanResourceService.bulkUpsertContainers",
    service: PodmanResourceService,
    model: new PodmanResource(),
    boundedColumnCount: 5,
    jsonPayloadColumnCount: 0,
    invoke: async (): Promise<void> => {
      await PodmanResourceService.bulkUpsertContainers({
        projectId: PROJECT_ID,
        podmanHostId: PARENT_ID,
        containers: [
          {
            containerName: OVERSIZED,
            containerId: OVERSIZED,
            imageName: OVERSIZED,
            state: OVERSIZED,
            cpuPercent: 1,
            memoryBytes: 1024,
            observedAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "DockerSwarmResourceService.bulkUpsert",
    service: DockerSwarmResourceService,
    model: new DockerSwarmResource(),
    boundedColumnCount: 11,
    jsonPayloadColumnCount: 1,
    invoke: async (): Promise<void> => {
      await DockerSwarmResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        dockerSwarmClusterId: PARENT_ID,
        resources: [
          {
            kind: OVERSIZED,
            externalId: OVERSIZED,
            name: OVERSIZED,
            state: OVERSIZED,
            role: OVERSIZED,
            serviceMode: OVERSIZED,
            desiredReplicas: 1,
            runningReplicas: 1,
            image: OVERSIZED,
            stackName: OVERSIZED,
            serviceName: OVERSIZED,
            nodeHostname: OVERSIZED,
            driver: OVERSIZED,
            isReady: true,
            attributes: { note: OVERSIZED },
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "ProxmoxResourceService.bulkUpsert",
    service: ProxmoxResourceService,
    model: new ProxmoxResource(),
    boundedColumnCount: 6,
    jsonPayloadColumnCount: 0,
    invoke: async (): Promise<void> => {
      await ProxmoxResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        proxmoxClusterId: PARENT_ID,
        resources: [
          {
            kind: OVERSIZED,
            externalId: OVERSIZED,
            name: OVERSIZED,
            vmid: 100,
            guestType: OVERSIZED,
            parentNodeName: OVERSIZED,
            isUp: true,
            haState: OVERSIZED,
            onboot: null,
            isBackedUp: null,
            uptimeSeconds: 10,
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "CephResourceService.bulkUpsert",
    service: CephResourceService,
    model: new CephResource(),
    boundedColumnCount: 6,
    jsonPayloadColumnCount: 0,
    invoke: async (): Promise<void> => {
      await CephResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        cephClusterId: PARENT_ID,
        resources: [
          {
            kind: OVERSIZED,
            externalId: OVERSIZED,
            name: OVERSIZED,
            hostname: OVERSIZED,
            daemonVersion: OVERSIZED,
            deviceClass: OVERSIZED,
            isUp: true,
            isIn: true,
            inQuorum: null,
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
  {
    label: "IoTDeviceService.bulkUpsert",
    service: IoTDeviceService,
    model: new IoTDevice(),
    boundedColumnCount: 5,
    jsonPayloadColumnCount: 0,
    invoke: async (): Promise<void> => {
      await IoTDeviceService.bulkUpsert({
        projectId: PROJECT_ID,
        iotFleetId: PARENT_ID,
        devices: [
          {
            kind: OVERSIZED,
            externalId: OVERSIZED,
            name: OVERSIZED,
            deviceType: OVERSIZED,
            firmwareVersion: OVERSIZED,
            isUp: true,
            uptimeSeconds: 10,
            lastSeenAt: OBSERVED_AT,
          },
        ],
      });
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every bulk INSERT fits the widths its entity declares", () => {
  test.each(CASES)(
    "$label clamps every bounded column",
    async (upsertCase: UpsertCase) => {
      const query: jest.Mock = mockQueryRunner(upsertCase.service);
      await upsertCase.invoke();

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      const audit: ColumnAudit = auditFirstRow(upsertCase.model, sql, params);

      expect(audit.violations).toEqual([]);
    },
  );

  test.each(CASES)(
    "$label audits the bounded columns it is supposed to",
    async (upsertCase: UpsertCase) => {
      /*
       * Guards the guard: without this, a regex that matched nothing
       * would make the assertion above pass vacuously. Bump the count
       * deliberately when a bounded column joins the INSERT — and clamp
       * it in the service while you are there.
       */
      const query: jest.Mock = mockQueryRunner(upsertCase.service);
      await upsertCase.invoke();

      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      const audit: ColumnAudit = auditFirstRow(upsertCase.model, sql, params);

      expect(audit.checked).toHaveLength(upsertCase.boundedColumnCount);
    },
  );

  test.each(CASES)(
    "$label actually clipped the oversized values, rather than dropping them",
    async (upsertCase: UpsertCase) => {
      const query: jest.Mock = mockQueryRunner(upsertCase.service);
      await upsertCase.invoke();

      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      const audit: ColumnAudit = auditFirstRow(upsertCase.model, sql, params);

      /*
       * Every input was oversized, so every bounded column that came
       * from the input must now sit exactly on its bound.
       */
      expect(audit.clampedToBound.length).toBeGreaterThan(0);
      expect(params).not.toContain(OVERSIZED);
    },
  );

  test.each(CASES)(
    "$label leaves its jsonb payloads unclamped",
    async (upsertCase: UpsertCase) => {
      /*
       * jsonb payloads (labels / annotations / attributes / status) have
       * no varchar bound, so clamping them would corrupt real data for
       * no reason.
       *
       * jsonPayloadColumnCount is asserted explicitly because without it
       * this case executes ZERO assertions for the services that carry no
       * jsonb column — and "no assertions ran" reads exactly like
       * "everything checked out".
       */
      const query: jest.Mock = mockQueryRunner(upsertCase.service);
      await upsertCase.invoke();

      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      const columns: Array<string> = insertColumnList(sql);
      const jsonPayloadColumns: Array<string> = [];

      columns.forEach((column: string, index: number) => {
        const metadata: TableColumnMetadata | undefined =
          upsertCase.model.getTableColumnMetadata(column);
        const value: unknown = params[index];

        if (
          !metadata ||
          typeof value !== "string" ||
          getMaxLengthFromTableColumnType(metadata.type) !== undefined
        ) {
          return;
        }

        /*
         * Unbounded and string-valued: a serialized JSON blob. It must
         * still carry the full oversized payload we fed in.
         */
        if (value.startsWith("{")) {
          jsonPayloadColumns.push(column);
          expect(value).toContain(OVERSIZED);
          expect(value.length).toBeGreaterThan(OVERSIZED.length);
        }
      });

      expect(jsonPayloadColumns).toHaveLength(
        upsertCase.jsonPayloadColumnCount,
      );
    },
  );
});

describe("the parity audit itself", () => {
  test("flags a column whose parameter exceeds the declared width", () => {
    /*
     * A test for the test: prove the sweep above is capable of failing.
     * KubernetesResource."kind" is varchar(100).
     */
    const audit: ColumnAudit = auditFirstRow(
      new KubernetesResource(),
      'INSERT INTO "KubernetesResource" ("kind", "name") VALUES ($1, $2)',
      [OVERSIZED, "api"],
    );

    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0]).toContain('"kind"');
    expect(audit.violations[0]).toContain("varchar(100)");
  });

  test("accepts a column sitting exactly on its declared width", () => {
    const audit: ColumnAudit = auditFirstRow(
      new KubernetesResource(),
      'INSERT INTO "KubernetesResource" ("kind", "name") VALUES ($1, $2)',
      ["k".repeat(100), "n".repeat(500)],
    );

    expect(audit.violations).toEqual([]);
    expect(audit.checked).toEqual(["kind", "name"]);
    expect(audit.clampedToBound).toEqual(["kind", "name"]);
  });

  test("reads the widened name bound off KubernetesResource, not a constant", () => {
    /*
     * 500 here comes from the entity; if the model regressed to
     * ShortText this would flag a violation instead.
     */
    const audit: ColumnAudit = auditFirstRow(
      new KubernetesResource(),
      'INSERT INTO "KubernetesResource" ("name") VALUES ($1)',
      ["n".repeat(500)],
    );

    expect(audit.violations).toEqual([]);
    expect(audit.clampedToBound).toEqual(["name"]);
  });

  test("throws rather than passing vacuously when it cannot find a column list", () => {
    expect(() => {
      return auditFirstRow(new KubernetesResource(), "UPDATE something", []);
    }).toThrow("Could not parse an INSERT column list");
  });
});
