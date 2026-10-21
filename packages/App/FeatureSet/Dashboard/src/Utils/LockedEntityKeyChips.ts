import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  LockedFilterDetail,
  LockedFilterScopeMatch,
} from "Common/Types/Telemetry/LockedFilterDetail";
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
 * and the attribute chip ("Cluster: prod") already stands for both. An
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
  /*
   * Folds this key into ONE chip with every other key of the same group.
   * A database is scoped by its own key, one key per endpoint and one per
   * pod it runs as — 26 keys for one CloudNativePG cluster — and a chip per
   * key buried the one thing the page filters on ("this database") under a
   * wall of look-alike pills. Grouped keys share a chip named after the
   * group, and its tooltip lists what they match, kind by kind.
   */
  group?: LockedEntityKeyGroup | undefined;
}

export interface LockedEntityKeyGroup {
  /** Keys with the same id share one chip. It is also that chip's value. */
  id: string;
  /** The shared chip's key, e.g. "Database". */
  displayKey: string;
  /** The shared chip's value, e.g. "orders-db". */
  displayValue: string;
  /*
   * The tooltip's opening line, e.g. "Shows telemetry from this database.
   * It matches any of:". The first member's non-empty summary wins.
   */
  summary?: string | undefined;
  /*
   * The heading this key is listed under in the tooltip ("Endpoints").
   * Defaults to the key's own displayKey.
   */
  memberLabel?: string | undefined;
  /*
   * How telemetry reaches the group through keys under this heading. The
   * first non-empty one per heading is shown.
   */
  memberDescription?: string | undefined;
  /*
   * The value this key is listed as under its heading. Defaults to the key's
   * own displayValue — a database's own key is better listed by its id than
   * by the name the chip already shows.
   */
  memberValue?: string | undefined;
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
}

type BuildLockedEntityKeyChipsFunction = (
  input: BuildLockedEntityKeyChipsInput,
) => Array<ActiveFilter>;

/*
 * Why a chip that stands for several keys has no search syntax: each key is
 * a different resource, and no search reproduces "any of them".
 */
export const ENTITY_KEY_GROUP_NO_SYNTAX_REASON: string =
  "This scope matches several resources at once, so no single search reproduces it.";

type GroupOfFunction = (
  display: LockedEntityKeyDisplay | undefined,
) => LockedEntityKeyGroup | undefined;

/*
 * The display's group, when it names one well enough to draw a chip: an id,
 * a key and a value. A partial group is no group — the key keeps a chip of
 * its own rather than collapsing into an unnamed pill.
 */
const groupOf: GroupOfFunction = (
  display: LockedEntityKeyDisplay | undefined,
): LockedEntityKeyGroup | undefined => {
  const group: unknown = display?.group;

  if (!group || typeof group !== "object" || Array.isArray(group)) {
    return undefined;
  }

  const candidate: LockedEntityKeyGroup = group as LockedEntityKeyGroup;

  if (
    !trimmedText(candidate.id) ||
    !trimmedText(candidate.displayKey) ||
    !trimmedText(candidate.displayValue)
  ) {
    return undefined;
  }

  return candidate;
};

interface GroupMember {
  entityKey: string;
  display: LockedEntityKeyDisplay;
  group: LockedEntityKeyGroup;
}

type BuildScopeMatchesFunction = (
  members: ReadonlyArray<GroupMember>,
) => Array<LockedFilterScopeMatch>;

/*
 * The tooltip's breakdown: one entry per heading, in the order its first
 * key appears, each value listed once.
 */
const buildScopeMatches: BuildScopeMatchesFunction = (
  members: ReadonlyArray<GroupMember>,
): Array<LockedFilterScopeMatch> => {
  const matches: Array<LockedFilterScopeMatch> = [];

  for (const member of members) {
    const label: string =
      trimmedText(member.group.memberLabel) ||
      trimmedText(member.display.displayKey) ||
      DEFAULT_ENTITY_KEY_DISPLAY_KEY;

    const value: string =
      trimmedText(member.group.memberValue) ||
      trimmedText(member.display.displayValue) ||
      member.entityKey;

    let match: LockedFilterScopeMatch | undefined = matches.find(
      (candidate: LockedFilterScopeMatch): boolean => {
        return candidate.label === label;
      },
    );

    if (!match) {
      match = { label: label, values: [] };
      matches.push(match);
    }

    const description: string = trimmedText(member.group.memberDescription);

    if (!match.description && description) {
      match.description = description;
    }

    if (!match.values.includes(value)) {
      match.values.push(value);
    }
  }

  return matches;
};

