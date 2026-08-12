import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryEntity from "../../../Models/DatabaseModels/TelemetryEntity";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import IoTDevice from "../../../Models/DatabaseModels/IoTDevice";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import DatabaseService from "../../Services/DatabaseService";
import CloudResourceService from "../../Services/CloudResourceService";
import DockerHostService from "../../Services/DockerHostService";
import IoTDeviceService from "../../Services/IoTDeviceService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import PodmanHostService from "../../Services/PodmanHostService";
import RumApplicationService from "../../Services/RumApplicationService";
import ServerlessFunctionService from "../../Services/ServerlessFunctionService";
import TelemetryEntityService from "../../Services/TelemetryEntityService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import ColumnLength from "../../../Types/Database/ColumnLength";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
  keyForInventoryEntity,
} from "../../../Utils/Telemetry/EntityKey";
import logger from "../Logger";

/*
 * Mirrors OneUptime's inventory tables into the TelemetryEntity registry.
 *
 * The registry began as a projection of OTLP resource attributes, which is
 * why the entity explorer shows a Kubernetes pod but not the switch next to
 * it: half of what OneUptime inventories is collected by pollers (SNMP,
 * cloud APIs, MQTT) that never produce a resource for ingest to extract
 * entities from. Those rows already exist in rich typed tables — they were
 * simply never projected. This module projects them, so "everything we know
 * about the estate" is answerable in one query instead of eight.
 *
 * WHY A RECONCILE RATHER THAN CREATE/DELETE HOOKS ON EACH TABLE
 *
 * Hooks were the obvious approach and are the wrong one here, for three
 * reasons that all bite the same way — a registry that silently disagrees
 * with the inventory it mirrors:
 *
 *   1. Backfill. Hooks only fire on future writes, so every device
 *      registered before this shipped would stay invisible forever.
 *   2. Cascade deletes. Deleting a project (or an IoT fleet) removes its
 *      devices by FK cascade, which fires no per-row service hook — the
 *      mirrored rows would outlive their owners.
 *   3. Seven tables x two hooks is seven chances for a future edit to drop
 *      one, and the resulting drift is invisible until someone notices a
 *      device missing from the explorer.
 *
 * A periodic full reconcile is level-triggered: whatever the inventory
 * says now is what the registry converges to, no matter how it got there.
 * The cost is latency — a newly registered device appears within one cron
 * period rather than instantly — which is an easy trade for inventory that
 * changes on a human timescale.
 */

/** Registry rows are read and written in pages of this size. */
export const INVENTORY_SYNC_PAGE_SIZE: number = 1000;

/**
 * The projection of one inventory row, as the registry stores it. Pure data
 * so the mapping can be tested without a database.
 */
export interface InventoryRowProjection {
  id: ObjectID;
  projectId: ObjectID;
  displayName: string;
  descriptiveAttributes: Dictionary<string>;
}

/**
 * One inventory table, type-erased at the boundary so the seven specs can
 * live in a single array. `defineInventorySource` below preserves full type
 * safety at each definition site; only the resulting closures are untyped.
 */
export interface ErasedInventorySource {
  entityType: EntityType;
  /** Model name stored in TelemetryEntity.resourceType. */
  resourceType: string;
  fetchPage(data: {
    skip: number;
    limit: number;
  }): Promise<Array<InventoryRowProjection>>;
  /** Which of these ids still exist in the owning table. */
  findLiveIds(ids: Array<ObjectID>): Promise<Set<string>>;
}

export interface InventorySourceSpec<TModel extends BaseModel> {
  entityType: EntityType;
  resourceType: string;
  service: DatabaseService<TModel>;
  /**
   * Columns needed by `describe`, beyond `_id` / `projectId` / `name` which
   * are always selected.
   */
  select: Select<TModel>;
  /**
   * Restricts what is mirrored — archived rows are excluded so the explorer
   * reflects the live estate rather than its history.
   */
  query: Query<TModel>;
  /** Non-identifying metadata worth showing on the entity. */
  describe(row: TModel): Dictionary<string>;
}

