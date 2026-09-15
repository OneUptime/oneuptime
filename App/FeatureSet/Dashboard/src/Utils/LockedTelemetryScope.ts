import {
  LockedFilterDetail,
  LockedFilterPredicate,
} from "Common/Types/Telemetry/LockedFilterDetail";
import {
  SearchableLockedFilter,
  TELEMETRY_EXPLORER_LABELS,
  TelemetrySignal,
  buildSearchTextForFilters,
  buildSearchTokenForFilter,
  buildSearchTokenForOperatorValue,
  isSearchTokenSafeKey,
} from "Common/Utils/Telemetry/LockedFilterSearch";
import {
  DictionaryEntryValue,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

/*
 * What the locked chips of an embedded telemetry explorer say about
 * themselves, and how the whole locked scope travels to the main explorer.
 *
 * A resource page (a Kubernetes cluster, a Docker host, a RUM application,
 * an incident's stored query, ...) pins the Logs / Traces / Metrics viewer it
 * embeds to its own slice of telemetry. The viewer shows that slice as grey
 * chips with a lock icon and nothing more, so a reader cannot tell whether
 * the match is by OTel resource attribute, by entity membership or by
 * service id — nor how to reproduce it on the main explorer page. The
 * describers here fill a LockedFilterDetail per chip (rendered as a rich
 * tooltip by the shared chip component) and build the "Copy filter" text.
 *
 * This module is deliberately PURE: no route map, no navigation, nothing
 * that touches the browser at load. The chip builders of all three viewers
 * (renderer-free modules with plain-node tests) import the describers, and
 * the route map's import chain reads `window` the moment it loads — which is
 * why the explorer LINK builder lives next door in LockedTelemetryScopeLink.
 * The tables that say which chips that link can carry live HERE, so a
 * describer can tell a reader "use Open in Logs" only when that is true.
 */

/*
 * The thing a resource page's attribute scope names, in the words a person
 * would use. The summary sentence reads "Only logs from this Kubernetes
 * cluster are shown." — the chip's own label ("Cluster") is not enough,
 * because Ceph, Proxmox, Docker Swarm and Kubernetes pages all say "Cluster".
 */
export const SCOPE_NOUN_BY_ATTRIBUTE_KEY: Readonly<Record<string, string>> = {
  "resource.k8s.cluster.name": "Kubernetes cluster",
  "resource.k8s.pod.name": "Kubernetes pod",
  "resource.k8s.container.name": "Kubernetes container",
  "resource.k8s.namespace.name": "Kubernetes namespace",
  "resource.host.name": "host",
  "resource.container.runtime": "container runtime",
  "resource.container.name": "container",
  "resource.container.id": "container",
  "resource.faas.name": "serverless function",
  "resource.cloud.platform": "cloud platform",
  "resource.cloud.account.id": "cloud account",
  "resource.cloud.region": "cloud region",
  "resource.ceph.cluster.name": "Ceph cluster",
  "resource.proxmox.cluster.name": "Proxmox cluster",
  "resource.docker.swarm.cluster.name": "Docker Swarm cluster",
  "resource.vmware.vcenter.name": "VMware vCenter",
  "resource.iot.fleet.name": "IoT fleet",
  "resource.service.name": "service",
  "networkDevice.id": "network device",
};

const DEFAULT_SCOPE_NOUN: string = "resource";

type GetScopeNounForAttributeKeyFunction = (attributeKey: string) => string;

/** The noun for an attribute key, "resource" when the key is not a known one. */
export const getScopeNounForAttributeKey: GetScopeNounForAttributeKeyFunction =
  (attributeKey: string): string => {
    if (
      Object.prototype.hasOwnProperty.call(
        SCOPE_NOUN_BY_ATTRIBUTE_KEY,
        attributeKey,
      )
    ) {
      return SCOPE_NOUN_BY_ATTRIBUTE_KEY[attributeKey] as string;
    }

    return DEFAULT_SCOPE_NOUN;
  };

/*
 * The two places a locked chip can come from, worded once so every viewer's
 * tooltip says the same thing.
 */
export const LOCKED_FILTER_SOURCE_PAGE: string = "Pinned by this page";
export const LOCKED_FILTER_SOURCE_STORED_QUERY: string =
  "Pinned by the stored query this view was opened with";

export const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * Which chips the explorer LINK (LockedTelemetryScopeLink) can carry, by the
 * facet key of the chip. Kept in the pure module because the describers
 * consult it: a chip is told "use Open in Logs instead" only when that link
 * would actually carry it. The link builder imports these — never the other
 * way round.
 *
 * `serviceId` is the pre-rename alias of `primaryEntityId`; the link folds
 * it into `primaryEntityId` on the way out.
 */
export const SERVICE_FACET_KEYS: ReadonlySet<string> = new Set<string>([
  "primaryEntityId",
  "serviceId",
]);

export const RESOURCE_ENTITY_FACET_KEYS: ReadonlyArray<string> = [
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
];

/*
 * Per explorer, the top-level columns its URL `filters` grammar compiles
 * into a predicate (readInitialUrlState + the facet compile of each viewer).
 * A `sessionId` chip is a plain top-level column on both the logs and the
 * traces explorer, and the logs aggregate requests take it from the list
 * query, so it rides on both.
 */
export const CARRIED_FACET_KEYS_BY_SIGNAL: Readonly<
  Record<TelemetrySignal, ReadonlySet<string>>
> = {
  logs: new Set<string>([
    "traceId",
    "spanId",
    "sessionId",
    "severityText",
    ...RESOURCE_ENTITY_FACET_KEYS,
  ]),
  traces: new Set<string>([
    "traceId",
    "spanId",
    "sessionId",
    "statusCode",
    "kind",
    "hasException",
    "name",
    "statusMessage",
    ...RESOURCE_ENTITY_FACET_KEYS,
  ]),
  metrics: new Set<string>([]),
};

type IsFilterCarriedByExplorerLinkFunction = (
  signal: TelemetrySignal,
  facetKey: string,
) => boolean;

/**
 * Whether the explorer link for `signal` carries a chip of this facet key.
 * Attribute chips ride on every explorer (an operator-valued one does not,
 * but that is a property of the value, decided by the caller); entity ids
 * ride everywhere; everything else is per the table above.
 */
export const isFilterCarriedByExplorerLink: IsFilterCarriedByExplorerLinkFunction =
  (signal: TelemetrySignal, facetKey: string): boolean => {
    if (facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
      return true;
    }

    if (SERVICE_FACET_KEYS.has(facetKey)) {
      return true;
    }

    return CARRIED_FACET_KEYS_BY_SIGNAL[signal].has(facetKey);
  };

/*
 * The predicate notes. Entity keys are an implementation detail most readers
 * have never met, so the note says what they are for rather than what they
 * are — and, since the attribute filter always applies alongside, that the
 * key can never admit a row the attribute would not.
 */
const ATTRIBUTE_PREDICATE_NOTE: string =
  "Matches the OpenTelemetry resource attribute this page scopes by.";
const ENTITY_SCOPE_PREDICATE_NOTE: string =
  "Newer rows are also stamped with a stable entity key at ingest; because the attribute filter applies too, only rows carrying the attribute are shown.";

const OPERATOR_FILTER_NO_SYNTAX_REASON: string =
  "This operator filter cannot be spelled in the search bar.";
const UNSAFE_KEY_NO_SYNTAX_REASON: string =
  "This attribute key cannot be typed into the search bar.";
const EMPTY_VALUE_NO_SYNTAX_REASON: string =
  "This filter has no value to copy.";
export const CANNOT_TRAVEL_REASON: string =
  "This filter cannot be copied or carried to the explorer.";

type ExplorerLabelFunction = (signal: TelemetrySignal) => string;

const explorerLabel: ExplorerLabelFunction = (
  signal: TelemetrySignal,
): string => {
  return TELEMETRY_EXPLORER_LABELS[signal];
};

type NoSyntaxReasonFunction = (
  signal: TelemetrySignal,
  facetKey: string,
) => string;

/*
 * "Use Open in <Explorer> instead" is only honest when that link carries the
 * chip; otherwise the reader is told plainly that the filter cannot travel.
 */
const noSyntaxReason: NoSyntaxReasonFunction = (
  signal: TelemetrySignal,
  facetKey: string,
): string => {
  if (isFilterCarriedByExplorerLink(signal, facetKey)) {
    return `This filter has no search syntax; use Open in ${explorerLabel(signal)} instead.`;
  }

  return CANNOT_TRAVEL_REASON;
};

type IsScalarFunction = (value: unknown) => value is string | number | boolean;

export const isScalar: IsScalarFunction = (
  value: unknown,
): value is string | number | boolean => {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
};

type QuoteScalarFunction = (value: string | number | boolean) => string;

/*
 * Strings are JSON-quoted so a value with spaces or an empty value reads
 * unambiguously; numbers and booleans are bare because that is how the
 * predicate compares them.
 */
const quoteScalar: QuoteScalarFunction = (
  value: string | number | boolean,
): string => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
};

