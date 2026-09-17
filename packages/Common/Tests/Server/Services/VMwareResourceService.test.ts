import VMwareResourceService, {
  ParsedVMwareResource,
  VMwareInventorySummary,
  VMwareResourceLatestMetric,
} from "../../../Server/Services/VMwareResourceService";
import logger from "../../../Server/Utils/Logger";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";

/*
 * The VMwareResource inventory write path. The service builds raw
 * parameterized SQL against the TypeORM manager — these tests mock the
 * query runner (no Postgres) and lock in the statement shape:
 *
 *   - COALESCE per identity/status column, so a batch that lacks an
 *     attribute (a VM briefly reported without its resource pool during
 *     a vMotion) keeps the last-known value instead of blanking it,
 *   - the lastSeenAt dominance guard (out-of-order ingest never
 *     regresses a newer snapshot),
 *   - parameter tuples in exact column order — the INSERT column list
 *     and the params must never drift,
 *   - 500-row chunking,
 *   - NULL metric values stay NULL (a powered-off VM carries no
 *     vcenter.vm.cpu.* points and must never read 0% CPU; a host without
 *     vcenter.host.memory.capacity enabled must never read 0 capacity),
 *   - bigint columns travel as strings (a multi-PB datastore exceeds
 *     2^53 bytes),
 *   - two entries that clamp to one (kind, externalId) collapse to a
 *     single VALUES tuple (newest wins) in BOTH statements, so Postgres
 *     never sees "ON CONFLICT DO UPDATE command cannot affect row a
 *     second time" (SQLSTATE 21000) and drops the whole chunk.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const VCENTER_ID: ObjectID = ObjectID.generate();

const VM_INSTANCE_UUID: string = "5029f9a1-2b3c-4d5e-8f60-71a2b3c4d5e6";
const VM_EXTERNAL_ID: string = `vm/${VM_INSTANCE_UUID}`;

type QueryCall = [string, Array<unknown>];

function mockQueryRunner(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);
  jest
    .spyOn(VMwareResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

function parsedResource(
  overrides: Partial<ParsedVMwareResource> = {},
): ParsedVMwareResource {
  return {
    kind: "VirtualMachine",
    externalId: VM_EXTERNAL_ID,
    name: "web-01",
    datacenterName: "dc-east",
    clusterName: "prod-cluster",
    hostName: "esx-01.example.com",
    resourcePoolName: "Resources",
    resourcePoolPath: "/dc-east/host/prod-cluster/Resources",
    virtualAppName: null,
    vmInstanceUuid: VM_INSTANCE_UUID,
    isTemplate: false,
    isPoweredOn: true,
    lastSeenAt: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VMwareResourceService.bulkUpsert", () => {
  test("does nothing for an empty batch", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("emits an ON CONFLICT upsert with COALESCE per identity/status column", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources: [parsedResource()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('INSERT INTO "VMwareResource"');
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "vmwareVCenterId", "kind", "externalId")',
    );

    /*
     * Every identity/status column COALESCEs against the existing row —
     * a partial batch must never blank a previously learned value.
     */
    for (const column of [
      "name",
      "datacenterName",
      "clusterName",
      "hostName",
      "resourcePoolName",
      "resourcePoolPath",
      "virtualAppName",
      "vmInstanceUuid",
      "isTemplate",
      "isPoweredOn",
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(EXCLUDED."${column}", "VMwareResource"."${column}")`,
      );
    }

    // lastSeenAt is overwritten (not COALESCEd) under the dominance guard.
    expect(sql).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
    expect(sql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "VMwareResource"."lastSeenAt"',
    );
  });

  test("parameter tuple matches the INSERT column order exactly", async () => {
    const query: jest.Mock = mockQueryRunner();
    const lastSeenAt: Date = new Date("2026-06-13T00:00:00.000Z");
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources: [
        parsedResource({
          virtualAppName: "vapp-web",
          isPoweredOn: false,
          lastSeenAt,
        }),
      ],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    // 16 columns per row: a 1-row batch carries exactly $1..$16.
    expect(params).toHaveLength(16);
    expect(sql).toContain(
      "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    );
    expect(params).toEqual([
      PROJECT_ID.toString(),
      VCENTER_ID.toString(),
      "VirtualMachine",
      VM_EXTERNAL_ID,
      "web-01",
      "dc-east",
      "prod-cluster",
      "esx-01.example.com",
      "Resources",
      "/dc-east/host/prod-cluster/Resources",
      "vapp-web",
      VM_INSTANCE_UUID,
      false, // isTemplate
      false, // isPoweredOn — false is a value (powered off), distinct from null
      lastSeenAt,
      0, // version
    ]);
  });

  test("tri-state isPoweredOn: null rides through so COALESCE keeps the last-known state", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources: [parsedResource({ isTemplate: true, isPoweredOn: null })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    // Column 13 (0-indexed 12) is isTemplate, 14 (0-indexed 13) is isPoweredOn.
    expect(params[12]).toBe(true);
    expect(params[13]).toBeNull();
  });

  test("a powered-off VM writes false, so an on→off transition lands through COALESCE", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources: [parsedResource({ isPoweredOn: false })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params[13]).toBe(false);
  });

  test("a standalone host carries null for every VM-only and cluster column", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources: [
        parsedResource({
          kind: "Host",
          externalId: "host/dc-east/esx-01.example.com",
          name: "esx-01.example.com",
          clusterName: null,
          hostName: null,
          resourcePoolName: null,
          resourcePoolPath: null,
          virtualAppName: null,
          vmInstanceUuid: null,
          isTemplate: null,
          isPoweredOn: null,
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params[2]).toBe("Host");
    expect(params[5]).toBe("dc-east");
    for (const index of [6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(params[index]).toBeNull();
    }
  });

  test("chunks batches of more than 500 rows into multiple statements", async () => {
    const query: jest.Mock = mockQueryRunner();
    const resources: Array<ParsedVMwareResource> = [];
    for (let i: number = 0; i < 501; i++) {
      resources.push(
        parsedResource({
          externalId: `vm/uuid-${i}`,
          vmInstanceUuid: `uuid-${i}`,
        }),
      );
    }

    await VMwareResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      resources,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [, firstParams] = query.mock.calls[0] as QueryCall;
    const [, secondParams] = query.mock.calls[1] as QueryCall;
    expect(firstParams).toHaveLength(500 * 16);
    expect(secondParams).toHaveLength(16);
  });

  /*
   * The snapshot scan bounds every externalId to 100 chars with a sha1
   * suffix, so two distinct ids normally never clamp to one key — but
   * the service is the last line of defence: a statement that carries
   * the same conflict target twice is rejected by Postgres outright
   * (21000), and the ingest flush only warns, so the whole vCenter's
   * inventory would silently stop landing.
   */
  describe("dedupe after clamping", () => {
    const SHARED_PREFIX: string = `resourcepool/${"p".repeat(
      ColumnLength.ShortText - "resourcepool/".length,
    )}`;
    const POOL_A_ID: string = `${SHARED_PREFIX}/SAP-HANA`;
    const POOL_B_ID: string = `${SHARED_PREFIX}/SAP-APP`;

    function pool(
      overrides: Partial<ParsedVMwareResource> = {},
    ): ParsedVMwareResource {
      return parsedResource({
        kind: "ResourcePool",
        hostName: null,
        vmInstanceUuid: null,
        isTemplate: null,
        isPoweredOn: null,
        ...overrides,
      });
    }

    test("the fixture really collides: both ids exceed 100 chars and clamp to the same prefix", () => {
      expect(POOL_A_ID.length).toBeGreaterThan(ColumnLength.ShortText);
      expect(POOL_B_ID.length).toBeGreaterThan(ColumnLength.ShortText);
      expect(POOL_A_ID.substring(0, ColumnLength.ShortText)).toBe(
        POOL_B_ID.substring(0, ColumnLength.ShortText),
      );
      expect(POOL_A_ID).not.toBe(POOL_B_ID);
    });

    test("two entries that clamp to one (kind, externalId) become one VALUES tuple — the newest lastSeenAt wins", async () => {
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      const older: Date = new Date("2026-06-13T00:00:00.000Z");
      const newer: Date = new Date("2026-06-13T00:02:00.000Z");

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources: [
          pool({
            externalId: POOL_A_ID,
            name: "SAP-HANA",
            resourcePoolPath: POOL_A_ID.substring("resourcepool/".length),
            lastSeenAt: older,
          }),
          pool({
            externalId: POOL_B_ID,
            name: "SAP-APP",
            resourcePoolPath: POOL_B_ID.substring("resourcepool/".length),
            lastSeenAt: newer,
          }),
        ],
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as QueryCall;

      // Exactly one row reached the statement.
      expect(params).toHaveLength(16);
      expect((sql.match(/\(\$\d+/g) || []).length).toBe(1);

      // ...and it is the newer one, under the clamped key.
      expect(params[2]).toBe("ResourcePool");
      expect(params[3]).toBe(POOL_B_ID.substring(0, ColumnLength.ShortText));
      expect(params[4]).toBe("SAP-APP");
      expect(params[14]).toBe(newer);

      // The drop is visible in the logs.
      const dropMessages: Array<string> = warn.mock.calls
        .map((call: Array<unknown>) => {
          return String(call[0]);
        })
        .filter((message: string) => {
          return message.includes("dropped 1 duplicate");
        });
      expect(dropMessages).toHaveLength(1);
      expect(dropMessages[0]).toContain("bulkUpsert");
      expect(dropMessages[0]).toContain(VCENTER_ID.toString());
    });

    test("the newest entry wins regardless of arrival order, and the survivor keeps its first-seen position", async () => {
      jest.spyOn(logger, "warn").mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      const older: Date = new Date("2026-06-13T00:00:00.000Z");
      const newer: Date = new Date("2026-06-13T00:02:00.000Z");

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources: [
          pool({ externalId: POOL_A_ID, name: "SAP-HANA", lastSeenAt: newer }),
          parsedResource(),
          pool({ externalId: POOL_B_ID, name: "SAP-APP", lastSeenAt: older }),
        ],
      });

      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params).toHaveLength(2 * 16);
      // First tuple: the surviving (newer) pool entry, in the slot the key was first seen.
      expect(params[3]).toBe(POOL_A_ID.substring(0, ColumnLength.ShortText));
      expect(params[4]).toBe("SAP-HANA");
      expect(params[14]).toBe(newer);
      // Second tuple: the untouched VM.
      expect(params[16 + 3]).toBe(VM_EXTERNAL_ID);
    });

    test("an equal lastSeenAt keeps the later entry (the dominance guard is >=)", async () => {
      jest.spyOn(logger, "warn").mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();
      const at: Date = new Date("2026-06-13T00:00:00.000Z");

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources: [
          pool({ externalId: POOL_A_ID, name: "first", lastSeenAt: at }),
          pool({ externalId: POOL_B_ID, name: "second", lastSeenAt: at }),
        ],
      });

      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params).toHaveLength(16);
      expect(params[4]).toBe("second");
    });

    test("distinct kinds never collide on the same externalId", async () => {
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources: [
          parsedResource({ kind: "VirtualMachine", externalId: "shared" }),
          parsedResource({ kind: "Host", externalId: "shared" }),
        ],
      });

      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params).toHaveLength(2 * 16);
      expect(warn).not.toHaveBeenCalled();
    });

    test("a batch without duplicates passes through untouched — same rows, same order, no warning", async () => {
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      const resources: Array<ParsedVMwareResource> = [
        parsedResource({ externalId: "vm/uuid-1", vmInstanceUuid: "uuid-1" }),
        parsedResource({ externalId: "vm/uuid-2", vmInstanceUuid: "uuid-2" }),
        parsedResource({ externalId: "vm/uuid-3", vmInstanceUuid: "uuid-3" }),
      ];

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources,
      });

      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params).toHaveLength(3 * 16);
      expect([params[3], params[16 + 3], params[32 + 3]]).toEqual([
        "vm/uuid-1",
        "vm/uuid-2",
        "vm/uuid-3",
      ]);
      expect(warn).not.toHaveBeenCalled();
    });

    test("dedupe runs before chunking, so a collapsed batch no longer spills into a second statement", async () => {
      jest.spyOn(logger, "warn").mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      const resources: Array<ParsedVMwareResource> = [];
      for (let i: number = 0; i < 500; i++) {
        resources.push(
          parsedResource({
            externalId: `vm/uuid-${i}`,
            vmInstanceUuid: `uuid-${i}`,
          }),
        );
      }
      // Row 501 clamps onto row 0's key after the 100-char clamp.
      resources.push(
        parsedResource({
          externalId: "vm/uuid-0",
          vmInstanceUuid: "uuid-0",
          lastSeenAt: new Date("2026-06-13T00:05:00.000Z"),
        }),
      );

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params).toHaveLength(500 * 16);
      expect(params[3]).toBe("vm/uuid-0");
      expect(params[14]).toEqual(new Date("2026-06-13T00:05:00.000Z"));
    });
  });
});

describe("VMwareResourceService.bulkUpdateLatestMetrics", () => {
  function latestMetric(
    overrides: Partial<VMwareResourceLatestMetric> = {},
  ): VMwareResourceLatestMetric {
    return {
      kind: "VirtualMachine",
      externalId: VM_EXTERNAL_ID,
      cpuPercent: 12.5,
      cpuMhz: 1200,
      cpuCapacityMhz: null,
      cpuEffectiveMhz: null,
      memoryBytes: 1024,
      maxMemoryBytes: 2048,
      memoryEffectiveBytes: null,
      memoryPercent: 50,
      diskBytes: null,
      maxDiskBytes: null,
      diskPercent: null,
      cpuReadinessPercent: 0.4,
      memoryBalloonedBytes: 0,
      memorySwappedBytes: null,
      hostCount: null,
      effectiveHostCount: null,
      poweredOnHostCount: null,
      vmCount: null,
      poweredOnVmCount: null,
      vmTemplateCount: null,
      datastoreCount: null,
      clusterCount: null,
      observedAt: new Date("2026-06-13T00:00:00.000Z"),
      ...overrides,
    };
  }

  /*
   * Params: projectId, vcenterId, then per row
   * (kind, externalId, cpu, cpuMhz, cpuCap, cpuEff, mem, maxMem, memEff,
   *  memPct, disk, maxDisk, diskPct, cpuReady, balloon, swap, hostCnt,
   *  effHostCnt, onHostCnt, vmCnt, onVmCnt, tmplCnt, dsCnt, clCnt,
   *  observedAt) — 25 values.
   */
  const ROW_WIDTH: number = 25;

  test("does nothing for an empty batch", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      metrics: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("COALESCEs every mirror column and guards on metricsUpdatedAt", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      metrics: [latestMetric()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('UPDATE "VMwareResource"');
    for (const [column, alias] of [
      ["latestCpuPercent", "cpu"],
      ["latestCpuMhz", "cpuMhz"],
      ["cpuCapacityMhz", "cpuCap"],
      ["cpuEffectiveMhz", "cpuEff"],
      ["latestMemoryBytes", "mem"],
      ["maxMemoryBytes", "maxMem"],
      ["memoryEffectiveBytes", "memEff"],
      ["latestMemoryPercent", "memPct"],
      ["latestDiskBytes", "disk"],
      ["maxDiskBytes", "maxDisk"],
      ["latestDiskPercent", "diskPct"],
      ["cpuReadinessPercent", "cpuReady"],
      ["memoryBalloonedBytes", "balloon"],
      ["memorySwappedBytes", "swap"],
      ["hostCount", "hostCnt"],
      ["effectiveHostCount", "effHostCnt"],
      ["poweredOnHostCount", "onHostCnt"],
      ["vmCount", "vmCnt"],
      ["poweredOnVmCount", "onVmCnt"],
      ["vmTemplateCount", "tmplCnt"],
      ["datastoreCount", "dsCnt"],
      ["clusterCount", "clCnt"],
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(v."${alias}", p."${column}")`,
      );
    }
    expect(sql).toContain('"metricsUpdatedAt" = v."observedAt"');
    // Out-of-order points never regress a newer observation.
    expect(sql).toContain(
      '(p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")',
    );
    // Scoped to the (project, vCenter) pair, matched on identity.
    expect(sql).toContain('p."projectId" = $1');
    expect(sql).toContain('p."vmwareVCenterId" = $2');
    expect(sql).toContain('p."kind" = v."kind"');
    expect(sql).toContain('p."externalId" = v."externalId"');
  });

  test("missing series stay NULL — never coerced to 0 (powered-off VM, host without memory.capacity)", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      metrics: [
        latestMetric({
          cpuPercent: null,
          cpuMhz: null,
          maxMemoryBytes: null,
          diskBytes: null,
          maxDiskBytes: null,
          memoryBalloonedBytes: null,
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params).toHaveLength(2 + ROW_WIDTH);
    expect(params[2]).toBe("VirtualMachine");
    expect(params[3]).toBe(VM_EXTERNAL_ID);
    expect(params[4]).toBeNull(); // cpu
    expect(params[5]).toBeNull(); // cpuMhz
    expect(params[9]).toBeNull(); // maxMem
    expect(params[12]).toBeNull(); // disk
    expect(params[13]).toBeNull(); // maxDisk
    // No absent series was coerced to a zero of any type.
    expect(params).not.toContain("0");
    expect(params).not.toContain(0);
  });

  test("bigint columns are sent as strings; integer columns are truncated", async () => {
    const query: jest.Mock = mockQueryRunner();
    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      metrics: [
        latestMetric({
          kind: "Datastore",
          externalId: "datastore/dc-east/vsanDatastore",
          cpuPercent: null,
          cpuMhz: 1200.7,
          memoryBytes: 1024,
          maxMemoryBytes: 2048,
          memoryEffectiveBytes: 2 ** 53 + 2, // above Number.MAX_SAFE_INTEGER
          diskBytes: 40_000_000_000_000,
          maxDiskBytes: 80_000_000_000_000,
          diskPercent: 50,
          memoryBalloonedBytes: 0,
          memorySwappedBytes: 512.9,
          hostCount: 4,
          poweredOnVmCount: 118.0,
        }),
      ],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    // Bigint columns are sent as strings to avoid JS precision loss.
    expect(params[8]).toBe("1024"); // mem
    expect(params[9]).toBe("2048"); // maxMem
    expect(params[10]).toBe((2 ** 53 + 2).toString()); // memEff
    expect(params[12]).toBe("40000000000000"); // disk
    expect(params[13]).toBe("80000000000000"); // maxDisk
    expect(params[16]).toBe("0"); // balloon — 0 is a value, not NULL
    expect(params[17]).toBe("512"); // swap truncated
    // Integer columns are truncated numbers, not strings.
    expect(params[5]).toBe(1200); // cpuMhz
    expect(params[18]).toBe(4); // hostCnt
    expect(params[22]).toBe(118); // onVmCnt
    // Decimal columns keep their fraction.
    expect(params[14]).toBe(50); // diskPct
    expect(params[26]).toEqual(new Date("2026-06-13T00:00:00.000Z"));
  });

  test("chunks batches of more than 500 rows into multiple statements", async () => {
    const query: jest.Mock = mockQueryRunner();
    const metrics: Array<VMwareResourceLatestMetric> = [];
    for (let i: number = 0; i < 501; i++) {
      metrics.push(latestMetric({ externalId: `vm/uuid-${i}` }));
    }

    await VMwareResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      vmwareVCenterId: VCENTER_ID,
      metrics,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [, firstParams] = query.mock.calls[0] as QueryCall;
    const [, secondParams] = query.mock.calls[1] as QueryCall;
    expect(firstParams).toHaveLength(2 + 500 * ROW_WIDTH);
    expect(secondParams).toHaveLength(2 + ROW_WIDTH);
  });

  describe("dedupe after clamping", () => {
    const SHARED_PREFIX: string = `resourcepool/${"p".repeat(
      ColumnLength.ShortText - "resourcepool/".length,
    )}`;
    const POOL_A_ID: string = `${SHARED_PREFIX}/SAP-HANA`;
    const POOL_B_ID: string = `${SHARED_PREFIX}/SAP-APP`;

    test("two entries that clamp to one (kind, externalId) become one VALUES tuple — the newest observedAt wins", async () => {
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      const older: Date = new Date("2026-06-13T00:00:00.000Z");
      const newer: Date = new Date("2026-06-13T00:02:00.000Z");

      await VMwareResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        metrics: [
          latestMetric({
            kind: "ResourcePool",
            externalId: POOL_A_ID,
            cpuMhz: 1200,
            observedAt: newer,
          }),
          latestMetric({
            kind: "ResourcePool",
            externalId: POOL_B_ID,
            cpuMhz: 300,
            observedAt: older,
          }),
        ],
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as QueryCall;

      expect(params).toHaveLength(2 + ROW_WIDTH);
      expect((sql.match(/\$\d+::timestamptz/g) || []).length).toBe(1);

      expect(params[2]).toBe("ResourcePool");
      expect(params[3]).toBe(POOL_A_ID.substring(0, ColumnLength.ShortText));
      expect(params[3]).toHaveLength(ColumnLength.ShortText);
      expect(params[5]).toBe(1200);
      expect(params[2 + ROW_WIDTH - 1]).toBe(newer);

      const dropMessages: Array<string> = warn.mock.calls
        .map((call: Array<unknown>) => {
          return String(call[0]);
        })
        .filter((message: string) => {
          return message.includes("dropped 1 duplicate");
        });
      expect(dropMessages).toHaveLength(1);
      expect(dropMessages[0]).toContain("bulkUpdateLatestMetrics");
      expect(dropMessages[0]).toContain(VCENTER_ID.toString());
    });

    test("the clamped key still matches what bulkUpsert wrote", async () => {
      jest.spyOn(logger, "warn").mockImplementation(() => {});
      const upsertQuery: jest.Mock = mockQueryRunner();

      await VMwareResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        resources: [
          parsedResource({ kind: "ResourcePool", externalId: POOL_A_ID }),
          parsedResource({ kind: "ResourcePool", externalId: POOL_B_ID }),
        ],
      });
      await VMwareResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        metrics: [
          latestMetric({ kind: "ResourcePool", externalId: POOL_A_ID }),
          latestMetric({ kind: "ResourcePool", externalId: POOL_B_ID }),
        ],
      });

      const [, upsertParams] = upsertQuery.mock.calls[0] as QueryCall;
      const [, mirrorParams] = upsertQuery.mock.calls[1] as QueryCall;
      expect(upsertParams).toHaveLength(16);
      expect(mirrorParams).toHaveLength(2 + ROW_WIDTH);
      expect(mirrorParams[3]).toBe(upsertParams[3]);
    });

    test("a batch without duplicates passes through untouched — same rows, same order, no warning", async () => {
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const query: jest.Mock = mockQueryRunner();

      await VMwareResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
        metrics: [
          latestMetric({ externalId: "vm/uuid-1" }),
          latestMetric({ externalId: "vm/uuid-2" }),
          latestMetric({ kind: "Host", externalId: "vm/uuid-1" }),
        ],
      });

      const [, params] = query.mock.calls[0] as QueryCall;
      expect(params).toHaveLength(2 + 3 * ROW_WIDTH);
      expect([
        params[3],
        params[2 + ROW_WIDTH + 1],
        params[2 + 2 * ROW_WIDTH + 1],
      ]).toEqual(["vm/uuid-1", "vm/uuid-2", "vm/uuid-1"]);
      expect(params[2 + 2 * ROW_WIDTH]).toBe("Host");
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe("VMwareResourceService.deleteStaleForVCenter", () => {
  test("normalizes the postgres [rows, affected] DELETE result", async () => {
    const query: jest.Mock = mockQueryRunner([[], 7]);
    const olderThan: Date = new Date("2026-06-13T00:00:00.000Z");
    const affected: number = await VMwareResourceService.deleteStaleForVCenter({
      vmwareVCenterId: VCENTER_ID,
      olderThan,
    });
    expect(affected).toBe(7);

    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('DELETE FROM "VMwareResource"');
    expect(sql).toContain('"vmwareVCenterId" = $1');
    expect(sql).toContain('"lastSeenAt" < $2');
    expect(params).toEqual([VCENTER_ID.toString(), olderThan]);
  });

  test("returns 0 when the driver result carries no affected count", async () => {
    mockQueryRunner({});
    const affected: number = await VMwareResourceService.deleteStaleForVCenter({
      vmwareVCenterId: VCENTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
    });
    expect(affected).toBe(0);
  });
});

