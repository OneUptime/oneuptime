import {
  DECLARED_STORE_PURPOSE,
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
} from "Common/Types/DataSecurity/DeclaredDataStore";
import { DataSecurityDeclaredStore } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { isDeclaredDataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS FOR THE STORES ONEUPTIME DECLARES (#10398): Security Events,
 * Network Flows and Security Address Vault, which hold IP addresses by
 * design. Each is an en.json key, looked up where it is drawn: the stores
 * list's mark, a declared store's Overview and Settings, and the record of
 * processing on Compliance.
 *
 * OneUptime's own purpose and retention are drawn in the reader's language
 * while they are OneUptime's; once the team writes its own, theirs is drawn
 * as written. React-free, so a plain test pins the words beside the rules
 * that choose them.
 */

// The mark a declared store carries on the stores list and in the record.
export const DECLARED_BY_ONEUPTIME: string = translationKey(
  "Declared by OneUptime",
);

/*
 * The declared kinds, which name the stores too (DataStoreKind): looked up
 * where a kind or a declared store's name is drawn, so each is a key.
 */
export const DECLARED_STORE_KIND_NAMES: ReadonlyArray<string> = [
  translationKey("Security Events"),
  translationKey("Network Flows"),
  translationKey("Security Address Vault"),
];

// The server's English purpose, as the reader's language says it.
export const DECLARED_PURPOSE: string = translationKey(
  "Network and information security (GDPR Recital 49)",
);

export const RETENTION_IN_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

export const RETENTION_AFTER_LAST_SEEN: PluralTemplate = {
  one: "{{count}} day after an address was last seen",
  other: "{{count}} days after an address was last seen",
};

// Under OneUptime's retention: where it comes from.
export const RETENTION_FOLLOWS_SETTINGS: string = translationKey(
  "Follows Telemetry Data Retention in your project's Settings.",
);

export const RETENTION_FROM_ARRIVAL: string = translationKey(
  "Every flow is kept this long after it arrives.",
);

export const RETENTION_FROM_LAST_SEEN: string = translationKey(
  "Every address is kept this long after it was last seen.",
);

// Whose words a purpose or a retention is.
export const FILLED_IN_BY_ONEUPTIME: string = translationKey(
  "Filled in by OneUptime",
);

export const WRITTEN_BY_YOUR_TEAM: string = translationKey(
  "Written by your team",
);

// Who reads the vault.
export const READ_BY_SCANS_ONLY: string = translationKey(
  "Only Security Events' scans, inside OneUptime. No person, page, export, API or AI tool can read it.",
);

// A declared store's Overview.
export const DECLARED_STORE_DESCRIPTION: string = translationKey(
  "OneUptime keeps this store for your project's network and information security, so it knows what the store holds. Data Security doesn't scan it, and holding these addresses never raises an issue: it is what the store is for.",
);

export const WHAT_IT_HOLDS: string = translationKey("What It Holds");

export const WHO_CAN_READ_IT: string = translationKey("Who Can Read It");

// Its Settings: what an empty field means.
export const LEAVE_EMPTY_FOR_ONEUPTIMES: string = translationKey(
  "Leave it empty to keep what OneUptime fills in.",
);

// The record of processing on Compliance.
export const RECORD_DESCRIPTION: string = translationKey(
  "GDPR Article 30 asks for a record of the personal data you process: each store that holds it, with its data, owners, purpose and retention. The stores OneUptime keeps for your security are declared for you.",
);

export const RECORD_EMPTY_TITLE: string = translationKey(
  "No personal data recorded yet",
);

export const RECORD_EMPTY_DESCRIPTION: string = translationKey(
  "A store joins the record once a scan finds personal data in it, or once your project keeps security events or network flows.",
);

export const WHO_CAN_READ: string = translationKey("Who Can Read");

/*
 * What a store's row calls it. A store OneUptime declares is named for its
 * kind - "Security Events" - which reads in the reader's language while the
 * team has not renamed it; any other name, and every other store's, reads
 * as written.
 */
export function getStoreDisplayName(
  store: { name?: string | undefined; kind?: string | undefined },
  translator: Translator,
): string {
  const name: string = store.name || "";

  if (
    store.kind &&
    isDeclaredDataStoreKind(store.kind) &&
    name === store.kind
  ) {
    return translator.translateText(name) || name;
  }

  return name;
}

// OneUptime's purpose in the reader's words, or the team's as written.
export function getDeclaredPurposeText(
  data: { purpose: string; declared: DataSecurityDeclaredStore },
  translator: Translator,
): string {
  if (data.declared.isPurposeTheTeams) {
    return data.purpose;
  }

  return data.declared.purpose === DECLARED_STORE_PURPOSE
    ? translator.translateText(DECLARED_PURPOSE) || data.declared.purpose
    : data.declared.purpose;
}

// OneUptime's retention in the reader's words, or the team's as written.
export function getDeclaredRetentionText(
  data: { retention: string; declared: DataSecurityDeclaredStore },
  translator: Translator,
): string {
  if (data.declared.isRetentionTheTeams) {
    return data.retention;
  }

  return translator.translatePlural(
    data.declared.retentionBasis === DeclaredStoreRetentionBasis.AddressVault
      ? RETENTION_AFTER_LAST_SEEN
      : RETENTION_IN_DAYS,
    data.declared.retentionInDays,
  );
}

// Where OneUptime's retention comes from, said under it.
export function getDeclaredRetentionHint(
  declared: DataSecurityDeclaredStore,
): string {
  switch (declared.retentionBasis) {
    case DeclaredStoreRetentionBasis.SecurityEvents:
      return RETENTION_FOLLOWS_SETTINGS;
    case DeclaredStoreRetentionBasis.NetworkFlows:
      return RETENTION_FROM_ARRIVAL;
    default:
      return RETENTION_FROM_LAST_SEEN;
  }
}

/*
 * Who can read a declared store, in the reader's words: its roles' names,
 * or, for the vault, that only Security Events' scans can.
 */
export function getDeclaredReaderNames(
  declared: DataSecurityDeclaredStore,
  translator: Translator,
): Array<string> {
  if (declared.readers === DeclaredStoreReaders.SecurityEventsScansOnly) {
    return [];
  }

  return PermissionHelper.getPermissionTitles(
    declared.readPermissions as Array<Permission>,
  ).map((title: string): string => {
    return translator.translateText(title) || title;
  });
}
