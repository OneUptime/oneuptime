import { getResourceFacetServiceTypeMap } from "Common/Types/Telemetry/ResourceFacetCatalog";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ResolvedTelemetryEntity,
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
  getTelemetryEntityTypeLabel,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";

/*
 * Naming the resources the Logs Insights page and its error-pattern drawer
 * list by id ("Where it happens", sample lines, "Sources reporting logs",
 * the scope picker).
 *
 * Those rows come from ClickHouse keyed on `primaryEntityId`, which is a
 * Service only some of the time — a RUM application, host or cluster logs
 * under its own id. The page's Service list names the Services; everything
 * else used to fall through to the raw UUID, and the type column showed the
 * raw enum ("RealUserMonitor"). The helpers below add the generic resolver
 * as the fallback and turn the enum into its label.
 *
 * React-free on purpose: App tests pin this without mounting the page.
 */

/*
 * The scope picker's resource facets whose values are ids of one known
 * table — every resource type in the shared catalog, so an unnamed Proxmox
 * cluster or IoT fleet goes straight to its own table instead of probing
 * all of them. `primaryEntityId` is absent: it is polymorphic, so it is
 * resolved without a hint.
 */
export const LOGS_SCOPE_FACET_ENTITY_TYPES: Readonly<
  Record<string, ServiceType>
> = Object.fromEntries(getResourceFacetServiceTypeMap());

export type ToServiceTypeFunction = (
  value: string | null | undefined,
) => ServiceType | undefined;

/** The ServiceType a server-sent type string names, if it names one. */
export const toServiceType: ToServiceTypeFunction = (
  value: string | null | undefined,
): ServiceType | undefined => {
  const text: string = (value || "").trim();

  if (
    !text ||
    !Object.prototype.hasOwnProperty.call(TELEMETRY_ENTITY_TYPES, text)
  ) {
    return undefined;
  }

  return text as ServiceType;
};

export interface LogsResourceRef {
  resourceId: string;
  resourceType?: string | undefined;
}

export type CollectLogsResourceIdsFunction = (
  refs: Array<LogsResourceRef> | undefined,
  isAlreadyNamed?: ((resourceId: string) => boolean) | undefined,
) => Array<string>;

/**
 * The unique, non-empty ids that still need a name. Ids a source the page
 * already loaded can name (its Service list) are skipped, so the resolver
 * only runs for what that source cannot cover.
 */
export const collectLogsResourceIds: CollectLogsResourceIdsFunction = (
  refs: Array<LogsResourceRef> | undefined,
  isAlreadyNamed?: ((resourceId: string) => boolean) | undefined,
): Array<string> => {
  const ids: Set<string> = new Set<string>();

  for (const ref of refs || []) {
    const id: string = (ref.resourceId || "").trim();

    if (!id || (isAlreadyNamed && isAlreadyNamed(id))) {
      continue;
    }

    ids.add(id);
  }

  return Array.from(ids).sort();
};

export type BuildLogsResourceTypeHintsFunction = (
  refs: Array<LogsResourceRef> | undefined,
) => Record<string, ServiceType> | undefined;

/**
 * `id -> ServiceType` for rows whose type the server reported, so each id
 * goes straight to its own table. Undefined when nothing can be hinted.
 */
