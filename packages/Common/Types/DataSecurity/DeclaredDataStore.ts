import DataCategory from "./DataCategory";
import DataSensitivity from "./DataSensitivity";
import { DataStoreKind } from "./DataStoreKind";
import { declaredDataStoreKey } from "./DataStoreKey";
import { NETWORK_FLOW_RETENTION_IN_DAYS } from "../NetFlow/NetworkFlowRetention";
import { SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS } from "../SecurityEvent/SecurityAddressVaultRetention";

/*
 * THE STORES ONEUPTIME DECLARES IN A PROJECT'S RECORD OF PROCESSING (#10398).
 *
 * A project that scrubs IP addresses out of its telemetry still keeps some,
 * on purpose, to protect its network: GDPR Recital 49 names that as a
 * legitimate interest. "You scrub IP addresses from your telemetry. Where
 * do you keep them, and why?" is what an auditor asks, so the record of
 * processing lists the three places OneUptime keeps them:
 *
 *   - Security Events: every security event, with the addresses, user
 *     names and email addresses of who did it and what it touched
 *     (principalIp, targetIp, principalUser, targetUser, observables);
 *   - Network Flows: who talked to whom, by address (srcIp, dstIp);
 *   - Security Address Vault: the address behind each token an IP Address
 *     Hash rule left in the logs and traces Security Events reads (#10395).
 *
 * What they hold is known by design, so they are declared, never scanned:
 * no content scan reads them, no check applies to them and none raises an
 * issue for holding addresses - holding them is their purpose. OneUptime
 * fills in what it knows (the purpose, the retention each table keeps,
 * who can read it); the team can change the purpose and the retention, as
 * on any store, and theirs is kept.
 *
 * Pure: the server declares the stores and fills the record from this
 * (Server/Utils/DataSecurity/DeclaredDataStores), and the Dashboard says
 * the same about them.
 */

// Why OneUptime keeps them, in GDPR's own terms.
export const DECLARED_STORE_PURPOSE: string =
  "Network and information security (GDPR Recital 49)";

// What a declared store's retention counts from, and where it is set.
export enum DeclaredStoreRetentionBasis {
  // The project's retention for security events (Settings, Telemetry).
  SecurityEvents = "security-events",
  // The table's own: from when a flow arrived (NETWORK_FLOW_RETENTION_IN_DAYS).
  NetworkFlows = "network-flows",
  // From when an address was last seen (SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS).
  AddressVault = "address-vault",
}

// Who can read a declared store.
export enum DeclaredStoreReaders {
  // People and API keys holding one of its table's read permissions.
  Roles = "roles",
  // Nobody: only Security Events' scans, inside OneUptime.
  SecurityEventsScansOnly = "security-events-scans-only",
}

export interface DeclaredDataStoreInfo {
  kind: DataStoreKind;
  // One per project: the kind is the key (DataStoreKey.declaredDataStoreKey).
  storeKey: string;
  // The name it is declared with, which the team may change.
  name: string;
  // What it holds by design: built-in data types (DataTypeCatalog).
  dataTypeIds: ReadonlyArray<string>;
  dataCategories: ReadonlyArray<DataCategory>;
  sensitivity: DataSensitivity;
  // The columns that hold them, as the table names them.
  fields: ReadonlyArray<string>;
  retentionBasis: DeclaredStoreRetentionBasis;
  readers: DeclaredStoreReaders;
}

const IP_ADDRESS: string = "ip-address";
const USERNAME: string = "username";
const EMAIL_ADDRESS: string = "email-address";

function declared(
  data: Omit<DeclaredDataStoreInfo, "storeKey" | "name" | "dataCategories">,
): DeclaredDataStoreInfo {
  return {
    ...data,
    storeKey: declaredDataStoreKey(data.kind),
    name: data.kind,
    // An address, a user name and an email address are all contact and identity data.
    dataCategories: [DataCategory.ContactAndIdentity],
  };
}

export const DECLARED_DATA_STORES: ReadonlyArray<DeclaredDataStoreInfo> = [
  declared({
    kind: DataStoreKind.SecurityEvents,
    dataTypeIds: [IP_ADDRESS, USERNAME, EMAIL_ADDRESS],
    sensitivity: DataSensitivity.Confidential,
    fields: [
      "principalIp",
      "targetIp",
      "principalUser",
      "targetUser",
      "observables",
    ],
    retentionBasis: DeclaredStoreRetentionBasis.SecurityEvents,
    readers: DeclaredStoreReaders.Roles,
  }),
  declared({
    kind: DataStoreKind.NetworkFlows,
    dataTypeIds: [IP_ADDRESS],
    sensitivity: DataSensitivity.Confidential,
    fields: ["srcIp", "dstIp"],
    retentionBasis: DeclaredStoreRetentionBasis.NetworkFlows,
    readers: DeclaredStoreReaders.Roles,
  }),
  declared({
    kind: DataStoreKind.SecurityAddressVault,
    dataTypeIds: [IP_ADDRESS],
    sensitivity: DataSensitivity.Confidential,
    fields: ["address"],
    retentionBasis: DeclaredStoreRetentionBasis.AddressVault,
    readers: DeclaredStoreReaders.SecurityEventsScansOnly,
  }),
];

const DECLARED_BY_KIND: ReadonlyMap<string, DeclaredDataStoreInfo> = new Map(
  DECLARED_DATA_STORES.map(
    (info: DeclaredDataStoreInfo): [string, DeclaredDataStoreInfo] => {
      return [info.kind, info];
    },
  ),
);

export function getDeclaredDataStore(
  kind: string | undefined | null,
): DeclaredDataStoreInfo | undefined {
  return kind ? DECLARED_BY_KIND.get(kind) : undefined;
}

/*
 * The days a table keeps its data for whatever the project says: the
 * flows' and the vault's own. Security events follow the project's
 * retention for them, read by the server (SecurityEventRetention).
 */
export function getFixedDeclaredRetentionInDays(
  basis: DeclaredStoreRetentionBasis,
): number | null {
  switch (basis) {
    case DeclaredStoreRetentionBasis.NetworkFlows:
      return NETWORK_FLOW_RETENTION_IN_DAYS;
    case DeclaredStoreRetentionBasis.AddressVault:
      return SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS;
    default:
      return null;
  }
}

/*
 * OneUptime's retention as the record writes it, in the English an auditor
 * files it under (the exports and the API): "15 days", or for the vault
 * "30 days after an address was last seen". The Dashboard says the same in
 * the reader's language.
 */
export function getDeclaredRetentionText(data: {
  basis: DeclaredStoreRetentionBasis;
  retentionInDays: number;
}): string {
  const days: string = `${data.retentionInDays} ${
    data.retentionInDays === 1 ? "day" : "days"
  }`;

  return data.basis === DeclaredStoreRetentionBasis.AddressVault
    ? `${days} after an address was last seen`
    : days;
}

// "Only Security Events' scans": who reads the vault, in the exports.
export const SECURITY_EVENTS_SCANS_ONLY_TEXT: string =
  "Only Security Events' scans, inside OneUptime";
