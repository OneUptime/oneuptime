/*
 * AN RDS INSTANCE'S CONNECTION LIMIT, FROM ITS CLASS AND ITS ENGINE.
 *
 * Past max_connections a database refuses new connections ("too many
 * connections"), and how many it allows depends on the instance: RDS sets
 * max_connections from the memory of the instance's class, by a formula of
 * its engine, unless the instance's parameter group sets a number of its
 * own. A db.t3.micro running MySQL takes about 60, a db.r6g.large running
 * PostgreSQL about 1,700. So a monitor on an instance's connections alerts
 * on a share of its own limit (CloudAlertTemplates' Connections Near the
 * Limit), never on one count for every database.
 *
 * The defaults, as AWS documents them (RDS's "Maximum number of database
 * connections", Aurora's "Maximum connections to an Aurora ... DB
 * instance"):
 *
 *   - MySQL, and MariaDB 10.4 and older: DBInstanceClassMemory / 12582880
 *   - MariaDB 10.5 and later: LEAST(DBInstanceClassMemory / 25165760, 12000)
 *   - PostgreSQL and Aurora PostgreSQL:
 *     LEAST(DBInstanceClassMemory / 9531392, 5000)
 *   - Aurora MySQL: AWS's table of classes - its formula, taken in steps of
 *     45 connections on the burstable classes and 1,000 on the others.
 *
 * DBInstanceClassMemory is the class's memory less what the operating
 * system and RDS's own processes keep, which AWS does not publish: "about
 * 630" on a class of 8 GiB, "about 60" on a db.t3.micro, where the class's
 * whole memory would give 683 and 85. It is estimated here as the class's
 * memory less 256 MiB and 4.6% of it, which gives AWS's two examples, and
 * Aurora Serverless v2's published PostgreSQL defaults for 2 to 32 GiB to
 * within 2% (RdsConnectionLimits.test holds all of them). An estimate a
 * little low, never high, is the safe side: a line at 90% of a limit a few
 * percent low fires a little early, where one above the real limit would
 * never fire at all.
 *
 * What it does not know, it says, never guesses:
 *
 *   - an instance the account's inventory has not listed yet: no class or
 *     engine to work from;
 *   - a class whose memory is not known (Aurora Serverless v2's
 *     db.serverless, whose limit follows its cluster's maximum capacity; a
 *     family newer than this file);
 *   - an engine whose connections its class does not limit: SQL Server
 *     (unlimited unless its server properties say otherwise), Oracle
 *     (processes and sessions, not connections), Db2 (64,000, whatever the
 *     class).
 *
 * And what it cannot read: a parameter group of the team's own may set
 * max_connections, and its value is read with rds:DescribeDBParameters,
 * which the connection's read-only access does not have. The read knows
 * the group's name (CloudFormation's DBParameterGroupName, from the
 * account's inventory): an engine's default group ("default.postgres16")
 * cannot be changed, so the class's default is the limit; a group of the
 * team's own is named, so the page can say the limit is the class's
 * default and how to change the monitor if the group sets another.
 *
 * Pure and isomorphic: the templates, the Dashboard and the tests read it.
 */

export const RDS_DB_INSTANCE_TYPE: string = "AWS::RDS::DBInstance";

// The inventory properties an instance's limit is read from (cloudProperties).
export const RDS_INSTANCE_CLASS_PROPERTY: string = "DBInstanceClass";
export const RDS_ENGINE_PROPERTY: string = "Engine";
export const RDS_ENGINE_VERSION_PROPERTY: string = "EngineVersion";
export const RDS_PARAMETER_GROUP_PROPERTY: string = "DBParameterGroupName";

// The prefix of every engine's default parameter group, which no one can change.
export const RDS_DEFAULT_PARAMETER_GROUP_PREFIX: string = "default.";

