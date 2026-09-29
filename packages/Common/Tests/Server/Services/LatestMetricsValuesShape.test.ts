import CephResourceService from "../../../Server/Services/CephResourceService";
import DockerSwarmResourceService from "../../../Server/Services/DockerSwarmResourceService";
import IoTDeviceService from "../../../Server/Services/IoTDeviceService";
import KubernetesContainerService from "../../../Server/Services/KubernetesContainerService";
import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
import ProxmoxResourceService from "../../../Server/Services/ProxmoxResourceService";
import VMwareResourceService from "../../../Server/Services/VMwareResourceService";
import ObjectID from "../../../Types/ObjectID";

/*
 * Every inventory service mirrors its latest metrics with a hand-built
 * `UPDATE ... FROM (VALUES ($3, $4::numeric, ...), ...) AS v("a", "b", ...)`.
 * Three lists have to agree for that statement to run at all: the
 * placeholders in each VALUES tuple, the column aliases in AS v(...), and
 * the params bound per row. When they disagree Postgres rejects the whole
 * statement ("table "v" has 9 columns available but 10 columns
 * specified"), the ingest path swallows the error at warn level, and the
 * latest-metric columns stay empty forever — which is how the IoT mirror
 * shipped (GitHub #3998).
 *
 * The unit suites fake `manager.query`, so a malformed statement passes
 * them. This suite parses the statement each service actually builds and
 * holds the three lists to each other, for every service, over several
 * rows (a per-row drift shifts every later row's params).
 * IoTDeviceLatestMetricsPostgres.test.ts executes the same statements on
 * a migrated Postgres.
 */

type QueryCall = [string, Array<unknown>];

const PROJECT_ID: ObjectID = ObjectID.generate();
const PARENT_ID: ObjectID = ObjectID.generate();
const ROWS: number = 3;
const OBSERVED_AT: Date = new Date("2026-09-20T10:00:00.000Z");

interface ServiceCase {
  name: string;
  service: { getRepository: () => unknown };
  run: (rows: number) => Promise<void>;
}

function indexes(count: number): Array<number> {
  return Array.from({ length: count }, (_: unknown, i: number) => {
    return i;
  });
}