type FormatOperatorExpressionFunction = (
  attributeKey: string,
  value: unknown,
) => string;

/*
 * `key is any of a, b`, `key contains x`, `key is empty` — the same operator
 * symbols the attribute filter form and the "Filtered by:" chips use, so the
 * tooltip and the form agree on what a filter is called.
 */
const formatOperatorExpression: FormatOperatorExpressionFunction = (
  attributeKey: string,
  value: unknown,
): string => {
  const detected: ReturnType<typeof detectOperatorFromValue> =
    detectOperatorFromValue(value);
  const option: DictionaryFilterOperatorOption = getOperatorOption(
    detected.operator,
  );

  if (option.hidesValueInput || detected.rawValue === "") {
    return `${attributeKey} ${option.symbol}`;
  }

  return `${attributeKey} ${option.symbol} ${detected.rawValue}`;
};

export interface LockedEntityScope {
  entityKeys: Array<string>;
  attributeKey: string;
  attributeValue: string;
}

export interface DescribeLockedAttributeFilterInput {
  signal: TelemetrySignal;
  /** The attribute key without the `attributes.` chip prefix. */
  attributeKey: string;
  /*
   * The value as the host page pinned it: a scalar for the implicit `=`,
   * an operator instance (`Includes`, `Search`, ...) for anything else.
   */
  rawValue: DictionaryEntryValue | undefined;
  displayKey: string;
  displayValue: string;
  /*
   * The page's entity scope, when it has one. Attached only when it names
   * THIS attribute — a page can scope by several attributes and the entity
   * key belongs to exactly one of them.
   */
  entityScope?: LockedEntityScope | undefined;
  source?: string | undefined;
}

