import DatabaseService from "./DatabaseService";
import DatabaseServerService from "./DatabaseServerService";
import Model from "../../Models/DatabaseModels/DatabaseServerEndpoint";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  parseDatabaseEndpointString,
} from "../../Types/DatabaseServer/DatabaseEndpoint";

/*
 * Who added an endpoint: "auto" when a discovery path claimed it, "user" when
 * a person added it (an alias from the database's Endpoints tab, or the
 * address typed into the create form of a manually added database).
 */
export type DatabaseServerEndpointSource = "auto" | "user";

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
}

// How much of a rejected value an error message repeats back.
const MAX_ECHOED_VALUE_LENGTH: number = 100;

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
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.props.isRoot) {
      return { createBy: createBy, carryForward: null };
    }

    const data: Model = createBy.data;

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

    if (!data.databaseServerId) {
      throw new BadDataException(
        "Select the database this endpoint belongs to.",
      );
    }

    const databaseServerId: ObjectID = new ObjectID(
      data.databaseServerId.toString(),
    );

    const databaseServer: DatabaseServer | null =
      await DatabaseServerService.findOneBy({
        query: {
          _id: databaseServerId.toString(),
          projectId: projectId,
        },
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

    if (!databaseServer) {
      throw new BadDataException("Database not found.");
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
        await getOwnedByOtherDatabaseMessage(formatted, owner),
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
    };
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
      return classifyOwner(existingOwner, data.databaseServerId);
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
   * input getDatabaseServerTelemetryEntityKeys turns into the database's
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
 * find and fix the conflict, and the caller was already checked in this
 * project, so the name is theirs to see.
 */
export async function getOwnedByOtherDatabaseMessage(
  formattedEndpoint: string,
  owner: DatabaseServerEndpointOwner,
): Promise<string> {
  let ownerName: string = "";

  try {
    ownerName = await DatabaseServerService.getDatabaseServerName({
      databaseServerId: owner.databaseServerId,
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
