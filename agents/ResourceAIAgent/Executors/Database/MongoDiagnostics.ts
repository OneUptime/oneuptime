import { MongoConnection } from "./DatabaseDrivers";
import {
  OutputColumn,
  OutputSection,
  formatBytes,
  limitRows,
  mongoCommandShape,
  safeJson,
} from "./DatabaseOutput";
import {
  DATABASE_AI_AGENT_APPLICATION_NAME,
  DiagnosticOutcome,
  DiagnosticRun,
  EngineProbe,
  argumentString,
  errorMessage,
  errorNumber,
  failed,
  flagInteger,
  flagString,
  notRun,
  ok,
  refusedByAgent,
  sessionIdOf,
  toNumber,
} from "./DiagnosticTypes";
import {
  DATABASE_DEFAULT_ROW_LIMIT,
  DATABASE_MAX_ROW_LIMIT,
  isDatabaseCredentialSettingName,
} from "../../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * The db catalog on MongoDB, through the mongodb driver: admin commands
 * only — ping, buildInfo, hello, the $currentOp aggregation, serverStatus,
 * replSetGetStatus, listDatabases, listCollections with $collStats,
 * getParameter — each with maxTimeMS so the server stops it within the
 * job's budget. The catalog's typed values are data in the command
 * documents (a database name is compared as a $literal, never read as a
 * field path), never code.
 *
 * Operation listings leave out the agent's own operations (its appName)
 * and print each operation's command as a query SHAPE: keys kept, the
 * collection kept, every value "?" — a filter's values are customers'
 * data.
 *
 * The one write, cancel-query (killOp), first looks up the agent's own
 * connection (hello's connectionId) and the target operation, and never
 * kills an operation of the agent's own connection or appName, an internal
 * operation (one that is not a client connection's, desc "conn..."), an
 * idle one or one that is not there. MongoDB has no "end one session"
 * command the catalog offers: terminate-session is not in its catalog.
 */

// How long (at most) any one command may run on the server, by default.
const DEFAULT_MAX_TIME_MS: number = 10_000;

// db table-sizes looks at no more collections than this.
export const MONGO_TABLE_SIZES_MAX_COLLECTIONS: number = 300;

// A serverStatus section larger than this is left out of the overview.
export const MONGO_INFO_OVERVIEW_SECTION_CHARS: number = 2_048;

// Client operations run on a connection thread: desc "conn123".
const CLIENT_OPERATION_DESC: RegExp = /^conn\d+$/;

/*
 * MongoDB's generic command arguments: `db settings maxTimeMS` would set
 * the getParameter command's own option instead of naming a parameter.
 */
const GENERIC_COMMAND_ARGUMENTS: ReadonlyArray<string> = [
  "apiDeprecationErrors",
  "apiStrict",
  "apiVersion",
  "autocommit",
  "comment",
  "getParameter",
  "lsid",
  "maxTimeMS",
  "maxTimeMSOpOnly",
  "readConcern",
  "readPreference",
  "startTransaction",
  "txnNumber",
  "writeConcern",
];

// What serverStatus sends besides its sections.
const REPLY_METADATA_KEYS: ReadonlyArray<string> = [
  "ok",
  "$clusterTime",
  "operationTime",
  "$configTime",
  "$topologyTime",
  "lastCommittedOpTime",
];

const OPERATION_PROJECTION: Record<string, number> = {
  opid: 1,
  type: 1,
  active: 1,
  secs_running: 1,
  op: 1,
  ns: 1,
  desc: 1,
  client: 1,
  appName: 1,
  effectiveUsers: 1,
  waitingForLock: 1,
  planSummary: 1,
  command: 1,
  connectionId: 1,
  locks: 1,
  transaction: 1,
};

const OPERATION_COLUMNS: Array<OutputColumn> = [
  { key: "opid" },
  { key: "active" },
  { key: "secs_running", header: "secs" },
  { key: "op" },
  { key: "ns" },
  { key: "client" },
  { key: "appName", header: "app" },
  { key: "user" },
  { key: "waitingForLock", header: "waiting_for_lock" },
  { key: "desc" },
  { key: "command", kind: "json" },
];

function maxTime(run: DiagnosticRun | null): number {
  return run
    ? Math.max(1, Math.floor(run.statementTimeoutMs))
    : DEFAULT_MAX_TIME_MS;
}

function adminCommand(
  connection: MongoConnection,
  command: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return connection.command("admin", command);
}

/*
 * hello (MongoDB 4.4.2+), or isMaster on an older server, which answers
 * the same fields (ismaster instead of isWritablePrimary).
 */
async function hello(
  connection: MongoConnection,
): Promise<Record<string, unknown>> {
  try {
    return await adminCommand(connection, { hello: 1 });
  } catch (err: unknown) {
    // 59 CommandNotFound
    if (errorNumber(err, "code") !== 59) {
      throw err;
    }

    const reply: Record<string, unknown> = await adminCommand(connection, {
      isMaster: 1,
    });

    return { ...reply, isWritablePrimary: reply["ismaster"] };
  }
}

function firstBatch(
  reply: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const cursor: unknown = reply["cursor"];
  const batch: unknown =
    cursor && typeof cursor === "object"
      ? (cursor as Record<string, unknown>)["firstBatch"]
      : null;

  return Array.isArray(batch)
    ? batch.filter((entry: unknown): entry is Record<string, unknown> => {
        return Boolean(entry) && typeof entry === "object";
      })
    : [];
}

// An EJSON date ({"$date": iso | millis | {"$numberLong"}}) or ISO string, as a Date.
export function readMongoDate(value: unknown): Date | null {
  let raw: unknown = value;

  if (
    raw &&
    typeof raw === "object" &&
    "$date" in (raw as Record<string, unknown>)
  ) {
    raw = (raw as Record<string, unknown>)["$date"];

    if (
      raw &&
      typeof raw === "object" &&
      "$numberLong" in (raw as Record<string, unknown>)
    ) {
      raw = Number((raw as Record<string, unknown>)["$numberLong"]);
    }
  }

  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  const date: Date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "user@db" of an operation's first effective user.
function operationUser(operation: Record<string, unknown>): string | null {
  const users: unknown = operation["effectiveUsers"];

  if (!Array.isArray(users) || !users[0] || typeof users[0] !== "object") {
    return null;
  }

  const first: Record<string, unknown> = users[0] as Record<string, unknown>;
  return `${String(first["user"] ?? "")}@${String(first["db"] ?? "")}`;
}

// An operation as a row: its user joined, its command reduced to a shape.
function operationRow(
  operation: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...operation,
    user: operationUser(operation),
    command:
      operation["command"] === undefined
        ? null
        : mongoCommandShape(operation["command"]),
  };
}

/*
 * The $currentOp aggregation on admin: `match` narrows it, the agent's own
 * operations never show, `limit` + 1 rows come back.
 */
async function currentOps(
  connection: MongoConnection,
  data: {
    idleConnections: boolean;
    match: Record<string, unknown>;
    sort: Record<string, number>;
    limit: number;
    maxTimeMS: number;
    project?: Record<string, number> | undefined;
  },
): Promise<Array<Record<string, unknown>>> {
  const reply: Record<string, unknown> = await adminCommand(connection, {
    aggregate: 1,
    pipeline: [
      {
        $currentOp: {
          allUsers: true,
          idleConnections: data.idleConnections,
        },
      },
      {
        $match: {
          ...data.match,
          appName: { $ne: DATABASE_AI_AGENT_APPLICATION_NAME },
        },
      },
      { $sort: data.sort },
      { $limit: data.limit },
      { $project: data.project || OPERATION_PROJECTION },
    ],
    cursor: { batchSize: data.limit },
    maxTimeMS: data.maxTimeMS,
  });

  return firstBatch(reply);
}

// The $match for db sessions' --state, --user and --database.
export function buildSessionMatch(data: {
  state: string | null;
  user: string | null;
  database: string | null;
}): Record<string, unknown> {
  const match: Record<string, unknown> = {};

  if (data.state === "active") {
    match["active"] = true;
  } else if (data.state === "idle") {
    match["active"] = false;
  } else if (data.state === "idle-in-transaction") {
    match["active"] = false;
    match["transaction"] = { $exists: true };
  }

  if (data.user !== null) {
    match["effectiveUsers.user"] = data.user;
  }

  if (data.database !== null) {
    // The namespace's database part, compared as a literal (never a $field path).
    match["$expr"] = {
      $eq: [
        {
          $arrayElemAt: [{ $split: [{ $ifNull: ["$ns", ""] }, "."] }, 0],
        },
        { $literal: data.database },
      ],
    };
  }

  return match;
}

// ---- Reads ----------------------------------------------------------------------------

async function runRead(
  connection: MongoConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const command: DiagnosticRun["command"] = run.command;
  const limit: number = flagInteger(
    command,
    "limit",
    DATABASE_DEFAULT_ROW_LIMIT,
  );
  const more: string = `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`;

  switch (command.operation.name) {
    case "ping": {
      await adminCommand(connection, { ping: 1 });

      return ok([
        {
          kind: "fields",
          fields: [{ name: "status", value: "ok (MongoDB answered ping)" }],
        },
      ]);
    }

    case "version": {
      const build: Record<string, unknown> = await adminCommand(connection, {
        buildInfo: 1,
      });
      const role: Record<string, unknown> = await hello(connection);

      return ok([
        {
          kind: "fields",
          fields: [
            { name: "version", value: build["version"] },
            { name: "gitVersion", value: build["gitVersion"] },
            { name: "modules", value: build["modules"] },
            { name: "allocator", value: build["allocator"] },
            { name: "bits", value: build["bits"] },
            { name: "setName", value: role["setName"] },
            { name: "isWritablePrimary", value: role["isWritablePrimary"] },
            { name: "secondary", value: role["secondary"] },
            { name: "msg", value: role["msg"] },
          ],
        },
      ]);
    }

    case "sessions": {
      const state: string | null = flagString(command, "state");
      const rows: Array<Record<string, unknown>> = await currentOps(
        connection,
        {
          idleConnections: state === "idle" || state === "idle-in-transaction",
          match: buildSessionMatch({
            state,
            user: flagString(command, "user"),
            database: flagString(command, "database"),
          }),
          sort: { active: -1, secs_running: -1, opid: 1 },
          limit: limit + 1,
          maxTimeMS: maxTime(run),
        },
      );
      const limited: {
        rows: Array<Record<string, unknown>>;
        note: OutputSection | null;
      } = limitRows(
        rows.map(operationRow),
        limit,
        `${more} Or narrow with --state, --user or --database.`,
      );

      return ok([
        {
          kind: "table",
          columns: OPERATION_COLUMNS,
          rows: limited.rows,
          emptyText: state
            ? "No operations match (the agent's own are not listed)."
            : "No operation is running (the agent's own are not listed; --state idle lists idle connections).",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "long-queries": {
      const minSeconds: number = flagInteger(command, "min-seconds", 5);
      const rows: Array<Record<string, unknown>> = await currentOps(
        connection,
        {
          idleConnections: false,
          match: { active: true, secs_running: { $gte: minSeconds } },
          sort: { secs_running: -1, opid: 1 },
          limit: limit + 1,
          maxTimeMS: maxTime(run),
        },
      );
      const limited: {
        rows: Array<Record<string, unknown>>;
        note: OutputSection | null;
      } = limitRows(
        rows.map(operationRow),
        limit,
        `${more} Or raise --min-seconds.`,
      );

      return ok([
        {
          kind: "table",
          columns: OPERATION_COLUMNS,
          rows: limited.rows,
          emptyText: `No operation has been running for ${minSeconds} seconds or more.`,
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "blocking": {
      const rows: Array<Record<string, unknown>> = await currentOps(
        connection,
        {
          idleConnections: false,
          match: { waitingForLock: true },
          sort: { secs_running: -1, opid: 1 },
          limit: limit + 1,
          maxTimeMS: maxTime(run),
        },
      );
      const limited: {
        rows: Array<Record<string, unknown>>;
        note: OutputSection | null;
      } = limitRows(rows.map(operationRow), limit, more);

      return ok([
        {
          kind: "records",
          title:
            "Operations waiting for a lock (MongoDB does not name the holder: db locks lists who holds what)",
          columns: [
            { key: "opid" },
            { key: "secs_running" },
            { key: "op" },
            { key: "ns" },
            { key: "client" },
            { key: "appName" },
            { key: "user" },
            { key: "desc" },
            { key: "locks", kind: "json" },
            { key: "command", kind: "json" },
          ],
          rows: limited.rows,
          emptyText: "No operation is waiting for a lock.",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "locks": {
      const rows: Array<Record<string, unknown>> = await currentOps(
        connection,
        {
          idleConnections: false,
          match: { locks: { $exists: true, $ne: {} } },
          sort: { waitingForLock: -1, secs_running: -1, opid: 1 },
          limit: limit + 1,
          maxTimeMS: maxTime(run),
        },
      );
      const limited: {
        rows: Array<Record<string, unknown>>;
        note: OutputSection | null;
      } = limitRows(rows.map(operationRow), limit, more);

      return ok([
        {
          kind: "table",
          columns: [
            { key: "opid" },
            { key: "active" },
            { key: "secs_running", header: "secs" },
            { key: "op" },
            { key: "ns" },
            { key: "waitingForLock", header: "waiting_for_lock" },
            { key: "desc" },
            { key: "locks", kind: "json" },
          ],
          rows: limited.rows,
          emptyText: "No operation holds or awaits a lock.",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "replication":
      return runReplication(connection, run);

    case "connections": {
      const status: Record<string, unknown> = await adminCommand(connection, {
        serverStatus: 1,
        maxTimeMS: maxTime(run),
      });
      const groups: Array<Record<string, unknown>> = firstBatch(
        await adminCommand(connection, {
          aggregate: 1,
          pipeline: [
            { $currentOp: { allUsers: true, idleConnections: true } },
            { $match: { connectionId: { $exists: true } } },
            {
              $group: {
                _id: {
                  app: { $ifNull: ["$appName", ""] },
                  user: {
                    $ifNull: [
                      { $arrayElemAt: ["$effectiveUsers.user", 0] },
                      "",
                    ],
                  },
                },
                connectionIds: { $addToSet: "$connectionId" },
                active: { $sum: { $cond: ["$active", 1, 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                app: "$_id.app",
                user: "$_id.user",
                connections: { $size: "$connectionIds" },
                active: 1,
              },
            },
            { $sort: { connections: -1, app: 1 } },
            { $limit: DATABASE_MAX_ROW_LIMIT },
          ],
          cursor: { batchSize: DATABASE_MAX_ROW_LIMIT },
          maxTimeMS: maxTime(run),
        }),
      );
      const connections: Record<string, unknown> =
        status["connections"] && typeof status["connections"] === "object"
          ? (status["connections"] as Record<string, unknown>)
          : {};

      return ok([
        {
          kind: "fields",
          fields: Object.entries(connections).map(
            ([name, value]: [string, unknown]): {
              name: string;
              value: unknown;
            } => {
              return { name, value };
            },
          ),
        },
        {
          kind: "table",
          title: "Connections by application and user ($currentOp)",
          columns: [
            { key: "app" },
            { key: "user" },
            { key: "connections" },
            { key: "active" },
          ],
          rows: groups,
        },
      ]);
    }

    case "database-sizes": {
      const reply: Record<string, unknown> = await adminCommand(connection, {
        listDatabases: 1,
        maxTimeMS: maxTime(run),
      });
      const databases: Array<Record<string, unknown>> = (
        Array.isArray(reply["databases"]) ? reply["databases"] : []
      )
        .filter((entry: unknown): entry is Record<string, unknown> => {
          return Boolean(entry) && typeof entry === "object";
        })
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>): number => {
            return (
              (toNumber(b["sizeOnDisk"]) ?? 0) -
              (toNumber(a["sizeOnDisk"]) ?? 0)
            );
          },
        );
      const limited: {
        rows: Array<Record<string, unknown>>;
        note: OutputSection | null;
      } = limitRows(databases, DATABASE_MAX_ROW_LIMIT, "");

      return ok([
        {
          kind: "table",
          columns: [
            { key: "name", header: "database" },
            { key: "size" },
            { key: "sizeOnDisk", header: "size_bytes" },
            { key: "empty" },
          ],
          rows: limited.rows.map(
            (row: Record<string, unknown>): Record<string, unknown> => {
              return { ...row, size: formatBytes(row["sizeOnDisk"]) };
            },
          ),
        },
        ...(limited.note ? [limited.note] : []),
        {
          kind: "note",
          text: `Total size on disk: ${formatBytes(reply["totalSize"]) || "unknown"}.`,
        },
      ]);
    }

    case "table-sizes":
      return runCollectionSizes(connection, run, limit);

    case "settings":
      return runSettings(connection, argumentString(command));

    case "info":
      return runInfo(connection, run, argumentString(command));

    case "memory": {
      const status: Record<string, unknown> = await adminCommand(connection, {
        serverStatus: 1,
        maxTimeMS: maxTime(run),
      });
      const mem: Record<string, unknown> = objectAt(status, "mem");
      const cache: Record<string, unknown> = objectAt(
        objectAt(status, "wiredTiger"),
        "cache",
      );
      const tcmalloc: Record<string, unknown> = objectAt(
        objectAt(status, "tcmalloc"),
        "generic",
      );
      const cacheFields: Array<string> = [
        "maximum bytes configured",
        "bytes currently in the cache",
        "tracked dirty bytes in the cache",
        "bytes read into cache",
        "bytes written from cache",
        "pages evicted by application threads",
        "pages read into cache",
        "pages written from cache",
      ];

      return ok([
        {
          kind: "fields",
          title: "Process memory (MiB)",
          fields: Object.entries(mem).map(
            ([name, value]: [string, unknown]): {
              name: string;
              value: unknown;
            } => {
              return { name, value };
            },
          ),
        },
        {
          kind: "fields",
          title: "WiredTiger cache",
          fields: cacheFields
            .filter((name: string): boolean => {
              return cache[name] !== undefined;
            })
            .map((name: string): { name: string; value: unknown } => {
              return { name, value: cache[name] };
            }),
        },
        {
          kind: "fields",
          title: "Allocator",
          fields: Object.entries(tcmalloc).map(
            ([name, value]: [string, unknown]): {
              name: string;
              value: unknown;
            } => {
              return { name, value };
            },
          ),
        },
      ]);
    }

    default:
      return failed(
        `db ${command.operation.name} is not available on MongoDB.`,
      );
  }
}

function objectAt(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value: unknown = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function runReplication(
  connection: MongoConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  let status: Record<string, unknown>;

  try {
    status = await adminCommand(connection, {
      replSetGetStatus: 1,
      maxTimeMS: maxTime(run),
    });
  } catch (err: unknown) {
    const code: number | null = errorNumber(err, "code");

    // 76 NoReplicationEnabled, 94 NotYetInitialized, 59 on a mongos.
    if (code === 76 || code === 94 || code === 59) {
      return ok([
        {
          kind: "note",
          text: `This server is not a replica set member with replication running (${errorMessage(err)}).`,
        },
      ]);
    }

    throw err;
  }

  const members: Array<Record<string, unknown>> = (
    Array.isArray(status["members"]) ? status["members"] : []
  ).filter((entry: unknown): entry is Record<string, unknown> => {
    return Boolean(entry) && typeof entry === "object";
  });
  const primary: Record<string, unknown> | undefined = members.find(
    (member: Record<string, unknown>): boolean => {
      return member["stateStr"] === "PRIMARY";
    },
  );
  const primaryOptime: Date | null = primary
    ? readMongoDate(primary["optimeDate"])
    : null;

  return ok([
    {
      kind: "fields",
      fields: [
        { name: "set", value: status["set"] },
        { name: "myState", value: status["myState"] },
        { name: "term", value: status["term"] },
        { name: "date", value: readMongoDate(status["date"]) },
      ],
    },
    {
      kind: "table",
      title: "Members",
      columns: [
        { key: "name" },
        { key: "stateStr", header: "state" },
        { key: "health" },
        { key: "uptime" },
        { key: "optime" },
        { key: "lag_seconds" },
        { key: "syncSourceHost", header: "sync_source" },
        { key: "pingMs" },
        { key: "lastHeartbeatMessage", header: "last_heartbeat_message" },
      ],
      rows: members.map(
        (member: Record<string, unknown>): Record<string, unknown> => {
          const optime: Date | null = readMongoDate(member["optimeDate"]);

          return {
            ...member,
            optime,
            lag_seconds:
              optime && primaryOptime
                ? Math.max(
                    0,
                    Math.round(
                      (primaryOptime.getTime() - optime.getTime()) / 1000,
                    ),
                  )
                : null,
          };
        },
      ),
    },
  ]);
}

async function runCollectionSizes(
  connection: MongoConnection,
  run: DiagnosticRun,
  limit: number,
): Promise<DiagnosticOutcome> {
  const database: string | null = flagString(run.command, "database");

  if (database === null) {
    return failed(
      "db table-sizes on MongoDB needs --database NAME (db database-sizes lists them).",
    );
  }

  const listed: Record<string, unknown> = await connection.command(database, {
    listCollections: 1,
    nameOnly: true,
    authorizedCollections: true,
    filter: { type: "collection" },
    cursor: { batchSize: MONGO_TABLE_SIZES_MAX_COLLECTIONS + 1 },
    maxTimeMS: maxTime(run),
  });
  const names: Array<string> = firstBatch(listed)
    .map((entry: Record<string, unknown>): string => {
      return typeof entry["name"] === "string" ? entry["name"] : "";
    })
    .filter((name: string): boolean => {
      return Boolean(name) && !name.startsWith("system.");
    })
    .sort();
  const considered: Array<string> = names.slice(
    0,
    MONGO_TABLE_SIZES_MAX_COLLECTIONS,
  );
  const rows: Array<Record<string, unknown>> = [];

  for (const name of considered) {
    let reply: Record<string, unknown>;

    try {
      reply = await connection.command(database, {
        aggregate: name,
        pipeline: [{ $collStats: { storageStats: {} } }],
        cursor: {},
        maxTimeMS: maxTime(run),
      });
    } catch (err: unknown) {
      // 26 NamespaceNotFound: dropped since it was listed.
      if (errorNumber(err, "code") === 26) {
        continue;
      }

      throw err;
    }

    const stats: Record<string, unknown> = objectAt(
      firstBatch(reply)[0] || {},
      "storageStats",
    );
    const storage: number = toNumber(stats["storageSize"]) ?? 0;
    const indexes: number = toNumber(stats["totalIndexSize"]) ?? 0;

    rows.push({
      collection: name,
      total_bytes: storage + indexes,
      total: formatBytes(storage + indexes),
      storage: formatBytes(storage),
      indexes: formatBytes(indexes),
      data: formatBytes(stats["size"]),
      documents: stats["count"],
    });
  }

  rows.sort(
    (a: Record<string, unknown>, b: Record<string, unknown>): number => {
      return (
        (toNumber(b["total_bytes"]) ?? 0) - (toNumber(a["total_bytes"]) ?? 0)
      );
    },
  );

  const limited: {
    rows: Array<Record<string, unknown>>;
    note: OutputSection | null;
  } = limitRows(
    rows,
    limit,
    `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`,
  );

  return ok([
    {
      kind: "table",
      title: `Largest collections in ${database}`,
      columns: [
        { key: "collection" },
        { key: "total" },
        { key: "storage" },
        { key: "indexes" },
        { key: "data" },
        { key: "documents" },
      ],
      rows: limited.rows,
      emptyText: `Database ${database} has no collections this login can see.`,
    },
    ...(limited.note ? [limited.note] : []),
    ...(names.length > considered.length
      ? [
          {
            kind: "note" as const,
            text: `Only the first ${considered.length} of ${names.length} collections (by name) were measured.`,
          },
        ]
      : []),
  ]);
}

async function runSettings(
  connection: MongoConnection,
  name: string | null,
): Promise<DiagnosticOutcome> {
  if (name !== null && GENERIC_COMMAND_ARGUMENTS.includes(name)) {
    return failed(
      `"${name}" is an option of every MongoDB command, not a server parameter.`,
    );
  }

  let reply: Record<string, unknown>;

  try {
    reply = await adminCommand(
      connection,
      name === null ? { getParameter: "*" } : { getParameter: 1, [name]: 1 },
    );
  } catch (err: unknown) {
    // 72 InvalidOptions: "no option found to get".
    if (name !== null && errorNumber(err, "code") === 72) {
      return failed(
        `MongoDB has no parameter named "${name}" (db settings with no name prints every one).`,
      );
    }

    throw err;
  }

  const parameters: Array<[string, unknown]> = Object.entries(reply)
    .filter(([key]: [string, unknown]): boolean => {
      return !REPLY_METADATA_KEYS.includes(key);
    })
    .sort((a: [string, unknown], b: [string, unknown]): number => {
      return a[0].localeCompare(b[0]);
    });
  const shown: Array<[string, unknown]> = parameters.filter(
    ([key]: [string, unknown]): boolean => {
      return !isDatabaseCredentialSettingName(key);
    },
  );

  if (name !== null) {
    const found: [string, unknown] | undefined = shown[0];

    if (!found) {
      return failed(`MongoDB has no parameter named "${name}".`);
    }

    return ok([
      {
        kind: "fields",
        fields: [
          { name: "name", value: found[0] },
          { name: "value", value: found[1] },
        ],
      },
    ]);
  }

  return ok([
    {
      kind: "table",
      columns: [{ key: "name" }, { key: "value", kind: "json" }],
      rows: shown.map(
        ([key, value]: [string, unknown]): Record<string, unknown> => {
          return { name: key, value };
        },
      ),
    },
    {
      kind: "note",
      text: `${parameters.length - shown.length} credential parameter(s) are not shown.`,
    },
  ]);
}

async function runInfo(
  connection: MongoConnection,
  run: DiagnosticRun,
  section: string | null,
): Promise<DiagnosticOutcome> {
  const status: Record<string, unknown> = await adminCommand(connection, {
    serverStatus: 1,
    maxTimeMS: maxTime(run),
  });

  if (section !== null) {
    if (status[section] === undefined) {
      return failed(
        `serverStatus on this server has no section "${section}" (db info with no section lists the ones it has).`,
      );
    }

    return ok([{ kind: "json", title: section, value: status[section] }]);
  }

  const overview: Record<string, unknown> = {};
  const omitted: Array<string> = [];

  for (const [key, value] of Object.entries(status)) {
    if (REPLY_METADATA_KEYS.includes(key)) {
      continue;
    }

    if (safeJson(value).length <= MONGO_INFO_OVERVIEW_SECTION_CHARS) {
      overview[key] = value;
    } else {
      omitted.push(key);
    }
  }

  return ok([
    { kind: "json", title: "serverStatus (overview)", value: overview },
    ...(omitted.length
      ? [
          {
            kind: "note" as const,
            text: `Left out of the overview for size: ${omitted.join(", ")}. db info SECTION prints one of them.`,
          },
        ]
      : []),
  ]);
}

// ---- The write ------------------------------------------------------------------------

async function runKillOp(
  connection: MongoConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const opid: number | null = sessionIdOf(run.command);

  if (opid === null) {
    return refusedByAgent(
      `"${String(run.command.argument)}" is not a MongoDB operation id.`,
    );
  }

  const own: Record<string, unknown> = await hello(connection);
  const ownConnectionId: number | null = toNumber(own["connectionId"]);

  // Every operation, the agent's own included, to recognise them.
  const reply: Record<string, unknown> = await adminCommand(connection, {
    aggregate: 1,
    pipeline: [
      { $currentOp: { allUsers: true, idleConnections: true } },
      { $match: { opid } },
      { $limit: 1 },
      { $project: OPERATION_PROJECTION },
    ],
    cursor: { batchSize: 1 },
    maxTimeMS: maxTime(run),
  });
  const target: Record<string, unknown> | undefined = firstBatch(reply)[0];

  if (!target) {
    return notRun(
      `MongoDB has no operation ${opid} (it may have finished already). Run db sessions to see the current ones; nothing was changed.`,
    );
  }

  if (
    target["appName"] === DATABASE_AI_AGENT_APPLICATION_NAME ||
    (ownConnectionId !== null &&
      toNumber(target["connectionId"]) === ownConnectionId)
  ) {
    return refusedByAgent(
      `operation ${opid} belongs to the Database AI agent's own connection (session:${opid}); it never kills its own operations.`,
    );
  }

  const desc: string = typeof target["desc"] === "string" ? target["desc"] : "";

  if (!CLIENT_OPERATION_DESC.test(desc)) {
    return refusedByAgent(
      `operation ${opid} is an internal MongoDB operation (${desc || "no client connection"}), not a client's: db cancel-query only kills client operations.`,
    );
  }

  if (target["active"] !== true) {
    return notRun(
      `Operation ${opid} is not running (its connection is idle): there is nothing to cancel, so nothing was changed.`,
    );
  }

  await adminCommand(connection, { killOp: 1, op: opid });

  const targetSection: OutputSection = {
    kind: "fields",
    title: "The operation, before",
    fields: [
      { name: "opid", value: target["opid"] },
      { name: "op", value: target["op"] },
      { name: "ns", value: target["ns"] },
      { name: "secs_running", value: target["secs_running"] },
      { name: "client", value: target["client"] },
      { name: "appName", value: target["appName"] },
      { name: "user", value: operationUser(target) },
      {
        name: "command",
        value: safeJson(mongoCommandShape(target["command"])),
      },
    ],
  };

  await run.sleep(run.settleMs);

  const after: Array<Record<string, unknown>> = firstBatch(
    await adminCommand(connection, {
      aggregate: 1,
      pipeline: [
        { $currentOp: { allUsers: true } },
        { $match: { opid } },
        { $limit: 1 },
        { $project: { opid: 1, active: 1, killPending: 1 } },
      ],
      cursor: { batchSize: 1 },
      maxTimeMS: maxTime(run),
    }),
  );
  const now: Record<string, unknown> | undefined = after[0];

  return ok([
    {
      kind: "note",
      text: `Asked MongoDB to kill operation ${opid} (killOp). Its connection stays open; the client sees the operation fail.`,
    },
    targetSection,
    {
      kind: "note",
      text: now
        ? `Operation ${opid} is still listed${
            now["killPending"] === true ? " (kill pending)" : ""
          }: it stops at its next interrupt check.`
        : `Operation ${opid} is gone.`,
    },
  ]);
}

export async function runMongoDiagnostic(
  connection: MongoConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  return run.command.operation.name === "cancel-query"
    ? runKillOp(connection, run)
    : runRead(connection, run);
}

export async function probeMongo(
  connection: MongoConnection,
): Promise<EngineProbe> {
  await adminCommand(connection, { ping: 1 });
  const build: Record<string, unknown> = await adminCommand(connection, {
    buildInfo: 1,
  });
  const role: Record<string, unknown> = await hello(connection);
  const version: string | null =
    typeof build["version"] === "string" ? build["version"] : null;

  return {
    toolVersion: version ? `MongoDB ${version}` : "MongoDB",
    details: {
      serverVersion: version,
      replicaSet: typeof role["setName"] === "string" ? role["setName"] : null,
      writablePrimary: role["isWritablePrimary"] === true,
    },
  };
}

// MongoDB's error codes -> what an operator should change.
export function describeMongoError(
  err: unknown,
  data: { username: string; credentialSource: string },
): string | null {
  const code: number | null = errorNumber(err, "code");
  const message: string = errorMessage(err);

  switch (code) {
    case 18:
      return `MongoDB refused the login "${data.username}" (${message}). Check ${data.credentialSource}, and ONEUPTIME_AI_DATABASE_NAME if the user is defined in a database other than admin.`;
    case 13:
      return `The login "${data.username || "(none)"}" lacks a privilege this needs (${message}). Grant it the clusterMonitor role for reads, and a role with the killop action (hostManager, or a custom role on the cluster resource) to cancel operations.`;
    case 50:
      return `MongoDB stopped the command: it ran longer than the command's time budget (${message}).`;
    case 59:
      return `This MongoDB server does not have that command (${message}).`;
    case 11600:
    case 91:
      return `MongoDB is shutting down (${message}).`;
    default:
      return null;
  }
}