describe("VMwareResourceService.getInventorySummary", () => {
  test("folds one GROUP BY into per-kind counts plus the VM power/template breakdown", async () => {
    const query: jest.Mock = mockQueryRunner([
      {
        kind: "Datacenter",
        count: "1",
        poweredOnCount: "0",
        templateCount: "0",
      },
      { kind: "Cluster", count: "2", poweredOnCount: "0", templateCount: "0" },
      { kind: "Host", count: "8", poweredOnCount: "0", templateCount: "0" },
      {
        kind: "VirtualMachine",
        count: "120",
        poweredOnCount: "97",
        templateCount: "5",
      },
      {
        kind: "Datastore",
        count: "6",
        poweredOnCount: "0",
        templateCount: "0",
      },
      {
        kind: "ResourcePool",
        count: "3",
        poweredOnCount: "0",
        templateCount: "0",
      },
    ]);

    const summary: VMwareInventorySummary =
      await VMwareResourceService.getInventorySummary({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
      });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('FROM "VMwareResource"');
    expect(sql).toContain('GROUP BY "kind"');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('FILTER (WHERE "isPoweredOn" IS TRUE)');
    expect(sql).toContain('FILTER (WHERE "isTemplate" IS TRUE)');
    expect(params).toEqual([PROJECT_ID.toString(), VCENTER_ID.toString()]);

    expect(summary).toEqual({
      countsByKind: {
        Datacenter: 1,
        Cluster: 2,
        Host: 8,
        VirtualMachine: 120,
        Datastore: 6,
        ResourcePool: 3,
      },
      datacenterCount: 1,
      clusterCount: 2,
      hostCount: 8,
      // Non-template VMs only — the same population VMwareVCenter.vmCount reports.
      virtualMachineCount: 115,
      poweredOnVirtualMachineCount: 97,
      virtualMachineTemplateCount: 5,
      datastoreCount: 6,
      resourcePoolCount: 3,
    });
  });

  test("returns zeros for an empty vCenter", async () => {
    mockQueryRunner([]);

    const summary: VMwareInventorySummary =
      await VMwareResourceService.getInventorySummary({
        projectId: PROJECT_ID,
        vmwareVCenterId: VCENTER_ID,
      });

    expect(summary).toEqual({
      countsByKind: {},
      datacenterCount: 0,
      clusterCount: 0,
      hostCount: 0,
      virtualMachineCount: 0,
      poweredOnVirtualMachineCount: 0,
      virtualMachineTemplateCount: 0,
      datastoreCount: 0,
      resourcePoolCount: 0,
    });
  });
});

