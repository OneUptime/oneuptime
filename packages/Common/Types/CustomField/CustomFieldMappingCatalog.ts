import CustomFieldMappingSourceResource from "./CustomFieldMappingSourceResource";

/*
 * WHICH RESOURCE PAIRS CAN MAP, in a form both the browser and the server can
 * read.
 *
 * Custom field definitions live in nine sibling tables and the values they
 * describe live in a `customFields` jsonb bag on nine different resources.
 * Nothing in the codebase previously wrote down the pairing between the two,
 * let alone which resource is reachable from which — that knowledge was
 * spread across ~19 JSX call sites. A "map this field's value from a related
 * resource" feature needs it in exactly three places at once (the settings
 * picker, the create-time resolver and the propagation fan-out), so it is
 * stated once, here, in Types where App's React-free tsc can import it.
 *
 * Keyed by the TARGET definition table name (`new AlertCustomField().tableName`)
 * because that is what a settings page has in hand.
 *
 * A resource is listed only when the target genuinely has a relation to it AND
 * the source itself carries custom fields. Today that is Monitor, reachable
 * from Alert (one monitor), Incident and Scheduled Maintenance (many). The six
 * definition tables with no reachable source are absent rather than mapped to
 * an empty array, so `getCustomFieldMappingSources` returning nothing is the
 * same answer for "unknown table" and "no sources" — which is what the UI
 * wants either way.
 */
export interface CustomFieldMappingSourceInfo {
  resource: CustomFieldMappingSourceResource;
  /** How the source is named to an operator, e.g. "Monitor". */
  title: string;
  /** Definition table listing the fields available on the source. */
  sourceDefinitionTableName: string;
  /**
   * True when the target can be attached to several sources at once (an
   * incident spans many monitors). Drives the wording of the settings help
   * text, because the resolution rule differs — see resolveMappedCustomFieldValue.
   */
  isManySources: boolean;
  /**
   * Property on the TARGET record that holds the relation: the FK column for a
   * single source, the relation array for many.
   */
  targetRelationProperty: string;
  /**
   * Keys the relation can arrive under in a create or update payload, FK
   * spelling FIRST. The dashboard posts `{ monitor: { _id } }` while server
   * callers write `{ monitorId }`, and hooks run before TypeORM resolves one
   * into the other — see Common/Server/Utils/Database/RelationIdUtil.ts.
   */
  relationDataKeys: Array<string>;
}

const MONITOR_SOURCE: (
  isManySources: boolean,
) => CustomFieldMappingSourceInfo = (
  isManySources: boolean,
): CustomFieldMappingSourceInfo => {
  return {
    resource: CustomFieldMappingSourceResource.Monitor,
    title: "Monitor",
    sourceDefinitionTableName: "MonitorCustomField",
    isManySources: isManySources,
    targetRelationProperty: isManySources ? "monitors" : "monitorId",
    relationDataKeys: isManySources ? ["monitors"] : ["monitorId", "monitor"],
  };
};

const CUSTOM_FIELD_MAPPING_CATALOG: Record<
  string,
  Array<CustomFieldMappingSourceInfo>
> = {
  AlertCustomField: [MONITOR_SOURCE(false)],
  IncidentCustomField: [MONITOR_SOURCE(true)],
  ScheduledMaintenanceCustomField: [MONITOR_SOURCE(true)],
};

export type GetCustomFieldMappingSourcesFunction = (
  definitionTableName: string | undefined,
) => Array<CustomFieldMappingSourceInfo>;

export const getCustomFieldMappingSources: GetCustomFieldMappingSourcesFunction =
  (
    definitionTableName: string | undefined,
  ): Array<CustomFieldMappingSourceInfo> => {
    if (!definitionTableName) {
      return [];
    }

    return CUSTOM_FIELD_MAPPING_CATALOG[definitionTableName] || [];
  };

export type GetCustomFieldMappingSourceFunction = (data: {
  definitionTableName: string | undefined;
  resource: CustomFieldMappingSourceResource | string | undefined;
}) => CustomFieldMappingSourceInfo | undefined;

export const getCustomFieldMappingSource: GetCustomFieldMappingSourceFunction =
  (data: {
    definitionTableName: string | undefined;
    resource: CustomFieldMappingSourceResource | string | undefined;
  }): CustomFieldMappingSourceInfo | undefined => {
    if (!data.resource) {
      return undefined;
    }

    return getCustomFieldMappingSources(data.definitionTableName).find(
      (source: CustomFieldMappingSourceInfo) => {
        return source.resource === data.resource;
      },
    );
  };