type DescribeLockedAttributeFilterFunction = (
  input: DescribeLockedAttributeFilterInput,
) => LockedFilterDetail;

/**
 * The explanation of a chip pinned through `logQuery.attributes` /
 * `attributeFilters`.
 *
 * Every resource page pins the attribute as an ordinary equality; the pages
 * with an entity scope pin, ALONGSIDE it, the scope the server compiles to
 * `hasAny(entityKeys, [...]) OR attributes[key] = value` (StatementGenerator).
 * The two AND together, so the entity-key half can never admit a row the
 * attribute equality rejects — the tooltip lists both predicates as "all of"
 * and says so, rather than promising an "either" the query does not make.
 */
export const describeLockedAttributeFilter: DescribeLockedAttributeFilterFunction =
  (input: DescribeLockedAttributeFilterInput): LockedFilterDetail => {
    const noun: string = getScopeNounForAttributeKey(input.attributeKey);
    const summary: string =
      noun === DEFAULT_SCOPE_NOUN
        ? `Only ${input.signal} matching this resource attribute are shown.`
        : `Only ${input.signal} from this ${noun} are shown.`;

    const hasEntityScope: boolean = Boolean(
      input.entityScope &&
        input.entityScope.attributeKey === input.attributeKey &&
        input.entityScope.entityKeys.length > 0,
    );

    const isScalarValue: boolean = isScalar(input.rawValue);

    const attributePredicate: LockedFilterPredicate = {
      label: "Attribute",
      expression: isScalarValue
        ? `${input.attributeKey} = ${quoteScalar(
            input.rawValue as string | number | boolean,
          )}`
        : formatOperatorExpression(input.attributeKey, input.rawValue),
    };

    if (hasEntityScope) {
      attributePredicate.note = ATTRIBUTE_PREDICATE_NOTE;
    }

    const predicates: Array<LockedFilterPredicate> = [attributePredicate];

    if (hasEntityScope) {
      const scope: LockedEntityScope = input.entityScope!;

      predicates.push({
        label: "Entity scope",
        expression: `entityKeys has ${scope.entityKeys.join(", ")} OR ${
          scope.attributeKey
        } = ${JSON.stringify(scope.attributeValue)}`,
        note: ENTITY_SCOPE_PREDICATE_NOTE,
      });
    }

    const detail: LockedFilterDetail = {
      source: input.source || LOCKED_FILTER_SOURCE_PAGE,
      summary,
      predicates,
      combinator: "all",
    };

    if (!isSearchTokenSafeKey(input.attributeKey)) {
      detail.searchTokenUnavailableReason = UNSAFE_KEY_NO_SYNTAX_REASON;
      return detail;
    }

    if (!isScalarValue) {
      const operatorToken: string | null = buildSearchTokenForOperatorValue(
        input.attributeKey,
        input.rawValue,
      );

      if (operatorToken) {
        detail.searchToken = operatorToken;
      } else {
        detail.searchTokenUnavailableReason = OPERATOR_FILTER_NO_SYNTAX_REASON;
      }

      return detail;
    }

    const searchToken: string | null = buildSearchTokenForFilter(
      input.signal,
      `${ATTRIBUTE_FACET_PREFIX}${input.attributeKey}`,
      String(input.rawValue),
    );

    if (searchToken) {
      detail.searchToken = searchToken;
    } else {
      detail.searchTokenUnavailableReason = EMPTY_VALUE_NO_SYNTAX_REASON;
    }

    return detail;
  };

