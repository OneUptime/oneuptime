import VMwareSourceService from "../../../Server/Services/VMwareSourceService";
import VMwareResourceService from "../../../Server/Services/VMwareResourceService";
import {
  VMwareSourceSnapshot,
  VMwareResourceSnapshot,
} from "../../../Server/Utils/Telemetry/VMwareSnapshot";
import ObjectID from "../../../Types/ObjectID";
import { Pool } from "pg";

/* Opt in with RUN_POSTGRES_VMWARE_TESTS=true. Clone the migrated production
 * table shapes into a private schema, so these assertions exercise PostgreSQL
 * conflict handling and defaults without changing any customer rows. */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_VMWARE_TESTS"] === "true"
    ? describe
    : describe.skip;
type SourceIdentity = { id: ObjectID; isArchived: boolean } | null;
const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-09-07T12:00:00Z");
function source(
  overrides: Partial<VMwareSourceSnapshot> = {},
): VMwareSourceSnapshot {
  return {
    sourceIdentifier: "prod",
    name: "Production",
    kind: "vcenter",
    metrics: {
      "oneuptime.vmware.source.up": 1,
      "oneuptime.vmware.source.inventory.complete": 1,
    },
    lastSeenAt: NOW,
    lastCollectionAt: NOW,
    lastSuccessfulCollectionAt: NOW,
    collectionIntervalSeconds: 60,
    resources: [],
    ...overrides,
  };
}
function resource(
  overrides: Partial<VMwareResourceSnapshot> = {},
): VMwareResourceSnapshot {
  return {
    resourceIdentifier: "uuid-1",
    resourceType: "vm",
    name: "api",
    metadata: {
      "oneuptime.vmware.resource.observed": true,
      "oneuptime.vmware.parent.id": "host-1",
    },
    metrics: {
      "oneuptime.vmware.resource.state": 1,
      "oneuptime.vmware.vm.cpu.utilization": 0,
    },
    lastSeenAt: NOW,
    lastReportedAt: NOW,
    ...overrides,
  };
}

