import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import VMwareResourceService, {
  ParsedVMwareResource,
  VMWARE_SWAP_RATE_MAX_GAP_SECONDS,
  VMwareResourceLatestMetric,
  VMwareResourceSwapRateReading,
} from "../../../Server/Services/VMwareResourceService";
import {
  VMWARE_HEALTH_READINGS_KEEP_SECONDS,
  VMWARE_HEALTH_READINGS_MAX,
  VMwareHealthReading,
  readVMwareHealthReadings,
} from "../../../Types/VMware/VMwareHealthReadings";
import { VMwareSwapRateSource } from "../../../Types/VMware/VMwareSwapRates";
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
  // vSphere's own rates, in bytes per second, as a probe sends them (#11468).
  swapOutRate?: number | null | undefined;
  swapInRate?: number | null | undefined;
  overrides?: Partial<VMwareResourceLatestMetric> | undefined;
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
    memorySwapOutBytesPerSecond: data.swapOutRate ?? null,
    memorySwapInBytesPerSecond: data.swapInRate ?? null,
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
    ...(data.overrides || {}),
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

  async function sourceOf(externalId: string = VM_ID): Promise<string | null> {
    const rows: Array<{ memorySwapRateSource: string | null }> =
      await database.query(
        `SELECT "memorySwapRateSource" FROM "VMwareResource" WHERE "projectId" = $1 AND "vmwareVCenterId" = $2 AND "externalId" = $3`,
        [projectId.toString(), vcenterId.toString(), externalId],
      );
    return rows[0]!.memorySwapRateSource;
  }

  async function readingsOf(
    externalId: string = VM_ID,
  ): Promise<Array<VMwareHealthReading>> {
    const rows: Array<{ healthReadings: unknown }> = await database.query(
      `SELECT "healthReadings" FROM "VMwareResource" WHERE "projectId" = $1 AND "vmwareVCenterId" = $2 AND "externalId" = $3`,
      [projectId.toString(), vcenterId.toString(), externalId],
    );
    return readVMwareHealthReadings(rows[0]!.healthReadings);
  }

  describe("vSphere's own swap rates (#11468)", () => {
    test("are kept as a probe sent them, and the row says vSphere measured them", async () => {
      await write(
        report({
          swappedMiB: 4,
          atSeconds: 0,
          swapOutRate: 524288,
          swapInRate: 1024.5,
        }),
      );
      expect(await swapOf()).toEqual({
        swappedMiB: 4,
        outBytesPerSecond: 524288,
        inBytesPerSecond: 1024.5,
      });
      expect(await sourceOf()).toBe(VMwareSwapRateSource.VSphere);
    });

    test("win over working the rate out, even when the amount moved", async () => {
      await write(
        report({ swappedMiB: 4, atSeconds: 0, swapOutRate: 0, swapInRate: 0 }),
        report({
          swappedMiB: 400,
          atSeconds: 120,
          swapOutRate: 0,
          swapInRate: 0,
        }),
      );
      expect(await swapOf()).toEqual({
        swappedMiB: 400,
        outBytesPerSecond: 0,
        inBytesPerSecond: 0,
      });
      expect(await sourceOf()).toBe(VMwareSwapRateSource.VSphere);
    });

    test("one direction sent is that direction alone; the other is not known", async () => {
      await write(
        report({ swappedMiB: 4, atSeconds: 0, swapOutRate: 2048 }),
      );
      expect(await swapOf()).toEqual({
        swappedMiB: 4,
        outBytesPerSecond: 2048,
        inBytesPerSecond: null,
      });
    });

    test("an ESXi host's are kept on its row", async () => {
      await write(
        report({
          kind: "Host",
          externalId: HOST_ID,
          swappedMiB: null,
          atSeconds: 0,
          swapOutRate: 4096,
          swapInRate: 0,
        }),
      );
      expect(await swapOf(HOST_ID)).toEqual({
        swappedMiB: null,
        outBytesPerSecond: 4096,
        inBytesPerSecond: 0,
      });
      expect(await sourceOf(HOST_ID)).toBe(VMwareSwapRateSource.VSphere);
    });

    test("a vCenter that stops sending them goes back to working the rates out, and says so", async () => {
      await write(
        report({ swappedMiB: 4, atSeconds: 0, swapOutRate: 0, swapInRate: 0 }),
        report({ swappedMiB: 12, atSeconds: 120 }),
      );
      const swap: {
        swappedMiB: number | null;
        outBytesPerSecond: number | null;
        inBytesPerSecond: number | null;
      } = await swapOf();
      expect(swap.outBytesPerSecond).toBeCloseTo((8 * MIB) / 120, 6);
      expect(await sourceOf()).toBe(VMwareSwapRateSource.Derived);
    });

    test("a worked-out rate says so; a first report has none, and no source", async () => {
      await write(report({ swappedMiB: 4, atSeconds: 0 }));
      expect(await sourceOf()).toBeNull();
      await write(report({ swappedMiB: 4, atSeconds: 120 }));
      expect(await sourceOf()).toBe(VMwareSwapRateSource.Derived);
      // A report with no swapped amount keeps the rates, and where they came from.
      await write(report({ swappedMiB: null, atSeconds: 240 }));
      expect(await sourceOf()).toBe(VMwareSwapRateSource.Derived);
    });

    test("answers the VM's and pool's rates it wrote, for OneUptime's own metrics; a host's are not", async () => {
      await write(report({ swappedMiB: 4, atSeconds: 0 }));
      const readings: Array<VMwareResourceSwapRateReading> =
        await VMwareResourceService.bulkUpdateLatestMetrics({
          projectId,
          vmwareVCenterId: vcenterId,
          metrics: [
            report({ swappedMiB: 4, atSeconds: 120 }),
            report({
              kind: "Host",
              externalId: HOST_ID,
              swappedMiB: null,
              atSeconds: 120,
              swapOutRate: 4096,
              swapInRate: 0,
            }),
          ],
        });
      expect(readings).toEqual([
        {
          kind: "VirtualMachine",
          externalId: VM_ID,
          swapOutBytesPerSecond: 0,
          swapInBytesPerSecond: 0,
          source: VMwareSwapRateSource.Derived,
          observedAt: at(120),
        },
      ]);
    });

    test("a first report answers nothing: there is no rate yet", async () => {
      expect(
        await VMwareResourceService.bulkUpdateLatestMetrics({
          projectId,
          vmwareVCenterId: vcenterId,
          metrics: [report({ swappedMiB: 4, atSeconds: 0 })],
        }),
      ).toEqual([]);
    });
  });

  describe("each part's last readings, for 'for at least N minutes' (#11469)", () => {
    test("a VM's: one per report, oldest first, with what each report carried", async () => {
      await write(
        report({ swappedMiB: 4, atSeconds: 0 }),
        report({ swappedMiB: 12, atSeconds: 120 }),
        report({
          swappedMiB: 12,
          atSeconds: 240,
          swapOutRate: 2048,
          swapInRate: 0,
        }),
      );
      const readings: Array<VMwareHealthReading> = await readingsOf();
      const t0: number = T0.getTime() / 1000;
      expect(readings).toHaveLength(3);
      expect(readings[0]).toEqual({
        t: t0,
        sw: 4 * MIB,
        bl: 0,
        rd: 1,
      });
      expect(readings[1]!.t).toBe(t0 + 120);
      expect(readings[1]!.so).toBeCloseTo((8 * MIB) / 120, 6);
      expect(readings[1]!.si).toBe(0);
      expect(readings[2]).toEqual({
        t: t0 + 240,
        so: 2048,
        si: 0,
        sw: 12 * MIB,
        bl: 0,
        rd: 1,
      });
    });

    test("a host's: its CPU and memory, and nothing a host does not have", async () => {
      await write(
        report({
          kind: "Host",
          externalId: HOST_ID,
          swappedMiB: null,
          atSeconds: 0,
          overrides: { cpuPercent: 93.5, memoryPercent: 40 },
        }),
        report({
          kind: "Host",
          externalId: HOST_ID,
          swappedMiB: null,
          atSeconds: 120,
          // A report with no CPU breaks a run rather than stretching it.
          overrides: { cpuPercent: null, memoryPercent: 41 },
        }),
      );
      const t0: number = T0.getTime() / 1000;
      expect(await readingsOf(HOST_ID)).toEqual([
        { t: t0, cpu: 93.5, mem: 40 },
        { t: t0 + 120, mem: 41 },
      ]);
    });

    test("the same report again replaces its reading; an older one is never written", async () => {
      await write(
        report({ swappedMiB: 4, atSeconds: 0 }),
        report({ swappedMiB: 4, atSeconds: 120 }),
        report({ swappedMiB: 4, atSeconds: 120 }),
        report({ swappedMiB: 900, atSeconds: 60 }),
      );
      const readings: Array<VMwareHealthReading> = await readingsOf();
      expect(
        readings.map((reading: VMwareHealthReading) => {
          return reading.t - T0.getTime() / 1000;
        }),
      ).toEqual([0, 120]);
    });

    test("readings older than the longest wait and one gap are dropped", async () => {
      await write(
        report({ swappedMiB: 4, atSeconds: 0 }),
        report({ swappedMiB: 4, atSeconds: 60 }),
        report({
          swappedMiB: 4,
          atSeconds: VMWARE_HEALTH_READINGS_KEEP_SECONDS + 60,
        }),
      );
      expect(
        (await readingsOf()).map((reading: VMwareHealthReading) => {
          return reading.t - T0.getTime() / 1000;
        }),
      ).toEqual([60, VMWARE_HEALTH_READINGS_KEEP_SECONDS + 60]);
    });

    test("never more than the newest 64", async () => {
      for (let index: number = 0; index < VMWARE_HEALTH_READINGS_MAX + 6; index++) {
        await write(report({ swappedMiB: 4, atSeconds: index * 30 }));
      }
      const readings: Array<VMwareHealthReading> = await readingsOf();
      expect(readings).toHaveLength(VMWARE_HEALTH_READINGS_MAX);
      expect(readings[readings.length - 1]!.t - T0.getTime() / 1000).toBe(
        (VMWARE_HEALTH_READINGS_MAX + 5) * 30,
      );
      expect(readings[0]!.t - T0.getTime() / 1000).toBe(6 * 30);
    });
  });
});