// The engines whose connection limit follows the instance's class.
export enum RdsConnectionEngine {
  MySql = "mysql",
  MariaDb = "mariadb",
  PostgreSql = "postgres",
  AuroraMySql = "aurora-mysql",
  AuroraPostgreSql = "aurora-postgresql",
}

// Each engine by its own name: a product name, the same in every language.
export const RDS_CONNECTION_ENGINE_NAMES: Readonly<
  Record<RdsConnectionEngine, string>
> = {
  [RdsConnectionEngine.MySql]: "MySQL",
  [RdsConnectionEngine.MariaDb]: "MariaDB",
  [RdsConnectionEngine.PostgreSql]: "PostgreSQL",
  [RdsConnectionEngine.AuroraMySql]: "Aurora MySQL",
  [RdsConnectionEngine.AuroraPostgreSql]: "Aurora PostgreSQL",
};

/*
 * ---------------------------------------------------------------------------
 * The class's memory
 * ---------------------------------------------------------------------------
 *
 * An instance class is a family and a size: db.r6g.large is the r family's
 * sixth generation on Graviton ("g"), two vCPUs. Every size of a family
 * has the same memory per vCPU, so a class's memory is its size's vCPUs
 * times its family's GiB per vCPU - which also knows the families AWS adds
 * after this file (a db.r9g is still eight GiB a vCPU). The burstable
 * classes (t2, t3, t4g) and the bare-metal sizes are listed as they are.
 * RdsConnectionLimits.test holds the rule to every class of AWS's
 * hardware specifications.
 */

// db.<family letter><generation><attributes>.<size>: db.r6gd.2xlarge.
const INSTANCE_CLASS_PATTERN: RegExp = /^db\.([a-z])(\d+)([a-z]*)\.([a-z0-9-]+)$/;
// 2xlarge, 48xlarge: four vCPUs for each "x".
const XLARGE_SIZE_PATTERN: RegExp = /^(\d+)xlarge$/;
// metal-48xl: the bare-metal host of the 48xlarge size.
const METAL_SIZE_PATTERN: RegExp = /^metal-(\d+)xl$/;

// The burstable classes' memory, by size: not a share of their vCPUs.
const BURSTABLE_MEMORY_GIB: Readonly<Record<string, number>> = {
  micro: 1,
  small: 2,
  medium: 4,
  large: 8,
  xlarge: 16,
  "2xlarge": 32,
};

// A bare-metal size named only "metal": the family's whole host.
const METAL_MEMORY_GIB: Readonly<Record<string, number>> = {
  "db.m6i.metal": 512,
  "db.m6id.metal": 512,
  "db.m6in.metal": 512,
  "db.r6i.metal": 1024,
  "db.r6id.metal": 1024,
  "db.r6in.metal": 1024,
  "db.x2idn.metal": 2048,
  "db.x2iedn.metal": 4096,
  "db.x2iezn.metal": 1536,
};

// A family's memory per vCPU, in GiB: null for a family this file does not know.
function getMemoryPerVcpuGiB(data: {
  letter: string;
  generation: number;
  attributes: string;
}): number | null {
  switch (data.letter) {
    // General purpose: 4 GiB a vCPU, but the third generation's 3.75.
    case "m":
      if (data.generation === 3) {
        return 3.75;
      }

      return data.generation >= 4 ? 4 : null;
    // Memory optimized: 8 GiB a vCPU, but r3's and r4's 7.625.
    case "r":
      if (data.generation === 3 || data.generation === 4) {
        return 7.625;
      }

      return data.generation >= 5 ? 8 : null;
    // The largest memory: x1's 15.25 and x1e's 30.5; x2g's and x2idn's 16, x2iedn's and x2iezn's 32.
    case "x":
      if (data.generation === 1) {
        if (data.attributes === "") {
          return 15.25;
        }

        return data.attributes === "e" ? 30.5 : null;
      }

      if (data.attributes === "g" || data.attributes === "idn") {
        return 16;
      }

      if (data.attributes === "iedn" || data.attributes === "iezn") {
        return 32;
      }

      return null;
    // z1d: 8 GiB a vCPU.
    case "z":
      return data.attributes === "d" ? 8 : null;
    // Compute optimized (c6gd, of Multi-AZ DB clusters): 2 GiB a vCPU.
    case "c":
      return data.generation >= 6 ? 2 : null;
    default:
      return null;
  }
}

