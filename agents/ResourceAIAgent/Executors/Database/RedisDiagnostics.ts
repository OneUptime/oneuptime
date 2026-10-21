import { RedisConnection } from "./DatabaseDrivers";
import {
  OutputColumn,
  OutputSection,
  limitRows,
  valueToText,
} from "./DatabaseOutput";
import {
  DATABASE_AI_AGENT_APPLICATION_NAME,
  DiagnosticOutcome,
  DiagnosticRun,
  EngineProbe,
  argumentString,
  errorMessage,
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
import { redactRedisCommandArguments } from "../../Common/Utils/AiRemediation/Resource/DatabaseQueryRedactor";

/*
 * The db catalog on Redis and its drop-ins (Valkey, KeyDB, Dragonfly),
 * through ioredis. Every operation is a fixed list of read commands — PING,
 * INFO, CLIENT ID / LIST, CONFIG GET, SLOWLOG GET, MEMORY STATS, DBSIZE —
 * with the catalog's typed values as separate arguments (a setting name, a
 * row count, an INFO section from a fixed list), never a command the model
 * wrote. Redis has no read-only session; the read-only guarantee is that no
 * other command is ever sent.
 *
 * The one write, terminate-session (CLIENT KILL ID <id>), first looks up
 * the agent's own client id (CLIENT ID) and the target (CLIENT LIST ID),
 * and never kills the agent's own connection, another connection of this
 * agent, a replication link (flags M or S) or a client that is not there.
 * Then it looks again, so the output says what the kill did. Redis has no
 * running statement to cancel: cancel-query is not in its catalog.
 *
 * Output: SLOWLOG arguments print as a JSON array, so the output redactor
 * masks AUTH secrets and the values of data-writing commands in place;
 * CONFIG GET never prints a credential setting (requirepass, masterauth,
 * ...), whatever it is asked.
 */

// A client's flags that make it part of replication, not a client session.
const REPLICATION_FLAGS: ReadonlyArray<string> = ["M", "S"];

// What Redis answers, by what it means.
const OLD_SERVER_SYNTAX_PATTERN: RegExp = /syntax|wrong number|unknown/i;
const NOAUTH_PATTERN: RegExp = /^NOAUTH/i;
const WRONG_PASSWORD_PATTERN: RegExp =
  /WRONGPASS|invalid (username-)?password|invalid password/i;
const NOPERM_PATTERN: RegExp = /^NOPERM/i;
const UNKNOWN_COMMAND_PATTERN: RegExp = /unknown (sub)?command/i;
const LOADING_PATTERN: RegExp = /^LOADING/i;

const CLIENT_COLUMNS: Array<OutputColumn> = [
  { key: "id" },
  { key: "addr", header: "address" },
  { key: "name" },
  { key: "user" },
  { key: "db" },
  { key: "age", header: "age_s" },
  { key: "idle", header: "idle_s" },
  { key: "flags" },
  { key: "cmd", header: "last_command" },
];

const VERSION_FIELDS: ReadonlyArray<string> = [
  "server_name",
  "redis_version",
  "valkey_version",
  "dragonfly_version",
  "redis_mode",
  "server_mode",
  "os",
  "arch_bits",
  "tcp_port",
  "uptime_in_seconds",
  "uptime_in_days",
  "executable",
  "config_file",
];

export type RedisInfo = Record<string, Record<string, string>>;

// INFO's text as {section: {field: value}} (sections lowercased).
export function parseRedisInfo(text: unknown): RedisInfo {
  const info: RedisInfo = {};
  let section: string = "default";

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line: string = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("#")) {
      section = line.slice(1).trim().toLowerCase() || "default";
      continue;
    }

    const colon: number = line.indexOf(":");

    if (colon > 0) {
      const fields: Record<string, string> = info[section] || {};
      fields[line.slice(0, colon)] = line.slice(colon + 1);
      info[section] = fields;
    }
  }

  return info;
}

// One field of any section.
function infoField(info: RedisInfo, name: string): string | null {
  for (const fields of Object.values(info)) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      return fields[name] ?? null;
    }
  }

  return null;
}

