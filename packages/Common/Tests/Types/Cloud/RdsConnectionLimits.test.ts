import { describe, expect, test } from "@jest/globals";
import {
  MARIADB_BYTES_PER_CONNECTION,
  MYSQL_BYTES_PER_CONNECTION,
  MYSQL_MAX_CONNECTIONS,
  POSTGRESQL_BYTES_PER_CONNECTION,
  RDS_CONNECTION_ENGINE_NAMES,
  RDS_DEFAULT_PARAMETER_GROUP_PREFIX,
  RDS_RESERVED_MEMORY_BASE_MIB,
  RDS_RESERVED_MEMORY_SHARE,
  RdsConnectionEngine,
  RdsConnectionLimitGap,
  RdsConnectionLimitReading,
  estimateRdsInstanceClassMemoryBytes,
  getRdsConnectionEngine,
  getRdsDefaultConnectionLimit,
  getRdsInstanceClassMemoryGiB,
  isRdsDefaultParameterGroup,
  readRdsConnectionLimit,
} from "../../../Types/Cloud/RdsConnectionLimits";
import {
  RDS_INSTANCE_CLASS_SPECS,
  RDS_OPTIMIZED_CPU_CLASS_SPECS,
  RdsInstanceClassSpec,
} from "./RdsInstanceClassSpecs";

/*
 * AN RDS INSTANCE'S CONNECTION LIMIT (Types/Cloud/RdsConnectionLimits).
 *
 * Held to what AWS publishes: the memory of every instance class its
 * hardware specifications list, Aurora MySQL's table of defaults, RDS's two
 * worked examples of DBInstanceClassMemory, and Aurora Serverless v2's
 * PostgreSQL defaults per capacity - which say how much memory RDS keeps
 * for itself, and so whether the estimate of it is on the safe side.
 */

const GIB: number = 1024 * 1024 * 1024;

