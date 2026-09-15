import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { RESOURCE_FACET_CATALOG } from "Common/Types/Telemetry/ResourceFacetCatalog";
import { describeSearchValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
} from "Common/UI/Components/TelemetryViewer/types";
import {
  DEFAULT_TELEMETRY_ENTITY_LABEL,
  ResolvedTelemetryEntity,
  TelemetryEntityNameMap,
  getTelemetryEntityDisplay,
  getTelemetryEntityTypeLabel,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { ATTRIBUTE_FACET_PREFIX } from "../Components/Metrics/MetricsSearchQuery";
import {
  describeLockedAttributeFilter,
  describeLockedEntityFilter,
} from "./LockedTelemetryScope";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "./LockedEntityKeyChips";

/*
 * Display rules for the metrics explorer's filter chips.
 *
 * The metric list is scoped by telemetry entity id, and that id is
 * polymorphic: on a RUM application page it is a RumApplication id, on a
 * host page a Host id, and so on. The chips used to resolve names against
 * the Service table only, so a RUM page's locked chip read
 * "Service: 84858d6c-…". Everything here is display only — the ids stay ids
 * in the query, the URL and saved views — and it lives outside the React
 * component so the rules can be pinned by plain unit tests.
 */

// Chips whose value is a polymorphic telemetry entity id (serviceId is the legacy alias).
export const METRICS_POLYMORPHIC_ENTITY_FACET_KEYS: Array<string> = [
  "primaryEntityId",
  "serviceId",
];

/*
 * Resource-id chips that can reach this explorer through a shared link or a
 * saved view written by another explorer. Their table is known from the key,
 * so they get a friendly key and a targeted name lookup instead of showing
 * "hostId: 1f0c…".
 *
 * Every resource type in ResourceFacetCatalog (hostId → Host, …,
 * iotFleetId → IoTDevice, the type IoT fleet telemetry is stamped with):
 * the Logs / Traces / Exceptions sidebars offer all of them, so a link from
 * any of those explorers can carry any of them here.
 */
const buildTypedEntityFacetTypes: () => Record<
  string,
  ServiceType
> = (): Record<string, ServiceType> => {
  const types: Record<string, ServiceType> = {};
  for (const definition of RESOURCE_FACET_CATALOG) {
    types[definition.facetKey] = definition.serviceType;
  }
  return types;
};

export const METRICS_TYPED_ENTITY_FACET_KEYS: Record<string, ServiceType> =
  buildTypedEntityFacetTypes();

export const isMetricsPolymorphicEntityFacetKey: (
  facetKey: string,
) => boolean = (facetKey: string): boolean => {
  return METRICS_POLYMORPHIC_ENTITY_FACET_KEYS.includes(facetKey);
};

export const getMetricsTypedEntityFacetType: (
  facetKey: string,
) => ServiceType | undefined = (facetKey: string): ServiceType | undefined => {
  if (
    !Object.prototype.hasOwnProperty.call(
      METRICS_TYPED_ENTITY_FACET_KEYS,
      facetKey,
    )
  ) {
    return undefined;
  }
  return METRICS_TYPED_ENTITY_FACET_KEYS[facetKey];
};

export const isMetricsEntityFacetKey: (facetKey: string) => boolean = (
  facetKey: string,
): boolean => {
  return (
    isMetricsPolymorphicEntityFacetKey(facetKey) ||
    getMetricsTypedEntityFacetType(facetKey) !== undefined
  );
};

export interface MetricsEntityLookup {
  // Sorted, de-duplicated entity ids to resolve.
  ids: Array<string>;
  // id -> table, for ids whose table is already known.
  typeHints: Record<string, ServiceType>;
}

/*
 * Every entity id the chips need a name for, gathered so the viewer issues
 * ONE lookup. Values that are not UUIDs (a hand-edited link) are skipped:
 * the resolver batches ids per table, and one malformed id would fail the
 * whole batch for the ids that are fine.
 */
export const collectMetricsEntityLookup: (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  scopeEntityType: ServiceType | undefined;
  filters: Array<ActiveFilter> | undefined;
}) => MetricsEntityLookup = (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  scopeEntityType: ServiceType | undefined;
  filters: Array<ActiveFilter> | undefined;
}): MetricsEntityLookup => {
  const ids: Set<string> = new Set<string>();
  const typeHints: Record<string, ServiceType> = {};

  const addId: (
    rawId: ObjectID | string,
    hint: ServiceType | undefined,
  ) => void = (
    rawId: ObjectID | string,
    hint: ServiceType | undefined,
  ): void => {
    const id: string = rawId ? rawId.toString().trim() : "";
    if (!id || !ObjectID.isValidUUID(id)) {
      return;
    }
    ids.add(id);
    // The page's own statement about its scope wins over a chip's guess.
    if (hint && !typeHints[id]) {
      typeHints[id] = hint;
    }
  };

  for (const scopeId of data.scopeIds || []) {
    addId(scopeId, data.scopeEntityType);
  }

  for (const filter of data.filters || []) {
    if (isMetricsPolymorphicEntityFacetKey(filter.facetKey)) {
      addId(filter.value, undefined);
      continue;
    }
    const typedFacetType: ServiceType | undefined =
      getMetricsTypedEntityFacetType(filter.facetKey);
    if (typedFacetType) {
      addId(filter.value, typedFacetType);
    }
  }

  return {
    ids: Array.from(ids).sort(),
    typeHints,
  };
};