// A size's vCPUs: medium 1, large 2, xlarge 4, Nxlarge and metal-Nxl 4N.
function getVcpusOfSize(size: string): number | null {
  if (size === "medium") {
    return 1;
  }

  if (size === "large") {
    return 2;
  }

  if (size === "xlarge") {
    return 4;
  }

  const xlarge: RegExpExecArray | null =
    XLARGE_SIZE_PATTERN.exec(size) || METAL_SIZE_PATTERN.exec(size);
  const times: number = xlarge ? Number(xlarge[1]) : NaN;

  return Number.isFinite(times) && times > 0 ? times * 4 : null;
}

/*
 * The memory of an instance class, in GiB, as AWS's hardware
 * specifications list it: null for a class this file does not know
 * (db.serverless, a .tpc2.mem4x class of Oracle's and SQL Server's, a
 * family it has no rule for).
 */
export function getRdsInstanceClassMemoryGiB(
  instanceClass: string | null | undefined,
): number | null {
  const name: string = (instanceClass || "").trim().toLowerCase();

  if (METAL_MEMORY_GIB[name] !== undefined) {
    return METAL_MEMORY_GIB[name]!;
  }

  const match: RegExpExecArray | null = INSTANCE_CLASS_PATTERN.exec(name);

  if (!match) {
    return null;
  }

  const letter: string = match[1]!;
  const generation: number = Number(match[2]);
  const attributes: string = match[3]!;
  const size: string = match[4]!;

  if (letter === "t") {
    return BURSTABLE_MEMORY_GIB[size] ?? null;
  }

  const perVcpu: number | null = getMemoryPerVcpuGiB({
    letter,
    generation,
    attributes,
  });
  const vcpus: number | null = getVcpusOfSize(size);

  if (perVcpu === null || vcpus === null) {
    return null;
  }

  return perVcpu * vcpus;
}

/*
 * ---------------------------------------------------------------------------
 * The engine's default
 * ---------------------------------------------------------------------------
 */

const MIB: number = 1024 * 1024;
const GIB: number = 1024 * MIB;

// What RDS keeps of a class's memory for the operating system and itself, as estimated.
export const RDS_RESERVED_MEMORY_BASE_MIB: number = 256;
export const RDS_RESERVED_MEMORY_SHARE: number = 0.046;

// The divisors AWS's formulas use: bytes of DBInstanceClassMemory per connection.
export const MYSQL_BYTES_PER_CONNECTION: number = 12582880;
export const MARIADB_BYTES_PER_CONNECTION: number = 25165760;
export const POSTGRESQL_BYTES_PER_CONNECTION: number = 9531392;

// The most each default formula gives, and the most MySQL allows at all.
export const MYSQL_MAX_CONNECTIONS: number = 100000;
export const MARIADB_DEFAULT_MAX_CONNECTIONS: number = 12000;
export const POSTGRESQL_DEFAULT_MAX_CONNECTIONS: number = 5000;

/*
 * Aurora MySQL's steps: 45 connections for every doubling of memory past
 * 768 MiB on the burstable classes, 1,000 for every doubling past 7.625 GiB
 * on the others (805306368 and 8187281408 bytes, its formula's own).
 */
const AURORA_MYSQL_SMALL_STEP: number = 45;
const AURORA_MYSQL_SMALL_BASE_GIB: number = 0.75;
const AURORA_MYSQL_LARGE_STEP: number = 1000;
const AURORA_MYSQL_LARGE_BASE_GIB: number = 7.625;
// The smallest class Aurora runs on: db.t3.small and db.t4g's smallest.
const AURORA_MYSQL_MIN_MEMORY_GIB: number = 2;

