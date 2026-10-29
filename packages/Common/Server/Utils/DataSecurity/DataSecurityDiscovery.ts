import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudResourceService from "../../Services/CloudResourceService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DataStoreAccessService from "../../Services/DataStoreAccessService";
import DataStoreService from "../../Services/DataStoreService";
import InventoryItemService from "../../Services/InventoryItemService";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
} from "./Cloud/DataSecurityCloudTypes";
import { queueDataSecurityEvaluation } from "./DataSecurityJobs";
import logger from "../Logger";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import { getDataStoreAccessKey } from "../../../Types/DataSecurity/DataStoreAccess";
import DataStoreEnvironment, {
  inferDataStoreEnvironment,
} from "../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DATA_STORE_KINDS,
  DATABASE_ENGINE_STORE_KINDS,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindForCloudResourceType,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  cloudDataStoreKey,
  databaseServerDataStoreKey,
  telemetryDataStoreKey,
  tracedDatabaseDataStoreKey,
} from "../../../Types/DataSecurity/DataStoreKey";
import { DataStorePostureFacts } from "../../../Types/DataSecurity/DataStorePosture";

/*
 * FINDING EVERY DATA STORE A PROJECT HAS, WITHOUT ANYONE ADDING ONE.
 *
 * A store comes from wherever OneUptime already knows of it:
 *
 *  - Cloud inventory: every CloudResource of a kind that holds data (an
 *    RDS instance, a storage account, a Cloud SQL instance), with the few
 *    safe properties inventory keeps, which already say whether an RDS
 *    instance is encrypted or public before the data-security read runs.
 *  - The Database product: every monitored database server.
 *  - The service map: a database services talk to that neither of the
 *    above covers - shadow data, found from the traffic to it.
 *  - The cloud data-security reads (recordCloudReads): stores inventory
 *    does not list, S3 buckets and BigQuery datasets among them.
 *  - Telemetry scans (ensureTelemetryStore): a service's logs, traces,
 *    exceptions, replays and AI conversations.
 *
 * Every source builds the same key for the same store (DataStoreKey.ts),
 * so a store found twice is one row. A store whose source is gone is
 * archived with its history, never deleted.
 */

const MAX_DISCOVERED: number = 10000;

// The cloud inventory types Data Security reads as stores.
const DATA_STORE_CLOUD_TYPES: Array<string> = DATA_STORE_KINDS.map(
  (info: DataStoreKindInfo) => {
    return info.cloudResourceType;
  },
).filter((type: string | undefined): type is string => {
  return Boolean(type);
});

interface DiscoveredStore {
  storeKey: string;
  name: string;
  kind: DataStoreKind;
  discoveredFrom: string;
  columns: JSONObject;
}

function booleanOf(value: unknown): boolean | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

/*
 * What inventory's own properties already say about a store's posture:
 * RDS keeps StorageEncrypted, PubliclyAccessible, DeletionProtection and
 * BackupRetentionPeriod; DynamoDB its point-in-time recovery and deletion
 * protection flags. The data-security read replaces these with the full
 * picture once it runs.
 */
export function postureFromInventory(
  kind: DataStoreKind,
  properties: JSONObject | undefined,
  inventoriedAt: Date | undefined,
): DataStorePostureFacts | null {
  if (!properties || !inventoriedAt) {
    return null;
  }

  if (
    kind === DataStoreKind.AwsRdsInstance ||
    kind === DataStoreKind.AwsRdsCluster
  ) {
    const retention: number = Number(properties["BackupRetentionPeriod"]);

    return {
      readAt: inventoriedAt.toISOString(),
      encryptedAtRest: booleanOf(properties["StorageEncrypted"]),
      publicNetworkAccess: booleanOf(properties["PubliclyAccessible"]),
      deletionProtection: booleanOf(properties["DeletionProtection"]),
      backupRetentionDays: Number.isFinite(retention) ? retention : null,
      backupsEnabled: Number.isFinite(retention) ? retention > 0 : null,
    };
  }

  if (kind === DataStoreKind.AwsDynamoDbTable) {
    return {
      readAt: inventoriedAt.toISOString(),
      encryptedAtRest: true,
      pointInTimeRecovery: booleanOf(
        properties[
          "PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled"
        ],
      ),
      deletionProtection: booleanOf(properties["DeletionProtectionEnabled"]),
    };
  }

  return null;
}

export default class DataSecurityDiscovery {
  public static async discoverProject(projectId: ObjectID): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const discovered: Array<DiscoveredStore> = [
      ...(await this.fromCloudInventory(projectId, now)),
      ...(await this.fromDatabaseServers(projectId)),
    ];