/*
 * The entity ids the user's chips apply to the metric list query.
 *
 * Both polymorphic keys count: `serviceId` is the legacy alias of
 * `primaryEntityId`, the chip bar labels it as the same Service / entity
 * filter, and the Metrics Insights tab and the Logs / Traces explorers all
 * apply it. Applying only `primaryEntityId` here left a restored
 * `serviceId` chip looking like an applied filter while the list ignored
 * it. Sharing isMetricsPolymorphicEntityFacetKey with the chip rules keeps
 * "labelled as a filter" and "applied as a filter" from drifting apart.
 *
 * The typed resource keys (hostId / dockerHostId / … / iotFleetId) are deliberately NOT
 * collected, matching the Metrics Insights tab (supportsResourceEntityFacets
 * is false for Metrics). A host or cluster selection needs the entity-key
 * treatment Logs / Traces give it (OTLP metrics are primary-keyed on their
 * Service, see ResourceEntityFacet); folding it into the `services` id list
 * would return only the agent-ingested part and look complete.
 *
 * Values are passed through as-is, exactly as a `primaryEntityId` chip
 * always was; only blanks and repeats are dropped.
 */
export const getMetricsAppliedEntityFilterIds: (
  filters: Array<ActiveFilter> | undefined,
) => Array<string> = (
  filters: Array<ActiveFilter> | undefined,
): Array<string> => {
  const ids: Array<string> = [];
  for (const filter of filters || []) {
    if (!isMetricsPolymorphicEntityFacetKey(filter.facetKey)) {
      continue;
    }
    const id: string = filter.value ? filter.value.toString() : "";
    if (!id.trim() || ids.includes(id)) {
      continue;
    }
    ids.push(id);
  }
  return ids;
};

/*
 * The selected scope ids on the Metrics Insights page that still need a name
 * lookup. An id the loaded service list already names does not (its option
 * carries the name), and neither does a value that is not a UUID (a
 * hand-edited link): it cannot be an entity row, and sending it would cost a
 * request per entity table for nothing.
 */
export const getMetricsUnnamedScopeIds: (data: {
  selectedIds: Array<string> | undefined;
  knownIds: Array<string> | undefined;
}) => Array<string> = (data: {
  selectedIds: Array<string> | undefined;
  knownIds: Array<string> | undefined;
}): Array<string> => {
  const knownIds: Set<string> = new Set<string>(data.knownIds || []);
  const ids: Array<string> = [];
  for (const rawId of data.selectedIds || []) {
    const id: string = rawId ? rawId.toString().trim() : "";
    if (
      !id ||
      !ObjectID.isValidUUID(id) ||
      knownIds.has(id) ||
      ids.includes(id)
    ) {
      continue;
    }
    ids.push(id);
  }
  return ids;
};