export type GetCustomFieldMappingRelationSelectFunction = (
  source: CustomFieldMappingSourceInfo,
) => Record<string, unknown>;

/**
 * The `select` clause that pulls a source relation off a target record. Shared
 * so the server resolver and the resource's Custom Fields card ask for the
 * same shape and read it back the same way.
 */
export const getCustomFieldMappingRelationSelect: GetCustomFieldMappingRelationSelectFunction =
  (source: CustomFieldMappingSourceInfo): Record<string, unknown> => {
    return {
      [source.targetRelationProperty]: source.isManySources
        ? { _id: true }
        : true,
    };
  };

export type HasCustomFieldMappingSourceFunction = (data: {
  source: CustomFieldMappingSourceInfo;
  record: Record<string, unknown> | null | undefined;
}) => boolean;

/**
 * Is this record actually attached to something to inherit from?
 *
 * A large and ordinary class of records is not: SLO burn-rate alerts,
 * security-event alerts, network-site rollup alerts and AI-declared incidents
 * are all created with no monitor. A mapped field on one of those can never be
 * filled in automatically, so it stays hand-editable rather than becoming a
 * permanently blank box the operator is locked out of.
 */
export const hasCustomFieldMappingSource: HasCustomFieldMappingSourceFunction =
  (data: {
    source: CustomFieldMappingSourceInfo;
    record: Record<string, unknown> | null | undefined;
  }): boolean => {
    const value: unknown = (data.record || {})[
      data.source.targetRelationProperty
    ];

    if (data.source.isManySources) {
      return Array.isArray(value) && value.length > 0;
    }

    return Boolean(value);
  };

/*
 * The two columns of a custom field definition that map it from a field of
 * a related resource. Loose, so definition rows and the forms' own
 * definitions can be passed as they are.
 */
export interface CustomFieldMappingColumns {
  mapFromResourceType?: string | null | undefined;
  mapFromCustomFieldName?: string | null | undefined;
}

export type GetCustomFieldInheritanceSourceFunction = (data: {
  definitionTableName: string | undefined;
  definition: CustomFieldMappingColumns;
}) => CustomFieldMappingSourceInfo | undefined;

/**
 * The resource a field copies its value from - undefined for a field that
 * is typed in, or mapped from a resource its table cannot reach.
 */
export const getCustomFieldInheritanceSource: GetCustomFieldInheritanceSourceFunction =
  (data: {
    definitionTableName: string | undefined;
    definition: CustomFieldMappingColumns;
  }): CustomFieldMappingSourceInfo | undefined => {
    if (
      !data.definition.mapFromResourceType ||
      !data.definition.mapFromCustomFieldName
    ) {
      return undefined;
    }

    return getCustomFieldMappingSource({
      definitionTableName: data.definitionTableName,
      resource: data.definition.mapFromResourceType,
    });
  };

export type IsCustomFieldInheritedByRecordFunction = (data: {
  definitionTableName: string | undefined;
  definition: CustomFieldMappingColumns;
  // The record as it will be created: its relations decide.
  record: Record<string, unknown> | null | undefined;
}) => boolean;

/**
 * Whether a field's value will be copied from a related resource rather than
 * typed: it is mapped (an incident field from a monitor field) and the
 * record is attached to something to copy from (the incident has a
 * monitor). The server applies the mapping last on create, so asking for
 * such a value would only have it replaced.
 *
 * The one rule every form that decides whether to ask for a field follows:
 * the dashboard's Declare Incident form and template wizard (through
 * isCustomFieldInherited), and the public incident forms.
 */
export const isCustomFieldInheritedByRecord: IsCustomFieldInheritedByRecordFunction =
  (data: {
    definitionTableName: string | undefined;
    definition: CustomFieldMappingColumns;
    record: Record<string, unknown> | null | undefined;
  }): boolean => {
    const source: CustomFieldMappingSourceInfo | undefined =
      getCustomFieldInheritanceSource({
        definitionTableName: data.definitionTableName,
        definition: data.definition,
      });

    if (!source) {
      return false;
    }

    return hasCustomFieldMappingSource({
      source: source,
      record: data.record,
    });
  };

export default CUSTOM_FIELD_MAPPING_CATALOG;