// CLIENT LIST's text: one client per line, space-separated name=value pairs.
export function parseRedisClientList(
  text: unknown,
): Array<Record<string, string>> {
  const clients: Array<Record<string, string>> = [];

  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const client: Record<string, string> = {};

    for (const pair of line.trim().split(" ")) {
      const equals: number = pair.indexOf("=");

      if (equals > 0) {
        client[pair.slice(0, equals)] = pair.slice(equals + 1);
      }
    }

    if (client["id"]) {
      clients.push(client);
    }
  }

  return clients;
}

// A flat [name, value, name, value, ...] reply (CONFIG GET, MEMORY STATS) as pairs.
export function redisPairs(reply: unknown): Array<[string, unknown]> {
  if (!Array.isArray(reply)) {
    if (reply && typeof reply === "object") {
      return Object.entries(reply as Record<string, unknown>);
    }

    return [];
  }

  const pairs: Array<[string, unknown]> = [];

  for (let index: number = 0; index + 1 < reply.length; index += 2) {
    pairs.push([valueToText(reply[index]), reply[index + 1]]);
  }

  return pairs;
}

// MEMORY STATS' nested replies flattened: "db.0.overhead.hashtable.main".
function flattenPairs(
  reply: unknown,
  prefix: string,
  out: Array<{ name: string; value: unknown }>,
): void {
  for (const [name, value] of redisPairs(reply)) {
    const key: string = prefix ? `${prefix}.${name}` : name;

    if (Array.isArray(value)) {
      flattenPairs(value, key, out);
    } else {
      out.push({ name: key, value });
    }
  }
}

function fieldsOf(
  fields: Record<string, string> | undefined,
): Array<{ name: string; value: unknown }> {
  return Object.entries(fields || {}).map(
    ([name, value]: [string, string]): { name: string; value: unknown } => {
      return { name, value };
    },
  );
}

async function info(
  connection: RedisConnection,
  section: string | null,
): Promise<{ text: string; parsed: RedisInfo }> {
  const reply: unknown = await connection.command(
    "INFO",
    section ? [section] : [],
  );
  const text: string = valueToText(reply);

  return { text, parsed: parseRedisInfo(text) };
}

async function ownClientId(
  connection: RedisConnection,
): Promise<number | null> {
  return toNumber(await connection.command("CLIENT", ["ID"]));
}

async function clientList(
  connection: RedisConnection,
): Promise<Array<Record<string, string>>> {
  return parseRedisClientList(await connection.command("CLIENT", ["LIST"]));
}

// One client by id: CLIENT LIST ID (Redis 6.2+), else the whole list.
async function findClient(
  connection: RedisConnection,
  id: number,
): Promise<Record<string, string> | null> {
  let clients: Array<Record<string, string>>;

  try {
    clients = parseRedisClientList(
      await connection.command("CLIENT", ["LIST", "ID", String(id)]),
    );
  } catch (err: unknown) {
    // An older server without CLIENT LIST ID answers "ERR syntax error".
    if (!OLD_SERVER_SYNTAX_PATTERN.test(errorMessage(err))) {
      throw err;
    }

    clients = await clientList(connection);
  }

  return (
    clients.find((client: Record<string, string>): boolean => {
      return client["id"] === String(id);
    }) || null
  );
}

// ---- Reads ----------------------------------------------------------------------------