describe("an instance class's memory", () => {
  test("is what AWS's hardware specifications list, for every class there", () => {
    expect(RDS_INSTANCE_CLASS_SPECS.length).toBeGreaterThan(350);

    const wrong: Array<string> = [];

    for (const [instanceClass, , memoryGiB] of RDS_INSTANCE_CLASS_SPECS) {
      const got: number | null = getRdsInstanceClassMemoryGiB(instanceClass);

      if (got !== memoryGiB) {
        wrong.push(`${instanceClass}: ${got} instead of ${memoryGiB}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test("covers every family the specifications list, the older and the newest", () => {
    const families: Set<string> = new Set<string>(
      RDS_INSTANCE_CLASS_SPECS.map((spec: RdsInstanceClassSpec): string => {
        return spec[0].split(".")[1]!;
      }),
    );

    for (const family of [
      "t3",
      "t4g",
      "m5",
      "m7g",
      "m8g",
      "r5",
      "r6g",
      "r7i",
      "r8g",
      "x2g",
      "x2iedn",
      "z1d",
      "c6gd",
      "r3",
      "m3",
      "x1e",
    ]) {
      expect(families).toContain(family);
    }
  });

  test("a family newer than this file is read by its letter: a db.r9g is still 8 GiB a vCPU", () => {
    expect(getRdsInstanceClassMemoryGiB("db.r9g.large")).toBe(16);
    expect(getRdsInstanceClassMemoryGiB("db.m9i.2xlarge")).toBe(32);
    expect(getRdsInstanceClassMemoryGiB("db.t5g.medium")).toBe(4);
    expect(getRdsInstanceClassMemoryGiB("db.x8g.xlarge")).toBe(64);
    // A bare-metal size of a new family: its xlarge size's vCPUs.
    expect(getRdsInstanceClassMemoryGiB("db.r9i.metal-48xl")).toBe(1536);
  });

  test("is read in any case, with spaces around it", () => {
    expect(getRdsInstanceClassMemoryGiB(" DB.R6G.LARGE ")).toBe(16);
  });

  test("is not known for a class it cannot tell: serverless, the CPU-optimized multiples, a family without a rule", () => {
    for (const instanceClass of [
      "db.serverless",
      "db.m1.small",
      "db.m2.xlarge",
      "db.q9.large",
      "db.x3e.large",
      "db.z2.large",
      "db.c5.large",
      "db.t3.huge",
      "db.r6g.tiny",
      "db.r6g.0xlarge",
      "db.r6g",
      "r6g.large",
      "",
    ]) {
      expect(`${instanceClass}: ${getRdsInstanceClassMemoryGiB(instanceClass)}`).toBe(
        `${instanceClass}: null`,
      );
    }

    expect(getRdsInstanceClassMemoryGiB(undefined)).toBeNull();
    expect(getRdsInstanceClassMemoryGiB(null)).toBeNull();

    for (const [instanceClass] of RDS_OPTIMIZED_CPU_CLASS_SPECS) {
      expect(getRdsInstanceClassMemoryGiB(instanceClass)).toBeNull();
    }
  });
});

/*
 * AWS's table of Aurora MySQL's default max_connections ("Maximum
 * connections to an Aurora MySQL DB instance", read 2026-11-06).
 */
const AURORA_MYSQL_DEFAULTS: ReadonlyArray<[string, number]> = [
  ["db.t2.small", 45],
  ["db.t2.medium", 90],
  ["db.t3.small", 45],
  ["db.t3.medium", 90],
  ["db.t3.large", 135],
  ["db.t4g.medium", 90],
  ["db.t4g.large", 135],
  ["db.r3.large", 1000],
  ["db.r3.xlarge", 2000],
  ["db.r3.2xlarge", 3000],
  ["db.r3.4xlarge", 4000],
  ["db.r3.8xlarge", 5000],
  ["db.r4.large", 1000],
  ["db.r4.xlarge", 2000],
  ["db.r4.2xlarge", 3000],
  ["db.r4.4xlarge", 4000],
  ["db.r4.8xlarge", 5000],
  ["db.r4.16xlarge", 6000],
  ["db.r5.large", 1000],
  ["db.r5.xlarge", 2000],
  ["db.r5.2xlarge", 3000],
  ["db.r5.4xlarge", 4000],
  ["db.r5.8xlarge", 5000],
  ["db.r5.12xlarge", 6000],
  ["db.r5.16xlarge", 6000],
  ["db.r5.24xlarge", 7000],
  ["db.r6g.large", 1000],
  ["db.r6g.xlarge", 2000],
  ["db.r6g.2xlarge", 3000],
  ["db.r6g.4xlarge", 4000],
  ["db.r6g.8xlarge", 5000],
  ["db.r6g.12xlarge", 6000],
  ["db.r6g.16xlarge", 6000],
  ["db.r6i.large", 1000],
  ["db.r6i.xlarge", 2000],
  ["db.r6i.2xlarge", 3000],
  ["db.r6i.4xlarge", 4000],
  ["db.r6i.8xlarge", 5000],
  ["db.r6i.12xlarge", 6000],
  ["db.r6i.16xlarge", 6000],
  ["db.r6i.24xlarge", 7000],
  ["db.r6i.32xlarge", 7000],
  ["db.r7g.large", 1000],
  ["db.r7g.xlarge", 2000],
  ["db.r7g.2xlarge", 3000],
  ["db.r7g.4xlarge", 4000],
  ["db.r7g.8xlarge", 5000],
  ["db.r7g.12xlarge", 6000],
  ["db.r7g.16xlarge", 6000],
  ["db.r7i.large", 1000],
  ["db.r7i.xlarge", 2000],
  ["db.r7i.2xlarge", 3000],
  ["db.r7i.4xlarge", 4000],
  ["db.r7i.8xlarge", 5000],
  ["db.r7i.12xlarge", 6000],
  ["db.r7i.16xlarge", 6000],
  ["db.r7i.24xlarge", 7000],
  ["db.r7i.48xlarge", 8000],
  ["db.r8g.large", 1000],
  ["db.r8g.xlarge", 2000],
  ["db.r8g.2xlarge", 3000],
  ["db.r8g.4xlarge", 4000],
  ["db.r8g.8xlarge", 5000],
  ["db.r8g.12xlarge", 6000],
  ["db.r8g.16xlarge", 6000],
  ["db.r8g.24xlarge", 7000],
  ["db.r8g.48xlarge", 8000],
  ["db.x2g.large", 2000],
  ["db.x2g.xlarge", 3000],
  ["db.x2g.2xlarge", 4000],
  ["db.x2g.4xlarge", 5000],
  ["db.x2g.8xlarge", 6000],
  ["db.x2g.12xlarge", 7000],
  ["db.x2g.16xlarge", 7000],
];

/*
 * Aurora Serverless v2's default max_connections for PostgreSQL by its
 * maximum capacity, on platform versions 1 and 2, 3 and 4 ("Maximum
 * connections for Aurora serverless", read 2026-11-06). An ACU is about
 * 2 GiB: these are LEAST(DBInstanceClassMemory / 9531392, 5000) at 2 to
 * 32 GiB, with what RDS keeps for itself already taken off.
 */
const AURORA_POSTGRESQL_SERVERLESS: ReadonlyArray<{
  memoryGiB: number;
  published: [number, number, number];
}> = [
  { memoryGiB: 2, published: [189, 193, 194] },
  { memoryGiB: 8, published: [823, 840, 844] },
  { memoryGiB: 16, published: [1669, 1703, 1710] },
  { memoryGiB: 32, published: [3360, 3429, 3443] },
  { memoryGiB: 64, published: [5000, 5000, 5000] },
];

describe("an engine's default limit", () => {
  test("Aurora MySQL's is AWS's table, for every class in it", () => {
    for (const [instanceClass, limit] of AURORA_MYSQL_DEFAULTS) {
      expect(
        `${instanceClass}: ${getRdsDefaultConnectionLimit({
          instanceClass,
          engine: "aurora-mysql",
        })}`,
      ).toBe(`${instanceClass}: ${limit}`);
    }
  });

  test("Aurora MySQL 1 (the engine \"aurora\") reads as Aurora MySQL", () => {
    expect(
      getRdsDefaultConnectionLimit({
        instanceClass: "db.r5.large",
        engine: "aurora",
      }),
    ).toBe(1000);
  });

  test("Aurora MySQL on a class it does not run (under 2 GiB) has no default", () => {
    expect(
      getRdsDefaultConnectionLimit({
        instanceClass: "db.t3.micro",
        engine: "aurora-mysql",
      }),
    ).toBeNull();
  });

  test("RDS for MySQL: AWS's examples, about 60 on a db.t3.micro and about 630 on a class of 8 GiB", () => {
    const micro: number = getRdsDefaultConnectionLimit({
      instanceClass: "db.t3.micro",
      engine: "mysql",
    })!;
    const large: number = getRdsDefaultConnectionLimit({
      instanceClass: "db.m7g.large",
      engine: "mysql",
    })!;

    expect(micro).toBe(60);
    expect(large).toBe(629);
    expect(Math.abs(large - 630) / 630).toBeLessThanOrEqual(0.01);
    /*
     * Where the class's whole memory would give 683 and 85: what RDS keeps
     * for itself is taken off.
     */
    expect(Math.floor((8 * GIB) / MYSQL_BYTES_PER_CONNECTION)).toBe(682);
    expect(Math.floor((1 * GIB) / MYSQL_BYTES_PER_CONNECTION)).toBe(85);
  });

  test("PostgreSQL's estimate falls within Aurora Serverless v2's published defaults - and is never above them", () => {
    for (const entry of AURORA_POSTGRESQL_SERVERLESS) {
      const estimate: number = Math.min(
        Math.floor(
          estimateRdsInstanceClassMemoryBytes(entry.memoryGiB) /
            POSTGRESQL_BYTES_PER_CONNECTION,
        ),
        5000,
      );
      const lowest: number = Math.min(...entry.published);
      const highest: number = Math.max(...entry.published);

      expect(`${entry.memoryGiB} GiB: ${estimate <= highest}`).toBe(
        `${entry.memoryGiB} GiB: true`,
      );
      expect(`${entry.memoryGiB} GiB: ${estimate >= lowest * 0.98}`).toBe(
        `${entry.memoryGiB} GiB: true`,
      );
    }
  });

  test.each([
    ["db.t3.micro", "postgres", 79],
    ["db.t4g.medium", "postgres", 401],
    ["db.r6g.large", "postgres", 1691],
    ["db.r6g.xlarge", "postgres", 3410],
    ["db.r6g.2xlarge", "postgres", 5000],
    ["db.r6g.large", "aurora-postgresql", 1691],
    ["db.m5.xlarge", "mysql", 1281],
    ["db.r6g.xlarge", "mysql", 2583],
  ])(
    "a %s running %s: %i",
    (instanceClass: string, engine: string, limit: number) => {
      expect(getRdsDefaultConnectionLimit({ instanceClass, engine })).toBe(
        limit,
      );
    },
  );

  test("MariaDB halves its per-connection memory from 10.5 on, up to 12,000; 10.4 and older are MySQL's", () => {
    const limitOf: (version: string | undefined) => number | null = (
      version: string | undefined,
    ): number | null => {
      return getRdsDefaultConnectionLimit({
        instanceClass: "db.r6g.large",
        engine: "mariadb",
        engineVersion: version,
      });
    };
    const bytes: number = estimateRdsInstanceClassMemoryBytes(16);

    expect(limitOf("10.11.8")).toBe(
      Math.floor(bytes / MARIADB_BYTES_PER_CONNECTION),
    );
    expect(limitOf("10.5.25")).toBe(limitOf("10.11.8"));
    expect(limitOf("11.4.3")).toBe(limitOf("10.11.8"));
    // Not known: every version RDS still runs is 10.5 or later.
    expect(limitOf(undefined)).toBe(limitOf("10.11.8"));
    expect(limitOf("unknown")).toBe(limitOf("10.11.8"));
    expect(limitOf("10.4.34")).toBe(
      Math.floor(bytes / MYSQL_BYTES_PER_CONNECTION),
    );
    expect(limitOf("10.3.39")).toBe(limitOf("10.4.34"));
    expect(limitOf("5.5.68")).toBe(limitOf("10.4.34"));

    expect(
      getRdsDefaultConnectionLimit({
        instanceClass: "db.x2iedn.32xlarge",
        engine: "mariadb",
        engineVersion: "10.11.8",
      }),
    ).toBe(12000);
  });

  test("each formula stops where AWS's does: PostgreSQL at 5,000, MySQL at the 100,000 it allows", () => {
    expect(
      getRdsDefaultConnectionLimit({
        instanceClass: "db.r6g.16xlarge",
        engine: "postgres",
      }),
    ).toBe(5000);
    expect(
      getRdsDefaultConnectionLimit({
        instanceClass: "db.x2iedn.32xlarge",
        engine: "mysql",
      }),
    ).toBe(MYSQL_MAX_CONNECTIONS);
  });

  /*
   * The safe side: a line at 90% of a limit a little low fires a little
   * early, where one above the real limit would never fire. Whatever the
   * class and engine, the estimate is never above the formula on the
   * class's whole memory.
   */
  test("never above the formula on the class's whole memory, for every class and engine", () => {
    for (const [instanceClass, , memoryGiB] of RDS_INSTANCE_CLASS_SPECS) {
      for (const engine of ["mysql", "postgres"]) {
        const limit: number | null = getRdsDefaultConnectionLimit({
          instanceClass,
          engine,
        });
        const whole: number =
          engine === "mysql"
            ? Math.min(
                Math.floor((memoryGiB * GIB) / MYSQL_BYTES_PER_CONNECTION),
                MYSQL_MAX_CONNECTIONS,
              )
            : Math.min(
                Math.floor((memoryGiB * GIB) / POSTGRESQL_BYTES_PER_CONNECTION),
                5000,
              );

        expect(limit).not.toBeNull();
        expect(limit!).toBeLessThanOrEqual(whole);
      }
    }
  });

  test("what RDS keeps is 256 MiB and 4.6% of the class's memory, never more than it has", () => {
    expect(RDS_RESERVED_MEMORY_BASE_MIB).toBe(256);
    expect(RDS_RESERVED_MEMORY_SHARE).toBe(0.046);
    expect(estimateRdsInstanceClassMemoryBytes(1)).toBeCloseTo(
      GIB - 256 * 1024 * 1024 - GIB * 0.046,
      0,
    );
    expect(estimateRdsInstanceClassMemoryBytes(0)).toBe(0);
    expect(estimateRdsInstanceClassMemoryBytes(0.1)).toBe(0);
  });

  test("an engine whose connections its class does not limit has none, whatever the class", () => {
    for (const engine of [
      "sqlserver-ee",
      "sqlserver-se",
      "sqlserver-ex",
      "sqlserver-web",
      "oracle-ee",
      "oracle-se2",
      "oracle-ee-cdb",
      "db2-se",
      "db2-ae",
      "custom-oracle-ee",
      "neptune",
      "",
    ]) {
      expect(getRdsConnectionEngine(engine)).toBeNull();
      expect(
        getRdsDefaultConnectionLimit({
          instanceClass: "db.r6g.large",
          engine: engine,
        }),
      ).toBeNull();
    }
  });

  test("the engines that have one, named as their product, in any case", () => {
    expect(getRdsConnectionEngine(" MySQL ")).toBe(RdsConnectionEngine.MySql);
    expect(getRdsConnectionEngine("mariadb")).toBe(RdsConnectionEngine.MariaDb);
    expect(getRdsConnectionEngine("postgres")).toBe(
      RdsConnectionEngine.PostgreSql,
    );
    expect(getRdsConnectionEngine("aurora-mysql")).toBe(
      RdsConnectionEngine.AuroraMySql,
    );
    expect(getRdsConnectionEngine("aurora-postgresql")).toBe(
      RdsConnectionEngine.AuroraPostgreSql,
    );
    expect(getRdsConnectionEngine(undefined)).toBeNull();
    expect(RDS_CONNECTION_ENGINE_NAMES).toEqual({
      [RdsConnectionEngine.MySql]: "MySQL",
      [RdsConnectionEngine.MariaDb]: "MariaDB",
      [RdsConnectionEngine.PostgreSql]: "PostgreSQL",
      [RdsConnectionEngine.AuroraMySql]: "Aurora MySQL",
      [RdsConnectionEngine.AuroraPostgreSql]: "Aurora PostgreSQL",
    });
  });
});

describe("what an instance's row says", () => {
  test("a listed instance: its limit, its class and engine, and its parameter group", () => {
    expect(
      readRdsConnectionLimit({
        DBInstanceClass: "db.r6g.large",
        Engine: "postgres",
        EngineVersion: "16.4",
        DBParameterGroupName: "default.postgres16",
        AllocatedStorage: 200,
      }),
    ).toEqual({
      limit: {
        limit: 1691,
        instanceClass: "db.r6g.large",
        engine: RdsConnectionEngine.PostgreSql,
        parameterGroup: "default.postgres16",
        isOwnParameterGroup: false,
      },
    });
  });

  test("a parameter group of the team's own may set its own max_connections; an engine's default cannot", () => {
    const own: RdsConnectionLimitReading = readRdsConnectionLimit({
      DBInstanceClass: "db.t3.micro",
      Engine: "mysql",
      DBParameterGroupName: "  orders-mysql8  ",
    });

    expect(own.limit).toEqual({
      limit: 60,
      instanceClass: "db.t3.micro",
      engine: RdsConnectionEngine.MySql,
      parameterGroup: "orders-mysql8",
      isOwnParameterGroup: true,
    });
    expect(isRdsDefaultParameterGroup("default.mysql8.0")).toBe(true);
    expect(isRdsDefaultParameterGroup("Default.Aurora-PostgreSQL15")).toBe(
      true,
    );
    expect(isRdsDefaultParameterGroup("defaults-for-orders")).toBe(false);
    expect(isRdsDefaultParameterGroup("orders-default.mysql")).toBe(false);
    expect(isRdsDefaultParameterGroup(undefined)).toBe(false);
    expect(RDS_DEFAULT_PARAMETER_GROUP_PREFIX).toBe("default.");

    // Not named by the inventory: nothing known of it, and not called its own.
    expect(
      readRdsConnectionLimit({ DBInstanceClass: "db.t3.micro", Engine: "mysql" })
        .limit,
    ).toEqual({
      limit: 60,
      instanceClass: "db.t3.micro",
      engine: RdsConnectionEngine.MySql,
      parameterGroup: null,
      isOwnParameterGroup: false,
    });
  });

  test("not listed yet: no class or no engine", () => {
    for (const properties of [
      {},
      { DBInstanceClass: "db.r6g.large" },
      { Engine: "postgres" },
      { DBInstanceClass: "  ", Engine: "postgres" },
      { DBInstanceClass: 42, Engine: "postgres" },
      null,
      undefined,
      [],
      "db.r6g.large",
    ]) {
      expect(readRdsConnectionLimit(properties).gap).toBe(
        RdsConnectionLimitGap.NotListed,
      );
    }

    expect(readRdsConnectionLimit({ Engine: "postgres" })).toEqual({
      gap: RdsConnectionLimitGap.NotListed,
      instanceClass: null,
      engine: "postgres",
    });
  });

  test("an engine its class does not limit, and a class whose memory is not known, each say so", () => {
    expect(
      readRdsConnectionLimit({
        DBInstanceClass: "db.m5.large",
        Engine: "sqlserver-se",
      }),
    ).toEqual({
      gap: RdsConnectionLimitGap.NoClassLimit,
      instanceClass: "db.m5.large",
      engine: "sqlserver-se",
    });
    expect(
      readRdsConnectionLimit({
        DBInstanceClass: "db.serverless",
        Engine: "aurora-postgresql",
      }),
    ).toEqual({
      gap: RdsConnectionLimitGap.UnknownClass,
      instanceClass: "db.serverless",
      engine: "aurora-postgresql",
    });
    // An engine with no class limit is said first, whatever its class.
    expect(
      readRdsConnectionLimit({
        DBInstanceClass: "db.serverless",
        Engine: "oracle-ee",
      }).gap,
    ).toBe(RdsConnectionLimitGap.NoClassLimit);
  });
});
