/**
 * How the traces explorer NAMES the telemetry entity a span or a chip points
 * at.
 *
 * A span's `primaryEntityId` is polymorphic: most spans carry a Service id,
 * but a RUM application's spans carry the RumApplication id, agent-ingested
 * host spans the Host id, and so on. The explorer only ever loaded Services,
 * so on a RUM application's traces tab the locked scope chip read
 * "Service: 84858d6c-…", every row's service pill read "unknown service", and
 * the analytics split-by "Service" legend was a list of UUIDs.
 *
 * Everything here is display only. Filters, URL state and saved views keep
 * the id — a name is not unique and is not what the column stores.
 *
 * Renderer-free so the App jest suite can exercise it in plain Node; the
 * components (TracesViewer, TraceRow, SpanDetailsPanel, TracesAnalyticsView,
 * TracesDashboard) only wire it to React state.
 */

import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
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
import {
  ATTRIBUTE_CHIP_PREFIX,
  ATTRIBUTE_SEARCH_CHIP_PREFIX,
} from "./TracesSearchCompile";
import { getAttributeDisplayName } from "../Logs/LogsAttributeFilterChips";

/** The Span column every entity chip ultimately filters. */
export const TRACE_PRIMARY_ENTITY_FACET_KEY: string = "primaryEntityId";

/*
 * `serviceId` is the pre-rename alias of `primaryEntityId`. A saved view or a
 * link written before the rename can still carry it, and its chip names the
 * same entity, so it is displayed the same way.
 */
export const TRACE_ENTITY_FACET_KEYS: ReadonlySet<string> = new Set<string>([
  TRACE_PRIMARY_ENTITY_FACET_KEY,
  "serviceId",
]);

/** What a span row shows when nothing names its entity. */
export const UNKNOWN_SPAN_ENTITY_NAME: string = "unknown service";

type IsTraceEntityFacetKeyFunction = (facetKey: string) => boolean;

export const isTraceEntityFacetKey: IsTraceEntityFacetKeyFunction = (
  facetKey: string,
): boolean => {
  return TRACE_ENTITY_FACET_KEYS.has(facetKey);
};

type NormalizeEntityIdFunction = (
  id: ObjectID | string | null | undefined,
) => string;

const normalizeEntityId: NormalizeEntityIdFunction = (
  id: ObjectID | string | null | undefined,
): string => {
  return id ? id.toString().trim() : "";
};

/*
 * Only UUID-shaped values are worth a lookup. An entity chip can also carry
 * whatever the user typed after `service:` ("api"), and the analytics
 * endpoint already swaps a Service id for its name server-side — sending
 * either to the entity tables costs a request per table and can only miss.
 */
type IsResolvableEntityIdFunction = (id: string) => boolean;

export const isResolvableEntityId: IsResolvableEntityIdFunction = (
  id: string,
): boolean => {
  return id.length > 0 && ObjectID.isValidUUID(id);
};

type BuildFacetDisplayNamesFunction = (
  facetData: FacetData | undefined,
) => Record<string, Record<string, string>>;

/**
 * facetKey -> value -> the server-resolved displayName the facets endpoint
 * attached (Services, for the primaryEntityId facet). Values without one are
 * left out, so a lookup miss means "the server did not name it".
 */
export const buildFacetDisplayNames: BuildFacetDisplayNamesFunction = (
  facetData: FacetData | undefined,
): Record<string, Record<string, string>> => {
  const result: Record<string, Record<string, string>> = {};

  for (const [facetKey, values] of Object.entries(facetData || {})) {
    for (const facetValue of (values || []) as Array<FacetValue>) {
      if (!facetValue.displayName) {
        continue;
      }

      if (!result[facetKey]) {
        result[facetKey] = {};
      }

      result[facetKey]![facetValue.value] = facetValue.displayName;
    }
  }

  return result;
};

type BuildTraceEntityTypeHintsFunction = (
  scopeEntityId: ObjectID | string | null | undefined,
  scopeEntityType: ServiceType | undefined,
) => Record<string, ServiceType>;

/**
 * The host page knows which table its scope id lives in (a RUM page passes
 * ServiceType.RealUserMonitor), so that id goes straight to its own table in
 * one request instead of being tried against every table in turn.
 */