async function runRead(
  connection: RedisConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const command: DiagnosticRun["command"] = run.command;
  const serverName: string = run.settings.serverName;

  switch (command.operation.name) {
    case "ping": {
      const reply: unknown = await connection.command("PING", []);

      return ok([
        {
          kind: "fields",
          fields: [
            {
              name: "status",
              value: `ok (${serverName} answered PING with ${valueToText(reply)})`,
            },
          ],
        },
      ]);
    }

    case "version": {
      const server: { parsed: RedisInfo } = await info(connection, "server");
      const fields: Record<string, string> = server.parsed["server"] || {};

      return ok([
        {
          kind: "fields",
          fields: VERSION_FIELDS.filter((name: string): boolean => {
            return fields[name] !== undefined;
          }).map((name: string): { name: string; value: unknown } => {
            return { name, value: fields[name] };
          }),
        },
      ]);
    }

    case "sessions": {
      const limit: number = flagInteger(
        command,
        "limit",
        DATABASE_DEFAULT_ROW_LIMIT,
      );
      const user: string | null = flagString(command, "user");
      const database: string | null = flagString(command, "database");
      const own: number | null = await ownClientId(connection);
      const clients: Array<Record<string, string>> = (
        await clientList(connection)
      )
        .filter((client: Record<string, string>): boolean => {
          return (
            client["id"] !== String(own) &&
            (user === null || client["user"] === user) &&
            (database === null || client["db"] === database)
          );
        })
        .sort(
          (a: Record<string, string>, b: Record<string, string>): number => {
            return (
              (toNumber(a["idle"]) ?? 0) - (toNumber(b["idle"]) ?? 0) ||
              (toNumber(a["id"]) ?? 0) - (toNumber(b["id"]) ?? 0)
            );
          },
        );
      const limited: {
        rows: Array<Record<string, string>>;
        note: OutputSection | null;
      } = limitRows(
        clients,
        limit,
        `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}) or narrow with --user or --database.`,
      );

      return ok([
        {
          kind: "table",
          columns: CLIENT_COLUMNS,
          rows: limited.rows,
          emptyText:
            "No clients match (the agent's own connection is not listed).",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "replication": {
      const replication: { parsed: RedisInfo } = await info(
        connection,
        "replication",
      );

      return ok([
        {
          kind: "fields",
          fields: fieldsOf(replication.parsed["replication"]),
        },
      ]);
    }

    case "connections": {
      const clients: { parsed: RedisInfo } = await info(connection, "clients");
      const fields: Array<{ name: string; value: unknown }> = fieldsOf(
        clients.parsed["clients"],
      );

      if (!infoField(clients.parsed, "maxclients")) {
        // Older servers leave maxclients out of INFO; CONFIG GET has it.
        try {
          const pairs: Array<[string, unknown]> = redisPairs(
            await connection.command("CONFIG", ["GET", "maxclients"]),
          );
          const maxclients: [string, unknown] | undefined = pairs[0];

          if (maxclients) {
            fields.push({ name: "maxclients", value: maxclients[1] });
          }
        } catch {
          fields.push({
            name: "maxclients",
            value: "(unknown: this user may not run CONFIG GET)",
          });
        }
      }

      const groups: Map<string, { user: string; db: string; count: number }> =
        new Map<string, { user: string; db: string; count: number }>();

      for (const client of await clientList(connection)) {
        const key: string = `${client["user"] || ""}\u0000${client["db"] || ""}`;
        const group: { user: string; db: string; count: number } = groups.get(
          key,
        ) || { user: client["user"] || "", db: client["db"] || "", count: 0 };
        group.count++;
        groups.set(key, group);
      }

      const rows: Array<Record<string, unknown>> = Array.from(groups.values())
        .sort(
          (
            a: { user: string; db: string; count: number },
            b: { user: string; db: string; count: number },
          ): number => {
            return b.count - a.count || a.user.localeCompare(b.user);
          },
        )
        .slice(0, DATABASE_MAX_ROW_LIMIT)
        .map(
          (group: {
            user: string;
            db: string;
            count: number;
          }): Record<string, unknown> => {
            return { user: group.user, db: group.db, connections: group.count };
          },
        );

      return ok([
        { kind: "fields", fields },
        {
          kind: "table",
          title: "Clients by user and database",
          columns: [{ key: "user" }, { key: "db" }, { key: "connections" }],
          rows,
        },
      ]);
    }

    case "settings":
      return runSettings(connection, argumentString(command), serverName);

    case "slowlog": {
      const limit: number = flagInteger(command, "limit", 20);
      const reply: unknown = await connection.command("SLOWLOG", [
        "GET",
        String(limit),
      ]);
      const entries: Array<unknown> = Array.isArray(reply) ? reply : [];
      const rows: Array<Record<string, unknown>> = entries.map(
        (entry: unknown): Record<string, unknown> => {
          const fields: Array<unknown> = Array.isArray(entry) ? entry : [];
          const at: number | null = toNumber(fields[1]);
          const micros: number | null = toNumber(fields[2]);

          return {
            id: fields[0],
            time: at === null ? null : new Date(at * 1000).toISOString(),
            duration_ms: micros === null ? null : (micros / 1000).toFixed(3),
            client: fields[4],
            name: fields[5],
            /*
             * AUTH secrets and written values masked HERE, before the table
             * cuts the cell (a value cut open is one the output redactor can
             * no longer see) or --format json encodes the array as a string;
             * as a JSON array, so the redactor masks it again all the same.
             */
            command: Array.isArray(fields[3])
              ? JSON.stringify(
                  redactRedisCommandArguments(fields[3].map(valueToText)),
                )
              : null,
          };
        },
      );

      return ok([
        {
          kind: "table",
          title: "Most recent slow commands (SLOWLOG GET)",
          columns: [
            { key: "id" },
            { key: "time" },
            { key: "duration_ms" },
            { key: "client" },
            { key: "name" },
            { key: "command", kind: "json" },
          ],
          rows,
          emptyText: "The slow log is empty.",
        },
      ]);
    }

    case "info": {
      const section: string | null = argumentString(command);
      const report: { text: string } = await info(connection, section);

      return ok([{ kind: "text", text: report.text }]);
    }

    case "memory": {
      const memory: { text: string; parsed: RedisInfo } = await info(
        connection,
        "memory",
      );
      const sections: Array<OutputSection> = [
        { kind: "fields", fields: fieldsOf(memory.parsed["memory"]) },
      ];

      try {
        const stats: Array<{ name: string; value: unknown }> = [];
        flattenPairs(await connection.command("MEMORY", ["STATS"]), "", stats);
        sections.push({ kind: "fields", title: "MEMORY STATS", fields: stats });
      } catch (err: unknown) {
        sections.push({
          kind: "note",
          text: `MEMORY STATS is not available here (${errorMessage(err)}).`,
        });
      }

      return ok(sections);
    }

    case "keyspace": {
      const keyspace: { parsed: RedisInfo } = await info(
        connection,
        "keyspace",
      );
      const rows: Array<Record<string, unknown>> = Object.entries(
        keyspace.parsed["keyspace"] || {},
      ).map(([db, value]: [string, string]): Record<string, unknown> => {
        const stats: Record<string, string> = {};

        for (const pair of value.split(",")) {
          const equals: number = pair.indexOf("=");

          if (equals > 0) {
            stats[pair.slice(0, equals)] = pair.slice(equals + 1);
          }
        }

        return {
          db,
          keys: stats["keys"],
          expires: stats["expires"],
          avg_ttl_ms: stats["avg_ttl"],
        };
      });
      const size: unknown = await connection.command("DBSIZE", []);

      return ok([
        {
          kind: "table",
          columns: [
            { key: "db" },
            { key: "keys" },
            { key: "expires" },
            { key: "avg_ttl_ms" },
          ],
          rows,
          emptyText: "Every database is empty.",
        },
        {
          kind: "note",
          text: `DBSIZE of db0 (the database the agent connects to): ${valueToText(size)} keys.`,
        },
      ]);
    }

    default:
      return failed(
        `db ${command.operation.name} is not available on ${serverName}.`,
      );
  }
}

async function runSettings(
  connection: RedisConnection,
  name: string | null,
  serverName: string,
): Promise<DiagnosticOutcome> {
  const pairs: Array<[string, unknown]> = redisPairs(
    await connection.command("CONFIG", ["GET", name === null ? "*" : name]),
  );
  const shown: Array<[string, unknown]> = pairs
    .filter(([setting]: [string, unknown]): boolean => {
      return !isDatabaseCredentialSettingName(setting);
    })
    .sort((a: [string, unknown], b: [string, unknown]): number => {
      return a[0].localeCompare(b[0]);
    });

  if (name !== null) {
    const found: [string, unknown] | undefined = shown[0];

    if (!found) {
      return failed(
        `${serverName} has no parameter named "${name}" (db settings with no name prints every one).`,
      );
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
      columns: [{ key: "name" }, { key: "value" }],
      rows: shown.map(
        ([setting, value]: [string, unknown]): Record<string, unknown> => {
          return { name: setting, value };
        },
      ),
    },
    {
      kind: "note",
      text: `${pairs.length - shown.length} credential parameter(s) are not shown.`,
    },
  ]);
}

// ---- The write ------------------------------------------------------------------------

async function runTerminate(
  connection: RedisConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const id: number | null = sessionIdOf(run.command);

  if (id === null) {
    return refusedByAgent(
      `"${String(run.command.argument)}" is not a Redis client id.`,
    );
  }

  const own: number | null = await ownClientId(connection);

  if (own === id) {
    return refusedByAgent(
      `client ${id} is the agent's own connection (session:${id}); it never kills itself.`,
    );
  }

  const target: Record<string, string> | null = await findClient(
    connection,
    id,
  );

  if (!target) {
    return notRun(
      `${run.settings.serverName} has no client with id ${id} (it may have disconnected already). Run db sessions to see the current ones; nothing was changed.`,
    );
  }

  if (target["name"] === DATABASE_AI_AGENT_APPLICATION_NAME) {
    return refusedByAgent(
      `client ${id} is another connection of the Database AI agent (${DATABASE_AI_AGENT_APPLICATION_NAME}); it never kills its own connections.`,
    );
  }

  const flags: string = target["flags"] || "";

  if (
    REPLICATION_FLAGS.some((flag: string): boolean => {
      return flags.includes(flag);
    })
  ) {
    return refusedByAgent(
      `client ${id} is a replication link (flags=${flags}), not a client session: db terminate-session never breaks replication.`,
    );
  }

  const killed: number | null = toNumber(
    await connection.command("CLIENT", ["KILL", "ID", String(id)]),
  );

  const targetSection: OutputSection = {
    kind: "fields",
    title: "The client, before",
    fields: CLIENT_COLUMNS.map(
      (column: OutputColumn): { name: string; value: unknown } => {
        return { name: column.header || column.key, value: target[column.key] };
      },
    ),
  };

  if (!killed) {
    return failed(
      `${run.settings.serverName} disconnected no client: client ${id} ended before the kill arrived.`,
      [targetSection],
    );
  }

  await run.sleep(run.settleMs);

  const after: Record<string, string> | null = await findClient(connection, id);

  return ok([
    {
      kind: "note",
      text: `Disconnected client ${id} (CLIENT KILL ID). A client that reconnects gets a new id.`,
    },
    targetSection,
    {
      kind: "note",
      text: after
        ? `Client ${id} is still listed; ${run.settings.serverName} may take a moment to close it.`
        : `Client ${id} is gone.`,
    },
  ]);
}

export async function runRedisDiagnostic(
  connection: RedisConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  return run.command.operation.name === "terminate-session"
    ? runTerminate(connection, run)
    : runRead(connection, run);
}

export async function probeRedis(
  connection: RedisConnection,
  serverName: string,
): Promise<EngineProbe> {
  await connection.command("PING", []);

  let parsed: RedisInfo = {};

  try {
    parsed = (await info(connection, "server")).parsed;
  } catch {
    // A user without INFO still answers PING: reachable, version unknown.
  }

  const version: string | null =
    infoField(parsed, "valkey_version") ||
    infoField(parsed, "dragonfly_version") ||
    infoField(parsed, "redis_version");

  return {
    toolVersion: version ? `${serverName} ${version}` : serverName,
    details: {
      serverVersion: version,
      redisMode:
        infoField(parsed, "redis_mode") || infoField(parsed, "server_mode"),
    },
  };
}

// A Redis error's words -> what an operator should change.
export function describeRedisError(
  err: unknown,
  data: { username: string; credentialSource: string; serverName: string },
): string | null {
  const message: string = errorMessage(err);

  if (NOAUTH_PATTERN.test(message)) {
    return `${data.serverName} needs a password (${message}). Set ${data.credentialSource}.`;
  }

  if (WRONG_PASSWORD_PATTERN.test(message)) {
    return `${data.serverName} refused the login${
      data.username ? ` "${data.username}"` : ""
    } (${message}). Check ${data.credentialSource}.`;
  }

  if (NOPERM_PATTERN.test(message)) {
    return `The ${data.serverName} user may not run this command (${message}). Allow it in the user's ACL: +ping +info +client|id +client|list +config|get +slowlog|get +memory|stats +dbsize for reads, and +client|kill to end sessions.`;
  }

  if (UNKNOWN_COMMAND_PATTERN.test(message)) {
    return `This ${data.serverName} server does not have that command (${message}).`;
  }

  if (LOADING_PATTERN.test(message)) {
    return `${data.serverName} is loading its dataset into memory and does not answer yet (${message}).`;
  }

  return null;
}
