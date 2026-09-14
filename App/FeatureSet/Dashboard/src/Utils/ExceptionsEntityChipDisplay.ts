import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
} from "Common/UI/Components/TelemetryViewer/types";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  DEFAULT_TELEMETRY_ENTITY_LABEL,
  ResolvedTelemetryEntity,
  TelemetryEntityNameMap,
  getTelemetryEntityTypeLabel,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { getAttributeDisplayName } from "../Components/Logs/LogsAttributeFilterChips";

/*
 * Display labels for the exceptions explorer's filter chips.
 *
 * An exception's `primaryEntityId` is polymorphic — a Service id on a service
 * page, a RumApplication id on a RUM application page, a Host id for
 * agent-ingested telemetry, and so on. The explorer only loads Services (and
 * a few host / cluster tables) for its facet sidebar, so a chip for any other
 * entity used to fall through to the raw id and read
 * "Service: 84858d6c-…". These helpers pick a name and a type-appropriate key
 * for every such chip — whether it came from a page prop, a stored incident
 * query, the facet sidebar or the URL — from every source the viewer has,
 * in precedence order.
 *
 * Display only: the chip's `value` (the id the query filters on) is never
 * touched. Kept React-free so App/Tests/Dashboard can exercise it directly.
 */

const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * Facet keys whose value is a polymorphic telemetry entity id. `serviceId` is
 * the legacy spelling still found in old shared links.
 */
export const EXCEPTION_ENTITY_ID_FACET_KEYS: ReadonlyArray<string> = [
  "primaryEntityId",
  "serviceId",
];

/*
 * Facet keys whose value is an id of ONE known table. Their chip key stays
 * the facet title ("Host"); the resolver is only a fallback for the name when
 * the viewer's own capped list does not cover the id.
 */
export const EXCEPTION_TYPED_RESOURCE_FACET_TYPES: Readonly<
  Record<string, ServiceType>
> = {
  hostId: ServiceType.Host,
  dockerHostId: ServiceType.DockerHost,
  podmanHostId: ServiceType.PodmanHost,
  kubernetesClusterId: ServiceType.KubernetesCluster,
};

export interface ExceptionEntityChipRef {
  facetKey: string;
  value: string;
}

export const isExceptionEntityIdFacetKey: (facetKey: string) => boolean = (
  facetKey: string,
): boolean => {
  return EXCEPTION_ENTITY_ID_FACET_KEYS.includes(facetKey);
};

const isTypedResourceFacetKey: (facetKey: string) => boolean = (
  facetKey: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(
    EXCEPTION_TYPED_RESOURCE_FACET_TYPES,
    facetKey,
  );
};

/*
 * Whether a chip's value is an id the name resolver can turn into a name.
 */
export const isExceptionNamedResourceFacetKey: (facetKey: string) => boolean = (
  facetKey: string,
): boolean => {
  return (
    isExceptionEntityIdFacetKey(facetKey) || isTypedResourceFacetKey(facetKey)
  );
};

// The facet the page's own `primaryEntityId` scope chip is rendered under.
const SCOPE_FACET_KEY: string = "primaryEntityId";

/*
 * facetKey -> the ids that facet already names without the resolver.
 *
 * Keyed per facet on purpose: primaryEntityId is polymorphic, and a chip is
 * only named from ITS OWN facet (see resolveExceptionChipDisplay). A Host id
 * the Host list names still reads "Service: <uuid>" under a primaryEntityId
 * chip, so a single flat id set would wrongly skip it.
 */
export type ExceptionKnownChipIds = Record<string, ReadonlySet<string>>;

/*
 * The ids every resource facet can name from what the viewer already has:
 * its loaded lists (valueDisplayMap) and the server facet displayName — the
 * same two sources resolveExceptionChipDisplay reads before the resolver.
 */
export const buildExceptionKnownChipIds: (data: {
  facetConfigs: Array<FacetConfig>;
  facetDisplayNames: Record<string, Record<string, string>> | undefined;
}) => ExceptionKnownChipIds = (data: {
  facetConfigs: Array<FacetConfig>;
  facetDisplayNames: Record<string, Record<string, string>> | undefined;
}): ExceptionKnownChipIds => {
  const known: Record<string, Set<string>> = {};

  const add: (facetKey: string, names: Record<string, string>) => void = (
    facetKey: string,
    names: Record<string, string>,
  ): void => {
    if (!isExceptionNamedResourceFacetKey(facetKey)) {
      return;
    }
    for (const [id, name] of Object.entries(names)) {
      if (!name) {
        continue;
      }
      if (!known[facetKey]) {
        known[facetKey] = new Set<string>();
      }
      known[facetKey]!.add(id);
    }
  };

  for (const config of data.facetConfigs) {
    add(config.key, config.valueDisplayMap || {});
  }
  for (const [facetKey, names] of Object.entries(
    data.facetDisplayNames || {},
  )) {
    add(facetKey, names || {});
  }

  return known;
};