export const buildLogsResourceTypeHints: BuildLogsResourceTypeHintsFunction = (
  refs: Array<LogsResourceRef> | undefined,
): Record<string, ServiceType> | undefined => {
  const hints: Record<string, ServiceType> = {};

  for (const ref of refs || []) {
    const id: string = (ref.resourceId || "").trim();
    const entityType: ServiceType | undefined = toServiceType(ref.resourceType);

    if (id && entityType && !hints[id]) {
      hints[id] = entityType;
    }
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
};

export interface LogsResourceDisplay {
  name: string;
  /*
   * "RUM Application", "Host", … — empty when neither the server nor the
   * resolver could say what the resource is.
   */
  typeLabel: string;
}

export type DescribeLogsResourceFunction = (data: {
  resourceId: string;
  resourceType?: string | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
  // A name from a source the page already loaded (its Service list).
  knownName?: string | undefined;
}) => LogsResourceDisplay;

/**
 * Name: the page's own source first, then the resolver, then the id — an
 * unnameable resource is still volume the user can search on.
 *
 * Type: the server's type turned into its label; if the server sent none,
 * the type the resolver found; an unrecognised type string is shown as-is
 * rather than mislabelled "Service".
 */
export const describeLogsResource: DescribeLogsResourceFunction = (data: {
  resourceId: string;
  resourceType?: string | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
  knownName?: string | undefined;
}): LogsResourceDisplay => {
  const resolved: ResolvedTelemetryEntity | undefined =
    data.nameMap?.[data.resourceId];
  const knownName: string = (data.knownName || "").trim();
  const rawType: string = (data.resourceType || "").trim();
  const entityType: ServiceType | undefined = toServiceType(rawType);

  let typeLabel: string = "";

  if (entityType) {
    typeLabel = getTelemetryEntityTypeLabel(entityType);
  } else if (resolved) {
    typeLabel = resolved.typeLabel;
  } else {
    typeLabel = rawType;
  }

  return {
    name: knownName || resolved?.name || data.resourceId,
    typeLabel,
  };
};

export interface LogsScopeSelection {
  facetKey: string;
  id: string;
}

export type DecodeLogsScopeSelectionFunction = (
  value: string,
) => LogsScopeSelection;

/**
 * Split a scope picker value (`<facetKey>:<id>`, see encodeScopeSelection)
 * back into its parts. Splits on the FIRST colon only.
 */
export const decodeLogsScopeSelection: DecodeLogsScopeSelectionFunction = (
  value: string,
): LogsScopeSelection => {
  const separator: number = value.indexOf(":");

  if (separator < 0) {
    return { facetKey: "", id: value };
  }

  return {
    facetKey: value.substring(0, separator),
    id: value.substring(separator + 1),
  };
};

export type LabelLogsScopeOptionFunction = (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
  // The page's own name for it (a loaded Service).
  knownName?: string | undefined;
  // The server's facet displayName, which echoes the id when unresolved.
  facetDisplayName?: string | undefined;
}) => string;

/** The scope picker label for one resource id — never a raw id if avoidable. */
export const labelLogsScopeOption: LabelLogsScopeOptionFunction = (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
  knownName?: string | undefined;
  facetDisplayName?: string | undefined;
}): string => {
  const knownName: string = (data.knownName || "").trim();

  if (knownName) {
    return knownName;
  }

  const facetDisplayName: string = (data.facetDisplayName || "").trim();

  if (facetDisplayName && facetDisplayName !== data.id) {
    return facetDisplayName;
  }

  return data.nameMap?.[data.id]?.name || facetDisplayName || data.id;
};

/*
 * How many of a pattern's resources the "Top errors" row names inline
 * ("3 sources · checkout-web, payments-api"). Shared by the row and by the
 * page's name lookup so the two cannot drift: the lookup asks for exactly
 * the ids the rows print, not every id every pattern was seen on.
 */
export const TOP_ERROR_PATTERN_RESOURCE_LABEL_LIMIT: number = 2;

export type GetDisplayedErrorPatternResourceIdsFunction = (
  resourceIds: Array<string> | undefined,
) => Array<string>;

/** The resource ids a "Top errors" row prints by name. */
export const getDisplayedErrorPatternResourceIds: GetDisplayedErrorPatternResourceIdsFunction =
  (resourceIds: Array<string> | undefined): Array<string> => {
    return (resourceIds || []).slice(0, TOP_ERROR_PATTERN_RESOURCE_LABEL_LIMIT);
  };

