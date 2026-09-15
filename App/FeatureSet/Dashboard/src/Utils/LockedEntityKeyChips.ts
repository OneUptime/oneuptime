import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  EntityKeyScopedRows,
  describeLockedEntityKeyFilter,
} from "./LockedTelemetryScope";

/*
 * The locked chip for an entity-key scope — the pill an Inventory item's
 * Logs / Traces / Metrics / Exceptions / Profiles pages were missing.
 *
 * A Kubernetes cluster's pages scope by resource attribute AND entity key,
 * and the attribute chip ("Cluster: prod") already explains both halves. An
 * Inventory item has no attribute counterpart: its pages scope by
 * `hasAny(entityKeys, [item key])` alone, and the viewers built chips only
 * from attributes, entity ids and trace / span / session ids — so the list
 * was filtered while the chip bar showed nothing at all. Every viewer turns
 * an entity-key scope into chips HERE, so the five surfaces cannot drift.
 *
 * Pure on purpose (no route map, no navigation): the chip builders that call
 * it are exercised by plain-Node suites. See LockedTelemetryScope for why.
 */

export interface LockedEntityKeyDisplay {
  /** The chip's key: what the entity is, e.g. "Kubernetes Pod". */
  displayKey: string;
  /** The chip's value: its name, e.g. "checkout-7d9f". */
  displayValue: string;
  /*
   * The OpenTelemetry resource attributes that identify the entity, keys
   * without the `resource.` prefix — `{ "k8s.pod.name": "checkout-7d9f", ... }`.
   * The chip's search syntax is spelled with these, since no search bar
   * understands an entity key. Absent when the page does not know them.
   */
  searchAttributes?: Record<string, string> | undefined;
}

/** Per entity key, how its chip reads. A key without an entry falls back. */
export type LockedEntityKeyDisplayMap = Record<string, LockedEntityKeyDisplay>;

type NormalizeLockedEntityKeysFunction = (
  entityKeys: ReadonlyArray<string> | undefined,
) => Array<string>;

/** Trimmed, non-empty, de-duplicated, in first-seen order. */
export const normalizeLockedEntityKeys: NormalizeLockedEntityKeysFunction = (
  entityKeys: ReadonlyArray<string> | undefined,
): Array<string> => {
  const normalized: Array<string> = [];

  /*
   * A non-array is no keys. A lone string would iterate its characters into
   * one chip per letter, and an operator instance reached through an untyped
   * query is not iterable at all — a throw inside the viewer's chip memo,
   * which takes the whole viewer down rather than just the pill.
   */
  const candidates: ReadonlyArray<unknown> = Array.isArray(entityKeys)
    ? entityKeys
    : [];

  for (const candidate of candidates) {
    const entityKey: string =
      typeof candidate === "string" ? candidate.trim() : "";

    if (entityKey.length > 0 && !normalized.includes(entityKey)) {
      normalized.push(entityKey);
    }
  }

  return normalized;
};

type TrimmedTextFunction = (value: unknown) => string;

const trimmedText: TrimmedTextFunction = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

type DisplayForFunction = (
  displays: LockedEntityKeyDisplayMap | undefined,
  entityKey: string,
) => LockedEntityKeyDisplay | undefined;

/*
 * An own entry only: a key is a hex hash today, but a lookup that could
 * answer `constructor` from the prototype is not one to leave lying around.
 */
const displayFor: DisplayForFunction = (
  displays: LockedEntityKeyDisplayMap | undefined,
  entityKey: string,
): LockedEntityKeyDisplay | undefined => {
  if (!displays || !Object.prototype.hasOwnProperty.call(displays, entityKey)) {
    return undefined;
  }

  return displays[entityKey];
};

type GetLockedEntityKeySearchAttributesFunction = (
  displays: LockedEntityKeyDisplayMap | undefined,
  entityKey: string,
) => Record<string, string> | undefined;

/**
 * The identifying resource attributes the page handed over for one entity
 * key, for a describer that re-explains an entity-key chip after it was
 * built (the logs viewer does).
 */
export const getLockedEntityKeySearchAttributes: GetLockedEntityKeySearchAttributesFunction =
  (
    displays: LockedEntityKeyDisplayMap | undefined,
    entityKey: string,
  ): Record<string, string> | undefined => {
    return displayFor(displays, entityKey)?.searchAttributes;
  };

export interface BuildLockedEntityKeyChipsInput {
  rows: EntityKeyScopedRows;
  /** The entity keys the page scopes the viewer by. */
  entityKeys: ReadonlyArray<string> | undefined;
  displays?: LockedEntityKeyDisplayMap | undefined;
  /*
   * Keys another locked chip already shows — a stored query's own entity-key
   * chip on the traces viewer. Skipped so one key never renders twice (the
   * chip list keys its pills by facet and value).
   */
  skipEntityKeys?: ReadonlyArray<string> | undefined;
  /*
   * Who pinned the keys: the page (the default) or the stored query the view
   * was opened with. The logs viewer reads its keys from `logQuery`, which a
   * log monitor's incident snapshot fills from the monitor's stored query, so
   * the chip must not claim the page pinned them.
   */
  source?: string | undefined;
}

type BuildLockedEntityKeyChipsFunction = (
  input: BuildLockedEntityKeyChipsInput,
) => Array<ActiveFilter>;

/**
 * One read-only chip per entity key, named by the page when it can
 * ("Kubernetes Pod: checkout-7d9f") and by the raw key otherwise
 * ("Resource: 3f9a1b2c4d5e6f70"), each carrying its explanation and — when
 * the page named the entity's identifying attributes — its search syntax.
 * The filter itself is the host's: nothing here reaches the query.
 */
export const buildLockedEntityKeyChips: BuildLockedEntityKeyChipsFunction = (
  input: BuildLockedEntityKeyChipsInput,
): Array<ActiveFilter> => {
  const entityKeys: Array<string> = normalizeLockedEntityKeys(input.entityKeys);
  const skipped: Set<string> = new Set<string>(
    normalizeLockedEntityKeys(input.skipEntityKeys),
  );

  const chips: Array<ActiveFilter> = [];

  for (const entityKey of entityKeys) {
    if (skipped.has(entityKey)) {
      continue;
    }

    const display: LockedEntityKeyDisplay | undefined = displayFor(
      input.displays,
      entityKey,
    );
    const displayKey: string = trimmedText(display?.displayKey);
    const displayValue: string = trimmedText(display?.displayValue);

    chips.push({
      facetKey: ENTITY_KEYS_FACET_KEY,
      value: entityKey,
      displayKey: displayKey || DEFAULT_ENTITY_KEY_DISPLAY_KEY,
      displayValue: displayValue || entityKey,
      readOnly: true,
      lockedDetail: describeLockedEntityKeyFilter({
        rows: input.rows,
        entityKey,
        entityKeys,
        entityTypeLabel: displayKey || undefined,
        source: input.source,
        searchAttributes: display?.searchAttributes,
      }),
    });
  }

  return chips;
};
