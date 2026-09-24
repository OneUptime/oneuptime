import {
  DATABASE_INSTANCE_ATTRIBUTES,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
  buildDatabaseCallerContext,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseCallTarget,
} from "Common/Types/DatabaseServer/DatabaseTelemetryResolver";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { keyForDatabaseEndpoint } from "Common/Utils/Telemetry/EntityKey";

/*
 * The per-ROW half of the Databases product's telemetry selection. The
 * resource-level half (a DB receiver batch carrying the database's own
 * key) lives in OtelIngestBaseService.resolveTelemetryResource; this module
 * handles the rows whose resource is an APPLICATION but which talk to a
 * database:
 *
 *   - every CLIENT span with `db.system.name` / `db.system` (traces), and
 *   - every `db.client.*` datapoint that names a server (metrics),
 *
 * get `keyForDatabaseEndpoint(projectId, endpoint)` appended to their own
 * `entityKeys`, so a database's page can find the queries applications
 * send it with the same `hasAny(entityKeys, keys)` predicate it uses for
 * everything else.
 *
 * Three rules keep this safe on the ingest hot path:
 *
 *   1. It reads the FINAL row — after drop filter, scrub rules and pipeline
 *      — so a scrubbed `server.address` never becomes an identity, and the
 *      key agrees with what the client-span discovery cron later reads back
 *      out of ClickHouse for the same row.
 *   2. It never mutates a shared array. A row's `entityKeys` starts out as
 *      the SAME array object as its resource's TelemetryServiceMetadata
 *      (and so as every sibling row and every exception row of that
 *      resource). Pushing onto it would stamp one span's database onto all
 *      of them; the key is always added by assigning a NEW array.
 *   3. It costs nothing for rows that are not database calls: the check for
 *      a system attribute is two property reads, with no allocation, before
 *      any other work.
 */

type RowAttributes = Record<string, unknown>;

// Bound on one request's memo; past it, rows are resolved without memoizing.
const MAX_MEMO_ENTRIES: number = 10_000;

// `db.client.*` is the OTel semconv namespace for client-side DB metrics.
export const DATABASE_CLIENT_METRIC_PREFIX: string = "db.client.";

/*
 * Every attribute resolveDatabaseCallTarget can read, in one list, so the
 * memo key covers exactly the inputs that decide the answer — including the
 * SQL Server named instance (two instances on one host are two servers).
 */
const DATABASE_CALL_ATTRIBUTES: ReadonlyArray<string> = [
  ...DATABASE_SYSTEM_ATTRIBUTES,
  ...DATABASE_ADDRESS_ATTRIBUTES,
  ...DATABASE_PORT_ATTRIBUTES,
  ...DATABASE_INSTANCE_ATTRIBUTES,
];

/*
 * The calling resource's side of endpoint canonicalization (namespace,
 * cluster, whether it is ephemeral), built at most once per resource block
 * and only when that block actually contains a database call.
 */
export class DatabaseCallerSource {
  private readonly resourceAttributes: RowAttributes;
  private context: DatabaseCallerContext | null = null;
  private fingerprint: string | null = null;

  /*
   * Resource attributes in either spelling: FLAT semconv keys, or the
   * `resource.`-prefixed map every stored row carries (buildDatabaseCallerContext
   * reads both).
   */
  public constructor(resourceAttributes: RowAttributes) {
    this.resourceAttributes =
      resourceAttributes && typeof resourceAttributes === "object"
        ? resourceAttributes
        : {};
  }

  public getContext(): DatabaseCallerContext {
    if (!this.context) {
      this.context = buildDatabaseCallerContext(this.resourceAttributes);
    }
    return this.context;
  }

  /*
   * Every field of the context canonicalization reads, so two callers that
   * could canonicalize one address differently never share a memo slot.
   * `runsInKubernetes` is unset by buildDatabaseCallerContext today (ingest
   * derives it from namespace / cluster), but it changes how a two-label
   * name expands, so it is part of the fingerprint all the same.
   */
  public getFingerprint(): string {
    if (this.fingerprint === null) {
      const context: DatabaseCallerContext = this.getContext();
      this.fingerprint = JSON.stringify([
        context.kubernetesNamespace || "",
        context.kubernetesClusterName || "",
        context.hostName || "",
        context.isEphemeral,
        context.runsInKubernetes === true,
      ]);
    }
    return this.fingerprint;
  }
}

/*
 * One per ingest request. Memoizes "these call attributes from this caller
 * → this key (or none)" for the request's lifetime: a payload of a few
 * thousand spans usually talks to a handful of databases, so the resolver
 * and the SHA-256 behind the key run a handful of times, not once per span.
 */