describePostgres("VMware inventory PostgreSQL integration", () => {
  const schema: string = `vmware_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({
      host: process.env["VMWARE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["VMWARE_TEST_DATABASE_PORT"] || "5400"),
      user: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["VMWARE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      options: `-c search_path=${schema},public`,
      max: 4,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["VMwareSource", "VMwareResource"]) {
      await pool.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    const query: (
      sql: string,
      params: Array<unknown>,
    ) => Promise<Array<Record<string, unknown>>> = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> =>
      (await pool.query(sql, params)).rows;
    for (const service of [VMwareSourceService, VMwareResourceService]) {
      jest
        .spyOn(service, "getRepository")
        .mockReturnValue({ manager: { query } } as any);
    }
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "VMwareResource", "VMwareSource"');
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
  async function rows(): Promise<Array<Record<string, any>>> {
    return (await pool.query('SELECT * FROM "VMwareResource"')).rows;
  }

  it("concurrent source discovery converges but identical IDs in another project stay separate", async () => {
    const results: Array<SourceIdentity> = await Promise.all(
      Array.from({ length: 4 }, () =>
        VMwareSourceService.ingestSnapshot(PROJECT, source()),
      ),
    );
    expect(
      new Set(results.map((item: SourceIdentity) => item!.id.toString())).size,
    ).toBe(1);
    const other: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      OTHER_PROJECT,
      source(),
    );
    expect(other!.id.toString()).not.toBe(results[0]!.id.toString());
  });
  it("prevents a resource from being inserted under a source owned by another project", async () => {
    const owner: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source(),
    );
    await VMwareResourceService.bulkUpsert({
      projectId: OTHER_PROJECT,
      sourceId: owner!.id,
      resources: [resource()],
    });
    expect(await rows()).toHaveLength(0);
  });
  it("preserves policy and identity through rename/migration, clears omitted values on newer reports and ignores delayed data", async () => {
    const owner: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source(),
    );
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [resource()],
    });
    const original: Record<string, any> = (await rows())[0]!;
    await pool.query(
      'UPDATE "VMwareResource" SET "expectedRunning"=true, "maintenanceMode"=false WHERE "_id"=$1',
      [original["_id"]],
    );
    const later: Date = new Date(NOW.getTime() + 60000);
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [
        resource({
          name: "renamed",
          lastReportedAt: later,
          lastSeenAt: null,
          metrics: { "oneuptime.vmware.resource.state": 0 },
          metadata: {
            "oneuptime.vmware.resource.observed": false,
            "oneuptime.vmware.parent.id": "host-2",
          },
        }),
      ],
    });
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [
        resource({ metrics: { "oneuptime.vmware.vm.cpu.utilization": 99 } }),
      ],
    });
    const latest: Record<string, any> = (await rows())[0]!;
    expect(latest["_id"]).toBe(original["_id"]);
    expect(latest["name"]).toBe("renamed");
    expect(latest["expectedRunning"]).toBe(true);
    expect(latest["maintenanceMode"]).toBe(false);
    expect(latest["lastSeenAt"]).toEqual(NOW);
    expect(latest["metrics"]).toEqual({ "oneuptime.vmware.resource.state": 0 });
    expect(latest["metadata"]["oneuptime.vmware.resource.observed"]).toBe(
      false,
    );
  });
  it("merges equal-timestamp export fragments while preserving zero", async () => {
    const owner: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source(),
    );
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [resource()],
    });
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [
        resource({ metrics: { "oneuptime.vmware.vm.memory.utilization": 40 } }),
      ],
    });
    expect((await rows())[0]!["metrics"]).toEqual({
      "oneuptime.vmware.resource.state": 1,
      "oneuptime.vmware.vm.cpu.utilization": 0,
      "oneuptime.vmware.vm.memory.utilization": 40,
    });
  });
  it("does not advance collection health from stock traffic or resurrect archived/deleted resources", async () => {
    const owner: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source(),
    );
    const later: Date = new Date(NOW.getTime() + 60000);
    await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source({
        lastSeenAt: later,
        lastCollectionAt: null,
        lastSuccessfulCollectionAt: null,
        metrics: {},
      }),
    );
    const stored: Record<string, any> = (
      await pool.query('SELECT * FROM "VMwareSource" WHERE "_id"=$1', [
        owner!.id.toString(),
      ])
    ).rows[0]!;
    expect(stored["lastSeenAt"]).toEqual(later);
    expect(stored["lastCollectionAt"]).toEqual(NOW);
    expect(stored["metrics"]["oneuptime.vmware.source.up"]).toBe(1);
    await pool.query(
      'UPDATE "VMwareSource" SET "isArchived"=true WHERE "_id"=$1',
      [owner!.id.toString()],
    );
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [resource()],
    });
    expect(await rows()).toHaveLength(0);
    await pool.query(
      'UPDATE "VMwareSource" SET "deletedAt"=now() WHERE "_id"=$1',
      [owner!.id.toString()],
    );
    expect(
      await VMwareSourceService.ingestSnapshot(PROJECT, source()),
    ).toBeNull();
  });
  it("does not regress the configured interval or source kind on an older replay", async () => {
    const owner: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source({ collectionIntervalSeconds: 600 }),
    );
    const before: Date = new Date(NOW.getTime() - 60000);
    await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source({
        kind: "esxi",
        collectionIntervalSeconds: 60,
        lastSeenAt: before,
        lastCollectionAt: before,
        lastSuccessfulCollectionAt: before,
      }),
    );
    const stored: Record<string, any> = (
      await pool.query('SELECT * FROM "VMwareSource" WHERE "_id"=$1', [
        owner!.id.toString(),
      ])
    ).rows[0]!;
    expect(stored["kind"]).toBe("vcenter");
    expect(stored["collectionIntervalSeconds"]).toBe(600);
    expect(stored["lastCollectionAt"]).toEqual(NOW);
  });
  it("recovers historical last-seen from an older observation without changing current unknown state", async () => {
    const owner: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source(),
    );
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [
        resource({
          lastSeenAt: null,
          metrics: { "oneuptime.vmware.resource.state": 0 },
        }),
      ],
    });
    const before: Date = new Date(NOW.getTime() - 60000);
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT,
      sourceId: owner!.id,
      resources: [resource({ lastSeenAt: before, lastReportedAt: before })],
    });
    const stored: Record<string, any> = (await rows())[0]!;
    expect(stored["lastSeenAt"]).toEqual(before);
    expect(stored["lastReportedAt"]).toEqual(NOW);
    expect(stored["metrics"]).toEqual({ "oneuptime.vmware.resource.state": 0 });
  });
  it("recombines split source-health gauges and preserves the previous successful timestamp after failure", async () => {
    const first: SourceIdentity = await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source({
        metrics: { "oneuptime.vmware.source.up": 1 },
        lastSuccessfulCollectionAt: null,
      }),
    );
    await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source({
        metrics: { "oneuptime.vmware.source.inventory.complete": 1 },
        lastSuccessfulCollectionAt: null,
      }),
    );
    const later: Date = new Date(NOW.getTime() + 60000);
    await VMwareSourceService.ingestSnapshot(
      PROJECT,
      source({
        metrics: {
          "oneuptime.vmware.source.up": 0,
          "oneuptime.vmware.source.inventory.complete": 0,
        },
        lastSeenAt: later,
        lastCollectionAt: later,
        lastSuccessfulCollectionAt: null,
      }),
    );
    const stored: Record<string, any> = (
      await pool.query('SELECT * FROM "VMwareSource" WHERE "_id"=$1', [
        first!.id.toString(),
      ])
    ).rows[0]!;
    expect(stored["lastSuccessfulCollectionAt"]).toEqual(NOW);
    expect(stored["lastCollectionAt"]).toEqual(later);
    expect(stored["metrics"]["oneuptime.vmware.source.up"]).toBe(0);
  });
});