/**
 * Drops empty values so the stored attribute bag contains only things worth
 * displaying — an inventory row with no OS recorded should have no `os.type`
 * key rather than an empty one.
 */
export function compactAttributes(
  attributes: Dictionary<string | undefined | null>,
): Dictionary<string> {
  const out: Dictionary<string> = {};

  for (const key of Object.keys(attributes)) {
    const value: string | undefined | null = attributes[key];
    if (value === undefined || value === null) {
      continue;
    }
    const text: string = String(value).trim();
    if (text.length === 0) {
      continue;
    }
    out[key] = text;
  }

  return out;
}

/**
 * Builds the registry row for one inventory row. Pure: same inputs, same
 * output, no database — this is the part worth testing exhaustively, since
 * an identity mistake here is what would mint duplicate entities.
 */
export function buildInventoryEntityModel(data: {
  source: Pick<ErasedInventorySource, "entityType" | "resourceType">;
  row: InventoryRowProjection;
  now: Date;
}): TelemetryEntity {
  const { source, row, now } = data;

  const model: TelemetryEntity = new TelemetryEntity();
  model.projectId = row.projectId;
  model.entityType = source.entityType;
  model.entityKey = keyForInventoryEntity(
    row.projectId.toString(),
    source.entityType,
    row.id.toString(),
  );
  model.source = EntitySource.Inventory;
  /*
   * Identity is the owning row's id, not its name: renaming a device in the
   * UI must not orphan its registry row and mint a second one beside it.
   */
  model.identifyingAttributes = {
    [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE]: row.id.toString(),
  } as JSONObject;
  model.displayName = row.displayName.substring(0, ColumnLength.ShortText);
  model.descriptiveAttributes = row.descriptiveAttributes as JSONObject;
  /*
   * The polymorphic pointer back to the rich typed row. Populated here for
   * every mirrored type — previously only `service` entities carried one —
   * so a registry row can be resolved to the page that owns it.
   */
  model.resourceType = source.resourceType;
  model.resourceId = row.id;
  /*
   * Both stamped at mirror time. `lastSeenAt` never advances for these rows
   * (no telemetry heartbeat exists to advance it), which is precisely why
   * PruneStaleEntities excludes EntitySource.Inventory.
   */
  model.firstSeenAt = now;
  model.lastSeenAt = now;

  return model;
}

/**
 * True when a mirrored row has drifted from its owning inventory row and
 * needs rewriting. Compared field by field rather than blindly updating so a
 * steady-state reconcile issues no writes at all.
 */
export function inventoryEntityNeedsUpdate(data: {
  existing: TelemetryEntity;
  desired: TelemetryEntity;
}): boolean {
  const { existing, desired } = data;

  if ((existing.displayName || "") !== (desired.displayName || "")) {
    return true;
  }

  if (existing.resourceType !== desired.resourceType) {
    return true;
  }

  if (existing.resourceId?.toString() !== desired.resourceId?.toString()) {
    return true;
  }

  return (
    JSON.stringify(existing.descriptiveAttributes || {}) !==
    JSON.stringify(desired.descriptiveAttributes || {})
  );
}

/**
 * The columns a drifted mirror rewrites.
 *
 * Built as a plain shape and cast once, for the same two reasons as
 * TelemetryEntityService.buildDescriptiveUpdate: assigning into
 * `QueryDeepPartialEntity<TelemetryEntity>` directly makes TS instantiate the
 * recursive JSONObject mapping (TS2589), and under this project's
 * `exactOptionalPropertyTypes` an optional model field typed `string |
 * undefined` is not assignable to the update type at all. Keys are therefore
 * assigned only when they have a value rather than being set to undefined —
 * which is also the correct write semantics: absent means "leave it alone",
 * not "null it out".
 */
