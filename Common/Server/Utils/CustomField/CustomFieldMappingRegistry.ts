import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingRelationSelect,
  getCustomFieldMappingSources,
} from "../../../Types/CustomField/CustomFieldMappingCatalog";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import AlertService from "../../Services/AlertService";
import IncidentService from "../../Services/IncidentService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import MonitorService from "../../Services/MonitorService";
import AlertCustomFieldService from "../../Services/AlertCustomFieldService";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import MonitorCustomFieldService from "../../Services/MonitorCustomFieldService";
import ScheduledMaintenanceCustomFieldService from "../../Services/ScheduledMaintenanceCustomFieldService";
import QueryHelper from "../../Types/Database/QueryHelper";
import RelationIdUtil from "../Database/RelationIdUtil";

/*
 * The server-side half of the mapping catalog: the same resource pairs, wired
 * to the services and query shapes needed to actually read a source and find
 * the targets attached to it.
 *
 * WHY EVERY SERVICE REFERENCE IS BEHIND A FUNCTION. This registry is imported
 * by AlertService/IncidentService/ScheduledMaintenanceService (their create
 * and update hooks) and imports them straight back. Circular imports are fine
 * in this codebase, but only if the cycle is not dereferenced while the
 * modules are still initialising — a top-level `service: AlertService` in an
 * array literal would capture `undefined` for whichever module got there
 * first. Reading them inside a call defers that to a point where every module
 * is loaded.
 *
 * WHY THE SHAPES ARE SPELLED OUT PER PAIR RATHER THAN REFLECTED. Alert holds a
 * single `monitorId`; Incident and Scheduled Maintenance hold a `monitors`
 * ManyToMany through a join table. The select clause, the payload keys and the
 * reverse query differ for each, and none of it is derivable from the column
 * metadata without a small framework. Three explicit descriptors are shorter
 * than the framework and are what a reader has to check anyway.
 */

export type DatabaseServiceLike = {
  findBy: (data: any) => Promise<Array<any>>;
  findOneById: (data: any) => Promise<any>;
  updateColumnsByIdWithoutHooks: (data: any) => Promise<void>;
};

export interface CustomFieldMappingSourceEntry {
  info: CustomFieldMappingSourceInfo;

  /** Service owning the SOURCE records (e.g. MonitorService). */
  getSourceService: () => DatabaseServiceLike;

  /** Service owning the SOURCE definitions (e.g. MonitorCustomFieldService). */
  getSourceDefinitionService: () => DatabaseServiceLike;

  /**
   * Keys the relation can arrive under in a create/update payload. The FK
   * column comes first, per the RelationIdUtil contract: the dashboard posts
   * `{ monitor: { _id } }` while server callers write `{ monitorId }`, and a
   * hook that inspects one spelling silently ignores the other.
   */
  relationDataKeys: Array<string>;

  /** Select clause that pulls the relation off a persisted target record. */
  targetRelationSelect: JSONObject;

  /** Source ids on a target record already read with `targetRelationSelect`. */
  readSourceIdsFromRecord: (record: any) => Array<ObjectID>;

  /**
   * Source ids in a create/update payload, or null when the payload says
   * nothing about the relation (which is different from clearing it).
   */
  readSourceIdsFromPayload: (data: any) => Array<ObjectID> | null;

  /**
   * Source records already hydrated on the payload, keyed by id string.
   *
   * The hottest creation path in the product — a monitor criterion opening an
   * alert — assigns the whole Monitor object, and MonitorResource already
   * selects `customFields` on it. Taking the bag from there means the ingest
   * path pays no extra query at all.
   */
  readHydratedSourcesFromPayload: (data: any) => Record<string, JSONObject>;

  /** Query matching every target record attached to one source record. */
  buildTargetQueryForSourceId: (sourceId: ObjectID) => JSONObject;
}

export interface CustomFieldMappingTargetEntry {
  /** Human name used in log lines, e.g. "Alert". */
  targetName: string;
  /** Definition table name — the catalog key, e.g. "AlertCustomField". */
  definitionTableName: string;
  getTargetService: () => DatabaseServiceLike;
  getDefinitionService: () => DatabaseServiceLike;
  sources: Array<CustomFieldMappingSourceEntry>;
}

type BuildMonitorSourceFunction = (data: {
  isManySources: boolean;
  definitionTableName: string;
}) => CustomFieldMappingSourceEntry;

