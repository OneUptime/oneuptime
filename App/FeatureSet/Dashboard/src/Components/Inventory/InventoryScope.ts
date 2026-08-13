import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import { getInventoryTypePluralLabel } from "./InventoryTypeCatalog";
import { getInventorySourceLabel } from "./InventorySource";
import { INVENTORY_STALE_AFTER_MINUTES } from "./InventoryLiveness";

/*
 * A narrowing of the inventory list, expressed as URL query params.
 *
 * The Overview is a set of drill-downs — a tile, a category row, a type row —
 * and every one of them means "show me the items behind this number". Rather
 * than reaching into the table's own filter machinery from another page (its
 * URL state is namespaced and serialized for the table's benefit, not ours),
 * a drill-down is a plain link carrying the three params below, and the Items
 * page turns them straight into the base query it lists with.
 *
 * That makes the scope part of the model query rather than a user-removable
 * filter chip, which is the behaviour we want: the page says what it is
 * scoped to and offers one control to clear it. It also means the params are
 * attacker-reachable — anyone can hand-edit the URL — so `parseInventoryScope`
 * validates against the real vocabularies and drops anything it does not
 * recognise, instead of forwarding an arbitrary string into a query.
 */

export interface InventoryScope {
  entityType?: EntityType | undefined;
  source?: EntitySource | undefined;
  /** Only items whose telemetry has gone quiet. See InventoryLiveness. */
  staleOnly?: boolean | undefined;
}

export const INVENTORY_SCOPE_TYPE_PARAM: string = "type";
export const INVENTORY_SCOPE_SOURCE_PARAM: string = "source";
export const INVENTORY_SCOPE_STALE_PARAM: string = "stale";

const ENTITY_TYPE_VALUES: Set<string> = new Set<string>(
  Object.values(EntityType),
);
const ENTITY_SOURCE_VALUES: Set<string> = new Set<string>(
  Object.values(EntitySource),
);

export type ReadQueryParamFunction = (paramName: string) => string | null;

export type ParseInventoryScopeFunction = (
  readParam: ReadQueryParamFunction,
) => InventoryScope;

/**
 * Read a scope off the URL. Unrecognised values are dropped rather than
 * passed through — `?type=<anything>` must never reach the model query.
 */
export const parseInventoryScope: ParseInventoryScopeFunction = (
  readParam: ReadQueryParamFunction,
): InventoryScope => {
  const scope: InventoryScope = {};

  const rawType: string | null = readParam(INVENTORY_SCOPE_TYPE_PARAM);

  if (rawType && ENTITY_TYPE_VALUES.has(rawType)) {
    scope.entityType = rawType as EntityType;
  }

  const rawSource: string | null = readParam(INVENTORY_SCOPE_SOURCE_PARAM);

  if (rawSource && ENTITY_SOURCE_VALUES.has(rawSource)) {
    scope.source = rawSource as EntitySource;
  }

  if (readParam(INVENTORY_SCOPE_STALE_PARAM) === "true") {
    scope.staleOnly = true;
  }

  return scope;
};

export type BuildInventoryScopeQueryStringFunction = (
  scope: InventoryScope,
) => string;

/**
 * The query string for a scope, including the leading `?`, or `""` for the
 * empty scope (so the unscoped link is a clean URL rather than a bare `?`).
 */
export const buildInventoryScopeQueryString: BuildInventoryScopeQueryStringFunction =
  (scope: InventoryScope): string => {
    const parts: Array<string> = [];

    if (scope.entityType) {
      parts.push(
        `${INVENTORY_SCOPE_TYPE_PARAM}=${encodeURIComponent(scope.entityType)}`,
      );
    }

    if (scope.source) {
      parts.push(
        `${INVENTORY_SCOPE_SOURCE_PARAM}=${encodeURIComponent(scope.source)}`,
      );
    }

    if (scope.staleOnly) {
      parts.push(`${INVENTORY_SCOPE_STALE_PARAM}=true`);
    }

    return parts.length === 0 ? "" : `?${parts.join("&")}`;
  };

export type IsInventoryScopeEmptyFunction = (scope: InventoryScope) => boolean;

export const isInventoryScopeEmpty: IsInventoryScopeEmptyFunction = (
  scope: InventoryScope,
): boolean => {
  return !scope.entityType && !scope.source && !scope.staleOnly;
};

export interface InventoryScopeQuery {
  entityType?: EntityType | undefined;
  source?: EntitySource | undefined;
  lastSeenAt?: LessThan<Date> | undefined;
}

export type BuildInventoryScopeQueryFunction = (
  scope: InventoryScope,
  now: Date,
) => InventoryScopeQuery;

/**
 * The model-query fragment a scope narrows the list with, merged into the
 * Items table's base query.
 *
 * `staleOnly` becomes `lastSeenAt < now - staleAfter`, which is the same
 * threshold `getInventoryLiveness` classifies against — pulled from the one
 * constant so the list and the badges cannot disagree. Rows with a null
 * `lastSeenAt` fall outside a `LessThan` in SQL, which is the behaviour we
 * want: never-seen is its own state, not a stale one.
 */
export const buildInventoryScopeQuery: BuildInventoryScopeQueryFunction = (
  scope: InventoryScope,
  now: Date,
): InventoryScopeQuery => {
  const query: InventoryScopeQuery = {};

  if (scope.entityType) {
    query.entityType = scope.entityType;
  }

  if (scope.source) {
    query.source = scope.source;
  }

  if (scope.staleOnly) {
    query.lastSeenAt = new LessThan<Date>(
      new Date(now.getTime() - INVENTORY_STALE_AFTER_MINUTES * 60 * 1000),
    );
  }

  return query;
};

export type DescribeInventoryScopeFunction = (
  scope: InventoryScope,
) => string | null;

/**
 * The sentence the Items page shows above the table when it is scoped, e.g.
 * "Showing Kubernetes Pods discovered from telemetry". `null` for the empty
 * scope, where there is nothing to explain.
 */
export const describeInventoryScope: DescribeInventoryScopeFunction = (
  scope: InventoryScope,
): string | null => {
  if (isInventoryScopeEmpty(scope)) {
    return null;
  }

  const noun: string = scope.entityType
    ? getInventoryTypePluralLabel(scope.entityType)
    : "items";

  const qualifiers: Array<string> = [];

  if (scope.source) {
    qualifiers.push(`from source "${getInventorySourceLabel(scope.source)}"`);
  }

  if (scope.staleOnly) {
    qualifiers.push("not seen in over a day");
  }

  if (qualifiers.length === 0) {
    return `Showing ${noun} only.`;
  }

  return `Showing ${noun} ${qualifiers.join(", ")}.`;
};
