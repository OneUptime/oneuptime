import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import VMwareResourceService, {
  ParsedVMwareResource,
  VMWARE_SWAP_RATE_MAX_GAP_SECONDS,
  VMwareResourceLatestMetric,
} from "../../../Server/Services/VMwareResourceService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * WHETHER THE HOST IS SWAPPING NOW, WORKED OUT ON POSTGRES (#11157).
 *
 * No collector sends a swap rate - the vcenter receiver has none, and the
 * probe sends what it sends - so the latest-metric UPDATE works both out
 * from vcenter.vm.memory.swapped itself, in the one statement that writes
 * it: how far the amount grew (swapped out) or shrank (read back in) since
 * the row's previous report, per second. Only a database can say the SET
 * expressions read the row as it was before the UPDATE, so this runs them
 * against a copy of the migrated VMwareResource table:
 *
 *   - a first report has nothing to compare with: no rate;
 *   - the same amount again is 0 out and 0 in: memory left from earlier;
 *   - growth is a swap-out rate, shrinking a swap-in rate, per second
 *     between the two reports;
 *   - the same report delivered twice keeps the rates it had;
 *   - a report with no swapped amount keeps them too, as every column keeps
 *     its last-known value;
 *   - reports further apart than VMWARE_SWAP_RATE_MAX_GAP_SECONDS say
 *     nothing about now: no rate;
 *   - an older report delivered late changes nothing;
 *   - a host or a datastore, which report no swapped memory, have none.
 *
 * Opt in with RUN_POSTGRES_VMWARE_SWAP_RATE_TESTS=true against a Postgres
 * migrated to the current head (the Postgres Schema Drift workflow's
 * database right after its drift check). The VMwareResource table's
 * STRUCTURE is cloned into a unique schema that is dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * VMWARE_SWAP_RATE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * VMWARE_SWAP_RATE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_VMWARE_SWAP_RATE_TESTS"] === "true"
    ? describe
    : describe.skip;

const MIB: number = 1024 * 1024;
const T0: Date = new Date("2026-11-27T10:00:00.000Z");
const VM_ID: string = "vm/4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e";
const HOST_ID: string = "host/DC-NORTH/esx-node-07.acme.lan";

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

function resource(kind: string, externalId: string): ParsedVMwareResource {
  return {
    kind,
    externalId,
    name: externalId.substring(externalId.lastIndexOf("/") + 1),
    datacenterName: "DC-NORTH",
    clusterName: "cluster-alpha",
    hostName: "esx-node-07.acme.lan",
    resourcePoolName: null,
    resourcePoolPath: null,
    virtualAppName: null,
    vmInstanceUuid: null,
    isTemplate: kind === "VirtualMachine" ? false : null,
    isPoweredOn: kind === "VirtualMachine" ? true : null,
    lastSeenAt: T0,
  };
}

function report(data: {
  kind?: string | undefined;
  externalId?: string | undefined;
  swappedMiB: number | null;
  atSeconds: number;
}): VMwareResourceLatestMetric {
  return {
    kind: data.kind || "VirtualMachine",
    externalId: data.externalId || VM_ID,
    cpuPercent: 12,
    cpuMhz: 400,
    cpuCapacityMhz: null,
    cpuEffectiveMhz: null,
    memoryBytes: 2048 * MIB,
    maxMemoryBytes: 8192 * MIB,
    memoryEffectiveBytes: null,
    memoryPercent: 25,
    diskBytes: null,
    maxDiskBytes: null,
    diskPercent: null,
    cpuReadinessPercent: 1,
    memoryBalloonedBytes: 0,
    memorySwappedBytes: data.swappedMiB === null ? null : data.swappedMiB * MIB,
    hostCount: null,
    effectiveHostCount: null,
    poweredOnHostCount: null,
    vmCount: null,
    poweredOnVmCount: null,
    vmTemplateCount: null,
    datastoreCount: null,
    clusterCount: null,
    notRespondingHostCount: null,
    standbyHostCount: null,
    criticalHostCount: null,
    warningHostCount: null,
    criticalVmCount: null,
    criticalClusterCount: null,
    observedAt: at(data.atSeconds),
  };
}

