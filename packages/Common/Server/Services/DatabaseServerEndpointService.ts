import DatabaseService from "./DatabaseService";
import DatabaseServerService from "./DatabaseServerService";
import Model from "../../Models/DatabaseModels/DatabaseServerEndpoint";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  parseDatabaseEndpointString,
} from "../../Types/DatabaseServer/DatabaseEndpoint";

/*
 * Who added an endpoint:
 *   - "auto": a telemetry path claimed it (the endpoint an application trace
 *     or a collector reported);
 *   - "workload": container discovery claimed it as a Service name of the
 *     Kubernetes workload the database runs as - released again once the
 *     workload stops producing it;
 *   - "user": a person added it (an alias from the database's Endpoints tab,
 *     or the address typed into the create form of a manually added
 *     database). Discovery never releases or moves a "user" endpoint.
 */
export type DatabaseServerEndpointSource = "auto" | "workload" | "user";

/*
 * The outcome of claimEndpoint. Discovery only ever needs to know whether the
 * endpoint is now this row's, and - when it is not - that some other row
 * already owns it, which is never tie-broken or taken over.
 */
export type DatabaseServerEndpointClaimResult =
  | "claimed"
  | "already-owned-by-this"
  | "owned-by-other";

export interface DatabaseServerEndpointOwner {
  databaseServerId: ObjectID;
  isPrimary: boolean;
  // The endpoint row itself, when it was read (findOwnerByEndpoint reads it).
  endpointId?: ObjectID | undefined;
  source?: string | undefined;
  lastMatchedAt?: Date | undefined;
}

// How much of a rejected value an error message repeats back.
const MAX_ECHOED_VALUE_LENGTH: number = 100;

/*
 * "Last matched" is refreshed at most this often per endpoint: often enough
 * that a stale alias stands out on the Endpoints tab, rarely enough that a
 * busy endpoint costs one write an hour, not one per lookup.
 */
export const ENDPOINT_MATCH_REFRESH_SECONDS: number = 60 * 60;

// "postgresql://", "jdbc:mysql://" - a connection URL rather than host:port.
const URL_SCHEME_PATTERN: RegExp = /^(?:jdbc:)?[a-z][a-z0-9+.-]*:\/\//i;