export const buildTraceEntityTypeHints: BuildTraceEntityTypeHintsFunction = (
  scopeEntityId: ObjectID | string | null | undefined,
  scopeEntityType: ServiceType | undefined,
): Record<string, ServiceType> => {
  const id: string = normalizeEntityId(scopeEntityId);

  if (!id || !scopeEntityType) {
    return {};
  }

  return { [id]: scopeEntityType };
};

type CollectTraceEntityIdsToResolveFunction = (data: {
  chips: Array<{ facetKey: string; value: string }>;
  spanEntityIds?: Array<ObjectID | string | null | undefined> | undefined;
  /*
   * Ids an existing source already names (the loaded Services, the facet
   * endpoint's displayName). They keep precedence, so they are not looked up.
   */
  knownNames?: Array<Record<string, string> | undefined> | undefined;
  /*
   * Span ids are only sent once the explorer's own Service list has landed.
   * Before that, every span id looks unnamed and the lookup would re-query
   * the Service table for ids the list is about to name anyway.
   */
  includeSpanEntityIds?: boolean | undefined;
}) => Array<string>;

/**
 * The ids ONE entity-name lookup has to resolve for the traces explorer: the
 * value of every entity chip (locked scope, stored-query scope, facet, URL,
 * saved view) plus every span row's entity — minus whatever is already
 * named. Sorted and de-duplicated so an identical set is an identical key.
 */
export const collectTraceEntityIdsToResolve: CollectTraceEntityIdsToResolveFunction =
  (data: {
    chips: Array<{ facetKey: string; value: string }>;
    spanEntityIds?: Array<ObjectID | string | null | undefined> | undefined;
    knownNames?: Array<Record<string, string> | undefined> | undefined;
    includeSpanEntityIds?: boolean | undefined;
  }): Array<string> => {
    const ids: Set<string> = new Set<string>();

    const isKnown: (id: string) => boolean = (id: string): boolean => {
      return (data.knownNames || []).some(
        (names: Record<string, string> | undefined): boolean => {
          return Boolean(names?.[id]);
        },
      );
    };

    const consider: (raw: ObjectID | string | null | undefined) => void = (
      raw: ObjectID | string | null | undefined,
    ): void => {
      const id: string = normalizeEntityId(raw);

      if (isResolvableEntityId(id) && !isKnown(id)) {
        ids.add(id);
      }
    };

    for (const chip of data.chips) {
      if (isTraceEntityFacetKey(chip.facetKey)) {
        consider(chip.value);
      }
    }

    if (data.includeSpanEntityIds) {
      for (const spanEntityId of data.spanEntityIds || []) {
        consider(spanEntityId);
      }
    }

    return Array.from(ids).sort();
  };

type GetTraceEntityChipDisplayFunction = (data: {
  id: string;
  // Name from an existing source (loaded Services / facet displayName).
  knownName?: string | undefined;
  // The facet's title; "Service" for primaryEntityId.
  facetTitle?: string | undefined;
  // The chip's own seeded display value.
  fallbackValue?: string | undefined;
  entityNames?: TelemetryEntityNameMap | undefined;
  scopeEntityId?: string | undefined;
  scopeEntityType?: ServiceType | undefined;
}) => { key: string; value: string };

/**
 * Key and value for a chip naming a telemetry entity by id.
 *
 * - value: an existing name source first, then the generic resolver, then
 *   the chip's seed, then the id.
 * - key: the host's declared scope type for the scope id — immediately, so a
 *   RUM page reads "RUM Application: …" before the lookup even lands — else
 *   the resolved entity's type label, else the facet title ("Service").
 */
export const getTraceEntityChipDisplay: GetTraceEntityChipDisplayFunction =
  (data: {
    id: string;
    knownName?: string | undefined;
    facetTitle?: string | undefined;
    fallbackValue?: string | undefined;
    entityNames?: TelemetryEntityNameMap | undefined;
    scopeEntityId?: string | undefined;
    scopeEntityType?: ServiceType | undefined;
  }): { key: string; value: string } => {
    const display: { key: string; value: string } = getTelemetryEntityDisplay({
      id: data.id,
      nameMap: data.entityNames,
      fallbackKey: data.facetTitle || DEFAULT_TELEMETRY_ENTITY_LABEL,
      fallbackValue: data.fallbackValue,
    });

    const isDeclaredScope: boolean = Boolean(
      data.scopeEntityType &&
        data.scopeEntityId &&
        data.scopeEntityId === data.id,
    );

    return {
      key: isDeclaredScope
        ? getTelemetryEntityTypeLabel(data.scopeEntityType)
        : display.key,
      value: data.knownName || display.value,
    };
  };