export type LabelErrorPatternResourcesFunction = (data: {
  resourceIds: Array<string> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
  // The page's own name for an id (a loaded Service), if it has one.
  getKnownName?: ((resourceId: string) => string | undefined) | undefined;
}) => Array<string>;

/**
 * The inline resource labels of one "Top errors" row. Uses the same
 * precedence as the error-pattern drawer (loaded Service, then resolver,
 * then the id) so the row and the drawer it opens name a resource the same.
 */
export const labelErrorPatternResources: LabelErrorPatternResourcesFunction =
  (data: {
    resourceIds: Array<string> | undefined;
    nameMap: TelemetryEntityNameMap | undefined;
    getKnownName?: ((resourceId: string) => string | undefined) | undefined;
  }): Array<string> => {
    return getDisplayedErrorPatternResourceIds(data.resourceIds).map(
      (resourceId: string): string => {
        return describeLogsResource({
          resourceId,
          nameMap: data.nameMap,
          knownName: data.getKnownName
            ? data.getKnownName(resourceId)
            : undefined,
        }).name;
      },
    );
  };

export type CollectLogsInsightsResourceRefsFunction = (data: {
  // Ids behind the "Sources reporting logs" cards the page renders.
  breakdownResourceIds: Array<string>;
  /*
   * The "Top errors" rows. Only the ids a row prints inline are collected
   * (see TOP_ERROR_PATTERN_RESOURCE_LABEL_LIMIT).
   */
  errorPatterns?: Array<{ resourceIds: Array<string> }> | undefined;
  // The scope picker's facet values, per facet key.
  scopeFacets: Record<string, Array<{ value: string; displayName: string }>>;
  // The picker's selected `<facetKey>:<id>` values.
  selectedScopeValues: Array<string>;
}) => Array<LogsResourceRef>;

/**
 * Every id the Logs Insights page may have to show by name, each with the
 * type its facet implies. Facet values the server already named are left
 * out, and a selection is only included when no named facet value covers it
 * (the window moved and that resource stopped logging).
 */
export const collectLogsInsightsResourceRefs: CollectLogsInsightsResourceRefsFunction =
  (data: {
    breakdownResourceIds: Array<string>;
    errorPatterns?: Array<{ resourceIds: Array<string> }> | undefined;
    scopeFacets: Record<string, Array<{ value: string; displayName: string }>>;
    selectedScopeValues: Array<string>;
  }): Array<LogsResourceRef> => {
    const refs: Array<LogsResourceRef> = [];
    const namedByFacet: Set<string> = new Set<string>();

    for (const resourceId of data.breakdownResourceIds) {
      refs.push({ resourceId });
    }

    /*
     * The pattern rows are keyed on the same polymorphic primaryEntityId as
     * the cards, with no type reported, so they go unhinted — the resolver
     * probes the tables. Without these the rows printed raw UUIDs for RUM
     * applications, hosts and clusters while the drawer named them.
     */
    for (const pattern of data.errorPatterns || []) {
      for (const resourceId of getDisplayedErrorPatternResourceIds(
        pattern.resourceIds,
      )) {
        refs.push({ resourceId });
      }
    }

    for (const [facetKey, values] of Object.entries(data.scopeFacets)) {
      for (const value of values || []) {
        const displayName: string = (value.displayName || "").trim();

        if (displayName && displayName !== value.value) {
          namedByFacet.add(`${facetKey}:${value.value}`);
          continue;
        }

        refs.push({
          resourceId: value.value,
          resourceType: LOGS_SCOPE_FACET_ENTITY_TYPES[facetKey],
        });
      }
    }

    for (const selected of data.selectedScopeValues) {
      if (namedByFacet.has(selected)) {
        continue;
      }

      const decoded: LogsScopeSelection = decodeLogsScopeSelection(selected);

      refs.push({
        resourceId: decoded.id,
        resourceType: LOGS_SCOPE_FACET_ENTITY_TYPES[decoded.facetKey],
      });
    }

    return refs;
  };