interface SwapRow {
  memorySwappedBytes: string | null;
  memorySwapOutBytesPerSecond: string | null;
  memorySwapInBytesPerSecond: string | null;
  metricsUpdatedAt: Date | null;
}

describePostgres("VMware swap rates on Postgres", () => {
  const schema: string = `vmware_swap_rates_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  const projectId: ObjectID = ObjectID.generate();
  const vcenterId: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["VMWARE_SWAP_RATE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["VMWARE_SWAP_RATE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["VMWARE_SWAP_RATE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}`, max: 1 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."VMwareResource" (LIKE public."VMwareResource" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`TRUNCATE "${schema}"."VMwareResource"`);
    await VMwareResourceService.bulkUpsert({
      projectId,
      vmwareVCenterId: vcenterId,
      resources: [resource("VirtualMachine", VM_ID), resource("Host", HOST_ID)],
    });
  });

  async function write(
    ...metrics: Array<VMwareResourceLatestMetric>
  ): Promise<void> {
    for (const metric of metrics) {
      await VMwareResourceService.bulkUpdateLatestMetrics({
        projectId,
        vmwareVCenterId: vcenterId,
        metrics: [metric],
      });
    }
  }

  async function swapOf(externalId: string = VM_ID): Promise<{
    swappedMiB: number | null;
    outBytesPerSecond: number | null;
    inBytesPerSecond: number | null;
  }> {
    const rows: Array<SwapRow> = await database.query(
      `SELECT "memorySwappedBytes", "memorySwapOutBytesPerSecond", "memorySwapInBytesPerSecond", "metricsUpdatedAt"
       FROM "VMwareResource" WHERE "projectId" = $1 AND "vmwareVCenterId" = $2 AND "externalId" = $3`,
      [projectId.toString(), vcenterId.toString(), externalId],
    );
    expect(rows).toHaveLength(1);
    const number: (value: string | null) => number | null = (
      value: string | null,
    ): number | null => {
      return value === null ? null : Number(value);
    };
    return {
      swappedMiB:
        rows[0]!.memorySwappedBytes === null
          ? null
          : Number(rows[0]!.memorySwappedBytes) / MIB,
      outBytesPerSecond: number(rows[0]!.memorySwapOutBytesPerSecond),
      inBytesPerSecond: number(rows[0]!.memorySwapInBytesPerSecond),
    };
  }

  test("a first report has nothing to compare with: no rate either way", async () => {
    await write(report({ swappedMiB: 4, atSeconds: 0 }));
    expect(await swapOf()).toEqual({
      swappedMiB: 4,
      outBytesPerSecond: null,
      inBytesPerSecond: null,
    });
  });

  test("the issue's VM: the same 4 MiB again is memory left from earlier, 0 out and 0 in", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({ swappedMiB: 4, atSeconds: 120 }),
    );
    expect(await swapOf()).toEqual({
      swappedMiB: 4,
      outBytesPerSecond: 0,
      inBytesPerSecond: 0,
    });
  });

  test("growth is the host swapping out, per second between the two reports", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({ swappedMiB: 12, atSeconds: 120 }),
    );
    const swap: {
      swappedMiB: number | null;
      outBytesPerSecond: number | null;
      inBytesPerSecond: number | null;
    } = await swapOf();
    expect(swap.swappedMiB).toBe(12);
    expect(swap.outBytesPerSecond).toBeCloseTo((8 * MIB) / 120, 6);
    expect(swap.inBytesPerSecond).toBe(0);
  });

  test("shrinking is the guest reading it back, and the next flat report ends both", async () => {
    await write(
      report({ swappedMiB: 100, atSeconds: 0 }),
      report({ swappedMiB: 40, atSeconds: 60 }),
    );
    let swap: {
      swappedMiB: number | null;
      outBytesPerSecond: number | null;
      inBytesPerSecond: number | null;
    } = await swapOf();
    expect(swap.outBytesPerSecond).toBe(0);
    expect(swap.inBytesPerSecond).toBeCloseTo((60 * MIB) / 60, 6);

    await write(report({ swappedMiB: 40, atSeconds: 120 }));
    swap = await swapOf();
    expect(swap).toEqual({
      swappedMiB: 40,
      outBytesPerSecond: 0,
      inBytesPerSecond: 0,
    });
  });

  test("the same report delivered twice keeps the rates it had", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({ swappedMiB: 12, atSeconds: 120 }),
      report({ swappedMiB: 12, atSeconds: 120 }),
    );
    expect((await swapOf()).outBytesPerSecond).toBeCloseTo((8 * MIB) / 120, 6);
  });

  test("a report that carries no swapped amount keeps the amount and the rates", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({ swappedMiB: 6, atSeconds: 60 }),
      report({ swappedMiB: null, atSeconds: 120 }),
    );
    const swap: {
      swappedMiB: number | null;
      outBytesPerSecond: number | null;
      inBytesPerSecond: number | null;
    } = await swapOf();
    expect(swap.swappedMiB).toBe(6);
    expect(swap.outBytesPerSecond).toBeCloseTo((2 * MIB) / 60, 6);
  });

  test("reports further apart than the gap say nothing about now", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({
        swappedMiB: 400,
        atSeconds: VMWARE_SWAP_RATE_MAX_GAP_SECONDS + 1,
      }),
    );
    expect(await swapOf()).toEqual({
      swappedMiB: 400,
      outBytesPerSecond: null,
      inBytesPerSecond: null,
    });
  });

  test("reports exactly the gap apart still compare", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({
        swappedMiB: 4 + 900,
        atSeconds: VMWARE_SWAP_RATE_MAX_GAP_SECONDS,
      }),
    );
    expect((await swapOf()).outBytesPerSecond).toBeCloseTo(
      (900 * MIB) / VMWARE_SWAP_RATE_MAX_GAP_SECONDS,
      6,
    );
  });

  test("an older report delivered late changes nothing", async () => {
    await write(
      report({ swappedMiB: 4, atSeconds: 0 }),
      report({ swappedMiB: 4, atSeconds: 240 }),
      report({ swappedMiB: 900, atSeconds: 120 }),
    );
    expect(await swapOf()).toEqual({
      swappedMiB: 4,
      outBytesPerSecond: 0,
      inBytesPerSecond: 0,
    });
  });

  test("a host reports no swapped memory, so it has no swap rate", async () => {
    await write(
      report({
        kind: "Host",
        externalId: HOST_ID,
        swappedMiB: null,
        atSeconds: 0,
      }),
      report({
        kind: "Host",
        externalId: HOST_ID,
        swappedMiB: null,
        atSeconds: 120,
      }),
    );
    expect(await swapOf(HOST_ID)).toEqual({
      swappedMiB: null,
      outBytesPerSecond: null,
      inBytesPerSecond: null,
    });
  });

  test("many VMs in one statement each get their own rates", async () => {
    const ids: Array<string> = Array.from(
      { length: 30 },
      (_: unknown, i: number) => {
        return `vm/00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      },
    );
    await VMwareResourceService.bulkUpsert({
      projectId,
      vmwareVCenterId: vcenterId,
      resources: ids.map((id: string): ParsedVMwareResource => {
        return resource("VirtualMachine", id);
      }),
    });
    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId,
      vmwareVCenterId: vcenterId,
      metrics: ids.map((id: string): VMwareResourceLatestMetric => {
        return report({ externalId: id, swappedMiB: 10, atSeconds: 0 });
      }),
    });
    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId,
      vmwareVCenterId: vcenterId,
      metrics: ids.map(
        (id: string, index: number): VMwareResourceLatestMetric => {
          return report({
            externalId: id,
            swappedMiB: 10 + index,
            atSeconds: 100,
          });
        },
      ),
    });
    for (const [index, id] of ids.entries()) {
      const swap: {
        swappedMiB: number | null;
        outBytesPerSecond: number | null;
        inBytesPerSecond: number | null;
      } = await swapOf(id);
      expect(swap.outBytesPerSecond).toBeCloseTo((index * MIB) / 100, 6);
      expect(swap.inBytesPerSecond).toBe(0);
    }
  });
});