export interface TraceChipDisplayContext {
  facetConfigs: Array<FacetConfig>;
  // facetKey -> value -> server displayName (see buildFacetDisplayNames).
  facetDisplayNames?: Record<string, Record<string, string>> | undefined;
  entityNames?: TelemetryEntityNameMap | undefined;
  // The id the host scoped the explorer to (props.primaryEntityId).
  scopeEntityId?: string | undefined;
  // The table that id lives in, when the host knows it.
  scopeEntityType?: ServiceType | undefined;
}

type GetReadOnlyAttributeChipDisplayKeyFunction = (data: {
  // The attribute key without the `attributes.` chip prefix.
  attributeKey: string;
  // The label the chip's origin seeded, if any.
  seededDisplayKey?: string | undefined;
}) => string;

/**
 * The key a READ-ONLY attribute chip shows: a host page's pinned scope, or an
 * incident / alert stored query's `attributes` (SpanQueryScope). Those pin
 * OTel resource keys (`resource.k8s.cluster.name`), which the Logs tab
 * already labels "Cluster" through ATTRIBUTE_DISPLAY_NAMES — the Traces tab
 * of the same page used to show the raw key.
 *
 * A seeded label that is not just the raw key is an explicit caller choice
 * (attributeFilterDisplayKeys) and keeps precedence over the shared map.
 */
export const getReadOnlyAttributeChipDisplayKey: GetReadOnlyAttributeChipDisplayKeyFunction =
  (data: {
    attributeKey: string;
    seededDisplayKey?: string | undefined;
  }): string => {
    const seeded: string = (data.seededDisplayKey || "").trim();

    if (
      seeded &&
      seeded !== data.attributeKey &&
      seeded !== `${ATTRIBUTE_CHIP_PREFIX}${data.attributeKey}`
    ) {
      return seeded;
    }

    return getAttributeDisplayName(data.attributeKey) || data.attributeKey;
  };

type ResolveTraceChipDisplayFunction = (
  chip: ActiveFilter,
  context: TraceChipDisplayContext,
) => ActiveFilter;

/**
 * Re-derive a chip's label from the explorer's current knowledge. Chips are
 * seeded with whatever their origin knew — a URL or a saved view only knows
 * `facetKey` / `value` — so the label is recomputed every render and
 * improves as Services, facets and entity names load.
 */
export const resolveTraceChipDisplay: ResolveTraceChipDisplayFunction = (
  chip: ActiveFilter,
  context: TraceChipDisplayContext,
): ActiveFilter => {
  if (chip.facetKey.startsWith(ATTRIBUTE_SEARCH_CHIP_PREFIX)) {
    return {
      ...chip,
      displayKey: chip.facetKey.substring(ATTRIBUTE_SEARCH_CHIP_PREFIX.length),
      displayValue: `~${chip.value}`,
    };
  }

  if (chip.facetKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
    const attributeKey: string = chip.facetKey.substring(
      ATTRIBUTE_CHIP_PREFIX.length,
    );

    return {
      ...chip,
      displayKey: chip.readOnly
        ? getReadOnlyAttributeChipDisplayKey({
            attributeKey,
            seededDisplayKey: chip.displayKey,
          })
        : /*
           * A user-typed / clicked chip keeps the literal key: it has to read
           * back as what the user can type into the search bar again.
           */
          attributeKey,
      /*
       * The chip stores a grammar token; show what it means — escapes
       * resolved, so a clicked `/api/*` reads as `/api/*` and not as the
       * `\*` the query needs.
       */
      displayValue: describeSearchValue(chip.value),
    };
  }

  const isEntityChip: boolean = isTraceEntityFacetKey(chip.facetKey);

  // The legacy `serviceId` alias has no facet of its own; it IS the Services facet.
  const configKey: string = isEntityChip
    ? TRACE_PRIMARY_ENTITY_FACET_KEY
    : chip.facetKey;

  const config: FacetConfig | undefined = context.facetConfigs.find(
    (candidate: FacetConfig): boolean => {
      return candidate.key === configKey;
    },
  );

  const knownName: string | undefined =
    config?.valueDisplayMap?.[chip.value] ||
    context.facetDisplayNames?.[chip.facetKey]?.[chip.value] ||
    context.facetDisplayNames?.[configKey]?.[chip.value] ||
    undefined;

  if (isEntityChip) {
    const display: { key: string; value: string } = getTraceEntityChipDisplay({
      id: chip.value,
      knownName,
      facetTitle: config?.title,
      fallbackValue: chip.displayValue,
      entityNames: context.entityNames,
      scopeEntityId: context.scopeEntityId,
      scopeEntityType: context.scopeEntityType,
    });

    return { ...chip, displayKey: display.key, displayValue: display.value };
  }

  /*
   * No facet config (a stored-query scope chip on `entityKeys`, `traceId`,
   * `statusMessage`, …): keep the label the chip was seeded with — "Resource",
   * "Trace" — rather than showing the raw column name.
   */
  return {
    ...chip,
    displayKey: config?.title || chip.displayKey || chip.facetKey,
    displayValue: knownName || chip.displayValue || chip.value,
  };
};

