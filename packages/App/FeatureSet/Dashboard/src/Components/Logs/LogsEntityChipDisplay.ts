import ObjectID from "Common/Types/ObjectID";
import {
  SERVICE_FACET_KEYS,
  isServiceFacetKey,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ActiveFilter,
  FacetValue,
} from "Common/UI/Components/LogsViewer/types";
import {
  DEFAULT_TELEMETRY_ENTITY_LABEL,
  TelemetryEntityNameMap,
  getTelemetryEntityDisplay,
  getTelemetryEntityTypeLabel,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";

/*
 * Display for the logs viewer's chips that name a telemetry entity by id.
 *
 * A log row's `primaryEntityId` is polymorphic — a Service, a RUM
 * application, a host, a cluster… (see ServiceType). The viewer used to
 * label every such chip "Service" and look its id up in the Service table
 * only, so a RUM application's logs tab read "Service: 84858d6c-…". These
 * helpers decide what such a chip SHOWS; the chip's `facetKey` and `value`
 * stay the id, so filtering, URL state and saved views are untouched.
 *
 * React-free on purpose: App tests pin this without mounting the viewer.
 */

/*
 * Facet keys whose chip value is a telemetry entity id. `serviceId` is the
 * column's historical name; a filter restored from an old URL or saved view
 * can still carry it. Shared with the query side so the two never disagree
 * on which chips are entity chips.
 */
export const LOGS_ENTITY_FACET_KEYS: ReadonlyArray<string> = SERVICE_FACET_KEYS;

export type IsLogsEntityFacetKeyFunction = (facetKey: string) => boolean;

export const isLogsEntityFacetKey: IsLogsEntityFacetKeyFunction = (
  facetKey: string,
): boolean => {
  return isServiceFacetKey(facetKey);
};

type NormalizeIdFunction = (id: ObjectID | string | null | undefined) => string;

const normalizeId: NormalizeIdFunction = (
  id: ObjectID | string | null | undefined,
): string => {
  return id ? id.toString().trim() : "";
};

type IsResolvableIdFunction = (id: string) => boolean;

/*
 * Entity ids are Postgres UUIDs. A `service:` value typed into the search
 * bar that matched no loaded Service stays a plain name; sending it to the
 * resolver would only make every entity table reject or miss it.
 */
const isResolvableId: IsResolvableIdFunction = (id: string): boolean => {
  return ObjectID.isValidUUID(id);
};

export type CollectLogsEntityIdsFunction = (data: {
  scopeIds?: Array<ObjectID | string> | undefined;
  appliedFacetFilters?: Map<string, Set<string>> | undefined;
}) => Array<string>;

/**
 * Every entity id a chip in the viewer can show: the page's locked scope
 * ids plus the values of any user / URL / saved-view entity chip. One list,
 * so the viewer resolves them all with a single lookup.
 */
export const collectLogsEntityIds: CollectLogsEntityIdsFunction = (data: {
  scopeIds?: Array<ObjectID | string> | undefined;
  appliedFacetFilters?: Map<string, Set<string>> | undefined;
}): Array<string> => {
  const ids: Set<string> = new Set<string>();

  for (const id of data.scopeIds || []) {
    const normalized: string = normalizeId(id);

    if (normalized) {
      ids.add(normalized);
    }
  }

  if (data.appliedFacetFilters) {
    for (const facetKey of LOGS_ENTITY_FACET_KEYS) {
      for (const value of data.appliedFacetFilters.get(facetKey) || []) {
        const normalized: string = normalizeId(value);

        if (normalized && isResolvableId(normalized)) {
          ids.add(normalized);
        }
      }
    }
  }

  return Array.from(ids).sort();
};

export type BuildLogsEntityTypeHintsFunction = (
  scopeIds: Array<ObjectID | string> | undefined,
  scopeEntityType: ServiceType | undefined,
) => Record<string, ServiceType> | undefined;

/**
 * `id -> ServiceType` for the scope ids when the host page said what they
 * are, so the resolver sends them straight to their own table in one
 * request instead of probing Service first. Undefined when there is nothing
 * to hint, which keeps the hook's options stable.
 */
export const buildLogsEntityTypeHints: BuildLogsEntityTypeHintsFunction = (
  scopeIds: Array<ObjectID | string> | undefined,
  scopeEntityType: ServiceType | undefined,
): Record<string, ServiceType> | undefined => {
  if (!scopeEntityType || !scopeIds || scopeIds.length === 0) {
    return undefined;
  }

  const hints: Record<string, ServiceType> = {};

  for (const id of scopeIds) {
    const normalized: string = normalizeId(id);

    if (normalized) {
      hints[normalized] = scopeEntityType;
    }
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
};

export type BuildFacetDisplayNamesFunction = (
  facetValues: Array<FacetValue> | undefined,
) => Record<string, string>;

/**
 * `id -> name` from the server's facet response. The server resolves some
 * facet ids itself; a displayName that merely echoes the id is not a name
 * and must not shadow the client-side resolver.
 */
export const buildFacetDisplayNames: BuildFacetDisplayNamesFunction = (
  facetValues: Array<FacetValue> | undefined,
): Record<string, string> => {
  const names: Record<string, string> = {};

  for (const facetValue of facetValues || []) {
    const id: string = normalizeId(facetValue.value);
    const displayName: string = (facetValue.displayName || "").trim();

    if (id && displayName && displayName !== id) {
      names[id] = displayName;
    }
  }

  return names;
};

export interface LogsEntityChipDisplay {
  displayKey: string;
  displayValue: string;
}

export type DescribeLogsEntityChipFunction = (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
  /*
   * What the id is, when the caller knows (the host page's scope). The key
   * then reads e.g. "RUM Application" immediately, before the name lands.
   */
  entityType?: ServiceType | undefined;
  /*
   * A name from a source the viewer already had (the server's facet
   * displayName). Wins over the resolver when present.
   */
  knownName?: string | undefined;
}) => LogsEntityChipDisplay;

export const describeLogsEntityChip: DescribeLogsEntityChipFunction = (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
  entityType?: ServiceType | undefined;
  knownName?: string | undefined;
}): LogsEntityChipDisplay => {
  const resolved: { key: string; value: string } = getTelemetryEntityDisplay({
    id: data.id,
    nameMap: data.nameMap,
    fallbackKey: DEFAULT_TELEMETRY_ENTITY_LABEL,
  });

  const knownName: string = (data.knownName || "").trim();

  return {
    displayKey: data.entityType
      ? getTelemetryEntityTypeLabel(data.entityType)
      : resolved.key,
    displayValue: knownName || resolved.value,
  };
};