export interface DescribeLockedEntityFilterInput {
  signal: TelemetrySignal;
  /** "Service", "RUM Application", "Host", ... */
  entityTypeLabel: string;
  id: string;
  name?: string | undefined;
  source?: string | undefined;
}

type DescribeLockedEntityFilterFunction = (
  input: DescribeLockedEntityFilterInput,
) => LockedFilterDetail;

/**
 * The explanation of a `primaryEntityId` chip — a Service or RUM application
 * page's scope. Logs and traces accept the id verbatim after `service:`;
 * the Metrics search bar matches services by NAME, so there the only faithful
 * way over is the explorer link (which carries entity ids on every explorer).
 */
export const describeLockedEntityFilter: DescribeLockedEntityFilterFunction = (
  input: DescribeLockedEntityFilterInput,
): LockedFilterDetail => {
  const detail: LockedFilterDetail = {
    source: input.source || LOCKED_FILTER_SOURCE_PAGE,
    summary: `Only ${input.signal} emitted by this ${input.entityTypeLabel} are shown.`,
    predicates: [
      {
        label: "Entity id",
        expression: `primaryEntityId = ${JSON.stringify(input.id)}`,
        note: `The ${input.entityTypeLabel}'s OneUptime id, stored on every row it emits.`,
      },
    ],
    combinator: "all",
  };

  const searchToken: string | null = buildSearchTokenForFilter(
    input.signal,
    "primaryEntityId",
    input.id,
  );

  if (searchToken) {
    detail.searchToken = searchToken;
  } else if (input.signal === "metrics") {
    detail.searchTokenUnavailableReason =
      "The Metrics search bar matches services by name, not by id — use Open in Metrics instead.";
  } else {
    detail.searchTokenUnavailableReason = EMPTY_VALUE_NO_SYNTAX_REASON;
  }

  return detail;
};

type DescribeLockedIdFilterFunction = (input: {
  signal: TelemetrySignal;
  facetKey: string;
  label: string;
  id: string;
  summary: string;
  source?: string | undefined;
}) => LockedFilterDetail;

/*
 * Trace and span chips share one shape: an id column, a `trace:` / `span:`
 * token on logs and traces, and nothing on metrics — which has neither
 * column, so a metrics viewer never shows these chips in the first place.
 */