function buildMirrorUpdate(
  desired: TelemetryEntity,
): QueryDeepPartialEntity<TelemetryEntity> {
  const update: {
    displayName?: string;
    descriptiveAttributes?: JSONObject;
    resourceType?: string;
    resourceId?: ObjectID;
  } = {};

  if (desired.displayName !== undefined) {
    update.displayName = desired.displayName;
  }

  if (desired.descriptiveAttributes !== undefined) {
    update.descriptiveAttributes = desired.descriptiveAttributes;
  }

  if (desired.resourceType !== undefined) {
    update.resourceType = desired.resourceType;
  }

  if (desired.resourceId !== undefined) {
    update.resourceId = desired.resourceId;
  }

  return update as unknown as QueryDeepPartialEntity<TelemetryEntity>;
}

function defineInventorySource<TModel extends BaseModel>(
  spec: InventorySourceSpec<TModel>,
): ErasedInventorySource {
  return {
    entityType: spec.entityType,
    resourceType: spec.resourceType,

    fetchPage: async (data: {
      skip: number;
      limit: number;
    }): Promise<Array<InventoryRowProjection>> => {
      const rows: Array<TModel> = await spec.service.findBy({
        query: spec.query,
        select: {
          _id: true,
          projectId: true,
          name: true,
          ...spec.select,
        } as Select<TModel>,
        skip: data.skip,
        limit: data.limit,
        props: { isRoot: true },
      });

      const projections: Array<InventoryRowProjection> = [];

      for (const row of rows) {
        const rowRecord: Record<string, unknown> = row as unknown as Record<
          string,
          unknown
        >;
        const projectId: unknown = rowRecord["projectId"];

        /*
         * A row with no project cannot be mirrored — the entity key folds
         * projectId in, and the registry is tenant-scoped. Should not occur;
         * skipped rather than throwing so one bad row cannot stall the sweep.
         */
        if (!row._id || !projectId) {
          continue;
        }

        const name: unknown = rowRecord["name"];
        const displayName: string = String(name || "").trim();

        projections.push({
          id: new ObjectID(row._id.toString()),
          projectId: new ObjectID(String(projectId)),
          displayName:
            displayName.length > 0 ? displayName : row._id.toString(),
          descriptiveAttributes: spec.describe(row),
        });
      }

      return projections;
    },

    findLiveIds: async (ids: Array<ObjectID>): Promise<Set<string>> => {
      if (ids.length === 0) {
        return new Set<string>();
      }

      /*
       * Deliberately unfiltered by `spec.query`: this answers "does the row
       * still exist", and an archived row still exists. Reusing the mirror
       * query here would make archiving delete the registry row rather than
       * merely stop refreshing it, which is a different (and destructive)
       * behaviour from the one intended.
       */
      const rows: Array<TModel> = await spec.service.findBy({
        query: {
          _id: QueryHelper.any(
            ids.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
        } as Query<TModel>,
        select: { _id: true } as Select<TModel>,
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

      return new Set<string>(
        rows.map((row: TModel) => {
          return row._id!.toString();
        }),
      );
    },
  };
}

/*
 * Archived rows are excluded from every source that has the concept: the
 * explorer is a view of the live estate. IoTDevice and NetworkDevice have no
 * archive flag, so their queries are unrestricted.
 */
export const INVENTORY_SOURCES: ReadonlyArray<ErasedInventorySource> = [
  defineInventorySource<NetworkDevice>({
    entityType: EntityType.NetworkDevice,
    resourceType: "NetworkDevice",
    service: NetworkDeviceService,
    select: { hostname: true },
    query: {},
    describe: (row: NetworkDevice): Dictionary<string> => {
      return compactAttributes({ "net.device.hostname": row.hostname });
    },
  }),
  defineInventorySource<CloudResource>({
    entityType: EntityType.CloudResource,
    resourceType: "CloudResource",
    service: CloudResourceService,
    select: {
      resourceIdentifier: true,
      cloudProvider: true,
      cloudRegion: true,
      cloudAccountId: true,
    },
    query: { isArchived: false },
    describe: (row: CloudResource): Dictionary<string> => {
      return compactAttributes({
        "cloud.resource.id": row.resourceIdentifier,
        "cloud.provider": row.cloudProvider,
        "cloud.region": row.cloudRegion,
        "cloud.account.id": row.cloudAccountId,
      });
    },
  }),
  defineInventorySource<ServerlessFunction>({
    entityType: EntityType.ServerlessFunction,
    resourceType: "ServerlessFunction",
    service: ServerlessFunctionService,
    select: {
      functionIdentifier: true,
      cloudProvider: true,
      cloudRegion: true,
      runtimeName: true,
    },
    query: { isArchived: false },
    describe: (row: ServerlessFunction): Dictionary<string> => {
      return compactAttributes({
        "faas.name": row.functionIdentifier,
        "cloud.provider": row.cloudProvider,
        "cloud.region": row.cloudRegion,
        "process.runtime.name": row.runtimeName,
      });
    },
  }),
  defineInventorySource<RumApplication>({
    entityType: EntityType.RumApplication,
    resourceType: "RumApplication",
    service: RumApplicationService,
    select: { appIdentifier: true, clientType: true, sdkLanguage: true },
    query: { isArchived: false },
    describe: (row: RumApplication): Dictionary<string> => {
      return compactAttributes({
        "rum.app.id": row.appIdentifier,
        "rum.client.type": row.clientType,
        "telemetry.sdk.language": row.sdkLanguage,
      });
    },
  }),
  defineInventorySource<IoTDevice>({
    entityType: EntityType.IoTDevice,
    resourceType: "IoTDevice",
    service: IoTDeviceService,
    select: { externalId: true, deviceType: true, firmwareVersion: true },
    query: {},
    describe: (row: IoTDevice): Dictionary<string> => {
      return compactAttributes({
        "device.id": row.externalId,
        "device.type": row.deviceType,
        "device.firmware.version": row.firmwareVersion,
      });
    },
  }),
  defineInventorySource<DockerHost>({
    entityType: EntityType.DockerHost,
    resourceType: "DockerHost",
    service: DockerHostService,
    select: { hostIdentifier: true, osType: true, osVersion: true },
    query: { isArchived: false },
    describe: (row: DockerHost): Dictionary<string> => {
      return compactAttributes({
        "host.name": row.hostIdentifier,
        "os.type": row.osType,
        "os.version": row.osVersion,
      });
    },
  }),
  defineInventorySource<PodmanHost>({
    entityType: EntityType.PodmanHost,
    resourceType: "PodmanHost",
    service: PodmanHostService,
    select: { hostIdentifier: true, osType: true, osVersion: true },
    query: { isArchived: false },
    describe: (row: PodmanHost): Dictionary<string> => {
      return compactAttributes({
        "host.name": row.hostIdentifier,
        "os.type": row.osType,
        "os.version": row.osVersion,
      });
    },
  }),
];

export interface InventorySyncResult {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Forward pass: every live inventory row gets a registry row, and one that
 * has drifted (renamed, re-tagged) is rewritten.
 */
async function mirrorRows(
  source: ErasedInventorySource,
): Promise<{ created: number; updated: number }> {
  let created: number = 0;
  let updated: number = 0;
  let skip: number = 0;

  for (;;) {
    const rows: Array<InventoryRowProjection> = await source.fetchPage({
      skip,
      limit: INVENTORY_SYNC_PAGE_SIZE,
    });

    if (rows.length === 0) {
      break;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const desiredByKey: Map<string, TelemetryEntity> = new Map<
      string,
      TelemetryEntity
    >();

    for (const row of rows) {
      const model: TelemetryEntity = buildInventoryEntityModel({
        source,
        row,
        now,
      });
      desiredByKey.set(model.entityKey!, model);
    }

    const existingRows: Array<TelemetryEntity> =
      await TelemetryEntityService.findBy({
        query: {
          entityType: source.entityType,
          entityKey: QueryHelper.any(Array.from(desiredByKey.keys())),
        },
        select: {
          _id: true,
          entityKey: true,
          displayName: true,
          descriptiveAttributes: true,
          resourceType: true,
          resourceId: true,
        },
        skip: 0,
        limit: desiredByKey.size,
        props: { isRoot: true },
      });

    const existingByKey: Map<string, TelemetryEntity> = new Map<
      string,
      TelemetryEntity
    >();
    for (const existing of existingRows) {
      existingByKey.set(existing.entityKey!, existing);
    }

    for (const [key, desired] of desiredByKey.entries()) {
      const existing: TelemetryEntity | undefined = existingByKey.get(key);

      try {
        if (!existing) {
          await TelemetryEntityService.create({
            data: desired,
            props: { isRoot: true },
          });
          created++;
          continue;
        }

        if (inventoryEntityNeedsUpdate({ existing, desired })) {
          await TelemetryEntityService.updateOneById({
            id: existing.id!,
            data: buildMirrorUpdate(desired),
            props: { isRoot: true },
          });
          updated++;
        }
      } catch (err) {
        /*
         * One unmirrorable row must not stall the rest of the estate. The
         * next run retries it, so a transient failure self-heals.
         */
        logger.error(
          `InventoryEntityRegistry: failed to mirror ${source.resourceType} row for entity key ${key}:`,
        );
        logger.error(err as Error);
      }
    }

    skip += rows.length;

    if (rows.length < INVENTORY_SYNC_PAGE_SIZE) {
      break;
    }
  }

  return { created, updated };
}

/**
 * Reverse pass: a mirrored row whose owning inventory row is gone is
 * deleted. This is what catches cascade deletes, which fire no service hook.
 */
async function removeOrphans(source: ErasedInventorySource): Promise<number> {
  const orphanIds: Array<ObjectID> = [];
  let skip: number = 0;

  /*
   * Collected across a read-only pass and deleted afterwards. Deleting while
   * paging would shift subsequent offsets and skip rows.
   */
  for (;;) {
    const rows: Array<TelemetryEntity> = await TelemetryEntityService.findBy({
      query: {
        entityType: source.entityType,
        source: EntitySource.Inventory,
      },
      select: { _id: true, resourceId: true },
      skip,
      limit: INVENTORY_SYNC_PAGE_SIZE,
      props: { isRoot: true },
    });

    if (rows.length === 0) {
      break;
    }

    const resourceIds: Array<ObjectID> = [];
    for (const row of rows) {
      if (row.resourceId) {
        resourceIds.push(row.resourceId);
      }
    }

    const liveIds: Set<string> = await source.findLiveIds(resourceIds);

    for (const row of rows) {
      /*
       * A mirrored row with no pointer cannot be matched back to anything,
       * so it is orphaned by definition.
       */
      if (!row.resourceId || !liveIds.has(row.resourceId.toString())) {
        orphanIds.push(row.id!);
      }
    }

    skip += rows.length;

    if (rows.length < INVENTORY_SYNC_PAGE_SIZE) {
      break;
    }
  }

  if (orphanIds.length === 0) {
    return 0;
  }

  await TelemetryEntityService.hardDeleteBy({
    query: {
      _id: QueryHelper.any(
        orphanIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ),
      // Re-asserted so a bug upstream can never widen this into a broad delete.
      source: EntitySource.Inventory,
    },
    limit: orphanIds.length,
    skip: 0,
    props: { isRoot: true },
  });

  return orphanIds.length;
}

/** Reconciles one inventory table into the registry. */
export async function syncInventorySource(
  source: ErasedInventorySource,
): Promise<InventorySyncResult> {
  const { created, updated } = await mirrorRows(source);
  const deleted: number = await removeOrphans(source);
  return { created, updated, deleted };
}

/**
 * Reconciles every inventory table. Each source is isolated: a failure in
 * one leaves the others to complete, because a broken cloud integration
 * should not stop network devices being mirrored.
 */
export async function syncAllInventorySources(): Promise<InventorySyncResult> {
  const total: InventorySyncResult = { created: 0, updated: 0, deleted: 0 };

  for (const source of INVENTORY_SOURCES) {
    try {
      const result: InventorySyncResult = await syncInventorySource(source);
      total.created += result.created;
      total.updated += result.updated;
      total.deleted += result.deleted;
    } catch (err) {
      logger.error(
        `InventoryEntityRegistry: sync failed for ${source.resourceType}:`,
      );
      logger.error(err as Error);
    }
  }

  return total;
}