type BuildLockedAttributeChipFunction = (data: {
  key: string;
  value: string;
  displayKeys?: Record<string, string> | undefined;
  displayValues?: Record<string, string> | undefined;
}) => ActiveFilter;

/**
 * The read-only chip for a host's attribute scope (`attributeFilters`).
 * Resource pages scope by a machine identifier — a cluster identifier, a
 * function ARN — while already holding the resource's friendly name, so the
 * chip shows that name. The filter value itself is untouched.
 */
export const buildLockedAttributeChip: BuildLockedAttributeChipFunction =
  (data: {
    key: string;
    value: string;
    displayKeys?: Record<string, string> | undefined;
    displayValues?: Record<string, string> | undefined;
  }): ActiveFilter => {
    return {
      facetKey: `${ATTRIBUTE_CHIP_PREFIX}${data.key}`,
      value: data.value,
      /*
       * The host's explicit label first, then the same friendly label the
       * Logs tab of that page gives the key ("Cluster", "Host"), then the key.
       */
      displayKey: getReadOnlyAttributeChipDisplayKey({
        attributeKey: data.key,
        seededDisplayKey: data.displayKeys?.[data.key],
      }),
      displayValue: data.displayValues?.[data.key] || data.value,
      readOnly: true,
    };
  };

export interface SpanEntityDisplay {
  name: string;
  // "Service", "RUM Application", "Host", …
  typeLabel: string;
  // Only Services carry a color.
  color?: string | undefined;
}

type GetSpanEntityDisplayFunction = (data: {
  service?: Service | undefined;
  entity?: ResolvedTelemetryEntity | undefined;
}) => SpanEntityDisplay;

/**
 * The name a span row / span panel shows for the span's entity. A loaded
 * Service keeps its exact previous rendering (name + color); any other entity
 * the lookup resolved shows its own name and type; nothing at all falls back
 * to "unknown service" as before.
 */
export const getSpanEntityDisplay: GetSpanEntityDisplayFunction = (data: {
  service?: Service | undefined;
  entity?: ResolvedTelemetryEntity | undefined;
}): SpanEntityDisplay => {
  if (data.service) {
    return {
      name: data.service.name || data.entity?.name || UNKNOWN_SPAN_ENTITY_NAME,
      typeLabel: DEFAULT_TELEMETRY_ENTITY_LABEL,
      color: data.service.serviceColor?.toString() || undefined,
    };
  }

  if (data.entity && data.entity.name) {
    return {
      name: data.entity.name,
      typeLabel: data.entity.typeLabel || DEFAULT_TELEMETRY_ENTITY_LABEL,
    };
  }

  return {
    name: UNKNOWN_SPAN_ENTITY_NAME,
    typeLabel: DEFAULT_TELEMETRY_ENTITY_LABEL,
  };
};

type GetSpanEntityFunction = (data: {
  spanEntityId: ObjectID | string | null | undefined;
  serviceById: Record<string, Service>;
  entityNames: TelemetryEntityNameMap | undefined;
}) => {
  service?: Service | undefined;
  entity?: ResolvedTelemetryEntity | undefined;
};

/**
 * What a span row is handed: its loaded Service when there is one, otherwise
 * the resolved entity. Never both, so a real Service renders exactly as it
 * always has.
 */