    const existing: Map<string, DataStore> = await this.readExisting(projectId);
    const covered: Set<string> = new Set(
      discovered.map((store: DiscoveredStore) => {
        return store.storeKey;
      }),
    );

    // Databases seen only in traffic: the shadow data no source lists.
    for (const traced of await this.fromServiceMap(projectId, existing)) {
      if (!covered.has(traced.storeKey)) {
        discovered.push(traced);
        covered.add(traced.storeKey);
      }
    }

    let created: number = 0;

    for (const store of discovered.slice(0, MAX_DISCOVERED)) {
      try {
        if (
          await this.upsert(projectId, store, existing.get(store.storeKey), now)
        ) {
          created++;
        }
      } catch (error) {
        logger.error(`DataSecurity: could not record store ${store.storeKey}:`);
        logger.error(error);
      }
    }

    await this.archiveGone(projectId, existing, covered);

    if (created > 0) {
      await queueDataSecurityEvaluation(projectId);
    }

    return created;
  }

  private static async readExisting(
    projectId: ObjectID,
  ): Promise<Map<string, DataStore>> {
    const rows: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId },
      select: {
        _id: true,
        storeKey: true,
        discoveredFrom: true,
        isArchived: true,
        posture: true,
        name: true,
        environment: true,
      },
      skip: 0,
      limit: MAX_DISCOVERED,
      props: { isRoot: true },
    });

    return new Map(
      rows.map((row: DataStore): [string, DataStore] => {
        return [row.storeKey || "", row];
      }),
    );
  }

  /*
   * Creates a store, or brings an existing one up to date. Returns whether
   * the store is new. A person's own settings - environment, sensitivity,
   * public by design, owners - are never overwritten.
   */
  private static async upsert(
    projectId: ObjectID,
    store: DiscoveredStore,
    existing: DataStore | undefined,
    now: Date,
  ): Promise<boolean> {
    if (existing?.id) {
      const columns: JSONObject = {
        ...store.columns,
        name: store.name.slice(0, 500) || store.kind,
        lastSeenAt: now,
      };

      // An environment once known - set by a person, or read before - stays.
      if (
        existing.environment &&
        existing.environment !== DataStoreEnvironment.Unknown
      ) {
        delete columns["environment"];
      }

      // Inventory posture fills only a store no data-security read has reached.
      const posture: DataStorePostureFacts | undefined = existing.posture as
        | DataStorePostureFacts
        | undefined;

      if (posture?.readAt && columns["posture"] && !columns["postureIsFull"]) {
        delete columns["posture"];
      }

      delete columns["postureIsFull"];

      const wasArchived: boolean = Boolean(existing.isArchived);

      if (wasArchived) {
        columns["isArchived"] = false;
      }

      await DataStoreService.updateColumnsByIdWithoutHooks({
        id: existing.id,
        data: columns as never,
      });

      // Found again: the store's Timeline says it is back.
      if (wasArchived) {
        await DataStoreService.writeRestoredFeed({
          projectId: projectId,
          dataStoreId: existing.id,
        }).catch((error: Error) => {
          logger.error(error);
        });
      }

      return false;
    }

    const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(
      store.kind,
    );
    const row: DataStore = new DataStore();
    row.projectId = projectId;
    row.storeKey = store.storeKey;
    row.name = store.name.slice(0, 500) || store.kind;
    row.kind = store.kind;

    if (info) {
      row.provider = info.provider;
      row.family = info.family;
    }

    row.discoveredFrom = store.discoveredFrom;
    row.firstSeenAt = now;
    row.lastSeenAt = now;
    row.nextContentScanAt = now;

    const columns: JSONObject = { ...store.columns, name: row.name };
    delete columns["postureIsFull"];

    for (const [column, value] of Object.entries(columns)) {
      row.setColumnValue(column, value);
    }

    await DataStoreService.create({ data: row, props: { isRoot: true } });

    return true;
  }

  private static async archiveGone(
    projectId: ObjectID,
    existing: Map<string, DataStore>,
    covered: Set<string>,
  ): Promise<void> {
    for (const [storeKey, store] of existing) {
      const discoveredBySweep: boolean =
        store.discoveredFrom === "Cloud inventory" ||
        store.discoveredFrom === "Database product" ||
        store.discoveredFrom === "Service map";

      if (
        store.id &&
        discoveredBySweep &&
        !store.isArchived &&
        !covered.has(storeKey)
      ) {
        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id,
          data: { isArchived: true },
        });

        // Its Timeline says why it left the everyday lists.
        await DataStoreService.writeArchivedFeed({
          projectId: projectId,
          dataStoreId: store.id,
          discoveredFrom: store.discoveredFrom,
        }).catch((error: Error) => {
          logger.error(error);
        });
      }
    }
  }

  private static async fromCloudInventory(
    projectId: ObjectID,
    now: Date,
  ): Promise<Array<DiscoveredStore>> {
    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId,
        isArchived: false,
        cloudResourceType: new Includes(DATA_STORE_CLOUD_TYPES),
      },
      select: {
        _id: true,
        name: true,
        cloudProvider: true,
        cloudRegion: true,
        cloudAccountId: true,
        cloudResourceType: true,
        providerResourceId: true,
        resourceIdentifier: true,
        cloudTags: true,
        cloudProperties: true,
        cloudConnectionId: true,
        inventoriedAt: true,
      },
      skip: 0,
      limit: MAX_DISCOVERED,
      props: { isRoot: true },
    });

    const accounts: Map<string, ObjectID> = await this.accountIds(projectId);
    const stores: Array<DiscoveredStore> = [];

    for (const resource of resources) {
      const kind: DataStoreKind | undefined =
        getDataStoreKindForCloudResourceType(resource.cloudResourceType || "");
      const providerResourceId: string =
        resource.providerResourceId || resource.resourceIdentifier || "";

      if (!kind || !providerResourceId || !resource.cloudProvider) {
        continue;
      }

      const tags: Record<string, string> =
        (resource.cloudTags as Record<string, string> | undefined) || {};
      const name: string = resource.name || providerResourceId;
      const columns: JSONObject = {
        name,
        cloudResourceId: resource.id!,
        providerResourceId: providerResourceId.slice(0, 500),
        cloudAccountNumber: (resource.cloudAccountId || "").slice(0, 100),
        region: (resource.cloudRegion || "").slice(0, 100),
        cloudTags: tags,
        environment: inferDataStoreEnvironment(name, tags),
      };

      if (resource.cloudConnectionId) {
        columns["cloudConnectionId"] = resource.cloudConnectionId;
      }

      const accountId: ObjectID | undefined = accounts.get(
        `${resource.cloudProvider}|${resource.cloudAccountId || ""}`,
      );

      if (accountId) {
        columns["cloudAccountId"] = accountId;
      }

      const posture: DataStorePostureFacts | null = postureFromInventory(
        kind,
        resource.cloudProperties as JSONObject | undefined,
        resource.inventoriedAt || now,
      );

      if (posture) {
        columns["posture"] = posture as unknown as JSONObject;
      }

      stores.push({
        storeKey: cloudDataStoreKey({
          provider: resource.cloudProvider,
          kind,
          providerResourceId,
        }),
        name,
        kind,
        discoveredFrom: "Cloud inventory",
        columns,
      });
    }

    return stores;
  }

  private static async accountIds(
    projectId: ObjectID,
  ): Promise<Map<string, ObjectID>> {
    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: { projectId },
      select: { _id: true, provider: true, accountId: true },
      skip: 0,
      limit: 5000,
      props: { isRoot: true },
    });

    return new Map(
      accounts
        .filter((account: CloudAccount) => {
          return Boolean(account.id);
        })
        .map((account: CloudAccount): [string, ObjectID] => {
          return [
            `${account.provider}|${account.accountId || ""}`,
            account.id!,
          ];
        }),
    );
  }

  private static async fromDatabaseServers(
    projectId: ObjectID,
  ): Promise<Array<DiscoveredStore>> {
    const servers: Array<DatabaseServer> = await DatabaseServerService.findBy({
      query: { projectId },
      select: { _id: true, name: true, dbSystem: true, serverAddress: true },
      skip: 0,
      limit: MAX_DISCOVERED,
      props: { isRoot: true },
    });
    const stores: Array<DiscoveredStore> = [];

    for (const server of servers) {
      const kind: DataStoreKind | undefined =
        DATABASE_ENGINE_STORE_KINDS[(server.dbSystem || "").toLowerCase()];

      if (!kind || !server.id) {
        continue;
      }

      const name: string = server.name || server.serverAddress || kind;

      stores.push({
        storeKey: databaseServerDataStoreKey(server.id.toString()),
        name,
        kind,
        discoveredFrom: "Database product",
        columns: {
          name,
          databaseServerId: server.id,
          environment: inferDataStoreEnvironment(name, {}),
        },
      });
    }

    return stores;
  }

  /*
   * Databases on the service map that no other source covers, keyed by
   * engine, address and database name as the map names them.
   */
  private static async fromServiceMap(
    projectId: ObjectID,
    existing: Map<string, DataStore>,
  ): Promise<Array<DiscoveredStore>> {
    const nodes: Array<InventoryItem> = await InventoryItemService.findBy({
      query: { projectId, entityType: EntityType.Database, isArchived: false },
      select: { identifyingAttributes: true, displayName: true },
      skip: 0,
      limit: 2000,
      props: { isRoot: true },
    });
    // Names other sources gave: a store the map found is the node itself, not another source.
    const knownNames: Set<string> = new Set(
      [...existing.values()]
        .filter((store: DataStore) => {
          return store.discoveredFrom !== "Service map";
        })
        .map((store: DataStore) => {
          return (store.name || "").toLowerCase();
        }),
    );
    const stores: Array<DiscoveredStore> = [];

    for (const node of nodes) {
      const attributes: JSONObject =
        (node.identifyingAttributes as JSONObject | undefined) || {};
      const system: string = String(attributes["db.system.name"] || "");
      const address: string = String(attributes["server.address"] || "");
      const namespace: string | undefined = attributes["db.namespace"]
        ? String(attributes["db.namespace"])
        : undefined;
      const kind: DataStoreKind | undefined =
        DATABASE_ENGINE_STORE_KINDS[system.toLowerCase()];

      if (!kind || !address) {
        continue;
      }

      const name: string = namespace ? `${namespace} on ${address}` : address;

      // A store another source already names this way is that store.
      if (knownNames.has(address.toLowerCase())) {
        continue;
      }

      stores.push({
        storeKey: tracedDatabaseDataStoreKey({ system, address, namespace }),
        name,
        kind,
        discoveredFrom: "Service map",
        columns: {
          name,
          environment: inferDataStoreEnvironment(name, {}),
        },
      });
    }

    return stores;
  }

  /*
   * What a cloud connection's data-security read found: each store's
   * posture, tags, size and access, written onto its row (made if
   * inventory never listed it), with its access entries replaced.
   */
  public static async recordCloudReads(data: {
    projectId: ObjectID;
    cloudConnectionId: ObjectID;
    provider: DataStoreProvider;
    result: CloudDataSecurityReadResult;
  }): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const existing: Map<string, DataStore> = await this.readExisting(
      data.projectId,
    );
    const accounts: Map<string, ObjectID> = await this.accountIds(
      data.projectId,
    );
    let recorded: number = 0;

    for (const read of data.result.stores.slice(0, MAX_DISCOVERED)) {
      try {
        const storeKey: string = cloudDataStoreKey({
          provider: data.provider,
          kind: read.identity.kind,
          providerResourceId: read.identity.providerResourceId,
        });
        const tags: Record<string, string> = read.tags || {};
        const columns: JSONObject = {
          name: read.identity.name,
          providerResourceId: read.identity.providerResourceId.slice(0, 500),
          cloudAccountNumber: read.identity.accountNumber.slice(0, 100),
          region: (read.identity.region || "").slice(0, 100),
          cloudConnectionId: data.cloudConnectionId,
          cloudTags: tags,
          posture: {
            ...read.posture,
            readAt: read.posture.readAt || now.toISOString(),
          } as unknown as JSONObject,
          postureIsFull: true,
          configurationReadAt: now,
          environment: inferDataStoreEnvironment(read.identity.name, tags),
        };
        const accountId: ObjectID | undefined = accounts.get(
          `${data.provider}|${read.identity.accountNumber}`,
        );

        if (accountId) {
          columns["cloudAccountId"] = accountId;
        }

        if (typeof read.sizeInBytes === "number") {
          columns["sizeInBytes"] = read.sizeInBytes;
        }

        if (typeof read.objectCount === "number") {
          columns["objectCount"] = read.objectCount;
        }

        if (read.lastActivityAt) {
          columns["lastActivityAt"] = read.lastActivityAt;
        }

        await this.upsert(
          data.projectId,
          {
            storeKey,
            name: read.identity.name,
            kind: read.identity.kind,
            discoveredFrom: "Cloud read",
            columns,
          },
          existing.get(storeKey),
          now,
        );

        const store: DataStore | null = await DataStoreService.findOneBy({
          query: { projectId: data.projectId, storeKey },
          select: { _id: true },
          props: { isRoot: true },
        });

        if (store?.id) {
          await this.replaceAccess(data.projectId, store.id, read, now);
          recorded++;
        }
      } catch (error) {
        logger.error(
          `DataSecurity: could not record the read of ${read.identity.providerResourceId}:`,
        );
        logger.error(error);
      }
    }

    await queueDataSecurityEvaluation(data.projectId);

    return recorded;
  }

  private static async replaceAccess(
    projectId: ObjectID,
    dataStoreId: ObjectID,
    read: CloudDataStoreRead,
    now: Date,
  ): Promise<void> {
    const current: Array<DataStoreAccess> = await DataStoreAccessService.findBy(
      {
        query: { dataStoreId },
        select: { _id: true, accessKey: true, isSeenInTraces: true },
        skip: 0,
        limit: 2000,
        props: { isRoot: true },
      },
    );
    const byKey: Map<string, DataStoreAccess> = new Map(
      current.map((entry: DataStoreAccess): [string, DataStoreAccess] => {
        return [entry.accessKey || "", entry];
      }),
    );
    const wanted: Set<string> = new Set();

    for (const entry of read.access.slice(0, 1000)) {
      const accessKey: string = getDataStoreAccessKey(entry);
      wanted.add(accessKey);

      const columns: JSONObject = {
        principal: entry.principal.slice(0, 500),
        principalType: entry.principalType,
        accessLevel: entry.accessLevel,
        grantedVia: entry.grantedVia.slice(0, 500),
        isExternal: entry.isExternal,
        isPublic: entry.isPublic,
        lastSeenAt: now,
      };

      if (entry.principalName) {
        columns["principalName"] = entry.principalName.slice(0, 500);
      }

      if (entry.lastUsedAt) {
        columns["lastUsedAt"] = entry.lastUsedAt;
      }

      const existing: DataStoreAccess | undefined = byKey.get(accessKey);

      if (existing?.id) {
        await DataStoreAccessService.updateColumnsByIdWithoutHooks({
          id: existing.id,
          data: columns as never,
        });
        continue;
      }

      const row: DataStoreAccess = new DataStoreAccess();
      row.projectId = projectId;
      row.dataStoreId = dataStoreId;
      row.accessKey = accessKey;
      row.firstSeenAt = now;

      for (const [column, value] of Object.entries(columns)) {
        row.setColumnValue(column, value);
      }

      await DataStoreAccessService.create({
        data: row,
        props: { isRoot: true },
      });
    }

    // Grants the cloud no longer reports are gone; traffic-seen ones stay.
    for (const entry of current) {
      if (
        entry.id &&
        !wanted.has(entry.accessKey || "") &&
        !entry.isSeenInTraces
      ) {
        await DataStoreAccessService.deleteOneById({
          id: entry.id,
          props: { isRoot: true },
        });
      }
    }
  }

  // A service's telemetry store of one signal, made the first time it is scanned.
  public static async ensureTelemetryStore(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceName: string;
    kind: DataStoreKind;
  }): Promise<ObjectID | null> {
    const storeKey: string = telemetryDataStoreKey({
      serviceId: data.serviceId.toString(),
      kind: data.kind,
    });
    const found: DataStore | null = await DataStoreService.findOneBy({
      query: { projectId: data.projectId, storeKey },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (found?.id) {
      await DataStoreService.updateColumnsByIdWithoutHooks({
        id: found.id,
        data: { lastSeenAt: OneUptimeDate.getCurrentDate(), isArchived: false },
      });
      return found.id;
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const name: string = `${data.serviceName} · ${data.kind}`;
    const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(data.kind);
    const row: DataStore = new DataStore();
    row.projectId = data.projectId;
    row.storeKey = storeKey;
    row.name = name.slice(0, 500);
    row.kind = data.kind;

    if (info) {
      row.provider = info.provider;
      row.family = info.family;
    }

    row.discoveredFrom = "Telemetry";

    // Session replays belong to a RUM application, which is not a service.
    if (data.kind !== DataStoreKind.TelemetrySessionReplays) {
      row.serviceId = data.serviceId;
    }

    row.environment = inferDataStoreEnvironment(data.serviceName, {});
    row.firstSeenAt = now;
    row.lastSeenAt = now;

    try {
      const created: DataStore = await DataStoreService.create({
        data: row,
        props: { isRoot: true },
      });

      return created.id || null;
    } catch (error) {
      // Another scan made it first - or the row could not be made at all.
      const raced: DataStore | null = await DataStoreService.findOneBy({
        query: { projectId: data.projectId, storeKey },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!raced?.id) {
        logger.error(
          `DataSecurity: could not record the ${data.kind} store of ${data.serviceId.toString()}:`,
        );
        logger.error(error);
      }

      return raced?.id || null;
    }
  }
}