/*
 * Every id that needs a name, deduplicated and sorted so the list is stable
 * across renders — one resolver call covers the prop scope, the host's stored
 * scope and the user's chips together.
 *
 * - `knownIds` drops ids the chip's own facet already names, so a Service
 *   page whose Service is in the loaded list issues no lookup at all.
 * - `isKnownIdsPending` (the viewer's lists have not loaded yet) holds every
 *   id back, because until then each one looks unnamed and would be looked
 *   up for nothing. The one exception is a scope id the page typed as a
 *   non-Service entity: the primaryEntityId facet only ever names Services,
 *   so waiting could not save its lookup — it would only delay the chip.
 */
export const collectExceptionEntityChipIds: (data: {
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
  chips: Array<ExceptionEntityChipRef>;
  knownIds?: ExceptionKnownChipIds | undefined;
  isKnownIdsPending?: boolean | undefined;
}) => Array<string> = (data: {
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
  chips: Array<ExceptionEntityChipRef>;
  knownIds?: ExceptionKnownChipIds | undefined;
  isKnownIdsPending?: boolean | undefined;
}): Array<string> => {
  const ids: Set<string> = new Set<string>();

  const isKnown: (facetKey: string, id: string) => boolean = (
    facetKey: string,
    id: string,
  ): boolean => {
    return Boolean(data.knownIds?.[facetKey]?.has(id));
  };

  const scopeId: string = (data.scopeEntityId || "").trim();
  if (scopeId) {
    const isNonServiceScope: boolean = Boolean(
      data.scopeEntityType &&
        data.scopeEntityType !== ServiceType.OpenTelemetry,
    );
    if (
      isNonServiceScope ||
      (!data.isKnownIdsPending && !isKnown(SCOPE_FACET_KEY, scopeId))
    ) {
      ids.add(scopeId);
    }
  }

  if (data.isKnownIdsPending) {
    return Array.from(ids).sort();
  }

  for (const chip of data.chips) {
    const value: string = (chip.value || "").trim();
    if (
      value &&
      isExceptionNamedResourceFacetKey(chip.facetKey) &&
      !isKnown(chip.facetKey, value)
    ) {
      ids.add(value);
    }
  }

  return Array.from(ids).sort();
};

/*
 * Tables the viewer already knows an id lives in, so the resolver can go
 * straight there instead of probing Service first and every other table
 * after. The page's own scope type wins for the scope id: a RUM application
 * page knows its id is a RumApplication.
 */
export const buildExceptionEntityTypeHints: (data: {
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
  chips: Array<ExceptionEntityChipRef>;
}) => Record<string, ServiceType> = (data: {
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
  chips: Array<ExceptionEntityChipRef>;
}): Record<string, ServiceType> => {
  const hints: Record<string, ServiceType> = {};

  for (const chip of data.chips) {
    const value: string = (chip.value || "").trim();
    if (!value || !isTypedResourceFacetKey(chip.facetKey)) {
      continue;
    }
    hints[value] = EXCEPTION_TYPED_RESOURCE_FACET_TYPES[chip.facetKey]!;
  }

  const scopeId: string = (data.scopeEntityId || "").trim();
  if (scopeId && data.scopeEntityType) {
    hints[scopeId] = data.scopeEntityType;
  }

  return hints;
};

/*
 * The server-resolved `displayName` of every facet value, keyed facetKey ->
 * value. The facets endpoint resolves resource facets against Postgres, so it
 * can name a service the client-side list (capped per project) never loaded.
 */
export const buildExceptionFacetDisplayNames: (
  facetData: FacetData | undefined,
) => Record<string, Record<string, string>> = (
  facetData: FacetData | undefined,
): Record<string, Record<string, string>> => {
  const result: Record<string, Record<string, string>> = {};

  for (const [facetKey, values] of Object.entries(facetData || {})) {
    for (const facetValue of (values || []) as Array<FacetValue>) {
      const displayName: string = (facetValue?.displayName || "").trim();
      if (!displayName || facetValue.value === undefined) {
        continue;
      }
      if (!result[facetKey]) {
        result[facetKey] = {};
      }
      result[facetKey]![String(facetValue.value)] = displayName;
    }
  }

  return result;
};