const buildMonitorSource: BuildMonitorSourceFunction = (data: {
  isManySources: boolean;
  definitionTableName: string;
}): CustomFieldMappingSourceEntry => {
  const info: CustomFieldMappingSourceInfo | undefined =
    getCustomFieldMappingSources(data.definitionTableName).find(
      (source: CustomFieldMappingSourceInfo) => {
        return source.resource === CustomFieldMappingSourceResource.Monitor;
      },
    );

  if (!info) {
    /*
     * The catalog is the single source of truth for which pairs exist. If it
     * no longer lists this one, the registry must not invent it — a mapping
     * the settings UI cannot offer would be a value nobody can explain.
     */
    throw new Error(
      `CustomFieldMappingRegistry: ${data.definitionTableName} has no Monitor source in the catalog.`,
    );
  }

  const isMany: boolean = data.isManySources;

  return {
    info: info,
    getSourceService: (): DatabaseServiceLike => {
      return MonitorService as unknown as DatabaseServiceLike;
    },
    getSourceDefinitionService: (): DatabaseServiceLike => {
      return MonitorCustomFieldService as unknown as DatabaseServiceLike;
    },
    relationDataKeys: info.relationDataKeys,
    targetRelationSelect: getCustomFieldMappingRelationSelect(
      info,
    ) as JSONObject,
    readSourceIdsFromRecord: (record: any): Array<ObjectID> => {
      if (!isMany) {
        const monitorId: ObjectID | null = RelationIdUtil.read(
          record as Record<string, unknown>,
          ["monitorId", "monitor"],
        );

        return monitorId ? [monitorId] : [];
      }

      const monitors: Array<Monitor> = (record?.monitors ||
        []) as Array<Monitor>;

      return monitors
        .map((monitor: Monitor) => {
          return RelationIdUtil.read(
            monitor as unknown as Record<string, unknown>,
            ["_id", "id"],
          );
        })
        .filter((id: ObjectID | null): id is ObjectID => {
          return Boolean(id);
        });
    },
    readSourceIdsFromPayload: (payload: any): Array<ObjectID> | null => {
      if (!isMany) {
        const hasKey: boolean = RelationIdUtil.isWritten(
          Object.keys(payload || {}),
          info.relationDataKeys,
        );

        if (!hasKey) {
          return null;
        }

        const monitorId: ObjectID | null = RelationIdUtil.read(
          payload as Record<string, unknown>,
          info.relationDataKeys,
        );

        return monitorId ? [monitorId] : [];
      }

      if ((payload || {})[info.targetRelationProperty] === undefined) {
        return null;
      }

      const monitors: Array<Monitor> = ((payload || {})[
        info.targetRelationProperty
      ] || []) as Array<Monitor>;

      return monitors
        .map((monitor: Monitor) => {
          return RelationIdUtil.read(
            monitor as unknown as Record<string, unknown>,
            ["_id", "id"],
          );
        })
        .filter((id: ObjectID | null): id is ObjectID => {
          return Boolean(id);
        });
    },
    readHydratedSourcesFromPayload: (
      payload: any,
    ): Record<string, JSONObject> => {
      const hydrated: Record<string, JSONObject> = {};

      /*
       * The RELATION-object spelling only. A payload that carries just the FK
       * (`monitorId`) has no bag to take, and must fall through to a lookup.
       */
      const relationObjectKey: string = isMany
        ? info.targetRelationProperty
        : info.relationDataKeys[info.relationDataKeys.length - 1]!;

      const candidates: Array<Monitor> = isMany
        ? ((payload || {})[relationObjectKey] as Array<Monitor>) || []
        : [(payload || {})[relationObjectKey] as Monitor].filter(Boolean);

      for (const monitor of candidates) {
        if (!monitor || !monitor.id) {
          continue;
        }

        /*
         * Only a monitor that was read WITH its customFields is usable here.
         * An id stub is not the same as a monitor whose bag is genuinely
         * empty: treating it as empty skips the lookup and silently inherits
         * nothing.
         *
         * `!== undefined` and NOT `hasOwnProperty`. Every model class in this
         * codebase initialises its columns in the class body
         * (`public customFields?: JSONObject = undefined;`), so a bare
         * `new Monitor()` already owns the property and hasOwnProperty is true
         * for every stub ever built. A row read WITH the column, whose value
         * is NULL in Postgres, arrives as `null` — which is a real answer and
         * correctly counts as hydrated.
         */
        if (monitor.customFields === undefined) {
          continue;
        }

        hydrated[monitor.id.toString()] = (monitor.customFields ||
          {}) as JSONObject;
      }

      return hydrated;
    },
    buildTargetQueryForSourceId: (sourceId: ObjectID): JSONObject => {
      return {
        [info.targetRelationProperty]: isMany
          ? QueryHelper.inRelationArray([sourceId])
          : sourceId,
      } as unknown as JSONObject;
    },
  };
};