const describeLockedIdFilter: DescribeLockedIdFilterFunction = (input: {
  signal: TelemetrySignal;
  facetKey: string;
  label: string;
  id: string;
  summary: string;
  source?: string | undefined;
}): LockedFilterDetail => {
  const detail: LockedFilterDetail = {
    source: input.source || LOCKED_FILTER_SOURCE_PAGE,
    summary: input.summary,
    predicates: [
      {
        label: input.label,
        expression: `${input.facetKey} = ${JSON.stringify(input.id)}`,
      },
    ],
    combinator: "all",
  };

  const searchToken: string | null = buildSearchTokenForFilter(
    input.signal,
    input.facetKey,
    input.id,
  );

  if (searchToken) {
    detail.searchToken = searchToken;
  } else {
    detail.searchTokenUnavailableReason = noSyntaxReason(
      input.signal,
      input.facetKey,
    );
  }

  return detail;
};

export interface DescribeLockedTraceFilterInput {
  signal: TelemetrySignal;
  traceId: string;
  source?: string | undefined;
}

type DescribeLockedTraceFilterFunction = (
  input: DescribeLockedTraceFilterInput,
) => LockedFilterDetail;

export const describeLockedTraceFilter: DescribeLockedTraceFilterFunction = (
  input: DescribeLockedTraceFilterInput,
): LockedFilterDetail => {
  return describeLockedIdFilter({
    signal: input.signal,
    facetKey: "traceId",
    label: "Trace ID",
    id: input.traceId,
    summary: `Only ${input.signal} that belong to this trace are shown.`,
    source: input.source,
  });
};

export interface DescribeLockedSpanFilterInput {
  signal: TelemetrySignal;
  spanId: string;
  source?: string | undefined;
}

type DescribeLockedSpanFilterFunction = (
  input: DescribeLockedSpanFilterInput,
) => LockedFilterDetail;

export const describeLockedSpanFilter: DescribeLockedSpanFilterFunction = (
  input: DescribeLockedSpanFilterInput,
): LockedFilterDetail => {
  return describeLockedIdFilter({
    signal: input.signal,
    facetKey: "spanId",
    label: "Span ID",
    id: input.spanId,
    summary: `Only ${input.signal} that belong to this span are shown.`,
    source: input.source,
  });
};

export interface DescribeLockedSessionFilterInput {
  signal: TelemetrySignal;
  sessionId: string;
  source?: string | undefined;
}

type DescribeLockedSessionFilterFunction = (
  input: DescribeLockedSessionFilterInput,
) => LockedFilterDetail;

/**
 * A RUM session chip. No explorer has a `session:` token; the logs and
 * traces explorers do accept the session as a URL chip, which is what the
 * explorer link carries (see CARRIED_FACET_KEYS_BY_SIGNAL). Metrics have no
 * session dimension at all.
 */
export const describeLockedSessionFilter: DescribeLockedSessionFilterFunction =
  (input: DescribeLockedSessionFilterInput): LockedFilterDetail => {
    return {
      source: input.source || LOCKED_FILTER_SOURCE_PAGE,
      summary: `Only ${input.signal} recorded during this session are shown.`,
      predicates: [
        {
          label: "Session ID",
          expression: `sessionId = ${JSON.stringify(input.sessionId)}`,
        },
      ],
      combinator: "all",
      searchTokenUnavailableReason:
        input.signal === "metrics"
          ? "Sessions are not a metrics dimension."
          : isFilterCarriedByExplorerLink(input.signal, "sessionId")
            ? `Session filters have no search syntax; use Open in ${explorerLabel(
                input.signal,
              )} instead.`
            : CANNOT_TRAVEL_REASON,
    };
  };

/** How a stored-query column matches its single value. */
export type StoredQueryMatch = "equals" | "contains";

export interface DescribeLockedStoredQueryFilterInput {
  signal: TelemetrySignal;
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
  /*
   * "contains" for a text column whose single stored value the viewer
   * compiles as a substring match (a trace monitor stores `new Search(name)`
   * and the traces viewer mirrors that for one value of `name` /
   * `statusMessage`); "equals" — the default — for everything else.
   */
  matches?: StoredQueryMatch | undefined;
}

type DescribeLockedStoredQueryFilterFunction = (
  input: DescribeLockedStoredQueryFilterInput,
) => LockedFilterDetail;

/**
 * A chip the traces viewer derived from a host's stored `spanQuery` (an
 * incident, alert or monitor snapshot). The viewer knows the column and the
 * value, not why the host chose them, so the explanation is the predicate
 * itself under the stored-query source line.
 */