/*
 * The label a chip had when it was created, but only if it is a real label.
 * URL-restored and stored-query chips carry the raw id as their display
 * value, which must not outrank a name found later.
 */
const getCarriedDisplayValue: (chip: ActiveFilter) => string | undefined = (
  chip: ActiveFilter,
): string | undefined => {
  if (!chip.displayValue || chip.displayValue === chip.value) {
    return undefined;
  }
  return chip.displayValue;
};

/*
 * Re-derive a chip's displayKey / displayValue.
 *
 * Entity-id chips (primaryEntityId / serviceId):
 * - key: the page scope's type label when this chip IS the page scope and the
 *   page said what it is (immediately — no waiting on a lookup); else the
 *   resolved entity's type label ("RUM Application"); else the facet title
 *   ("Service").
 * - value: the loaded Service name, then the server facet name, then the name
 *   the chip was created with, then the resolver's name, then the id.
 *
 * Typed resource chips (hostId / …) keep their facet title and only gain the
 * resolver as a last name source. Everything else is unchanged.
 */
export const resolveExceptionChipDisplay: (data: {
  chip: ActiveFilter;
  config: FacetConfig | undefined;
  entityNames: TelemetryEntityNameMap | undefined;
  facetDisplayNames?: Record<string, string> | undefined;
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
}) => ActiveFilter = (data: {
  chip: ActiveFilter;
  config: FacetConfig | undefined;
  entityNames: TelemetryEntityNameMap | undefined;
  facetDisplayNames?: Record<string, string> | undefined;
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
}): ActiveFilter => {
  const chip: ActiveFilter = data.chip;

  if (chip.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
    const attributeKey: string = chip.facetKey.substring(
      ATTRIBUTE_FACET_PREFIX.length,
    );
    return {
      ...chip,
      /*
       * A read-only chip is a host page's stored scope (ExceptionQueryScope),
       * pinned on OTel resource keys — give it the label the logs viewer uses
       * ("Host", not "resource.host.name"). A chip the user typed keeps the
       * literal key they typed, so they can recognise and edit it.
       */
      displayKey: chip.readOnly
        ? getAttributeDisplayName(attributeKey)
        : attributeKey,
      displayValue:
        data.config?.valueDisplayMap?.[chip.value] ||
        chip.displayValue ||
        chip.value,
    };
  }

  const mappedName: string | undefined =
    data.config?.valueDisplayMap?.[chip.value];

  if (!isExceptionNamedResourceFacetKey(chip.facetKey)) {
    return {
      ...chip,
      displayKey: data.config?.title || chip.displayKey || chip.facetKey,
      displayValue: mappedName || chip.displayValue || chip.value,
    };
  }

  const resolved: ResolvedTelemetryEntity | undefined =
    data.entityNames?.[chip.value];

  const displayValue: string =
    mappedName ||
    data.facetDisplayNames?.[chip.value] ||
    getCarriedDisplayValue(chip) ||
    resolved?.name ||
    chip.value;

  if (isTypedResourceFacetKey(chip.facetKey)) {
    return {
      ...chip,
      displayKey: data.config?.title || chip.displayKey || chip.facetKey,
      displayValue,
    };
  }

  /*
   * The facet title is "Service" because that facet lists Services — it must
   * not be forced onto a chip whose id resolved to a RUM application or host.
   */
  const fallbackKey: string =
    data.config?.title || DEFAULT_TELEMETRY_ENTITY_LABEL;

  const isPageScope: boolean = Boolean(
    data.scopeEntityType &&
      data.scopeEntityId &&
      data.scopeEntityId === chip.value,
  );

  const displayKey: string = isPageScope
    ? getTelemetryEntityTypeLabel(data.scopeEntityType)
    : resolved?.typeLabel || fallbackKey;

  return { ...chip, displayKey, displayValue };
};

/*
 * Display value for a chip created from the facet sidebar: the facet's own
 * display map first, then the server's resolved name for that value.
 */
export const getExceptionFacetIncludeDisplayValue: (data: {
  value: string;
  config: FacetConfig | undefined;
  facetValues: Array<FacetValue> | undefined;
}) => string = (data: {
  value: string;
  config: FacetConfig | undefined;
  facetValues: Array<FacetValue> | undefined;
}): string => {
  const mapped: string | undefined = data.config?.valueDisplayMap?.[data.value];
  if (mapped) {
    return mapped;
  }

  const serverName: string | undefined = (data.facetValues || [])
    .find((facetValue: FacetValue): boolean => {
      return String(facetValue.value) === data.value;
    })
    ?.displayName?.trim();

  return serverName || data.value;
};