type BuildGroupChipFunction = (data: {
  rows: EntityKeyScopedRows;
  members: ReadonlyArray<GroupMember>;
}) => ActiveFilter;

/*
 * The one chip a group of keys shares. It is named by its first member's
 * group; a lone member keeps its own search syntax (a group of one is one
 * resource), while two or more have none to give.
 */
const buildGroupChip: BuildGroupChipFunction = (data: {
  rows: EntityKeyScopedRows;
  members: ReadonlyArray<GroupMember>;
}): ActiveFilter => {
  const first: GroupMember = data.members[0]!;

  const summary: string =
    data.members
      .map((member: GroupMember): string => {
        return trimmedText(member.group.summary);
      })
      .find((text: string): boolean => {
        return text.length > 0;
      }) || "";

  const syntax: LockedFilterDetail =
    data.members.length === 1
      ? describeLockedEntityKeyFilter({
          rows: data.rows,
          searchAttributes: first.display.searchAttributes,
        })
      : { searchTokenUnavailableReason: ENTITY_KEY_GROUP_NO_SYNTAX_REASON };

  const lockedDetail: LockedFilterDetail = {
    ...syntax,
    scopeMatches: buildScopeMatches(data.members),
  };

  if (summary) {
    lockedDetail.scopeSummary = summary;
  }

  return {
    facetKey: ENTITY_KEYS_FACET_KEY,
    value: trimmedText(first.group.id),
    displayKey: trimmedText(first.group.displayKey),
    displayValue: trimmedText(first.group.displayValue),
    readOnly: true,
    lockedDetail: lockedDetail,
  };
};

/**
 * One read-only chip per entity key, named by the page when it can
 * ("Kubernetes Pod: checkout-7d9f") and by the raw key otherwise
 * ("Resource: 3f9a1b2c4d5e6f70"), each carrying its search syntax when the
 * page named the entity's identifying attributes, and the reason it has none
 * otherwise. Keys whose displays name the same group share ONE chip instead,
 * placed where the group's first key would be, whose tooltip lists what the
 * group matches. The filter itself is the host's: nothing here reaches the
 * query.
 */
export const buildLockedEntityKeyChips: BuildLockedEntityKeyChipsFunction = (
  input: BuildLockedEntityKeyChipsInput,
): Array<ActiveFilter> => {
  const entityKeys: Array<string> = normalizeLockedEntityKeys(input.entityKeys);
  const skipped: Set<string> = new Set<string>(
    normalizeLockedEntityKeys(input.skipEntityKeys),
  );

  /*
   * A slot per chip in key order: a single key's chip, or the members of a
   * group, which becomes its chip once every key has been seen.
   */
  const slots: Array<ActiveFilter | Array<GroupMember>> = [];
  const groupSlots: Map<string, Array<GroupMember>> = new Map<
    string,
    Array<GroupMember>
  >();

  for (const entityKey of entityKeys) {
    if (skipped.has(entityKey)) {
      continue;
    }

    const display: LockedEntityKeyDisplay | undefined = displayFor(
      input.displays,
      entityKey,
    );
    const group: LockedEntityKeyGroup | undefined = groupOf(display);

    if (display && group) {
      const groupId: string = trimmedText(group.id);
      let members: Array<GroupMember> | undefined = groupSlots.get(groupId);

      if (!members) {
        members = [];
        groupSlots.set(groupId, members);
        slots.push(members);
      }

      members.push({ entityKey, display, group });
      continue;
    }

    const displayKey: string = trimmedText(display?.displayKey);
    const displayValue: string = trimmedText(display?.displayValue);

    slots.push({
      facetKey: ENTITY_KEYS_FACET_KEY,
      value: entityKey,
      displayKey: displayKey || DEFAULT_ENTITY_KEY_DISPLAY_KEY,
      displayValue: displayValue || entityKey,
      readOnly: true,
      lockedDetail: describeLockedEntityKeyFilter({
        rows: input.rows,
        searchAttributes: display?.searchAttributes,
      }),
    });
  }

  return slots.map((slot: ActiveFilter | Array<GroupMember>): ActiveFilter => {
    return Array.isArray(slot)
      ? buildGroupChip({ rows: input.rows, members: slot })
      : slot;
  });
};