/*
 * The name the facet endpoint resolved for a value, if it sent one. Kept on
 * the chip when the user includes the value, so a service the loaded list
 * does not cover still shows its name straight away.
 */
export const getFacetValueDisplayName: (data: {
  facetData: FacetData | undefined;
  facetKey: string;
  value: string;
}) => string | undefined = (data: {
  facetData: FacetData | undefined;
  facetKey: string;
  value: string;
}): string | undefined => {
  const values: Array<FacetValue> | undefined = data.facetData?.[data.facetKey];
  if (!values || !Array.isArray(values)) {
    return undefined;
  }
  const match: FacetValue | undefined = values.find(
    (facetValue: FacetValue): boolean => {
      return facetValue.value === data.value;
    },
  );
  const displayName: string = match?.displayName
    ? match.displayName.toString().trim()
    : "";
  return displayName || undefined;
};

const findFacetConfig: (
  facetConfigs: Array<FacetConfig> | undefined,
  facetKey: string,
) => FacetConfig | undefined = (
  facetConfigs: Array<FacetConfig> | undefined,
  facetKey: string,
): FacetConfig | undefined => {
  return (facetConfigs || []).find((config: FacetConfig): boolean => {
    return config.key === facetKey;
  });
};

/*
 * A chip restored from the URL or a saved view carries its raw value as its
 * display value, which is not a name. Only a display value that differs from
 * the value (set from the facet's resolved name on include) counts.
 */
const getStoredChipName: (chip: ActiveFilter) => string | undefined = (
  chip: ActiveFilter,
): string | undefined => {
  if (!chip.displayValue || chip.displayValue === chip.value) {
    return undefined;
  }
  return chip.displayValue;
};

/*
 * Build the chip a user facet include adds to the explorer's state. The
 * value stays the id; the display value prefers the loaded service list,
 * then the name the facet endpoint resolved, then the raw value.
 */
export const buildMetricsIncludedFacetChip: (data: {
  facetKey: string;
  value: string;
  facetConfigs: Array<FacetConfig> | undefined;
  facetData: FacetData | undefined;
}) => ActiveFilter = (data: {
  facetKey: string;
  value: string;
  facetConfigs: Array<FacetConfig> | undefined;
  facetData: FacetData | undefined;
}): ActiveFilter => {
  const config: FacetConfig | undefined = findFacetConfig(
    data.facetConfigs,
    data.facetKey,
  );
  // Attribute chips (`attributes.<key>`) display as just `<key>`.
  const displayKey: string = data.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)
    ? data.facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)
    : config?.title || data.facetKey;
  const displayValue: string =
    config?.valueDisplayMap?.[data.value] ||
    getFacetValueDisplayName({
      facetData: data.facetData,
      facetKey: data.facetKey,
      value: data.value,
    }) ||
    data.value;
  return {
    facetKey: data.facetKey,
    value: data.value,
    displayKey,
    displayValue,
  };
};

/*
 * Resolve one chip's displayKey / displayValue.
 *
 * - Attribute chips show the attribute key and the value the user typed
 *   (the stored value is in search grammar: escaped / bracketed).
 * - Entity-id chips (primaryEntityId / serviceId) show the entity name and
 *   its type. Existing name sources keep precedence (the loaded service
 *   list, the facet endpoint's display name); the generic resolver covers
 *   everything else — RUM applications, hosts, clusters, Unknown Service.
 *   `scopeEntityType` is set only for the page's locked scope chips: the
 *   page knows what it is scoped to, so the key is right before any lookup.
 * - Typed resource chips (every ResourceFacetCatalog key: hostId … iotFleetId)
 *   get a friendly key and a resolved name.
 * - Everything else is unchanged: facet title and value display map.
 */