export const getSpanEntity: GetSpanEntityFunction = (data: {
  spanEntityId: ObjectID | string | null | undefined;
  serviceById: Record<string, Service>;
  entityNames: TelemetryEntityNameMap | undefined;
}): {
  service?: Service | undefined;
  entity?: ResolvedTelemetryEntity | undefined;
} => {
  const id: string = normalizeEntityId(data.spanEntityId);

  if (!id) {
    return {};
  }

  const service: Service | undefined = data.serviceById[id];

  if (service) {
    return { service };
  }

  const entity: ResolvedTelemetryEntity | undefined = data.entityNames?.[id];

  return entity ? { entity } : {};
};

/*
 * Analytics split-by labels. Kept here (not in the view) so the "Service"
 * dimension's naming is tested with the rest of the entity display rules.
 */
export const TRACE_ANALYTICS_STATUS_LABEL: Record<string, string> = {
  "0": "Unset",
  "1": "Ok",
  "2": "Error",
};

export const TRACE_ANALYTICS_KIND_LABEL: Record<string, string> = {
  SPAN_KIND_SERVER: "Server",
  SPAN_KIND_CLIENT: "Client",
  SPAN_KIND_PRODUCER: "Producer",
  SPAN_KIND_CONSUMER: "Consumer",
  SPAN_KIND_INTERNAL: "Internal",
};

export const TRACE_ANALYTICS_EMPTY_GROUP_LABEL: string = "(empty)";

type FormatTraceAnalyticsGroupValueFunction = (data: {
  key: string;
  raw: string;
  serviceNameMap: Record<string, string>;
  entityNames?: TelemetryEntityNameMap | undefined;
}) => string;

/**
 * Display text for one group value of the analytics view. The server already
 * swaps a Service id for its name, so what reaches here as an id on the
 * `primaryEntityId` dimension is normally a non-Service entity (a RUM
 * application, a host) — the resolver names it.
 */
export const formatTraceAnalyticsGroupValue: FormatTraceAnalyticsGroupValueFunction =
  (data: {
    key: string;
    raw: string;
    serviceNameMap: Record<string, string>;
    entityNames?: TelemetryEntityNameMap | undefined;
  }): string => {
    if (!data.raw) {
      return TRACE_ANALYTICS_EMPTY_GROUP_LABEL;
    }

    if (isTraceEntityFacetKey(data.key)) {
      return (
        data.serviceNameMap[data.raw] ||
        data.entityNames?.[data.raw]?.name ||
        data.raw
      );
    }

    if (data.key === "statusCode") {
      return TRACE_ANALYTICS_STATUS_LABEL[data.raw] || data.raw;
    }

    if (data.key === "kind") {
      return TRACE_ANALYTICS_KIND_LABEL[data.raw] || data.raw;
    }

    return data.raw;
  };

type GetTraceAnalyticsGroupTypeLabelFunction = (data: {
  key: string;
  raw: string;
  serviceNameMap: Record<string, string>;
  entityNames?: TelemetryEntityNameMap | undefined;
}) => string | undefined;

/**
 * The entity type behind an entity-dimension group value, in the same order
 * formatTraceAnalyticsGroupValue picks its name: a loaded Service, a resolved
 * entity, or a non-id value (a Service name the server swapped in). An
 * unresolved id has no known type — and needs none, it already reads as the
 * unique id.
 */
export const getTraceAnalyticsGroupTypeLabel: GetTraceAnalyticsGroupTypeLabelFunction =
  (data: {
    key: string;
    raw: string;
    serviceNameMap: Record<string, string>;
    entityNames?: TelemetryEntityNameMap | undefined;
  }): string | undefined => {
    if (!data.raw || !isTraceEntityFacetKey(data.key)) {
      return undefined;
    }

    if (data.serviceNameMap[data.raw]) {
      return DEFAULT_TELEMETRY_ENTITY_LABEL;
    }

    const entity: ResolvedTelemetryEntity | undefined =
      data.entityNames?.[data.raw];

    if (entity && entity.name) {
      return entity.typeLabel || DEFAULT_TELEMETRY_ENTITY_LABEL;
    }

    if (!isResolvableEntityId(data.raw)) {
      return DEFAULT_TELEMETRY_ENTITY_LABEL;
    }

    return undefined;
  };

// How many leading characters of an entity id tell two same-named entities apart.
export const TRACE_ANALYTICS_SHORT_ID_LENGTH: number = 8;

