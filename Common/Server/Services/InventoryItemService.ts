import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/InventoryItem";
import Service from "../../Models/DatabaseModels/Service";
import ServiceService from "./ServiceService";
import QueryHelper from "../Types/Database/QueryHelper";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import ColumnLength from "../../Types/Database/ColumnLength";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import EntitySource from "../../Types/Telemetry/EntitySource";
import EntityType from "../../Types/Telemetry/EntityType";
import { MANUAL_ENTITY_TYPES } from "../../Types/Telemetry/EntityTypeGroups";
import {
  canonicalizeEntityValue,
  computeEntityKey,
  MANUAL_ENTITY_IDENTITY_ATTRIBUTE,
} from "../../Utils/Telemetry/EntityKey";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ExtractedEntity } from "../Utils/Telemetry/TelemetryEntity";
import {
  getEntityBudget,
  reconcileByNaturalKey,
  REGISTRY_PROMOTED_TYPES,
  shouldWarnEntityBudgetOnce,
} from "../Utils/Telemetry/EntityRegistry";

export class InventoryItemService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Completes a manually created CI.
   *
   * Every machine writer — the ingest reconciler and the inventory mirror —
   * computes `entityKey` itself and passes an explicit `source`, because
   * both derive identity from something the user never sees (a canonicalized
   * semconv attribute set, or the owning row's id). A create arriving
   * WITHOUT a key is therefore a user create by construction, and this hook
   * is what turns the two fields a human can reasonably supply (type and
   * name) into the identity the registry needs.
   *
   * Deriving the key here rather than in the dashboard keeps it enforced for
   * API clients too, and keeps the one identity rule — canonicalize, then
   * hash — in the module that owns it.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Model = createBy.data;

    if (!data.entityKey) {
      data.source = EntitySource.Manual;
    }

    if (data.source !== EntitySource.Manual) {
      return { createBy, carryForward: null };
    }

    if (!data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    if (!data.entityType) {
      throw new BadDataException("Entity Type is required.");
    }

    /*
     * Confined to the manual-only vocabulary. A hand-made row of an
     * observable type would key off the manual identity attribute and so
     * could never converge with the row ingest derives for the same thing —
     * it would just sit beside it forever. See MANUAL_ENTITY_TYPES.
     */
    if (!MANUAL_ENTITY_TYPES.has(data.entityType)) {
      throw new BadDataException(
        `Entities of type ${data.entityType} are discovered automatically and cannot be created manually. Manually creatable types are: ${Array.from(
          MANUAL_ENTITY_TYPES,
        ).join(", ")}.`,
      );
    }

    const displayName: string = (data.displayName || "").trim();

    if (!displayName) {
      throw new BadDataException(
        "Name is required for a manually created entity.",
      );
    }

    data.displayName = displayName.substring(0, ColumnLength.ShortText);

    const identifyingAttributes: Dictionary<string> = {
      [MANUAL_ENTITY_IDENTITY_ATTRIBUTE]: canonicalizeEntityValue(displayName),
    };
    data.identifyingAttributes = identifyingAttributes as JSONObject;

    data.entityKey = computeEntityKey({
      projectId: data.projectId.toString(),
      entityType: data.entityType,
      identifyingAttributes,
    });

    /*
     * Stamped so the explorer can sort manual CIs alongside discovered ones
     * on the same columns. `lastSeenAt` never moves again for these rows —
     * it means "created", not "observed" — which is exactly why the prune
     * sweep excludes them.
     */
    const now: Date = OneUptimeDate.getCurrentDate();
    data.firstSeenAt = data.firstSeenAt || now;
    data.lastSeenAt = data.lastSeenAt || now;

    return { createBy, carryForward: null };
  }

  /**
   * Forward-only registry reconciliation: upsert a catalog row per
   * discovered entity, bump `lastSeenAt`, merge descriptive attributes
   * (last-writer-wins) and union labels. High-churn membership-only
   * types (container / process / service.instance / telemetry.sdk — see
   * `REGISTRY_PROMOTED_TYPES`) are skipped: their keys still flow into
   * the `entityKeys` column on signals, they just never mint registry
   * rows. New rows are additionally gated by a per-(project, type)
   * entity budget. Resilient by design — a registry failure must never break
   * signal ingest, so every error is swallowed (logged). Callers are
   * expected to throttle this (it should not run on every batch); see
   * `reconcileEntityRegistryThrottled` in
   * `Common/Server/Utils/Telemetry/EntityRegistry`.
   */
  @CaptureSpan()
  public async reconcileEntities(data: {
    projectId: ObjectID;
    entities: Array<ExtractedEntity>;
  }): Promise<void> {
    /*
     * Per-reconcile budget count cache: at most one countBy per entity
     * type per reconcile (the fence already throttles reconciles to one
     * per entity-set per window, so this stays cheap). Creates within
     * this reconcile increment the cached count so a single batch cannot
     * blow past the budget.
     */
    const countByType: Map<EntityType, number> = new Map<EntityType, number>();

    for (const entity of data.entities) {
      if (!REGISTRY_PROMOTED_TYPES.has(entity.entityType)) {
        continue;
      }
      try {
        await this.upsertEntity({
          projectId: data.projectId,
          entity,
          countByType,
        });
      } catch (err) {
        logger.error(
          `InventoryItemService: failed to upsert entity ${entity.entityType}/${entity.entityKey}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  /**
   * The polymorphic (resourceType, resourceId) pointer for Service
   * entities: resolve the backing Service row by name (case-insensitive —
   * entity display names are canonicalized to lowercase while Service
   * rows keep their original casing, the same matching ingest itself
   * uses). This is the single place the name join happens; everything
   * downstream (traces links, overlays) reads the pointer instead of
   * re-matching names. Best-effort: no Service row means no pointer.
   */
  private async resolveServiceResourceId(data: {
    projectId: ObjectID;
    entity: ExtractedEntity;
  }): Promise<ObjectID | null> {
    if (data.entity.entityType !== EntityType.Service) {
      return null;
    }
    const name: string = InventoryItemService.deriveDisplayName(data.entity);
    if (!name) {
      return null;
    }
    try {
      /*
       * createdAt ASC mirrors ingest's findOrCreateTelemetryService: if
       * case-variant duplicate Service rows exist, telemetry keys to the
       * OLDEST row, so the pointer must resolve to the same one.
       */
      const service: Service | null = await ServiceService.findOneBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameText(name),
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      });
      return service?._id ? new ObjectID(service._id.toString()) : null;
    } catch (err) {
      logger.error(
        `InventoryItemService: failed to resolve Service row for entity name "${name}":`,
      );
      logger.error(err as Error);
      return null;
    }
  }

  private async upsertEntity(data: {
    projectId: ObjectID;
    entity: ExtractedEntity;
    countByType: Map<EntityType, number>;
  }): Promise<void> {
    const { projectId, entity, countByType } = data;
    const now: Date = OneUptimeDate.getCurrentDate();

    const serviceResourceId: ObjectID | null =
      await this.resolveServiceResourceId({ projectId, entity });

    await reconcileByNaturalKey({
      service: this,
      query: {
        projectId,
        entityType: entity.entityType,
        entityKey: entity.entityKey,
      },
      lastSeenAt: now,
      describe: `entity ${entity.entityType}/${entity.entityKey}`,
      rowFenceId: `${projectId.toString()}:${entity.entityType}:${entity.entityKey}`,
      select: {
        displayName: true,
        descriptiveAttributes: true,
        labels: true,
        resourceId: true,
      },
      buildUpdate: (existing: Model): QueryDeepPartialEntity<Model> => {
        const update: QueryDeepPartialEntity<Model> =
          InventoryItemService.buildDescriptiveUpdate(entity, existing);
        /*
         * Stamp / refresh the pointer on the throttled bump too, so
         * pre-existing rows converge and a deleted+recreated Service
         * (new id, same name) heals instead of pointing at a dead row.
         */
        if (
          serviceResourceId &&
          existing.resourceId?.toString() !== serviceResourceId.toString()
        ) {
          (update as { resourceType?: string }).resourceType = "Service";
          (update as { resourceId?: ObjectID }).resourceId = serviceResourceId;
        }
        return update;
      },
      /*
       * Entity budget (doc §Edge Cases): existing rows always get their
       * bump above; only NEW rows are gated. Counted via the
       * (projectId, entityType) index; over budget the row is skipped —
       * its key still flows in `entityKeys` on signals.
       */
      beforeCreate: async (): Promise<boolean> => {
        const budget: number = getEntityBudget(entity.entityType);

        let count: number | undefined = countByType.get(entity.entityType);
        if (count === undefined) {
          count = (
            await this.countBy({
              query: {
                projectId,
                entityType: entity.entityType,
                /*
                 * The budget exists to bound rows minted by ingest, so it
                 * counts only those. Manual CIs and inventory mirrors are
                 * bounded by their own creators and must not consume it —
                 * otherwise registering enough devices could stop new
                 * telemetry entities being recorded at all.
                 */
                source: EntitySource.Discovered,
              },
              props: { isRoot: true },
            })
          ).toNumber();
          countByType.set(entity.entityType, count);
        }

        if (count < budget) {
          countByType.set(entity.entityType, count + 1);
          return true;
        }

        if (
          await shouldWarnEntityBudgetOnce({
            projectId,
            entityType: entity.entityType,
          })
        ) {
          logger.warn(
            `InventoryItemService: entity budget reached for project ${projectId.toString()} type ${entity.entityType} (${count} >= ${budget}); skipping new registry rows. Membership keys still flow on signals.`,
          );
        }
        return false;
      },
      buildModel: () => {
        const model: Model = new Model();
        model.projectId = projectId;
        model.entityType = entity.entityType;
        model.entityKey = entity.entityKey;
        /*
         * Explicit rather than leaning on the column default: this is the
         * flag that makes the row eligible for stale-entity pruning, and a
         * silently-defaulted value is a poor way to carry that.
         */
        model.source = EntitySource.Discovered;
        model.identifyingAttributes = entity.identifyingAttributes;
        if (
          entity.descriptiveAttributes &&
          Object.keys(entity.descriptiveAttributes).length > 0
        ) {
          model.descriptiveAttributes = entity.descriptiveAttributes;
        }
        if (entity.labels && entity.labels.length > 0) {
          model.labels = InventoryItemService.normalizeLabels(entity.labels);
        }
        // varchar(ShortText) column; k8s names can run to 253 chars.
        model.displayName = InventoryItemService.deriveDisplayName(
          entity,
        ).substring(0, ColumnLength.ShortText);
        if (serviceResourceId) {
          model.resourceType = "Service";
          model.resourceId = serviceResourceId;
        }
        model.firstSeenAt = now;
        model.lastSeenAt = now;
        return model;
      },
    });
  }

  /**
   * Extra fields for the `lastSeenAt` bump on an existing row: a legacy
   * generated Kubernetes fallback display name can converge to the resource
   * name, descriptive attributes merge last-writer-wins per key, and labels
   * merge as a set union. Each is written ONLY when it actually changes, so a
   * stable resource keeps its bump a one-column update (no text/jsonb churn).
   */
  private static buildDescriptiveUpdate(
    entity: ExtractedEntity,
    existing: Model,
  ): QueryDeepPartialEntity<Model> {
    /*
     * Built as a plain shape and cast once on return: assigning into
     * QueryDeepPartialEntity<Model> directly forces TS to instantiate the
     * recursive JSONObject mapping (TS2589).
     */
    const update: {
      displayName?: string;
      descriptiveAttributes?: JSONObject;
      labels?: Array<string>;
    } = {};

    const preferredNameKey: string | undefined =
      InventoryItemService.preferredDisplayNameAttributeByType[
        entity.entityType
      ];
    /*
     * Existing inventory display names may be user-edited. Only migrate a
     * pod/node row when its current value is exactly the value the old generic
     * algorithm generated. A sparse observation cannot erase a learned name,
     * and an unrelated entity type never has its display name reconciled here.
     */
    const preferredName: string | undefined = preferredNameKey
      ? entity.descriptiveAttributes?.[preferredNameKey] ||
        entity.identifyingAttributes?.[preferredNameKey]
      : undefined;
    if (preferredName) {
      const desiredDisplayName: string = preferredName.substring(
        0,
        ColumnLength.ShortText,
      );
      const legacyDisplayName: string =
        InventoryItemService.deriveFallbackDisplayName(entity).substring(
          0,
          ColumnLength.ShortText,
        );
      const existingDisplayName: string = existing.displayName || "";

      if (
        existingDisplayName !== desiredDisplayName &&
        (!existingDisplayName || existingDisplayName === legacyDisplayName)
      ) {
        update.displayName = desiredDisplayName;
      }
    }

    const incoming: Record<string, string> = entity.descriptiveAttributes || {};
    if (Object.keys(incoming).length > 0) {
      const current: Record<string, unknown> =
        (existing.descriptiveAttributes as Record<string, unknown>) || {};

      const differs: boolean = Object.keys(incoming).some((key: string) => {
        return current[key] !== incoming[key];
      });

      if (differs) {
        update.descriptiveAttributes = {
          ...current,
          ...incoming,
        } as JSONObject;
      }
    }

    const incomingLabels: Array<string> = entity.labels || [];
    if (incomingLabels.length > 0) {
      const currentLabels: Array<string> = existing.labels || [];
      const currentSet: Set<string> = new Set<string>(currentLabels);

      const hasNew: boolean = incomingLabels.some((label: string) => {
        return !currentSet.has(label);
      });

      if (hasNew) {
        update.labels = InventoryItemService.normalizeLabels([
          ...currentLabels,
          ...incomingLabels,
        ]);
      }
    }

    return update as unknown as QueryDeepPartialEntity<Model>;
  }

  /** Sorted + deduped for a stable stored value. */
  private static normalizeLabels(labels: Array<string>): Array<string> {
    return Array.from(new Set<string>(labels)).sort();
  }

  private static readonly preferredDisplayNameAttributeByType: Partial<
    Record<EntityType, string>
  > = {
    [EntityType.KubernetesNode]: "k8s.node.name",
    [EntityType.KubernetesPod]: "k8s.pod.name",
  };

  /**
   * Best-effort human-readable name for Inventory. Prefer the name belonging
   * to this exact entity type, including a descriptive name paired with a
   * stable UID identity (the normal Kubernetes pod/node shape). Falling back
   * to the longest identifying `*.name` preserves the behaviour for types
   * without a dedicated display-name rule.
   */
  public static deriveDisplayName(entity: ExtractedEntity): string {
    const id: Record<string, string> = entity.identifyingAttributes || {};
    const descriptive: Record<string, string> =
      entity.descriptiveAttributes || {};
    const preferredKey: string | undefined =
      this.preferredDisplayNameAttributeByType[entity.entityType];

    if (preferredKey) {
      const preferredValue: string | undefined =
        descriptive[preferredKey] || id[preferredKey];
      if (preferredValue) {
        return preferredValue;
      }
    }

    return this.deriveFallbackDisplayName(entity);
  }

  /** The generic display-name algorithm used before type-aware K8s names. */
  private static deriveFallbackDisplayName(entity: ExtractedEntity): string {
    const id: Record<string, string> = entity.identifyingAttributes || {};

    const nameKeys: Array<string> = Object.keys(id)
      .filter((k: string) => {
        return k.endsWith(".name");
      })
      .sort((a: string, b: string) => {
        return b.length - a.length;
      });

    if (nameKeys.length > 0 && id[nameKeys[0]!]) {
      return id[nameKeys[0]!]!;
    }

    const keys: Array<string> = Object.keys(id);
    if (keys.length > 0 && id[keys[keys.length - 1]!]) {
      return id[keys[keys.length - 1]!]!;
    }

    return entity.entityKey;
  }
}

export default new InventoryItemService();