export const resolveMetricsChipDisplay: (data: {
  chip: ActiveFilter;
  facetConfigs: Array<FacetConfig> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
  scopeEntityType?: ServiceType | undefined;
}) => ActiveFilter = (data: {
  chip: ActiveFilter;
  facetConfigs: Array<FacetConfig> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
  scopeEntityType?: ServiceType | undefined;
}): ActiveFilter => {
  const chip: ActiveFilter = data.chip;
  /*
   * The legacy serviceId alias names the same entity as primaryEntityId, so
   * it borrows that facet's config (title, loaded service names) when it has
   * none of its own.
   */
  const config: FacetConfig | undefined =
    findFacetConfig(data.facetConfigs, chip.facetKey) ||
    (isMetricsPolymorphicEntityFacetKey(chip.facetKey)
      ? (data.facetConfigs || []).find((candidate: FacetConfig): boolean => {
          return isMetricsPolymorphicEntityFacetKey(candidate.key);
        })
      : undefined);

  if (chip.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
    /*
     * An attribute chip stores its value in the search grammar, so a
     * literal asterisk arrives escaped (`a\*b`) and an any-of list arrives
     * bracketed. The chip has to show the value the user typed, not its
     * escaping.
     */
    return {
      ...chip,
      displayKey: chip.facetKey.substring(ATTRIBUTE_FACET_PREFIX.length),
      displayValue: describeSearchValue(chip.value),
    };
  }

  const knownName: string | undefined =
    config?.valueDisplayMap?.[chip.value] || getStoredChipName(chip);

  if (isMetricsPolymorphicEntityFacetKey(chip.facetKey)) {
    const entityDisplay: { key: string; value: string } =
      getTelemetryEntityDisplay({
        id: chip.value,
        nameMap: data.nameMap,
        fallbackKey: config?.title || DEFAULT_TELEMETRY_ENTITY_LABEL,
      });
    const displayKey: string = data.scopeEntityType
      ? getTelemetryEntityTypeLabel(data.scopeEntityType)
      : entityDisplay.key;
    return {
      ...chip,
      displayKey,
      displayValue: knownName || entityDisplay.value,
    };
  }

  const typedFacetType: ServiceType | undefined =
    getMetricsTypedEntityFacetType(chip.facetKey);
  if (typedFacetType) {
    const resolved: ResolvedTelemetryEntity | undefined =
      data.nameMap?.[chip.value];
    return {
      ...chip,
      displayKey: getTelemetryEntityTypeLabel(typedFacetType),
      displayValue: knownName || resolved?.name || chip.value,
    };
  }

  return {
    ...chip,
    displayKey: config?.title || chip.displayKey || chip.facetKey,
    displayValue:
      config?.valueDisplayMap?.[chip.value] || chip.displayValue || chip.value,
  };
};

/*
 * Read-only chips for a host page's attribute scope (e.g. a host page's
 * `resource.host.name`). The filter value is untouched; the page may supply
 * a friendlier key and value for display.
 *
 * Each chip also carries its LockedFilterDetail: the `@key:value` search
 * syntax that reproduces it on the Metrics explorer, or the reason there is
 * none.
 */
export const buildMetricsLockedAttributeChips: (data: {
  attributeFilters: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
}) => Array<ActiveFilter> = (data: {
  attributeFilters: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
}): Array<ActiveFilter> => {
  const chips: Array<ActiveFilter> = [];
  for (const [key, value] of Object.entries(data.attributeFilters || {})) {
    if (!value) {
      continue;
    }
    const displayKey: string = data.attributeFilterDisplayKeys?.[key] || key;
    const displayValue: string =
      data.attributeFilterDisplayValues?.[key] || value;
    chips.push({
      facetKey: `${ATTRIBUTE_FACET_PREFIX}${key}`,
      value,
      displayKey,
      displayValue,
      readOnly: true,
      lockedDetail: describeLockedAttributeFilter({
        signal: "metrics",
        attributeKey: key,
        rawValue: value,
      }),
    });
  }
  return chips;
};

/*
 * Read-only chips for the page's entity scope (the ids passed as
 * serviceIds). The key is the scope's type label from the first render, so
 * a RUM application page never flashes "Service".
 */
