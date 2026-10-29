import {
  FEED_GONE,
  FOLLOWS_A_FEED,
  FOLLOWS_FEED,
  HOLDS_DOMAINS,
  HOLDS_FILE_HASHES,
  HOLDS_HOSTS,
  HOLDS_IP_ADDRESSES,
  HOLDS_OTHER,
  HOLDS_PROCESSES,
  HOLDS_URLS,
  HOLDS_USERS,
  IMPORT_PREVIEW_DUPLICATES,
  IMPORT_PREVIEW_PROBLEMS,
  IMPORT_PREVIEW_VALUES,
  NO_VALUES_YET,
  READ_BY_MORE,
  READ_BY_NO_RULE,
  STARTER_ADMIN_ADDRESSES_DESCRIPTION,
  STARTER_ADMIN_ADDRESSES_TITLE,
  STARTER_CRITICAL_HOSTS_DESCRIPTION,
  STARTER_CRITICAL_HOSTS_TITLE,
  STARTER_KNOWN_BAD_HASHES_DESCRIPTION,
  STARTER_KNOWN_BAD_HASHES_TITLE,
  STARTER_VIP_USERS_DESCRIPTION,
  STARTER_VIP_USERS_TITLE,
  VALUES_TABLE_DESCRIPTION,
  VALUES_TABLE_DESCRIPTION_HASH,
  VALUES_TABLE_DESCRIPTION_IP,
  VALUE_COUNT,
  VALUE_FIELD_DESCRIPTION,
} from "./WatchlistsCopy";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SecurityWatchlistImportResult,
  SecurityWatchlistSource,
  canSecurityWatchlistFollowFeed,
  getSecurityWatchlistNameKey,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import { NAME_BREAKS_FROM_LENGTH } from "Common/Utils/NameBreaks";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Watchlists pages say about a list, worked out without React: the
 * words for what it holds, its values, the rules that read it, the lists
 * to start with, and what an import is about to do. Pinned in plain tests;
 * the components only draw it.
 */

// What each kind of list is called where a list is described: plural, "Users".
const HOLDS_LABELS: Readonly<Record<string, string>> = {
  [SecurityEntityType.User]: HOLDS_USERS,
  [SecurityEntityType.Host]: HOLDS_HOSTS,
  [SecurityEntityType.IpAddress]: HOLDS_IP_ADDRESSES,
  [SecurityEntityType.FileHash]: HOLDS_FILE_HASHES,
  [SecurityEntityType.Domain]: HOLDS_DOMAINS,
  [SecurityEntityType.Url]: HOLDS_URLS,
  [SecurityEntityType.Process]: HOLDS_PROCESSES,
  [SecurityEntityType.Other]: HOLDS_OTHER,
};

// The English key for what a list holds: "Users", "IP addresses".
export function getWatchlistHoldsKey(entityType: unknown): string {
  return typeof entityType === "string" &&
    Object.prototype.hasOwnProperty.call(HOLDS_LABELS, entityType)
    ? HOLDS_LABELS[entityType]!
    : HOLDS_OTHER;
}

export function getWatchlistHoldsLabel(
  translator: Translator,
  entityType: unknown,
): string {
  const key: string = getWatchlistHoldsKey(entityType);
  return translator.translateText(key) || key;
}

export function getWatchlistHoldsIcon(entityType: unknown): IconProp {
  return typeof entityType === "string" &&
    Object.prototype.hasOwnProperty.call(HOLDS_LABELS, entityType)
    ? getSecurityEntityIcon(entityType as SecurityEntityType)
    : IconProp.QueueList;
}

export interface WatchlistHoldsOption {
  value: SecurityEntityType;
  // An English key: drawn translated.
  label: string;
}

// The Holds dropdown: every kind, in the form's order.
export function getWatchlistHoldsOptions(): Array<WatchlistHoldsOption> {
  return SECURITY_WATCHLIST_ENTITY_TYPES.map(
    (type: SecurityEntityType): WatchlistHoldsOption => {
      return { value: type, label: getWatchlistHoldsKey(type) };
    },
  );
}