// MariaDB's version from which its default halves: 10.5.
const MARIADB_VERSION_PATTERN: RegExp = /^(\d+)\.(\d+)/;

/*
 * DBInstanceClassMemory, estimated: the class's memory less what the
 * operating system and RDS's processes keep (see the header).
 */
export function estimateRdsInstanceClassMemoryBytes(memoryGiB: number): number {
  const total: number = memoryGiB * GIB;

  return Math.max(
    0,
    total - RDS_RESERVED_MEMORY_BASE_MIB * MIB - total * RDS_RESERVED_MEMORY_SHARE,
  );
}

// The engine a connection limit is worked out for, or null for one with none.
export function getRdsConnectionEngine(
  engine: string | null | undefined,
): RdsConnectionEngine | null {
  switch ((engine || "").trim().toLowerCase()) {
    case "mysql":
      return RdsConnectionEngine.MySql;
    case "mariadb":
      return RdsConnectionEngine.MariaDb;
    case "postgres":
      return RdsConnectionEngine.PostgreSql;
    // Aurora MySQL 1 (MySQL 5.6) was the engine "aurora".
    case "aurora":
    case "aurora-mysql":
      return RdsConnectionEngine.AuroraMySql;
    case "aurora-postgresql":
      return RdsConnectionEngine.AuroraPostgreSql;
    default:
      return null;
  }
}

// Whether a MariaDB version is 10.4 or older, whose default is MySQL's.
function isOldMariaDb(engineVersion: string | null | undefined): boolean {
  const match: RegExpExecArray | null = MARIADB_VERSION_PATTERN.exec(
    (engineVersion || "").trim(),
  );

  if (!match) {
    // Unknown: every version RDS still runs is 10.5 or later.
    return false;
  }

  const major: number = Number(match[1]);
  const minor: number = Number(match[2]);

  return major < 10 || (major === 10 && minor <= 4);
}

// Aurora MySQL's default, from the class's memory, as AWS's table lists it.
function getAuroraMySqlDefault(memoryGiB: number): number | null {
  if (memoryGiB < AURORA_MYSQL_MIN_MEMORY_GIB) {
    return null;
  }

  const small: number =
    AURORA_MYSQL_SMALL_STEP *
    Math.round(Math.log2(memoryGiB / AURORA_MYSQL_SMALL_BASE_GIB));
  const large: number =
    AURORA_MYSQL_LARGE_STEP *
    Math.round(Math.log2(memoryGiB / AURORA_MYSQL_LARGE_BASE_GIB));

  return Math.max(small, large);
}

/*
 * max_connections's default for an instance of this class and engine, or
 * null when it is not known: a class this file does not know, or an engine
 * whose connections its class does not limit.
 */
export function getRdsDefaultConnectionLimit(data: {
  instanceClass: string | null | undefined;
  engine: string | null | undefined;
  engineVersion?: string | null | undefined;
}): number | null {
  const engine: RdsConnectionEngine | null = getRdsConnectionEngine(
    data.engine,
  );
  const memoryGiB: number | null = getRdsInstanceClassMemoryGiB(
    data.instanceClass,
  );

  if (!engine || memoryGiB === null) {
    return null;
  }

  if (engine === RdsConnectionEngine.AuroraMySql) {
    return getAuroraMySqlDefault(memoryGiB);
  }

  const bytes: number = estimateRdsInstanceClassMemoryBytes(memoryGiB);
  let limit: number;

  if (
    engine === RdsConnectionEngine.PostgreSql ||
    engine === RdsConnectionEngine.AuroraPostgreSql
  ) {
    limit = Math.min(
      Math.floor(bytes / POSTGRESQL_BYTES_PER_CONNECTION),
      POSTGRESQL_DEFAULT_MAX_CONNECTIONS,
    );
  } else if (
    engine === RdsConnectionEngine.MariaDb &&
    !isOldMariaDb(data.engineVersion)
  ) {
    limit = Math.min(
      Math.floor(bytes / MARIADB_BYTES_PER_CONNECTION),
      MARIADB_DEFAULT_MAX_CONNECTIONS,
    );
  } else {
    limit = Math.min(
      Math.floor(bytes / MYSQL_BYTES_PER_CONNECTION),
      MYSQL_MAX_CONNECTIONS,
    );
  }

  return limit > 0 ? limit : null;
}