type GetTraceAnalyticsGroupIdentityKeyFunction = (
  groupValues: Record<string, string> | undefined,
) => string;

/**
 * The identity of one analytics group: its RAW dimension values. Two groups
 * are the same series / row only when every raw value matches — never
 * because their display labels happen to match. Dimension order is
 * normalised so a response that lists the keys in another order is still
 * the same group.
 */
export const getTraceAnalyticsGroupIdentityKey: GetTraceAnalyticsGroupIdentityKeyFunction =
  (groupValues: Record<string, string> | undefined): string => {
    const entries: Array<[string, string]> = Object.entries(
      groupValues || {},
    ).map(([key, value]: [string, string]): [string, string] => {
      return [key, value === undefined || value === null ? "" : `${value}`];
    });

    entries.sort((a: [string, string], b: [string, string]): number => {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

    return JSON.stringify(entries);
  };

type BuildTraceAnalyticsGroupLabelsFunction = (data: {
  groups: Array<Record<string, string> | undefined>;
  serviceNameMap: Record<string, string>;
  entityNames?: TelemetryEntityNameMap | undefined;
  // Label of a group with no dimensions (a timeseries with no split).
  ungroupedLabel?: string | undefined;
  // Labels that must not be produced (e.g. the pivot row's `time` field).
  reservedLabels?: Array<string> | undefined;
}) => Map<string, string>;

/**
 * identity key (getTraceAnalyticsGroupIdentityKey) -> a display label that is
 * UNIQUE across the given groups.
 *
 * Names are not unique: a Service "checkout" and a RUM application
 * "checkout", or two hosts both called "ip-10-0-0-12", used to produce the
 * same label. The timeseries pivot keyed its series by that label, so the
 * two series collapsed into one and overwrote each other's values, and the
 * legend rendered duplicate React keys. Labels are therefore widened only as
 * far as needed:
 *
 * 1. the plain names ("checkout");
 * 2. clashing groups add each entity's type ("checkout (Service)",
 *    "checkout (RUM Application)");
 * 3. still-clashing groups add a short id ("ip-10-0-0-12 (Host · 44444444)");
 * 4. anything left (e.g. the "(empty)" group next to a span literally named
 *    "(empty)") is numbered in order of first appearance.
 */
export const buildTraceAnalyticsGroupLabels: BuildTraceAnalyticsGroupLabelsFunction =
  (data: {
    groups: Array<Record<string, string> | undefined>;
    serviceNameMap: Record<string, string>;
    entityNames?: TelemetryEntityNameMap | undefined;
    ungroupedLabel?: string | undefined;
    reservedLabels?: Array<string> | undefined;
  }): Map<string, string> => {
    // Distinct groups, in order of first appearance.
    const identityKeys: Array<string> = [];
    const entriesByKey: Map<string, Array<[string, string]>> = new Map();

    for (const groupValues of data.groups) {
      const identityKey: string =
        getTraceAnalyticsGroupIdentityKey(groupValues);

      if (entriesByKey.has(identityKey)) {
        continue;
      }

      identityKeys.push(identityKey);
      entriesByKey.set(
        identityKey,
        Object.entries(groupValues || {}).map(
          ([key, value]: [string, string]): [string, string] => {
            return [
              key,
              value === undefined || value === null ? "" : `${value}`,
            ];
          },
        ),
      );
    }

    type LabelLevel = "name" | "type" | "id";

    const labelFor: (identityKey: string, level: LabelLevel) => string = (
      identityKey: string,
      level: LabelLevel,
    ): string => {
      const entries: Array<[string, string]> =
        entriesByKey.get(identityKey) || [];

      if (entries.length === 0) {
        return data.ungroupedLabel || TRACE_ANALYTICS_EMPTY_GROUP_LABEL;
      }

      return entries
        .map(([key, raw]: [string, string]): string => {
          const name: string = formatTraceAnalyticsGroupValue({
            key,
            raw,
            serviceNameMap: data.serviceNameMap,
            entityNames: data.entityNames,
          });

          if (level === "name" || !isTraceEntityFacetKey(key) || !raw) {
            return name;
          }

          const qualifiers: Array<string> = [];
          const typeLabel: string | undefined = getTraceAnalyticsGroupTypeLabel(
            {
              key,
              raw,
              serviceNameMap: data.serviceNameMap,
              entityNames: data.entityNames,
            },
          );

          if (typeLabel) {
            qualifiers.push(typeLabel);
          }

          /*
           * The label of an unresolved id IS the id; repeating a piece of it
           * would add nothing.
           */
          if (level === "id" && isResolvableEntityId(raw) && name !== raw) {
            qualifiers.push(raw.substring(0, TRACE_ANALYTICS_SHORT_ID_LENGTH));
          }

          return qualifiers.length > 0
            ? `${name} (${qualifiers.join(" · ")})`
            : name;
        })
        .join(" / ");
    };

    const labels: Map<string, string> = new Map();

    for (const identityKey of identityKeys) {
      labels.set(identityKey, labelFor(identityKey, "name"));
    }

    const widenClashes: (level: LabelLevel) => void = (
      level: LabelLevel,
    ): void => {
      const counts: Map<string, number> = new Map();

      for (const label of labels.values()) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }

      for (const identityKey of identityKeys) {
        if ((counts.get(labels.get(identityKey)!) || 0) > 1) {
          labels.set(identityKey, labelFor(identityKey, level));
        }
      }
    };

    widenClashes("type");
    widenClashes("id");

    const reserved: Set<string> = new Set<string>(data.reservedLabels || []);
    const planned: Set<string> = new Set<string>(labels.values());
    const used: Set<string> = new Set<string>();

    for (const identityKey of identityKeys) {
      const label: string = labels.get(identityKey)!;
      let unique: string = label;

      if (used.has(unique) || reserved.has(unique)) {
        let suffix: number = 2;
        unique = `${label} #${suffix}`;

        while (
          used.has(unique) ||
          reserved.has(unique) ||
          planned.has(unique)
        ) {
          suffix++;
          unique = `${label} #${suffix}`;
        }
      }

      used.add(unique);
      labels.set(identityKey, unique);
    }

    return labels;
  };

export interface TraceAnalyticsTimeseriesInputRow {
  time: string;
  value: number;
  groupValues?: Record<string, string> | undefined;
}

export interface TraceAnalyticsPivotedRow {
  time: string;
  [series: string]: number | string;
}

export const TRACE_ANALYTICS_PIVOT_TIME_KEY: string = "time";

type PivotTraceAnalyticsTimeseriesFunction = (data: {
  rows: Array<TraceAnalyticsTimeseriesInputRow>;
  serviceNameMap: Record<string, string>;
  entityNames?: TelemetryEntityNameMap | undefined;
  // Series label when the timeseries is not split (the metric's label).
  metricLabel: string;
}) => {
  pivotedData: Array<TraceAnalyticsPivotedRow>;
  // Unique series labels, in order of first appearance; each is a dataKey.
  seriesKeys: Array<string>;
};

/**
 * One chart row per bucket, one column per series. Series are identified by
 * their raw group values and named by buildTraceAnalyticsGroupLabels, so the
 * unique label can serve as the recharts dataKey (which the legend and the
 * tooltip print) without two different entities sharing a column.
 */
export const pivotTraceAnalyticsTimeseries: PivotTraceAnalyticsTimeseriesFunction =
  (data: {
    rows: Array<TraceAnalyticsTimeseriesInputRow>;
    serviceNameMap: Record<string, string>;
    entityNames?: TelemetryEntityNameMap | undefined;
    metricLabel: string;
  }): {
    pivotedData: Array<TraceAnalyticsPivotedRow>;
    seriesKeys: Array<string>;
  } => {
    const labels: Map<string, string> = buildTraceAnalyticsGroupLabels({
      groups: data.rows.map(
        (
          row: TraceAnalyticsTimeseriesInputRow,
        ): Record<string, string> | undefined => {
          return row.groupValues;
        },
      ),
      serviceNameMap: data.serviceNameMap,
      entityNames: data.entityNames,
      ungroupedLabel: data.metricLabel,
      // A series named "time" would overwrite the bucket's own time field.
      reservedLabels: [TRACE_ANALYTICS_PIVOT_TIME_KEY],
    });

    const rowsByTime: Map<string, TraceAnalyticsPivotedRow> = new Map();
    const seriesKeys: Set<string> = new Set<string>();

    for (const row of data.rows) {
      let pivotRow: TraceAnalyticsPivotedRow | undefined = rowsByTime.get(
        row.time,
      );

      if (!pivotRow) {
        pivotRow = { time: row.time };
        rowsByTime.set(row.time, pivotRow);
      }

      const seriesKey: string = labels.get(
        getTraceAnalyticsGroupIdentityKey(row.groupValues),
      )!;

      seriesKeys.add(seriesKey);
      pivotRow[seriesKey] = row.value;
    }

    return {
      pivotedData: Array.from(rowsByTime.values()),
      seriesKeys: Array.from(seriesKeys),
    };
  };

type BuildTraceAnalyticsValueLabelsFunction = (data: {
  key: string;
  values: Array<string | undefined>;
  serviceNameMap: Record<string, string>;
  entityNames?: TelemetryEntityNameMap | undefined;
}) => Map<string, string>;

/**
 * raw value -> unique label for ONE dimension: the top list's items, or one
 * column of the table. Those render a row per item, so nothing collapses —
 * but two rows both reading "checkout" are just as ambiguous, so they get
 * the same widening as the timeseries legend.
 */
export const buildTraceAnalyticsValueLabels: BuildTraceAnalyticsValueLabelsFunction =
  (data: {
    key: string;
    values: Array<string | undefined>;
    serviceNameMap: Record<string, string>;
    entityNames?: TelemetryEntityNameMap | undefined;
  }): Map<string, string> => {
    const groupFor: (raw: string | undefined) => Record<string, string> = (
      raw: string | undefined,
    ): Record<string, string> => {
      return { [data.key]: raw || "" };
    };

    const byIdentity: Map<string, string> = buildTraceAnalyticsGroupLabels({
      groups: data.values.map(groupFor),
      serviceNameMap: data.serviceNameMap,
      entityNames: data.entityNames,
    });

    const result: Map<string, string> = new Map();

    for (const raw of data.values) {
      result.set(
        raw || "",
        byIdentity.get(getTraceAnalyticsGroupIdentityKey(groupFor(raw)))!,
      );
    }

    return result;
  };

type CollectTraceAnalyticsEntityIdsFunction = (data: {
  rows: Array<{ groupValues?: Record<string, string> | undefined }>;
  topList?: Array<{ value: string }> | undefined;
  topListGroupKey?: string | undefined;
  serviceNameMap: Record<string, string>;
}) => Array<string>;

/**
 * The entity ids on the analytics view's screen that nothing names yet: the
 * `primaryEntityId` group values of the timeseries / table rows, and the top
 * list's values when it is split by that dimension.
 */
export const collectTraceAnalyticsEntityIds: CollectTraceAnalyticsEntityIdsFunction =
  (data: {
    rows: Array<{ groupValues?: Record<string, string> | undefined }>;
    topList?: Array<{ value: string }> | undefined;
    topListGroupKey?: string | undefined;
    serviceNameMap: Record<string, string>;
  }): Array<string> => {
    const ids: Set<string> = new Set<string>();

    const consider: (raw: string | undefined) => void = (
      raw: string | undefined,
    ): void => {
      const id: string = normalizeEntityId(raw);

      if (isResolvableEntityId(id) && !data.serviceNameMap[id]) {
        ids.add(id);
      }
    };

    for (const row of data.rows) {
      for (const [key, value] of Object.entries(row.groupValues || {})) {
        if (isTraceEntityFacetKey(key)) {
          consider(value);
        }
      }
    }

    if (data.topListGroupKey && isTraceEntityFacetKey(data.topListGroupKey)) {
      for (const item of data.topList || []) {
        consider(item.value);
      }
    }

    return Array.from(ids).sort();
  };

type GetTraceEntityOptionLabelFunction = (data: {
  id: string;
  knownLabel?: string | undefined;
  entityNames?: TelemetryEntityNameMap | undefined;
  fallback?: string | undefined;
}) => string;

/**
 * Label for an entity id in a picker or a list (the Insights tab's service
 * scope and its recent-trace rows): the loaded Service's name, else the
 * resolved entity's name, else the caller's fallback, else the id.
 */
export const getTraceEntityOptionLabel: GetTraceEntityOptionLabelFunction =
  (data: {
    id: string;
    knownLabel?: string | undefined;
    entityNames?: TelemetryEntityNameMap | undefined;
    fallback?: string | undefined;
  }): string => {
    return (
      data.knownLabel ||
      data.entityNames?.[data.id]?.name ||
      data.fallback ||
      data.id
    );
  };