describe("VMwareResourceService.getStaleThresholdMinutes", () => {
  const ENV_KEY: string = "VMWARE_INVENTORY_STALE_MINUTES";
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedValue;
    }
  });

  test("defaults to 15 minutes (well above the receiver's 2-minute collection interval)", () => {
    delete process.env[ENV_KEY];
    expect(VMwareResourceService.getStaleThresholdMinutes()).toBe(15);
  });

  test("honors the env override", () => {
    process.env[ENV_KEY] = "30";
    expect(VMwareResourceService.getStaleThresholdMinutes()).toBe(30);
  });

  test("rejects overrides below the 5-minute floor and non-numbers", () => {
    process.env[ENV_KEY] = "2";
    expect(VMwareResourceService.getStaleThresholdMinutes()).toBe(15);
    process.env[ENV_KEY] = "not-a-number";
    expect(VMwareResourceService.getStaleThresholdMinutes()).toBe(15);
  });

  test("getStaleThresholdDate subtracts the threshold from the supplied now", () => {
    delete process.env[ENV_KEY];
    const now: Date = new Date("2026-06-13T12:00:00.000Z");
    expect(VMwareResourceService.getStaleThresholdDate(now).toISOString()).toBe(
      "2026-06-13T11:45:00.000Z",
    );
  });
});