const CUSTOM_FIELD_MAPPING_TARGETS: Array<CustomFieldMappingTargetEntry> = [
  {
    targetName: "Alert",
    definitionTableName: new AlertCustomField().tableName!,
    getTargetService: (): DatabaseServiceLike => {
      return AlertService as unknown as DatabaseServiceLike;
    },
    getDefinitionService: (): DatabaseServiceLike => {
      return AlertCustomFieldService as unknown as DatabaseServiceLike;
    },
    sources: [
      buildMonitorSource({
        isManySources: false,
        definitionTableName: new AlertCustomField().tableName!,
      }),
    ],
  },
  {
    targetName: "Incident",
    definitionTableName: new IncidentCustomField().tableName!,
    getTargetService: (): DatabaseServiceLike => {
      return IncidentService as unknown as DatabaseServiceLike;
    },
    getDefinitionService: (): DatabaseServiceLike => {
      return IncidentCustomFieldService as unknown as DatabaseServiceLike;
    },
    sources: [
      buildMonitorSource({
        isManySources: true,
        definitionTableName: new IncidentCustomField().tableName!,
      }),
    ],
  },
  {
    targetName: "Scheduled Maintenance",
    definitionTableName: new ScheduledMaintenanceCustomField().tableName!,
    getTargetService: (): DatabaseServiceLike => {
      return ScheduledMaintenanceService as unknown as DatabaseServiceLike;
    },
    getDefinitionService: (): DatabaseServiceLike => {
      return ScheduledMaintenanceCustomFieldService as unknown as DatabaseServiceLike;
    },
    sources: [
      buildMonitorSource({
        isManySources: true,
        definitionTableName: new ScheduledMaintenanceCustomField().tableName!,
      }),
    ],
  },
];

export type GetCustomFieldMappingTargetsFunction =
  () => Array<CustomFieldMappingTargetEntry>;

export const getCustomFieldMappingTargets: GetCustomFieldMappingTargetsFunction =
  (): Array<CustomFieldMappingTargetEntry> => {
    return CUSTOM_FIELD_MAPPING_TARGETS;
  };

export type GetCustomFieldMappingTargetFunction = (
  definitionTableName: string | undefined,
) => CustomFieldMappingTargetEntry | undefined;

export const getCustomFieldMappingTarget: GetCustomFieldMappingTargetFunction =
  (
    definitionTableName: string | undefined,
  ): CustomFieldMappingTargetEntry | undefined => {
    if (!definitionTableName) {
      return undefined;
    }

    return CUSTOM_FIELD_MAPPING_TARGETS.find(
      (target: CustomFieldMappingTargetEntry) => {
        return target.definitionTableName === definitionTableName;
      },
    );
  };

/**
 * Targets that can inherit from a given source resource — the reverse lookup
 * the propagation path needs when a monitor's custom fields change.
 */
export type GetCustomFieldMappingTargetsForSourceFunction = (
  resource: CustomFieldMappingSourceResource,
) => Array<{
  target: CustomFieldMappingTargetEntry;
  source: CustomFieldMappingSourceEntry;
}>;

export const getCustomFieldMappingTargetsForSource: GetCustomFieldMappingTargetsForSourceFunction =
  (
    resource: CustomFieldMappingSourceResource,
  ): Array<{
    target: CustomFieldMappingTargetEntry;
    source: CustomFieldMappingSourceEntry;
  }> => {
    const matches: Array<{
      target: CustomFieldMappingTargetEntry;
      source: CustomFieldMappingSourceEntry;
    }> = [];

    for (const target of CUSTOM_FIELD_MAPPING_TARGETS) {
      for (const source of target.sources) {
        if (source.info.resource === resource) {
          matches.push({ target: target, source: source });
        }
      }
    }

    return matches;
  };