/*
 * The endpoints a database is reached at. Every endpoint belongs to at most
 * one database per project: the (projectId, endpoint) unique index enforces
 * it, and this service turns a collision into a message naming the database
 * that already owns the endpoint instead of a raw constraint error.
 *
 * Endpoints are stored canonical (formatDatabaseEndpoint), because the
 * telemetry entity key of a database is derived from the endpoint string -
 * a person typing "Orders-DB.internal" must land on the same key ingest
 * computes for `server.address=orders-db.internal`.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A person adding an alias. Root writes (the discovery paths, through
   * claimEndpoint) pass through untouched: they already hold a canonical
   * endpoint and handle ownership themselves.
   *
   * Adding an endpoint is an EDIT of the database it is added to: it decides
   * which traffic that database's pages show and - one owner per endpoint -
   * that no other database can claim it. So the caller must be allowed to
   * edit that very row, label and Owned scopes included. DatabaseService
   * checks the create permission only after this hook, and never scopes a
   * create to the parent row, so both happen here - the create permission
   * FIRST, so a caller without it learns nothing about which databases exist
   * or who owns an endpoint.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.props.isRoot) {
      return { createBy: createBy, carryForward: null };
    }

    const data: Model = createBy.data;

    ModelPermission.checkCreatePermissions(Model, data, createBy.props);

    /*
     * The tenant column is stamped from props.tenantId only after this hook,
     * so read the request tenant first - it is the only project the caller
     * was checked in.
     */
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || data.projectId || undefined;

    if (!projectId) {
      throw new BadDataException(
        "Project ID is required to add a database endpoint.",
      );
    }

    /*
     * The reference arrives as the FK column or as a relation object, and
     * TypeORM persists the relation object's id over the column's. Read both
     * spellings, refuse a payload whose two spellings disagree, and leave the
     * validated column as the only one that can reach the insert.
     */
    const databaseServerId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["databaseServerId", "databaseServer"],
      "database",
    );

    data.setColumnValue("databaseServer", undefined);

    if (!databaseServerId) {
      throw new BadDataException(
        "Select the database this endpoint belongs to.",
      );
    }

    const databaseServer: DatabaseServer | null =
      await this.findEditableDatabaseServer({
        projectId: projectId,
        databaseServerId: databaseServerId,
        props: createBy.props,
      });

    /*
     * One answer for "no such database in this project" and "a database you
     * may not edit", so the refusal is not a way to probe for ids.
     */
    if (!databaseServer) {
      throw new NotAuthorizedException(
        "Database not found, or you do not have permission to edit it. Adding an endpoint to a database needs permission to edit that database.",
      );
    }

    /*
     * Canonicalize with the database's own context: its engine supplies the
     * default port, and for a database discovered on Kubernetes its
     * namespace expands a bare service name and its cluster qualifies a
     * cluster-local name - exactly what ingest does for the pods calling it.
     */
    const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
      data.endpoint,
      {
        system: databaseServer.dbSystem || "",
        kubernetesClusterName:
          databaseServer.kubernetesCluster?.clusterIdentifier,
        kubernetesNamespace: databaseServer.kubernetesNamespace,
      },
    );

    /*
     * The parser treats an out-of-range port as "no port" and would quietly
     * fill in the engine default - right for telemetry, wrong for a value a
     * person typed and expects to be kept.
     */
    if (!endpoint || hasOutOfRangePort(data.endpoint)) {
      throw new BadDataException(
        `${describeRejectedValue(data.endpoint)} is not a valid host[:port] endpoint. Enter a host name or IP address with an optional port (1-65535), for example orders-db.internal:5432. Loopback addresses such as localhost cannot be used, because every application reaches its own.`,
      );
    }

    const formatted: string = formatDatabaseEndpoint(endpoint);

    if (formatted.length > ColumnLength.LongText) {
      throw new BadDataException(
        `This endpoint is too long. Endpoints can be at most ${ColumnLength.LongText} characters.`,
      );
    }

    const owner: DatabaseServerEndpointOwner | null =
      await this.findOwnerByEndpoint(projectId, formatted);

    if (owner) {
      if (owner.databaseServerId.toString() === databaseServerId.toString()) {
        throw new BadDataException(
          `${formatted} is already an endpoint of this database.`,
        );
      }

      throw new BadDataException(
        await getOwnedByOtherDatabaseMessage(formatted, owner, createBy.props),
      );
    }

    data.databaseServerId = databaseServerId;
    data.endpoint = formatted;
    /*
     * Forced, whatever the caller sent: a person only ever adds a removable
     * alias. The primary endpoint is written by whichever path created the
     * database, as root.
     */
    data.source = "user";
    data.isPrimary = false;

    return { createBy: createBy, carryForward: null };
  }

  /*
   * The primary endpoint is what the database was created from; discovery
   * would claim it straight back, and a manually added database would lose
   * the only endpoint its telemetry is keyed by. Aliases can be removed.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (deleteBy.props.isRoot) {
      return { deleteBy: deleteBy, carryForward: null };
    }

    const query: Query<Model> = {
      ...deleteBy.query,
      isPrimary: true,
    };

    // Never answer about rows outside the project the caller was checked in.
    if (deleteBy.props.tenantId) {
      query.projectId = deleteBy.props.tenantId;
    }

    const primaryEndpoints: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        endpoint: true,
      },
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (primaryEndpoints.length > 0) {
      const endpoint: string =
        primaryEndpoints[0]!.endpoint || "The primary endpoint";

      throw new BadDataException(
        `${endpoint} is the primary endpoint of this database and cannot be removed. Add another endpoint as an alias instead, or delete the database.`,
      );
    }

    return { deleteBy: deleteBy, carryForward: null };
  }

  /**
   * The database that owns this canonical (formatDatabaseEndpoint) endpoint
   * in the project, or null when no database lists it.
   */
  @CaptureSpan()
  public async findOwnerByEndpoint(
    projectId: ObjectID,
    formattedEndpoint: string,
  ): Promise<DatabaseServerEndpointOwner | null> {
    const endpoint: string = (formattedEndpoint || "").trim();

    if (!endpoint) {
      return null;
    }

    const row: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        endpoint: endpoint,
      },
      select: {
        _id: true,
        databaseServerId: true,
        isPrimary: true,
        source: true,
        lastMatchedAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!row || !row.databaseServerId) {
      return null;
    }

    return {
      databaseServerId: new ObjectID(row.databaseServerId.toString()),
      isPrimary: Boolean(row.isPrimary),
      endpointId: row._id ? new ObjectID(row._id.toString()) : undefined,
      source: row.source || undefined,
      lastMatchedAt: row.lastMatchedAt || undefined,
    };
  }

  /**
   * Record that telemetry just matched this endpoint to its database: moves
   * lastMatchedAt to now, at most once per ENDPOINT_MATCH_REFRESH_SECONDS
   * (decided from the lastMatchedAt the owner lookup already read, so a
   * fresh endpoint costs nothing). A "workload" endpoint is left alone: its
   * lastMatchedAt says when the workload last produced it, which is what
   * decides whether discovery may release it. Never throws.
   */
  @CaptureSpan()
  public async markEndpointMatched(
    owner: DatabaseServerEndpointOwner | null,
  ): Promise<void> {
    if (!owner || !owner.endpointId || owner.source === "workload") {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    if (
      owner.lastMatchedAt &&
      OneUptimeDate.isAfter(
        owner.lastMatchedAt,
        OneUptimeDate.addRemoveSeconds(now, -ENDPOINT_MATCH_REFRESH_SECONDS),
      )
    ) {
      return;
    }

    try {
      await this.updateColumnsByIdWithoutHooks({
        id: owner.endpointId,
        data: {
          lastMatchedAt: now,
        },
        skipUpdateDateColumn: true,
      });
      owner.lastMatchedAt = now;
    } catch (error) {
      logger.warn(
        `DatabaseServerEndpointService: could not record a match of endpoint ${owner.endpointId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Move lastMatchedAt to `now` on those of `endpoints` this database owns
   * whose lastMatchedAt is empty or older than `staleBefore` - one
   * statement, however many endpoints. The workload path calls it for the
   * aliases a discovery run produced again.
   */
  @CaptureSpan()
  public async refreshMatchedEndpoints(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    endpoints: Array<string>;
    now: Date;
    staleBefore: Date;
  }): Promise<void> {
    if (data.endpoints.length === 0) {
      return;
    }

    await this.getRepository().manager.query(
      `UPDATE "DatabaseServerEndpoint"
      SET "lastMatchedAt" = $1
      WHERE "projectId" = $2
        AND "databaseServerId" = $3
        AND "endpoint" = ANY($4::text[])
        AND ("lastMatchedAt" IS NULL OR "lastMatchedAt" < $5)
        AND "deletedAt" IS NULL`,
      [
        data.now,
        data.projectId.toString(),
        data.databaseServerId.toString(),
        data.endpoints,
        data.staleBefore,
      ],
    );
  }

  /**
   * Hand a discovered endpoint to another database: the workload that now
   * serves it. A compare-and-set on the current owner, and never a "user"
   * endpoint - those only a person moves. The endpoint becomes a "workload"
   * endpoint of its new owner, matched now. True when it moved.
   */
  @CaptureSpan()
  public async transferEndpoint(data: {
    projectId: ObjectID;
    endpointId: ObjectID;
    fromDatabaseServerId: ObjectID;
    toDatabaseServerId: ObjectID;
    isPrimary: boolean;
    now: Date;
  }): Promise<boolean> {
    /*
     * Wrapped in a CTE so the statement is a SELECT: TypeORM answers a bare
     * UPDATE with [rows, rowCount], which would read as "moved" every time.
     */
    const moved: unknown = await this.getRepository().manager.query(
      `WITH "moved" AS (
        UPDATE "DatabaseServerEndpoint"
        SET "databaseServerId" = $1,
          "source" = 'workload',
          "isPrimary" = $2,
          "lastMatchedAt" = $3,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "_id" = $4
          AND "projectId" = $5
          AND "databaseServerId" = $6
          AND COALESCE("source", '') <> 'user'
          AND "deletedAt" IS NULL
        RETURNING "_id"
      )
      SELECT "_id" FROM "moved"`,
      [
        data.toDatabaseServerId.toString(),
        data.isPrimary,
        data.now,
        data.endpointId.toString(),
        data.projectId.toString(),
        data.fromDatabaseServerId.toString(),
      ],
    );

    return Array.isArray(moved) && moved.length > 0;
  }

  /**
   * Release the "workload" endpoints of one database that its workload no
   * longer produces: not in `keepEndpoints` and not matched since
   * `staleBefore` (so one partial discovery run releases nothing). Never the
   * primary endpoint, never an "auto" or "user" one. Returns the endpoints
   * released.
   */
  @CaptureSpan()
  public async releaseUnproducedWorkloadEndpoints(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    keepEndpoints: Array<string>;
    staleBefore: Date;
  }): Promise<Array<string>> {
    // A CTE for the same reason as transferEndpoint: a SELECT's rows come back.
    const released: unknown = await this.getRepository().manager.query(
      `WITH "released" AS (
        DELETE FROM "DatabaseServerEndpoint"
        WHERE "projectId" = $1
          AND "databaseServerId" = $2
          AND "source" = 'workload'
          AND "isPrimary" = false
          AND NOT ("endpoint" = ANY($3::text[]))
          AND ("lastMatchedAt" IS NULL OR "lastMatchedAt" < $4)
        RETURNING "endpoint"
      )
      SELECT "endpoint" FROM "released"`,
      [
        data.projectId.toString(),
        data.databaseServerId.toString(),
        data.keepEndpoints,
        data.staleBefore,
      ],
    );

    if (!Array.isArray(released)) {
      return [];
    }

    return released
      .map((row: unknown): string => {
        const endpoint: unknown = (row as { endpoint?: unknown })?.endpoint;
        return typeof endpoint === "string" ? endpoint : "";
      })
      .filter((endpoint: string): boolean => {
        return endpoint.length > 0;
      });
  }

  // True when the database has a primary endpoint.
  @CaptureSpan()
  public async hasPrimaryEndpoint(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
  }): Promise<boolean> {
    const primary: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        databaseServerId: data.databaseServerId,
        isPrimary: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(primary);
  }

  /**
   * Make a canonical endpoint this database's, as root. Never takes an
   * endpoint away from another database: that answers "owned-by-other" and
   * the caller decides what to do (discovery logs and skips it).
   *
   * Two discovery writers can race to claim the same endpoint. The unique
   * index lets exactly one insert through; the loser re-reads the owner and
   * reports the winner rather than throwing.
   */
  @CaptureSpan()
  public async claimEndpoint(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    endpoint: string;
    isPrimary: boolean;
    source: DatabaseServerEndpointSource;
  }): Promise<DatabaseServerEndpointClaimResult> {
    const endpoint: string = (data.endpoint || "").trim();

    if (!endpoint) {
      throw new BadDataException("Endpoint is required to claim it.");
    }

    const existingOwner: DatabaseServerEndpointOwner | null =
      await this.findOwnerByEndpoint(data.projectId, endpoint);

    if (existingOwner) {
      const result: DatabaseServerEndpointClaimResult = classifyOwner(
        existingOwner,
        data.databaseServerId,
      );

      // Re-reported by the database that owns it: that is a match.
      if (result === "already-owned-by-this") {
        await this.markEndpointMatched(existingOwner);
      }

      return result;
    }

    try {
      const row: Model = new Model();
      row.projectId = data.projectId;
      row.databaseServerId = data.databaseServerId;
      row.endpoint = endpoint;
      row.isPrimary = data.isPrimary;
      row.source = data.source;
      row.lastMatchedAt = OneUptimeDate.getCurrentDate();

      await this.create({
        data: row,
        props: {
          isRoot: true,
        },
      });

      return "claimed";
    } catch (error) {
      const racedOwner: DatabaseServerEndpointOwner | null =
        await this.findOwnerByEndpoint(data.projectId, endpoint);

      if (racedOwner) {
        return classifyOwner(racedOwner, data.databaseServerId);
      }

      // Not a lost race (a foreign key, a dead connection): surface it.
      throw error;
    }
  }

  /**
   * Every endpoint of one database, primary first then alphabetical - the
   * input getDatabaseServerSignalEntityKeys turns into the database's
   * telemetry key set.
   */
  @CaptureSpan()
  public async listEndpoints(
    databaseServerId: ObjectID,
  ): Promise<Array<string>> {
    const rows: Array<Model> = await this.findBy({
      query: {
        databaseServerId: databaseServerId,
      },
      select: {
        _id: true,
        endpoint: true,
        isPrimary: true,
      },
      sort: {
        isPrimary: SortOrder.Descending,
        endpoint: SortOrder.Ascending,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const endpoints: Array<string> = [];

    for (const row of rows) {
      if (row.endpoint && !endpoints.includes(row.endpoint)) {
        endpoints.push(row.endpoint);
      }
    }

    return endpoints;
  }

  /**
   * The database a caller adds an endpoint to, read only if the caller may
   * EDIT it: the update permission check scopes the lookup exactly the way
   * an update of that row would be scoped (project, label-scoped and
   * Owned-scoped grants, block permissions). Null when the row does not
   * exist in the project or the caller may not edit it - deliberately the
   * same answer.
   */
  @CaptureSpan()
  public async findEditableDatabaseServer(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DatabaseServer | null> {
    const editableQuery: Query<DatabaseServer> =
      await ModelPermission.checkUpdateQueryPermissions(
        DatabaseServer,
        {
          _id: data.databaseServerId.toString(),
          projectId: data.projectId,
        },
        {},
        data.props,
      );

    return await DatabaseServerService.findOneBy({
      query: editableQuery,
      select: {
        _id: true,
        dbSystem: true,
        kubernetesNamespace: true,
        kubernetesCluster: {
          clusterIdentifier: true,
        },
      },
      props: {
        isRoot: true,
      },
    });
  }
}

function classifyOwner(
  owner: DatabaseServerEndpointOwner,
  databaseServerId: ObjectID,
): DatabaseServerEndpointClaimResult {
  return owner.databaseServerId.toString() === databaseServerId.toString()
    ? "already-owned-by-this"
    : "owned-by-other";
}

/*
 * "orders-db.internal:5432 already belongs to the database "PostgreSQL
 * orders-db.internal:5432"" - naming the owner is the only way a person can
 * find and fix the conflict. But only a database the caller can READ is
 * named: with label- or Owned-scoped permissions the owner may be a row they
 * are not allowed to see, and then it is just "another database". Without
 * props (a root path) the name is read as root.
 */
export async function getOwnedByOtherDatabaseMessage(
  formattedEndpoint: string,
  owner: DatabaseServerEndpointOwner,
  props?: DatabaseCommonInteractionProps | undefined,
): Promise<string> {
  let ownerName: string = "";

  try {
    ownerName = await DatabaseServerService.getDatabaseServerNameIfReadable({
      databaseServerId: owner.databaseServerId,
      props: props,
    });
  } catch {
    // The name only decorates the message; the refusal stands without it.
  }

  const ownerLabel: string = ownerName
    ? `the database "${ownerName}"`
    : "another database";

  return `${formattedEndpoint} already belongs to ${ownerLabel}. An endpoint can belong to only one database in a project - remove it from that database first.`;
}

/*
 * True when a typed "host:port" (optionally "[v6]:port" and/or "@cluster")
 * names a port outside 1-65535. A bare IPv6 address has no port to check.
 */
export function hasOutOfRangePort(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  let address: string = value.trim();

  // URL forms carry userinfo, not a cluster, after "@".
  if (!URL_SCHEME_PATTERN.test(address)) {
    const atIndex: number = address.lastIndexOf("@");
    if (atIndex >= 0) {
      address = address.substring(0, atIndex);
    }
  } else {
    address = address.replace(URL_SCHEME_PATTERN, "");
    address = address.substring(address.lastIndexOf("@") + 1);
    address = address.split(/[/?#;]/)[0] || "";
  }

  const colonCount: number = (address.match(/:/g) || []).length;
  const match: RegExpMatchArray | null =
    address.startsWith("[") || colonCount === 1
      ? address.match(/:(\d+)$/)
      : null;

  if (!match) {
    return false;
  }

  const port: number = Number(match[1]);

  return !Number.isInteger(port) || port < 1 || port > 65535;
}

function describeRejectedValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "An empty value";
  }

  const trimmed: string = value.trim();

  return `"${
    trimmed.length > MAX_ECHOED_VALUE_LENGTH
      ? `${trimmed.substring(0, MAX_ECHOED_VALUE_LENGTH)}…`
      : trimmed
  }"`;
}

export default new Service();