/*
 * ---------------------------------------------------------------------------
 * What an instance's row says
 * ---------------------------------------------------------------------------
 */

/*
 * Why an instance's limit is not known:
 *   - NotListed: the inventory has not listed its class and engine yet;
 *   - UnknownClass: its class's memory is not known (db.serverless, a
 *     family newer than this file);
 *   - NoClassLimit: its engine's connections do not follow its class (SQL
 *     Server, Oracle, Db2).
 */
export enum RdsConnectionLimitGap {
  NotListed = "NotListed",
  UnknownClass = "UnknownClass",
  NoClassLimit = "NoClassLimit",
}

export interface RdsConnectionLimit {
  // max_connections's default for its class and engine.
  limit: number;
  // As the inventory lists it: "db.r6g.large".
  instanceClass: string;
  engine: RdsConnectionEngine;
  // Its parameter group, when the inventory names one.
  parameterGroup: string | null;
  // A group of the team's own, which may set its own max_connections.
  isOwnParameterGroup: boolean;
}

export type RdsConnectionLimitReading =
  | { limit: RdsConnectionLimit; gap?: undefined }
  | {
      limit?: undefined;
      gap: RdsConnectionLimitGap;
      // As the inventory lists them, when it does.
      instanceClass: string | null;
      engine: string | null;
    };

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Whether a parameter group is an engine's own default, which nobody can change.
export function isRdsDefaultParameterGroup(
  name: string | null | undefined,
): boolean {
  return (name || "")
    .trim()
    .toLowerCase()
    .startsWith(RDS_DEFAULT_PARAMETER_GROUP_PREFIX);
}

/*
 * An RDS instance's connection limit, from what its inventory lists
 * (CloudResource.cloudProperties), or why it is not known.
 */
export function readRdsConnectionLimit(
  properties: unknown,
): RdsConnectionLimitReading {
  const record: Record<string, unknown> =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)
      : {};
  const instanceClass: string = readText(record[RDS_INSTANCE_CLASS_PROPERTY]);
  const engine: string = readText(record[RDS_ENGINE_PROPERTY]);
  const gap: (reason: RdsConnectionLimitGap) => RdsConnectionLimitReading = (
    reason: RdsConnectionLimitGap,
  ): RdsConnectionLimitReading => {
    return {
      gap: reason,
      instanceClass: instanceClass || null,
      engine: engine || null,
    };
  };

  if (!instanceClass || !engine) {
    return gap(RdsConnectionLimitGap.NotListed);
  }

  const connectionEngine: RdsConnectionEngine | null =
    getRdsConnectionEngine(engine);

  if (!connectionEngine) {
    return gap(RdsConnectionLimitGap.NoClassLimit);
  }

  const limit: number | null = getRdsDefaultConnectionLimit({
    instanceClass,
    engine,
    engineVersion: readText(record[RDS_ENGINE_VERSION_PROPERTY]),
  });

  if (limit === null) {
    return gap(RdsConnectionLimitGap.UnknownClass);
  }

  const parameterGroup: string = readText(record[RDS_PARAMETER_GROUP_PROPERTY]);

  return {
    limit: {
      limit: limit,
      instanceClass: instanceClass,
      engine: connectionEngine,
      parameterGroup: parameterGroup || null,
      isOwnParameterGroup:
        Boolean(parameterGroup) && !isRdsDefaultParameterGroup(parameterGroup),
    },
  };
}
