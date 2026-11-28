import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Probe from "../../../Models/DatabaseModels/Probe";
import AuditLogService from "../../Services/AuditLogService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataSecurityScanService from "../../Services/DataSecurityScanService";
import DataStoreOwnerTeamService from "../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../Services/DataStoreOwnerUserService";
import DataStoreService from "../../Services/DataStoreService";
import DataWarehouseJobService from "../../Services/DataWarehouseJobService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import ProbeService from "../../Services/ProbeService";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import OneUptimeDate from "../../../Types/Date";
import {
  DataObservabilityAgentState,
  DataObservabilityCollector,
  DataObservabilityStoreConnection,
  DataObservabilityStoreRefusal,
  DataObservabilityStoreSettings as StoreSettings,
  DataObservabilityStoreUses,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { OBJECT_STORE_KINDS } from "../../../Types/DataObservability/StoragePaths";
import {
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DatabaseAgentEngine,
  getDatabaseAgentEngineOfSystem,
  isDatabaseAgentDatabaseName,
} from "../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import { isValidProbeConnectionVariable } from "../DataSecurity/DataSecurityProbeScan";
import CallerPermission from "../Permission/CallerPermission";
import DataObservabilityAttentionReader from "./DataObservabilityAttentionReader";
import DataObservabilityDatabaseAgents, {
  DatabaseAgentOfServer,
  getDatabaseAgentEngineOfKind,
} from "./DataObservabilityDatabaseAgents";
import { DATA_OBSERVABILITY_KINDS } from "./DataObservabilityEngines";
import { DATA_OBSERVABILITY_CONNECT_PERMISSIONS } from "./DataObservabilityPermissions";
import { queueTableHealthCollection } from "./DataObservabilityJobs";

/*
 * A DATABASE'S WHOLE LIFE IN DATA OBSERVABILITY (#11147).
 *
 * A database here is Data Security's data store: one row, two products.
 * Data Observability reads it as OneUptime (a store is readable by the
 * Security tiers only) and changes it through its own routes, as Connect a
 * Database always has - so a Data Observability admin manages the
 * databases they connected without being given Data Security, and never
 * takes from Data Security what Data Security relies on:
 *
 *   - Settings read how the database is reached (never its connection
 *     string: only whether one is saved), what else uses it, and what the
 *     caller may change.
 *   - Renaming it renames it in both products.
 *   - Changing how it is reached - a new login, another probe, a Database
 *     Agent - writes what Data Observability reads it with. While Data
 *     Security samples the database's content, it samples with that same
 *     connection, so then only someone who may edit Data Security's stores
 *     changes it, through Data Security's own path (its checks of what it
 *     can scan, its Timeline). A Database Agent never touches that
 *     connection, so it is open to Data Observability's admins either way.
 *   - Remove from Data Observability stops reading the database and
 *     forgets what Data Observability kept of it - its tables, their
 *     checks and history, its warehouse jobs - and Data Security keeps the
 *     store, its connection and everything its scans found. Connecting it
 *     again starts afresh.
 *   - Delete removes it from OneUptime, Data Security's part with it. So
 *     while Data Security relies on it - it found it or someone added it
 *     there, or it holds findings, issues, scans, owners or a record of
 *     processing of it, or samples its content - only someone who may delete
 *     Data Security's stores deletes it, through Data Security's own delete,
 *     with its permissions and labels. A database Data Observability added
 *     that Data Security holds nothing of is Data Observability's to delete.
 *
 * Each change is recorded in the audit log as the person who made it.
 */

// How Data Security names a store connected from Data Observability: it was found here.
export const DATA_OBSERVABILITY_FOUND_FROM: string = "Data Observability";

// How Data Security names a store someone added by hand, there or (before it said so) here.
const ADDED_BY_HAND: string = "Manual";

export const CONNECTION_CHANGE_REFUSAL: string =
  "Data Security samples this database's content with its connection, so only someone who may edit Data Security's data stores can change it. Read it through a Database Agent instead, which leaves Data Security's connection as it is.";

export const DELETE_REFUSAL: string =
  "Data Security relies on this database, so only someone who may delete Data Security's data stores can delete it. Remove it from Data Observability instead, or ask one of them.";

export const NOT_PERMITTED_MESSAGE: string =
  "You do not have permission to do this in Data Observability.";

export const DATABASE_NOT_FOUND_MESSAGE: string = "Database not found.";

// What the settings, and each change, read of a store.
const STORE_SELECT: Select<DataStore> = {
  _id: true,
  projectId: true,
  name: true,
  kind: true,
  discoveredFrom: true,
  createdByUserId: true,
  isTableHealthEnabled: true,
  isContentScanEnabled: true,
  connectionString: true,
  scanProbeId: true,
  scanProbe: { name: true },
  probeConnectionVariable: true,
  cloudConnectionId: true,
  tableHealthDatabaseServerId: true,
  tableHealthDatabaseName: true,
  findingCount: true,
  purpose: true,
  retention: true,
  legalBasis: true,
  dataSubjects: true,
};

/*
 * Who reads a database for Data Observability: a Database Agent when one is
 * chosen (#11148), else the probe the store names, else OneUptime's
 * workers with the store's connection string.
 */
export function getDataObservabilityCollector(store: {
  tableHealthDatabaseServerId?: ObjectID | null | undefined;
  scanProbeId?: ObjectID | null | undefined;
}): DataObservabilityCollector {
  if (store.tableHealthDatabaseServerId) {
    return DataObservabilityCollector.DatabaseAgent;
  }

  return store.scanProbeId
    ? DataObservabilityCollector.Probe
    : DataObservabilityCollector.OneUptime;
}

/*
 * Whether Data Observability added the store: connected from here, or -
 * before connecting said so - added by OneUptime by hand with nobody's
 * name on it. A store someone added in Data Security has its author.
 */
export function isAddedByDataObservability(store: {
  discoveredFrom?: string | null | undefined;
  createdByUserId?: ObjectID | null | undefined;
}): boolean {
  return (
    store.discoveredFrom === DATA_OBSERVABILITY_FOUND_FROM ||
    (store.discoveredFrom === ADDED_BY_HAND && !store.createdByUserId)
  );
}

/*
 * Whether Data Security samples the store's content, and so reads it with
 * its connection: content scanning on, for a kind Data Security samples
 * through a connection of its own (a database the customer runs).
 */
export function isContentSampledThroughConnection(store: {
  kind?: string | null | undefined;
  isContentScanEnabled?: boolean | null | undefined;
}): boolean {
  const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(store.kind);

  return (
    store.isContentScanEnabled === true &&
    Boolean(info?.contentScannable) &&
    info?.provider === DataStoreProvider.SelfManaged
  );
}

// Whether Data Security relies on the store: it found or added it, samples it, or holds something of it.
export function isDataSecurityRelyingOn(
  store: Pick<DataStore, "discoveredFrom" | "createdByUserId">,
  uses: DataObservabilityStoreUses,
): boolean {
  return (
    !isAddedByDataObservability(store) ||
    uses.isContentScanned ||
    uses.findingCount > 0 ||
    uses.issueCount > 0 ||
    uses.scanCount > 0 ||
    uses.ownerCount > 0 ||
    uses.hasRecordOfProcessing
  );
}

function mayConnect(props: DatabaseCommonInteractionProps): boolean {
  return (
    Boolean(props.isRoot) ||
    Boolean(props.isMasterAdmin) ||
    CallerPermission.holdsAnyOf(props, DATA_OBSERVABILITY_CONNECT_PERMISSIONS)
  );
}

// What a record's update or delete check answers with when it says no.
const REFUSAL_CODES: ReadonlyArray<ExceptionCode> = [
  ExceptionCode.NotAuthorizedException,
  ExceptionCode.NotAuthenticatedException,
  ExceptionCode.ForbiddenException,
  ExceptionCode.PaymentRequiredException,
  ExceptionCode.NotFoundException,
];

/*
 * Whether the caller may change, or delete, this data store as Data
 * Security's: decided on the store's own row, as an update or a delete of
 * it through the API is (DatabaseService.findOneUpdatableById and
 * findOneDeletableById) - the table's permissions, a team's block on one
 * of the store's labels, a grant limited to labels or to what is owned.
 * Holding the permission for some stores is no permission for this one
 * (TableHalfWriteGuard).
 */
async function mayDataSecurity(
  props: DatabaseCommonInteractionProps,
  dataStoreId: ObjectID,
  operation: "update" | "delete",
): Promise<boolean> {
  if (props.isRoot || props.isMasterAdmin) {
    return true;
  }

  try {
    const store: DataStore | null =
      operation === "update"
        ? await DataStoreService.findOneUpdatableById({
            id: dataStoreId,
            select: { _id: true },
            props,
          })
        : await DataStoreService.findOneDeletableById({
            id: dataStoreId,
            select: { _id: true },
            props,
          });

    return Boolean(store);
  } catch (error) {
    if (error instanceof Exception && REFUSAL_CODES.includes(error.code)) {
      return false;
    }

    throw error;
  }
}

// The way in a change asks for, read from the request.
interface ConnectionChange {
  collector: DataObservabilityCollector;
  connectionString: string;
  probe: Probe | null;
  probeConnectionVariable: string | null;
  server: DatabaseServer | null;
  databaseName: string | null;
}

export default class DataObservabilityStoreSettings {
  // A database's settings, as its Settings page shows them.
  public static async read(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<StoreSettings> {
    const store: DataStore = await this.readStore(
      data.projectId,
      data.dataStoreId,
    );
    const uses: DataObservabilityStoreUses = await this.readUses(store);
    const relies: boolean = isDataSecurityRelyingOn(store, uses);
    const canEdit: boolean = mayConnect(data.props);
    const mayChangeSampledConnection: boolean =
      canEdit && isContentSampledThroughConnection(store)
        ? await mayDataSecurity(data.props, store.id!, "update")
        : true;
    const mayDeleteRelied: boolean =
      canEdit && relies
        ? await mayDataSecurity(data.props, store.id!, "delete")
        : true;

    return {
      dataStoreId: store.id!.toString(),
      name: store.name || "",
      kind: store.kind || "",
      isTableHealthEnabled: store.isTableHealthEnabled !== false,
      connection: await this.readConnection(store),
      uses,
      isDataSecurityRelyingOnIt: relies,
      canEdit,
      connectionRefusal: !mayChangeSampledConnection
        ? DataObservabilityStoreRefusal.DataSecuritySamplesIt
        : null,
      canRemove: canEdit,
      deleteRefusal: !canEdit
        ? DataObservabilityStoreRefusal.NotPermitted
        : !mayDeleteRelied
          ? DataObservabilityStoreRefusal.DataSecurityReliesOnIt
          : null,
    };
  }

  /*
   * A new name, a new way in, or both. Data Observability's own columns
   * are written as OneUptime; the connection Data Security samples with,
   * while it does, only through Data Security's path, as the caller.
   */
  public static async update(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    body: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!mayConnect(data.props)) {
      throw new NotAuthorizedException(NOT_PERMITTED_MESSAGE);
    }

    const store: DataStore = await this.readStore(
      data.projectId,
      data.dataStoreId,
    );
    const nameValue: unknown = data.body["name"];
    const connectionValue: unknown = data.body["connection"];

    if (nameValue === undefined && connectionValue === undefined) {
      throw new BadDataException(
        "Give the database a new name, or a new way to reach it.",
      );
    }

    const ownChanges: JSONObject = {};

    if (nameValue !== undefined) {
      const name: string =
        typeof nameValue === "string" ? nameValue.trim() : "";

      if (!name) {
        throw new BadDataException("Give the database a name.");
      }

      if (name.length > 500) {
        throw new BadDataException(
          "Give the database a name of at most 500 characters.",
        );
      }

      ownChanges["name"] = name;
    }

    let sharedChanges: JSONObject = {};
    let collector: DataObservabilityCollector | null = null;

    if (connectionValue !== undefined) {
      const change: ConnectionChange = await this.readConnectionChange({
        store,
        value: connectionValue,
      });

      collector = change.collector;
      sharedChanges = this.getSharedChanges(store, change);

      Object.assign(ownChanges, {
        tableHealthDatabaseServerId:
          change.collector === DataObservabilityCollector.DatabaseAgent
            ? change.server!.id!
            : null,
        tableHealthDatabaseName:
          change.collector === DataObservabilityCollector.DatabaseAgent
            ? change.databaseName
            : null,
        // A new way in is tried at once, every table the database refused asked again.
        nextTableHealthCollectionAt: OneUptimeDate.getCurrentDate(),
        tableHealthSkippedTables: null,
      });
    }

    const isSampled: boolean = isContentSampledThroughConnection(store);

    if (Object.keys(sharedChanges).length > 0 && isSampled) {
      if (!(await mayDataSecurity(data.props, store.id!, "update"))) {
        throw new NotAuthorizedException(CONNECTION_CHANGE_REFUSAL);
      }

      // Data Security's own path, as the caller: its permissions, its rules for what it samples, its Timeline.
      await DataStoreService.updateOneById({
        id: store.id!,
        data: sharedChanges as never,
        props: data.props,
      });
      sharedChanges = {};
    }

    const written: JSONObject = { ...ownChanges, ...sharedChanges };

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: store.id!,
      data: written as never,
    });

    // Written round the hooks, so recorded here: who renamed it, or changed how it is reached.
    await AuditLogService.recordUpdate({
      model: new DataStore(),
      before: store,
      updatedFields: written,
      itemId: store.id!,
      props: data.props,
    });

    // OneUptime's workers read it now; a probe or a Database Agent at its next poll.
    if (
      collector === DataObservabilityCollector.OneUptime &&
      store.isTableHealthEnabled !== false
    ) {
      await queueTableHealthCollection({
        projectId: data.projectId,
        dataStoreId: store.id!,
      });
    }
  }

  /*
   * Data Observability stops reading the database and forgets what it kept
   * of it; Data Security keeps the store, its connection and everything its
   * scans found. The monitors that watch it are the Monitors product's,
   * kept: the confirmation counts them.
   */
  public static async remove(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!mayConnect(data.props)) {
      throw new NotAuthorizedException(NOT_PERMITTED_MESSAGE);
    }

    const store: DataStore = await this.readStore(
      data.projectId,
      data.dataStoreId,
    );
    const query: { projectId: ObjectID; dataStoreId: ObjectID } = {
      projectId: data.projectId,
      dataStoreId: store.id!,
    };

    // Stopped first, so no collection writes a table back while its tables go.
    const stopped: JSONObject = {
      isTableHealthEnabled: false,
      tableHealthRemovedAt: OneUptimeDate.getCurrentDate(),
      nextTableHealthCollectionAt: null,
      tableHealthDatabaseServerId: null,
      tableHealthDatabaseName: null,
      tableHealthStatus: null,
      tableHealthMessage: null,
      tableHealthCollectedAt: null,
      tableHealthAttemptedAt: null,
      tableHealthAssetCount: null,
      tableHealthTarget: null,
      tableHealthSkippedTables: null,
      newPersonalDataColumns: null,
    };

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: store.id!,
      data: stopped as never,
    });

    // Its tables take their checks, history, lineage and alerts' causes with them.
    await DataAssetService.deleteBy({
      query,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
    await DataAlertService.deleteBy({
      query,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
    await DataWarehouseJobService.deleteBy({
      query,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    await AuditLogService.recordUpdate({
      model: new DataStore(),
      before: store,
      updatedFields: {
        isTableHealthEnabled: false,
        tableHealthRemovedAt: stopped["tableHealthRemovedAt"],
      },
      itemId: store.id!,
      props: data.props,
      includeColumns: ["tableHealthRemovedAt"],
    });
  }

  /*
   * Deletes the database from OneUptime. Data Observability's to delete
   * when Data Security holds nothing of it; else only through Data
   * Security's delete, as the caller.
   */
  public static async delete(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!mayConnect(data.props)) {
      throw new NotAuthorizedException(NOT_PERMITTED_MESSAGE);
    }

    const store: DataStore = await this.readStore(
      data.projectId,
      data.dataStoreId,
    );
    const uses: DataObservabilityStoreUses = await this.readUses(store);

    if (isDataSecurityRelyingOn(store, uses)) {
      if (!(await mayDataSecurity(data.props, store.id!, "delete"))) {
        throw new NotAuthorizedException(DELETE_REFUSAL);
      }

      // Data Security's own delete: its permissions and labels, its audit log.
      await DataStoreService.deleteOneById({
        id: store.id!,
        props: data.props,
      });
      return;
    }

    await DataStoreService.deleteOneById({
      id: store.id!,
      props: { isRoot: true },
    });

    await AuditLogService.recordDelete({
      model: new DataStore(),
      deletedItem: store,
      itemId: store.id!,
      props: data.props,
    });
  }

  // The store a route names, of the project, that Data Observability reads and has not removed.
  public static async readStore(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<DataStore> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: {
        _id: dataStoreId,
        projectId,
        kind: new Includes([
          ...DATA_OBSERVABILITY_KINDS,
          ...OBJECT_STORE_KINDS,
        ]),
        tableHealthRemovedAt: QueryHelper.isNull(),
      },
      select: STORE_SELECT,
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException(DATABASE_NOT_FOUND_MESSAGE);
    }

    return store;
  }

  // What else uses the store: what Remove and Delete each take with it.
  public static async readUses(
    store: DataStore,
  ): Promise<DataObservabilityStoreUses> {
    const projectId: ObjectID = store.projectId!;
    const dataStoreId: ObjectID = store.id!;
    const byStore: { projectId: ObjectID; dataStoreId: ObjectID } = {
      projectId,
      dataStoreId,
    };
    const root: DatabaseCommonInteractionProps = { isRoot: true };

    const [
      tableCount,
      checkCount,
      monitors,
      issueCount,
      scanCount,
      ownerUsers,
      ownerTeams,
    ] = await Promise.all([
      DataAssetService.countBy({
        query: { ...byStore, isDropped: false },
        props: root,
      }),
      DataCheckService.countBy({ query: byStore, props: root }),
      DataObservabilityAttentionReader.getAlertMonitorCountByStore(projectId),
      DataSecurityIssueService.countBy({ query: byStore, props: root }),
      DataSecurityScanService.countBy({ query: byStore, props: root }),
      DataStoreOwnerUserService.countBy({ query: byStore, props: root }),
      DataStoreOwnerTeamService.countBy({ query: byStore, props: root }),
    ]);

    return {
      tableCount: tableCount.toNumber(),
      checkCount: checkCount.toNumber(),
      monitorCount: monitors.get(dataStoreId.toString()) || 0,
      isContentScanned: isContentSampledThroughConnection(store),
      findingCount: store.findingCount || 0,
      issueCount: issueCount.toNumber(),
      scanCount: scanCount.toNumber(),
      ownerCount: ownerUsers.toNumber() + ownerTeams.toNumber(),
      hasRecordOfProcessing: Boolean(
        store.purpose?.trim() ||
          store.retention?.trim() ||
          store.legalBasis ||
          (Array.isArray(store.dataSubjects) && store.dataSubjects.length > 0),
      ),
      foundFrom: store.discoveredFrom || null,
    };
  }

  // How the store is reached, never with its connection string.
  private static async readConnection(
    store: DataStore,
  ): Promise<DataObservabilityStoreConnection> {
    const collector: DataObservabilityCollector =
      getDataObservabilityCollector(store);
    let agent: DatabaseAgentOfServer | null = null;

    if (store.tableHealthDatabaseServerId) {
      agent =
        (
          await DataObservabilityDatabaseAgents.readByServer({
            projectId: store.projectId!,
            serverIds: [store.tableHealthDatabaseServerId],
          })
        ).get(store.tableHealthDatabaseServerId.toString().toLowerCase()) ||
        null;
    }

    return {
      collector,
      hasConnectionString: Boolean(store.connectionString),
      probe:
        store.scanProbeId && store.scanProbe
          ? {
              id: store.scanProbeId.toString(),
              name: store.scanProbe.name || "",
            }
          : null,
      probeConnectionVariable: store.probeConnectionVariable || null,
      databaseServer: agent?.server.id
        ? { id: agent.server.id.toString(), name: agent.server.name || "" }
        : null,
      databaseName: store.tableHealthDatabaseName || null,
      agentState:
        collector === DataObservabilityCollector.DatabaseAgent
          ? agent?.state || DataObservabilityAgentState.NoAgent
          : null,
    };
  }

  // A new way in, read and checked: the probe the project's own, the server one of its agents reads.
  private static async readConnectionChange(data: {
    store: DataStore;
    value: unknown;
  }): Promise<ConnectionChange> {
    if (
      !data.value ||
      typeof data.value !== "object" ||
      Array.isArray(data.value)
    ) {
      throw new BadDataException("Say how Data Observability reaches it.");
    }

    const value: JSONObject = data.value as JSONObject;
    const collector: unknown = value["collector"];
    const projectId: ObjectID = data.store.projectId!;

    if (
      !data.store.kind ||
      !DATA_OBSERVABILITY_KINDS.includes(data.store.kind)
    ) {
      throw new BadDataException(
        "This database is read through the cloud connection that found it.",
      );
    }

    if (collector === DataObservabilityCollector.OneUptime) {
      const connectionString: string =
        typeof value["connectionString"] === "string"
          ? value["connectionString"].trim()
          : "";

      if (!connectionString && !data.store.connectionString) {
        throw new BadDataException(
          "Give the connection string OneUptime reads the database with.",
        );
      }

      return {
        collector,
        connectionString,
        probe: null,
        probeConnectionVariable: null,
        server: null,
        databaseName: null,
      };
    }

    if (collector === DataObservabilityCollector.Probe) {
      const probeId: unknown = value["probeId"];
      const variable: unknown = value["probeConnectionVariable"];
      const probe: Probe | null =
        typeof probeId === "string" && ObjectID.isValidUUID(probeId)
          ? await ProbeService.findOneBy({
              query: { _id: new ObjectID(probeId), projectId },
              select: { _id: true, isGlobalProbe: true },
              props: { isRoot: true },
            })
          : null;

      if (!probe?.id || probe.isGlobalProbe) {
        throw new BadDataException(
          "Choose one of this project's own probes: a global probe never reads a customer's database.",
        );
      }

      const trimmed: unknown =
        typeof variable === "string" ? variable.trim() : variable;

      if (!isValidProbeConnectionVariable(trimmed)) {
        throw new BadDataException(
          "Name the probe's environment variable that holds the connection string: upper-case letters, digits and underscores, not one of the probe's own settings.",
        );
      }

      return {
        collector,
        connectionString: "",
        probe,
        probeConnectionVariable: trimmed,
        server: null,
        databaseName: null,
      };
    }

    if (collector === DataObservabilityCollector.DatabaseAgent) {
      return {
        collector,
        connectionString: "",
        probe: null,
        probeConnectionVariable: null,
        ...(await this.readAgentChoice({
          projectId,
          kind: data.store.kind,
          databaseServerId: value["databaseServerId"],
          databaseName: value["databaseName"],
        })),
      };
    }

    throw new BadDataException(
      "Choose who connects: OneUptime, a probe in your network, or a Database Agent.",
    );
  }

  /*
   * A Database Agent chosen for a database (#11148): a database server of
   * the project, of the engine the database is, and the database's name on
   * it. Whether its agent can read it yet is the database's page's to say:
   * the choice stands while its owner turns Data Observability on.
   */
  public static async readAgentChoice(data: {
    projectId: ObjectID;
    kind: string;
    databaseServerId: unknown;
    databaseName: unknown;
  }): Promise<{ server: DatabaseServer; databaseName: string }> {
    const engine: DatabaseAgentEngine | null = getDatabaseAgentEngineOfKind(
      data.kind,
    );

    if (!engine) {
      throw new BadDataException(
        "A Database Agent reads PostgreSQL and MySQL databases for Data Observability. Choose OneUptime or a probe for this one.",
      );
    }

    const server: DatabaseServer | null =
      typeof data.databaseServerId === "string" &&
      ObjectID.isValidUUID(data.databaseServerId)
        ? await DatabaseServerService.findOneBy({
            query: {
              _id: new ObjectID(data.databaseServerId),
              projectId: data.projectId,
              isArchived: false,
            },
            select: { _id: true, name: true, dbSystem: true },
            props: { isRoot: true },
          })
        : null;

    if (!server?.id) {
      throw new BadDataException(
        "Choose the database server whose Database Agent reads this database.",
      );
    }

    const serverEngine: DatabaseAgentEngine | null =
      getDatabaseAgentEngineOfSystem(server.dbSystem);

    if (serverEngine && serverEngine !== engine) {
      throw new BadDataException(
        "That Database Agent reads another engine: choose the agent of the server this database is on.",
      );
    }

    const databaseName: unknown =
      typeof data.databaseName === "string"
        ? data.databaseName.trim()
        : data.databaseName;

    if (!isDatabaseAgentDatabaseName(databaseName)) {
      throw new BadDataException(
        "Name the database on that server the agent reads, as the server names it: at most 64 characters, with no slash.",
      );
    }

    return { server, databaseName };
  }

  /*
   * What a new way in writes of the connection the store shares with Data
   * Security: the string, the probe and its variable. Only what changes.
   * A Database Agent writes none of it, but a saved connection string that
   * Data Security does not sample with is deleted, so OneUptime keeps no
   * login it no longer uses.
   */
  private static getSharedChanges(
    store: DataStore,
    change: ConnectionChange,
  ): JSONObject {
    const changes: JSONObject = {};
    const isSampled: boolean = isContentSampledThroughConnection(store);

    if (change.collector === DataObservabilityCollector.OneUptime) {
      if (change.connectionString) {
        changes["connectionString"] = change.connectionString;
      }

      if (store.scanProbeId) {
        changes["scanProbeId"] = null;
      }

      if (store.probeConnectionVariable) {
        changes["probeConnectionVariable"] = null;
      }
    }

    if (change.collector === DataObservabilityCollector.Probe) {
      if (store.scanProbeId?.toString() !== change.probe!.id!.toString()) {
        changes["scanProbeId"] = change.probe!.id!;
      }

      if (store.probeConnectionVariable !== change.probeConnectionVariable) {
        changes["probeConnectionVariable"] = change.probeConnectionVariable;
      }

      // The probe holds it now: none stays saved in OneUptime.
      if (store.connectionString) {
        changes["connectionString"] = null;
      }
    }

    if (
      change.collector === DataObservabilityCollector.DatabaseAgent &&
      store.connectionString &&
      !isSampled
    ) {
      changes["connectionString"] = null;
    }

    return changes;
  }
}