export const buildMetricsLockedScopeChips: (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  scopeEntityType: ServiceType | undefined;
  facetConfigs: Array<FacetConfig> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}) => Array<ActiveFilter> = (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  scopeEntityType: ServiceType | undefined;
  facetConfigs: Array<FacetConfig> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}): Array<ActiveFilter> => {
  const chips: Array<ActiveFilter> = [];
  for (const scopeId of data.scopeIds || []) {
    const id: string = scopeId ? scopeId.toString() : "";
    if (!id) {
      continue;
    }
    const resolved: ActiveFilter = resolveMetricsChipDisplay({
      chip: {
        facetKey: "primaryEntityId",
        value: id,
        displayKey: getTelemetryEntityTypeLabel(data.scopeEntityType),
        displayValue: id,
        readOnly: true,
      },
      facetConfigs: data.facetConfigs,
      nameMap: data.nameMap,
      scopeEntityType: data.scopeEntityType,
    });
    /*
     * The Metrics search bar matches services by name, so the detail is the
     * reason an id has no search syntax here.
     */
    chips.push({
      ...resolved,
      lockedDetail: describeLockedEntityFilter({
        signal: "metrics",
        id,
      }),
    });
  }
  return chips;
};

/*
 * Everything the explorer's chip bar shows: the page's locked entity scope,
 * its locked entity-key scope, its locked attribute scope, then the user's
 * own chips (facet includes, URL-restored and saved-view-restored alike).
 *
 * The entity-key chips sit with the entity-id chips, ahead of the
 * attributes: both name the entity the page is about, and a stored query's
 * chips on the traces viewer (SpanQueryScope) put the entity-key chip right
 * after the entity-id chip in the same way.
 *
 * Only `entityKeysFilter` becomes an entity-key chip. The `entityScope` of a
 * Kubernetes / host / Docker page carries entity keys too, but its attribute
 * chip ("Cluster: prod") already stands for it; a second chip for the same
 * scope would read as a second, AND-ed filter.
 */
export const buildMetricsActiveFilterChips: (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  scopeEntityType: ServiceType | undefined;
  attributeFilters: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
  // The page's bare entity-key scope (an Inventory item), one chip per key.
  entityKeysFilter?: ReadonlyArray<string> | undefined;
  // How each of those chips reads; a key without an entry reads "Resource".
  entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
  activeFilters: Array<ActiveFilter>;
  facetConfigs: Array<FacetConfig> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}) => Array<ActiveFilter> = (data: {
  scopeIds: Array<ObjectID | string> | undefined;
  scopeEntityType: ServiceType | undefined;
  attributeFilters: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
  entityKeysFilter?: ReadonlyArray<string> | undefined;
  entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
  activeFilters: Array<ActiveFilter>;
  facetConfigs: Array<FacetConfig> | undefined;
  nameMap: TelemetryEntityNameMap | undefined;
}): Array<ActiveFilter> => {
  return [
    ...buildMetricsLockedScopeChips({
      scopeIds: data.scopeIds,
      scopeEntityType: data.scopeEntityType,
      facetConfigs: data.facetConfigs,
      nameMap: data.nameMap,
    }),
    ...buildLockedEntityKeyChips({
      rows: "metrics",
      entityKeys: data.entityKeysFilter,
      displays: data.entityKeyDisplays,
    }),
    ...buildMetricsLockedAttributeChips({
      attributeFilters: data.attributeFilters,
      attributeFilterDisplayKeys: data.attributeFilterDisplayKeys,
      attributeFilterDisplayValues: data.attributeFilterDisplayValues,
    }),
    ...data.activeFilters.map((chip: ActiveFilter): ActiveFilter => {
      return resolveMetricsChipDisplay({
        chip,
        facetConfigs: data.facetConfigs,
        nameMap: data.nameMap,
      });
    }),
  ];
};

/*
 * Label for a selected entity in the Metrics Insights scope dropdown when
 * the loaded service list does not cover it (a RUM application or host
 * carried over from the Viewer, or a service that stopped reporting).
 */
export const getMetricsScopeFallbackLabel: (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
}) => string = (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
}): string => {
  return getTelemetryEntityDisplay({ id: data.id, nameMap: data.nameMap })
    .value;
};