const CASES: Array<ServiceCase> = [
  {
    name: "IoTDeviceService",
    service: IoTDeviceService,
    run: async (rows: number): Promise<void> => {
      await IoTDeviceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        iotFleetId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            kind: "Sensor",
            externalId: `sensor-${i}`,
            cpuPercent: 10 + i,
            memoryBytes: 1000 + i,
            maxMemoryBytes: 2000 + i,
            memoryPercent: 20 + i,
            batteryPercent: 80 + i,
            signalStrengthDbm: -60 - i,
            temperatureCelsius: 21 + i,
            observedAt: OBSERVED_AT,
          };
        }),
      });
    },
  },
  {
    name: "ProxmoxResourceService",
    service: ProxmoxResourceService,
    run: async (rows: number): Promise<void> => {
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            kind: "VM",
            externalId: `qemu/${100 + i}`,
            cpuPercent: 10 + i,
            memoryBytes: 1000 + i,
            maxMemoryBytes: 2000 + i,
            memoryPercent: 20 + i,
            diskBytes: 3000 + i,
            maxDiskBytes: 4000 + i,
            observedAt: OBSERVED_AT,
          };
        }),
      });
    },
  },
  {
    name: "CephResourceService",
    service: CephResourceService,
    run: async (rows: number): Promise<void> => {
      await CephResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        cephClusterId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            kind: "OSD",
            externalId: `osd.${i}`,
            statBytes: 1000 + i,
            statBytesUsed: 500 + i,
            applyLatencyMs: 1 + i,
            commitLatencyMs: 2 + i,
            pgCount: 30 + i,
            storedBytes: 400 + i,
            maxAvailBytes: 600 + i,
            objects: 70 + i,
            readOpsCounter: 800 + i,
            writeOpsCounter: 900 + i,
            observedAt: OBSERVED_AT,
          };
        }),
      });
    },
  },
  {
    name: "VMwareResourceService",
    service: VMwareResourceService,
    run: async (rows: number): Promise<void> => {
      await VMwareResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        vmwareVCenterId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            kind: "VirtualMachine",
            externalId: `vm-${i}`,
            cpuPercent: 10 + i,
            cpuMhz: 100 + i,
            cpuCapacityMhz: 200 + i,
            cpuEffectiveMhz: 150 + i,
            memoryBytes: 1000 + i,
            maxMemoryBytes: 2000 + i,
            memoryEffectiveBytes: 1500 + i,
            memoryPercent: 50 + i,
            diskBytes: 3000 + i,
            maxDiskBytes: 4000 + i,
            diskPercent: 75 + i,
            cpuReadinessPercent: 1 + i,
            memoryBalloonedBytes: 10 + i,
            memorySwappedBytes: 20 + i,
            hostCount: 1 + i,
            effectiveHostCount: 1 + i,
            poweredOnHostCount: 1 + i,
            vmCount: 5 + i,
            poweredOnVmCount: 4 + i,
            vmTemplateCount: 1 + i,
            datastoreCount: 2 + i,
            clusterCount: 1 + i,
            observedAt: OBSERVED_AT,
          };
        }),
      });
    },
  },
  {
    name: "DockerSwarmResourceService",
    service: DockerSwarmResourceService,
    run: async (rows: number): Promise<void> => {
      await DockerSwarmResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        dockerSwarmClusterId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            kind: "Service",
            externalId: `svc-${i}`,
            cpuPercent: 10 + i,
            memoryBytes: 1000 + i,
            maxMemoryBytes: 2000 + i,
            memoryPercent: 50 + i,
            observedAt: OBSERVED_AT,
          };
        }),
      });
    },
  },
  {
    name: "KubernetesResourceService",
    service: KubernetesResourceService,
    run: async (rows: number): Promise<void> => {
      await KubernetesResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        kubernetesClusterId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            kind: "Pod",
            namespaceKey: "default",
            name: `pod-${i}`,
            cpuPercent: 10 + i,
            memoryBytes: 1000 + i,
            memoryPercent: 50 + i,
            observedAt: OBSERVED_AT,
            controllerDeploymentName: `deploy-${i}`,
            controllerCronJobName: null,
          };
        }),
      });
    },
  },
  {
    name: "KubernetesContainerService",
    service: KubernetesContainerService,
    run: async (rows: number): Promise<void> => {
      await KubernetesContainerService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        kubernetesClusterId: PARENT_ID,
        metrics: indexes(rows).map((i: number) => {
          return {
            podNamespaceKey: "default",
            podName: `pod-${i}`,
            name: "app",
            cpuPercent: 10 + i,
            memoryBytes: 1000 + i,
            observedAt: OBSERVED_AT,
          };
        }),
      });
    },
  },
];

interface ParsedStatement {
  tuples: Array<Array<string>>;
  aliases: Array<string>;
  referencedAliases: Array<string>;
  maxPlaceholder: number;
}

function parseStatement(sql: string): ParsedStatement {
  const valuesMatch: RegExpMatchArray | null = sql.match(
    /FROM \(VALUES ([\s\S]*?)\)\s+AS v\(([\s\S]*?)\)/,
  );
  if (!valuesMatch) {
    throw new Error(`No FROM (VALUES ...) AS v(...) in:\n${sql}`);
  }

  const tuples: Array<Array<string>> = Array.from(
    `${valuesMatch[1]!})`.matchAll(/\(([^()]*)\)/g),
  ).map((m: RegExpMatchArray) => {
    return m[1]!.split(",").map((slot: string) => {
      return slot.trim();
    });
  });

  const aliases: Array<string> = valuesMatch[2]!
    .split(",")
    .map((alias: string) => {
      return alias.trim().replace(/^"|"$/g, "");
    })
    .filter((alias: string) => {
      return alias.length > 0;
    });

  const referencedAliases: Array<string> = Array.from(
    sql.matchAll(/\bv\."([^"]+)"/g),
  ).map((m: RegExpMatchArray) => {
    return m[1]!;
  });

  const maxPlaceholder: number = Math.max(
    ...Array.from(sql.matchAll(/\$(\d+)/g)).map((m: RegExpMatchArray) => {
      return Number(m[1]);
    }),
  );

  return { tuples, aliases, referencedAliases, maxPlaceholder };
}