export const describeLockedStoredQueryFilter: DescribeLockedStoredQueryFilterFunction =
  (input: DescribeLockedStoredQueryFilterInput): LockedFilterDetail => {
    const isAttribute: boolean = input.facetKey.startsWith(
      ATTRIBUTE_FACET_PREFIX,
    );
    const column: string = isAttribute
      ? input.facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)
      : input.facetKey;

    let predicate: LockedFilterPredicate;

    if (input.facetKey === "entityKeys") {
      // A membership column: "has", not "=".
      predicate = {
        label: "Entity key",
        expression: `entityKeys has ${input.value}`,
      };
    } else {
      const comparison: string =
        input.matches === "contains" ? "contains" : "=";

      predicate = {
        label: isAttribute ? "Attribute" : input.displayKey,
        expression: `${column} ${comparison} ${JSON.stringify(input.value)}`,
      };
    }

    const detail: LockedFilterDetail = {
      source: LOCKED_FILTER_SOURCE_STORED_QUERY,
      summary: `Only ${input.signal} matching the stored query are shown.`,
      predicates: [predicate],
      combinator: "all",
    };

    const searchToken: string | null = buildSearchTokenForFilter(
      input.signal,
      input.facetKey,
      input.value,
    );

    if (searchToken) {
      detail.searchToken = searchToken;
    } else {
      detail.searchTokenUnavailableReason = noSyntaxReason(
        input.signal,
        input.facetKey,
      );
    }

    return detail;
  };

/*
 * The column an entity-key scope filters: the `entityKeys` membership array
 * every telemetry row is stamped with at ingest, one key per entity its
 * resource describes. An Inventory item's pages scope every signal by it.
 */
export const ENTITY_KEYS_FACET_KEY: string = "entityKeys";

/*
 * The key an entity-key chip reads when its page did not name the entity —
 * the same word a stored query's entity-key chip is seeded with
 * (SpanQueryScope), so the two never disagree on screen.
 */
export const DEFAULT_ENTITY_KEY_DISPLAY_KEY: string = "Resource";

/*
 * What an entity-key scope narrows: the rows of one of the three explorers,
 * or of the exceptions and profiles lists, which scope the same way but have
 * no explorer link to hand the filter to.
 */
export type EntityKeyScopedRows = TelemetrySignal | "exceptions" | "profiles";

/*
 * Worded as a possibility, not a fact: whether rows owned by another resource
 * appear depends on the item. A host's list can hold a service's rows (the
 * service is their primary owner), while a service's own rows all name it as
 * their owner — a note claiming the list DOES include foreign rows sends the
 * reader looking for rows that are not there.
 */
const ENTITY_KEY_PREDICATE_NOTE: string =
  "Rows are stamped at ingest with the key of every resource they describe, so rows primarily owned by another resource (a service running on it, say) can appear here too.";
const ENTITY_KEY_ANY_OF_PREDICATE_NOTE: string =
  "A row carrying any one of these keys is shown.";
export const ENTITY_KEY_NO_SYNTAX_REASON: string =
  "Entity keys have no search syntax.";

type IsTelemetrySignalFunction = (
  rows: EntityKeyScopedRows,
) => rows is TelemetrySignal;

const isTelemetrySignal: IsTelemetrySignalFunction = (
  rows: EntityKeyScopedRows,
): rows is TelemetrySignal => {
  return rows === "logs" || rows === "traces" || rows === "metrics";
};

type CapitalizeFunction = (text: string) => string;

const capitalize: CapitalizeFunction = (text: string): string => {
  return text.length > 0 ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text;
};

export interface DescribeLockedEntityKeyFilterInput {
  rows: EntityKeyScopedRows;
  /** The key this chip stands for. */
  entityKey: string;
  /*
   * Every entity key the page pins, this one included. The column is matched
   * with `hasAny`, so several keys WIDEN the scope — a row carrying any of
   * them is shown — and each chip has to say so rather than read like one
   * more filter AND-ed with its neighbours.
   */
  entityKeys?: ReadonlyArray<string> | undefined;
  /** "Kubernetes Pod", "Host", ... — the summary says "resource" without one. */
  entityTypeLabel?: string | undefined;
  /*
   * Where the keys came from: the page (the default — an Inventory item's
   * pages) or a stored query the view was opened with (a log monitor's
   * incident snapshot). The multi-key summary names that same source, so a
   * stored query's keys are never said to be pinned by the page.
   */
  source?: string | undefined;
}