/*
 * How a list's values match, in the words of its kind: over its Values
 * table and under Add Value's field. A user list shows a pattern at work
 * (svc-*), an IP address list its ranges, and a file hash list - which
 * takes digests only - the hashes it takes, never a word of *. Any other
 * kind: whatever the case, * for any run of characters. An English key.
 */
export function getWatchlistValuesHint(entityType: unknown): string {
  switch (entityType) {
    case SecurityEntityType.User:
      return VALUES_TABLE_DESCRIPTION;
    case SecurityEntityType.IpAddress:
      return VALUES_TABLE_DESCRIPTION_IP;
    case SecurityEntityType.FileHash:
      return VALUES_TABLE_DESCRIPTION_HASH;
    default:
      return VALUE_FIELD_DESCRIPTION;
  }
}

/*
 * Where a long list name may break: after each of its underscores, so a
 * name of up to 50 characters wraps between its words in a narrow column
 * ("executive_assistants_" / "and_finance_admins") rather than at whatever
 * letter fills the line. A short name stays whole, as Common/Utils/
 * NameBreaks keeps short names whole. The parts join back to the name.
 */
export function splitWatchlistName(name: string): Array<string> {
  if (name.length < NAME_BREAKS_FROM_LENGTH) {
    return [name];
  }

  const parts: Array<string> = [];
  let current: string = "";

  for (const character of name) {
    current += character;

    if (character === "_") {
      parts.push(current);
      current = "";
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

// Whether the form offers where a list's values come from: only a kind a feed carries.
export function canChooseWatchlistSource(entityType: unknown): boolean {
  return canSecurityWatchlistFollowFeed(entityType);
}

export function isFeedWatchlist(source: unknown): boolean {
  return source === SecurityWatchlistSource.ThreatIntelFeed;
}

/*
 * What a row says of its values: how many it keeps, or which feed it
 * follows (one whose feed is gone says so).
 */
export function describeWatchlistValues(
  translator: Translator,
  watchlist: {
    source?: unknown;
    valueCount?: number | undefined;
    threatIntelFeedId?: unknown;
    feedName?: string | undefined;
  },
): string {
  if (isFeedWatchlist(watchlist.source)) {
    if (!watchlist.threatIntelFeedId) {
      return translator.translateText(FEED_GONE) || FEED_GONE;
    }

    const feedName: string = (watchlist.feedName || "").trim();

    return feedName
      ? translator.translateTemplate(FOLLOWS_FEED, { feed: feedName })
      : translator.translateText(FOLLOWS_A_FEED) || FOLLOWS_A_FEED;
  }

  const count: number = Math.max(0, Number(watchlist.valueCount) || 0);

  if (count === 0) {
    return translator.translateText(NO_VALUES_YET) || NO_VALUES_YET;
  }

  return translator.translatePlural(VALUE_COUNT, count, {
    count: translator.formatNumber(count),
  });
}

// The rules that read one list, as its row shows them.
export interface WatchlistReaders {
  // The first rules' names, as written.
  names: Array<string>;
  // How many more read it.
  more: number;
}

export const WATCHLIST_READERS_SHOWN: number = 2;

export function summarizeWatchlistReaders(
  readers: ReadonlyArray<{ name: string }> | undefined,
): WatchlistReaders {
  const all: ReadonlyArray<{ name: string }> = readers || [];

  return {
    names: all
      .slice(0, WATCHLIST_READERS_SHOWN)
      .map((reader: { name: string }): string => {
        return reader.name;
      }),
    more: Math.max(0, all.length - WATCHLIST_READERS_SHOWN),
  };
}

// The rules that read a list, in words: "VIP sign-in, VIP new country and 2 more".
export function describeWatchlistReaders(
  translator: Translator,
  readers: WatchlistReaders,
): string {
  if (readers.names.length === 0) {
    return translator.translateText(READ_BY_NO_RULE) || READ_BY_NO_RULE;
  }

  const names: string = readers.names.join(", ");

  if (readers.more === 0) {
    return names;
  }

  return `${names} ${translator.translatePlural(READ_BY_MORE, readers.more, {
    count: translator.formatNumber(readers.more),
  })}`;
}

// The rules that read the list with this name, from the readers of every list.
export function getWatchlistReaders(
  readersByKey: ReadonlyMap<string, Array<{ id: string; name: string }>>,
  name: unknown,
): Array<{ id: string; name: string }> {
  return readersByKey.get(getSecurityWatchlistNameKey(name)) || [];
}

/*
 * A COMMON LIST TO START WITH: created empty, with its name, what it holds
 * and what it is for, from the Watchlists page while a project has none.
 */
export interface WatchlistStarter {
  key: string;
  name: string;
  entityType: SecurityEntityType;
  // English keys: drawn translated, and the description is stored in the reader's words.
  title: string;
  description: string;
  icon: IconProp;
}

export const WATCHLIST_STARTERS: ReadonlyArray<WatchlistStarter> = [
  {
    key: "vip-users",
    name: "vip_users",
    entityType: SecurityEntityType.User,
    title: STARTER_VIP_USERS_TITLE,
    description: STARTER_VIP_USERS_DESCRIPTION,
    icon: IconProp.User,
  },
  {
    key: "critical-hosts",
    name: "critical_hosts",
    entityType: SecurityEntityType.Host,
    title: STARTER_CRITICAL_HOSTS_TITLE,
    description: STARTER_CRITICAL_HOSTS_DESCRIPTION,
    icon: IconProp.ServerStack,
  },
  {
    key: "known-bad-hashes",
    name: "known_bad_hashes",
    entityType: SecurityEntityType.FileHash,
    title: STARTER_KNOWN_BAD_HASHES_TITLE,
    description: STARTER_KNOWN_BAD_HASHES_DESCRIPTION,
    icon: IconProp.Fingerprint,
  },
  {
    key: "admin-addresses",
    name: "admin_addresses",
    entityType: SecurityEntityType.IpAddress,
    title: STARTER_ADMIN_ADDRESSES_TITLE,
    description: STARTER_ADMIN_ADDRESSES_DESCRIPTION,
    icon: IconProp.Globe,
  },
];

// The starters a project does not have yet, by their names.
export function getAvailableWatchlistStarters(
  existingNames: ReadonlyArray<string>,
): Array<WatchlistStarter> {
  const existing: Set<string> = new Set(
    existingNames.map((name: string): string => {
      return getSecurityWatchlistNameKey(name);
    }),
  );

  return WATCHLIST_STARTERS.filter((starter: WatchlistStarter): boolean => {
    return !existing.has(getSecurityWatchlistNameKey(starter.name));
  });
}

/*
 * What the Import Values dialog is about to do, as it is typed: how many
 * values, how many repeated lines it skips, and how many lines it leaves
 * out. Each part in the reader's words; the parts with nothing to say are
 * left out.
 */
export function describeWatchlistImportPreview(
  translator: Translator,
  result: SecurityWatchlistImportResult,
): Array<string> {
  const parts: Array<string> = [
    translator.translatePlural(IMPORT_PREVIEW_VALUES, result.values.length, {
      count: translator.formatNumber(result.values.length),
    }),
  ];

  if (result.duplicates > 0) {
    parts.push(
      translator.translatePlural(IMPORT_PREVIEW_DUPLICATES, result.duplicates, {
        count: translator.formatNumber(result.duplicates),
      }),
    );
  }

  if (result.problems.length > 0) {
    parts.push(
      translator.translatePlural(
        IMPORT_PREVIEW_PROBLEMS,
        result.problems.length,
        { count: translator.formatNumber(result.problems.length) },
      ),
    );
  }

  return parts;
}

// The lines an import's preview names, at most: the rest is counted.
export const WATCHLIST_IMPORT_PROBLEMS_SHOWN: number = 5;