function placeholderNumber(slot: string): number {
  const match: RegExpMatchArray | null = slot.match(/^\$(\d+)(::[a-z ]+)?$/);
  if (!match) {
    throw new Error(`Not a placeholder: "${slot}"`);
  }
  return Number(match[1]);
}

async function capture(serviceCase: ServiceCase): Promise<QueryCall> {
  const query: jest.Mock = jest.fn().mockResolvedValue([]);
  jest
    .spyOn(serviceCase.service, "getRepository")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockReturnValue({ manager: { query } } as any);
  await serviceCase.run(ROWS);
  expect(query).toHaveBeenCalledTimes(1);
  return query.mock.calls[0] as QueryCall;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)(
  "$name.bulkUpdateLatestMetrics builds a well-formed VALUES source",
  (serviceCase: ServiceCase) => {
    test("one tuple per row, each with exactly one slot per AS v(...) alias", async () => {
      const [sql] = await capture(serviceCase);
      const parsed: ParsedStatement = parseStatement(sql);

      expect(parsed.tuples).toHaveLength(ROWS);
      for (const tuple of parsed.tuples) {
        expect(tuple).toHaveLength(parsed.aliases.length);
      }
    });

    test('aliases are unique, and every v."..." the statement reads is declared', async () => {
      const [sql] = await capture(serviceCase);
      const parsed: ParsedStatement = parseStatement(sql);

      expect(new Set(parsed.aliases).size).toBe(parsed.aliases.length);
      for (const alias of parsed.referencedAliases) {
        expect(parsed.aliases).toContain(alias);
      }
      // Every alias is read somewhere: a declared-but-unused column is a mis-wire.
      for (const alias of parsed.aliases) {
        expect(parsed.referencedAliases).toContain(alias);
      }
    });

    test("tuples number their placeholders $3.. contiguously, one param each", async () => {
      const [sql, params] = await capture(serviceCase);
      const parsed: ParsedStatement = parseStatement(sql);

      const numbers: Array<number> = parsed.tuples
        .flat()
        .map(placeholderNumber);
      expect(numbers).toEqual(
        indexes(numbers.length).map((i: number) => {
          return i + 3;
        }),
      );

      // $1/$2 are the shared projectId + parent id, then one param per slot.
      expect(params).toHaveLength(2 + ROWS * parsed.aliases.length);
      expect(parsed.maxPlaceholder).toBe(params.length);
      expect(params[0]).toBe(PROJECT_ID.toString());
      expect(params[1]).toBe(PARENT_ID.toString());
    });

    test("each row's observedAt param sits under the observedAt alias", async () => {
      const [sql, params] = await capture(serviceCase);
      const parsed: ParsedStatement = parseStatement(sql);
      const observedAtColumn: number = parsed.aliases.indexOf("observedAt");
      expect(observedAtColumn).toBeGreaterThanOrEqual(0);

      for (const tuple of parsed.tuples) {
        const slot: string = tuple[observedAtColumn]!;
        expect(slot).toMatch(/::timestamptz$/);
        const param: unknown = params[placeholderNumber(slot) - 1];
        expect(param).toBeInstanceOf(Date);
        expect((param as Date).getTime()).toBe(OBSERVED_AT.getTime());
      }
    });
  },
);