type DescribeLockedEntityKeyFilterFunction = (
  input: DescribeLockedEntityKeyFilterInput,
) => LockedFilterDetail;

/**
 * The explanation of an `entityKeys` chip — an Inventory item's scope, which
 * the server compiles to `hasAny(entityKeys, [...])` with no attribute
 * alongside it. No explorer's search grammar has a token for the column and
 * no explorer link carries it, so the reader is told plainly that it cannot
 * travel (and why the list may hold rows owned by some other resource).
 */
export const describeLockedEntityKeyFilter: DescribeLockedEntityKeyFilterFunction =
  (input: DescribeLockedEntityKeyFilterInput): LockedFilterDetail => {
    const label: string =
      typeof input.entityTypeLabel === "string"
        ? input.entityTypeLabel.trim()
        : "";
    const noun: string =
      label.length > 0 && label.toLowerCase() !== DEFAULT_SCOPE_NOUN
        ? label
        : DEFAULT_SCOPE_NOUN;

    /*
     * Trimmed exactly like the keys it is compared with below, so a padded
     * key never counts itself as "another resource".
     */
    const thisEntityKey: string =
      typeof input.entityKey === "string" ? input.entityKey.trim() : "";

    /*
     * A non-array is no other keys: a lone string would iterate its
     * characters, and an operator instance is not iterable at all.
     */
    const candidates: ReadonlyArray<unknown> = Array.isArray(input.entityKeys)
      ? input.entityKeys
      : [];

    const otherEntityKeys: Array<string> = [];

    for (const candidate of candidates) {
      const entityKey: string =
        typeof candidate === "string" ? candidate.trim() : "";

      if (
        entityKey.length > 0 &&
        entityKey !== thisEntityKey &&
        !otherEntityKeys.includes(entityKey)
      ) {
        otherEntityKeys.push(entityKey);
      }
    }

    const predicate: LockedFilterPredicate =
      otherEntityKeys.length === 0
        ? {
            label: "Entity key",
            expression: `entityKeys has ${thisEntityKey}`,
            note: ENTITY_KEY_PREDICATE_NOTE,
          }
        : {
            label: "Entity key",
            expression: `entityKeys has any of ${[
              thisEntityKey,
              ...otherEntityKeys,
            ].join(", ")}`,
            note: `${ENTITY_KEY_ANY_OF_PREDICATE_NOTE} ${ENTITY_KEY_PREDICATE_NOTE}`,
          };

    const source: string = input.source || LOCKED_FILTER_SOURCE_PAGE;

    const pinnedBy: string =
      source === LOCKED_FILTER_SOURCE_STORED_QUERY
        ? "the stored query pins"
        : "this page pins";

    const summary: string =
      otherEntityKeys.length === 0
        ? `Only ${input.rows} linked to this ${noun} are shown.`
        : `${capitalize(input.rows)} linked to this ${noun} are shown, along with ${
            input.rows
          } linked to the ${otherEntityKeys.length} other ${
            otherEntityKeys.length === 1 ? "resource" : "resources"
          } ${pinnedBy}.`;

    return {
      source,
      summary,
      predicates: [predicate],
      combinator: "all",
      searchTokenUnavailableReason: isTelemetrySignal(input.rows)
        ? noSyntaxReason(input.rows, ENTITY_KEYS_FACET_KEY)
        : ENTITY_KEY_NO_SYNTAX_REASON,
    };
  };

type BuildLockedScopeCopyTextFunction = (
  signal: TelemetrySignal,
  filters: Array<SearchableLockedFilter>,
) => string;

/**
 * The search-bar text that reproduces every locked chip on the main
 * explorer — the "Copy filter" affordance. Delegates to the shared builder
 * so the per-chip syntax in the tooltip and the copied text never disagree.
 */
export const buildLockedScopeCopyText: BuildLockedScopeCopyTextFunction = (
  signal: TelemetrySignal,
  filters: Array<SearchableLockedFilter>,
): string => {
  return buildSearchTextForFilters(signal, filters);
};