export default class DatabaseCallEntityKeyResolver {
  private readonly projectId: string;
  private readonly memo: Map<string, string | null> = new Map<
    string,
    string | null
  >();

  public constructor(projectId: ObjectID | string) {
    this.projectId = projectId.toString();
  }

  /*
   * True when the attribute map carries a non-empty `db.system.name` or
   * `db.system`. Zero allocation — safe to call on every row.
   */
  public static hasDatabaseSystem(attributes: unknown): boolean {
    if (!attributes || typeof attributes !== "object") {
      return false;
    }
    const record: RowAttributes = attributes as RowAttributes;
    for (const key of DATABASE_SYSTEM_ATTRIBUTES) {
      const value: unknown = record[key];
      if (value !== undefined && value !== null && value !== "") {
        return true;
      }
    }
    return false;
  }

  public static isDatabaseClientMetricName(name: unknown): boolean {
    return (
      typeof name === "string" && name.startsWith(DATABASE_CLIENT_METRIC_PREFIX)
    );
  }

  /*
   * The database endpoint key for one row's attributes, or null when the row
   * names no identifiable server (no system, no address, a loopback or
   * scrubbed address, …).
   */
  public getEntityKey(
    attributes: unknown,
    caller: DatabaseCallerSource,
  ): string | null {
    if (!DatabaseCallEntityKeyResolver.hasDatabaseSystem(attributes)) {
      return null;
    }

    const record: RowAttributes = attributes as RowAttributes;
    const memoKey: string = this.buildMemoKey(record, caller);

    if (this.memo.has(memoKey)) {
      return this.memo.get(memoKey) ?? null;
    }

    const target: {
      system: string;
      endpoint: DatabaseEndpoint;
      scope: DatabaseEndpointScope;
    } | null = resolveDatabaseCallTarget({
      getAttribute: (key: string): unknown => {
        return record[key];
      },
      caller: caller.getContext(),
    });

    const entityKey: string | null = target
      ? keyForDatabaseEndpoint(this.projectId, target.endpoint)
      : null;

    if (this.memo.size < MAX_MEMO_ENTRIES) {
      this.memo.set(memoKey, entityKey);
    }

    return entityKey;
  }

  /*
   * A CLIENT span row: append its database's key. Returns whether a key was
   * added. Non-client spans and spans without a system attribute return
   * before anything is read beyond `kind` and two attribute lookups.
   */
  public appendToClientSpanRow(
    row: JSONObject,
    caller: DatabaseCallerSource,
  ): boolean {
    if (!row || row["kind"] !== SpanKind.Client) {
      return false;
    }
    return this.appendToRow(row, caller);
  }

  /*
   * A metric row: append its database's key when the (final) metric name is
   * a `db.client.*` metric. Returns whether a key was added.
   */
  public appendToDatabaseClientMetricRow(
    row: JSONObject,
    caller: DatabaseCallerSource,
  ): boolean {
    if (
      !row ||
      !DatabaseCallEntityKeyResolver.isDatabaseClientMetricName(row["name"])
    ) {
      return false;
    }
    return this.appendToRow(row, caller);
  }

  private appendToRow(row: JSONObject, caller: DatabaseCallerSource): boolean {
    const entityKey: string | null = this.getEntityKey(
      row["attributes"],
      caller,
    );

    if (!entityKey) {
      return false;
    }

    const existing: Array<string> = Array.isArray(row["entityKeys"])
      ? (row["entityKeys"] as Array<string>)
      : [];

    if (existing.includes(entityKey)) {
      return false;
    }

    // A NEW array — `existing` is shared with sibling rows (see rule 2).
    row["entityKeys"] = [...existing, entityKey];
    return true;
  }

  private buildMemoKey(
    attributes: RowAttributes,
    caller: DatabaseCallerSource,
  ): string {
    const parts: Array<string> = [caller.getFingerprint()];
    for (const key of DATABASE_CALL_ATTRIBUTES) {
      parts.push(memoToken(attributes[key]));
    }
    return JSON.stringify(parts);
  }
}

/*
 * A type-tagged token per attribute value, so `5432` and `"5432"` or an
 * absent value and an empty string never share a memo slot by accident.
 */
function memoToken(value: unknown): string {
  if (value === undefined || value === null) {
    return "u";
  }
  if (typeof value === "string") {
    return `s${value}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${typeof value === "number" ? "n" : "b"}${String(value)}`;
  }
  // Arrays / maps are never read as a system, address or port.
  return "o";
}