export type BuildLogsScopeEntityChipsFunction = (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
  scopeEntityType?: ServiceType | undefined;
}) => Array<ActiveFilter>;

/**
 * The read-only chips for the entity scope a host page pinned via
 * `serviceIds`. Value stays the id (the filter); key and label name it.
 */
export const buildLogsScopeEntityChips: BuildLogsScopeEntityChipsFunction =
  (data: {
    scopeIds: Array<ObjectID | string> | undefined;
    nameMap: TelemetryEntityNameMap | undefined;
    scopeEntityType?: ServiceType | undefined;
  }): Array<ActiveFilter> => {
    const chips: Array<ActiveFilter> = [];

    for (const scopeId of data.scopeIds || []) {
      const id: string = normalizeId(scopeId);

      if (!id) {
        continue;
      }

      const display: LogsEntityChipDisplay = describeLogsEntityChip({
        id,
        nameMap: data.nameMap,
        entityType: data.scopeEntityType,
      });

      chips.push({
        facetKey: "primaryEntityId",
        value: id,
        displayKey: display.displayKey,
        displayValue: display.displayValue,
        readOnly: true,
      });
    }

    return chips;
  };

export type ApplyLogsEntityChipDisplayFunction = (
  filters: Array<ActiveFilter>,
  data: {
    nameMap: TelemetryEntityNameMap | undefined;
    scopeIds?: Array<ObjectID | string> | undefined;
    scopeEntityType?: ServiceType | undefined;
    knownNames?: Record<string, string> | undefined;
  },
) => Array<ActiveFilter>;

/**
 * Re-label the user-removable entity chips (facet clicks, search bar,
 * URL- and saved-view-restored filters). A chip for the same id the page is
 * scoped to takes the page's entity type; any other id takes the type the
 * resolver found. Every other chip passes through untouched.
 */
export const applyLogsEntityChipDisplay: ApplyLogsEntityChipDisplayFunction = (
  filters: Array<ActiveFilter>,
  data: {
    nameMap: TelemetryEntityNameMap | undefined;
    scopeIds?: Array<ObjectID | string> | undefined;
    scopeEntityType?: ServiceType | undefined;
    knownNames?: Record<string, string> | undefined;
  },
): Array<ActiveFilter> => {
  const scopeIdSet: Set<string> = new Set<string>(
    (data.scopeIds || []).map((id: ObjectID | string): string => {
      return normalizeId(id);
    }),
  );

  return filters.map((filter: ActiveFilter): ActiveFilter => {
    if (!isLogsEntityFacetKey(filter.facetKey)) {
      return filter;
    }

    const id: string = normalizeId(filter.value);

    if (!id) {
      return filter;
    }

    const display: LogsEntityChipDisplay = describeLogsEntityChip({
      id,
      nameMap: data.nameMap,
      entityType:
        data.scopeEntityType && scopeIdSet.has(id)
          ? data.scopeEntityType
          : undefined,
      knownName: data.knownNames?.[id],
    });

    return {
      ...filter,
      displayKey: display.displayKey,
      displayValue: display.displayValue,
    };
  });
};
