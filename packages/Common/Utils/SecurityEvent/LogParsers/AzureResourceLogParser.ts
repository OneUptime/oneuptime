import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import Crypto from "../../Crypto";
import { getAzureResourceIdKey } from "../../SecurityCase/SecurityConnectionMatch";
import { flattenPayload, parseEventTime } from "../NormalizerHelpers";
import { SecurityRecordReading } from "../SecurityRecordReading";
import { readAzureRecords, subscriptionOf } from "./AzureActivityLogParser";
import { readAzureResourceLogResourceIds } from "./CloudAuditResources";
import {
  SecurityLogLine,
  boundAttributes,
  buildLogSecurityEvent,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * AN AZURE RESOURCE'S OWN AUDIT LOG, AS SECURITY EVENTS (#10110).
 *
 * A diagnostic setting sends a resource's own logs - what the stream's
 * diagnostic settings send to its event hubs, and what a collector or a
 * shipper forwards from an event hub or a storage account - one record, or
 * Azure's batch {"records": [...]}, in the resource logs schema. Three
 * families of them are audit logs, each read here by what Microsoft
 * documents of it:
 *
 *   - a key vault's AuditEvent ("Azure Key Vault logging"): every request
 *     the vault answered, with the caller's token claims, its address and
 *     the HTTP status;
 *   - a storage account's StorageRead, StorageWrite and StorageDelete, from
 *     its blob, file, queue and table services ("Azure Blob Storage
 *     monitoring data reference"): every request, with how it was
 *     authorized (identity.type: OAuth, Kerberos, SAS, AccountKey or
 *     Anonymous), its status and the object;
 *   - Azure SQL auditing's SQLSecurityAuditEvents ("SQL Database audit log
 *     format"): sign-ins, batches and the actions the audit records, with
 *     whether each succeeded.
 *
 * Each is filed under its resource's ID, so every event names that
 * resource, and the one it is a part of - a storage account for its blob
 * service, a SQL server for its database - by the one key every Azure ID
 * is kept by (getAzureResourceIdKey, #10034): it reaches that resource's
 * Security Events page whatever case the writer chose.
 *
 * WHAT IS AN EVENT. These logs record every request, and most requests are
 * an app doing its work. As CloudTrail's data events and Google's Data
 * Access logs are read (CloudTrailLogParser, GoogleCloudAuditLogParser),
 * only what a security team looks at is an event:
 *
 *   - Key Vault: a request the vault refused (403, or a 401 for a token it
 *     did not accept); a secret handed out (SecretGet, SecretGetDeleted);
 *     a secret, key, certificate or the vault deleted, purged or backed up;
 *     the vault's access policy changed; and a change to what it holds or
 *     to the vault. Not a read that hands out nothing secret (a key's
 *     public part, a certificate, a list), a key used to sign, wrap or
 *     decrypt (services with customer-managed keys do so all day), nor
 *     Event Grid's expiry notices.
 *     The 401 every Azure SDK client gets on its first call is no refusal:
 *     the SDK sends that call without a token, to learn the tenant to ask
 *     for one ("Authentication, requests, and responses"), and Key Vault
 *     logs it under its Authentication operation. Microsoft's own failures
 *     query leaves out OperationName == "Authentication" and a 401. A 401
 *     of a request that presented no token - its record names no caller -
 *     is the same challenge and is left out too: a request without a
 *     token can do nothing.
 *   - Storage: a request refused for want of a right (401 or 403, and the
 *     409 PublicAccessNotPermitted an anonymous request gets from an
 *     account that allows none); a request served anonymously - but not a
 *     static website's pages, which are anonymous by design, or a CORS
 *     preflight; a container's, share's, queue's or table's access list
 *     changed; a whole container, file system, share, queue or table
 *     deleted; and a write or delete a shared access signature signed.
 *     Not a read that succeeded, SAS reads included: a SAS is how most
 *     apps hand files to browsers, and its reads would be most of an
 *     account's volume. They stay in Logs, filed under the storage
 *     account, with the whole record.
 *   - Azure SQL: a failed sign-in; a successful one on a new connection,
 *     not a pooled connection's reuse, which is audited on every reuse; a
 *     permission granted, denied or revoked, a role's member added or
 *     dropped, a password changed or reset, an impersonation, and a login,
 *     user or role created, altered or dropped; and any other audited
 *     action whose permission check failed. Not a batch or an RPC, the
 *     bulk of an audit - a batch's statement is not read for what it does.
 *
 * SEVERITY: Informational for what was allowed and is expected - a secret
 * read, a change, a sign-in, a SAS write; Low for what was refused, and
 * for what removes, exposes or copies out - a delete, a purge, a backup, an
 * access list or access policy changed, an anonymous read. As with the
 * other audit logs, detection rules raise what a pattern of them means.
 *
 * STORED ONCE. A record that arrives twice - through the stream and a
 * pipeline, or redelivered by an event hub - is one event: its id is made
 * of what the record says of itself (getAzureResourceLogRecordUid), and
 * the store looks it up before it writes (SecurityEventStoreOnce).
 *
 * Every value is read with indexOf and slices, never a regular expression:
 * a statement or a URI is whatever the caller sent.
 */

const AUTHENTICATION: number = 3002;
const API_ACTIVITY: number = 6003;

export const AZURE_KEY_VAULT_PRODUCT_NAME: string = "Azure Key Vault";
export const AZURE_STORAGE_PRODUCT_NAME: string = "Azure Storage";
export const AZURE_SQL_PRODUCT_NAME: string = "Azure SQL";

// The products the events carry, one a service.
export const AZURE_RESOURCE_LOG_PRODUCT_NAMES: ReadonlyArray<string> = [
  AZURE_KEY_VAULT_PRODUCT_NAME,
  AZURE_STORAGE_PRODUCT_NAME,
  AZURE_SQL_PRODUCT_NAME,
];

export enum AzureResourceLogService {
  KeyVault = "key-vault",
  Storage = "storage",
  Sql = "sql",
}

// The categories read, lowercase.
export const AZURE_KEY_VAULT_AUDIT_CATEGORY: string = "auditevent";
export const AZURE_STORAGE_CATEGORIES: ReadonlyArray<string> = [
  "storageread",
  "storagewrite",
  "storagedelete",
];
export const AZURE_SQL_AUDIT_CATEGORY: string = "sqlsecurityauditevents";

// How a key vault's resource ID names its type, lowercase.
export const AZURE_KEY_VAULT_ID_MARKER: string =
  "/providers/microsoft.keyvault/vaults/";

// ---------- reading ----------

function text(value: JSONValue | undefined): string {
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }

  return String(value).trim();
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// A record's field by its name in any case: Azure writes "category" and "Category".
function field(record: JSONObject, name: string): JSONValue | undefined {
  if (record[name] !== undefined) {
    return record[name];
  }

  const lower: string = name.toLowerCase();

  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) {
      return record[key];
    }
  }

  return undefined;
}

// An HTTP status as a number: 403, "403", else 0 ("Unknown", nothing).
function statusNumber(value: JSONValue | undefined): number {
  const candidate: string = text(value);

  if (!candidate || candidate.length > 3) {
    return 0;
  }

  for (let index: number = 0; index < candidate.length; index++) {
    const code: number = candidate.charCodeAt(index);

    if (code < 48 || code > 57) {
      return 0;
    }
  }

  return Number(candidate);
}

function isServed(status: number): boolean {
  return status >= 200 && status < 400;
}

/*
 * The address a request came from, as Azure writes it: bare (Key Vault),
 * or with its port (Storage: "192.0.2.10:52314", "[2001:db8::1]:443").
 */
export function readAzureCallerAddress(value: string): string {
  const candidate: string = (value || "").trim();

  if (!candidate || candidate.length > 80) {
    return "";
  }

  const bare: string = readRemoteIpAddress(candidate);

  if (bare) {
    return bare;
  }

  if (candidate.startsWith("[")) {
    const end: number = candidate.indexOf("]");

    return end > 1 ? readRemoteIpAddress(candidate.slice(1, end)) : "";
  }

  const colon: number = candidate.lastIndexOf(":");

  // One colon: an IPv4 address and its port.
  if (colon > 0 && candidate.indexOf(":") === colon) {
    return readRemoteIpAddress(candidate.slice(0, colon));
  }

  return "";
}

// The last segment of a resource ID: a vault's, an account's, a database's name.
function nameOf(resourceId: string): string {
  const trimmed: string = resourceId.endsWith("/")
    ? resourceId.slice(0, -1)
    : resourceId;

  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

// The segment after `marker` in a resource ID ("/storageaccounts/"), in its own case.
function segmentAfter(resourceId: string, marker: string): string {
  const at: number = resourceId.toLowerCase().indexOf(marker);

  if (at === -1) {
    return "";
  }

  const start: number = at + marker.length;
  const end: number = resourceId.indexOf("/", start);

  return resourceId.slice(start, end === -1 ? undefined : end);
}

function categoryOf(record: JSONObject): string {
  return text(field(record, "category")).toLowerCase();
}

function resourceIdOf(record: JSONObject): string {
  return text(field(record, "resourceId"));
}

/*
 * Which of the three services a record is the audit log of, or null: a key
 * vault's AuditEvent (another service's AuditEvent - Managed HSM's, an
 * attestation provider's - is not read), a storage service's request, or
 * Azure SQL auditing's record.
 */
export function getAzureResourceLogService(
  record: JSONObject,
): AzureResourceLogService | null {
  const category: string = categoryOf(record);

  if (category === AZURE_KEY_VAULT_AUDIT_CATEGORY) {
    return (getAzureResourceIdKey(resourceIdOf(record)) || "").indexOf(
      AZURE_KEY_VAULT_ID_MARKER,
    ) !== -1
      ? AzureResourceLogService.KeyVault
      : null;
  }

  if (AZURE_STORAGE_CATEGORIES.includes(category)) {
    return AzureResourceLogService.Storage;
  }

  if (category === AZURE_SQL_AUDIT_CATEGORY) {
    return AzureResourceLogService.Sql;
  }

  return null;
}

/*
 * Whether a diagnostic record is one this parser reads. A cloud stream
 * keeps such a record whole, as its log line's body, so it is read here as
 * a pipeline's would be (AzureDiagnosticRecords).
 */
export function isAzureResourceLogRecord(record: JSONObject): boolean {
  return getAzureResourceLogService(record) !== null;
}

// ---------- the record's id, the same however it arrives ----------

const UID_PREFIXES: Readonly<Record<AzureResourceLogService, string>> = {
  [AzureResourceLogService.KeyVault]: "azure-keyvault",
  [AzureResourceLogService.Storage]: "azure-storage",
  [AzureResourceLogService.Sql]: "azure-sql",
};

function uidOf(service: AzureResourceLogService, parts: Array<string>): string {
  return `${UID_PREFIXES[service]}:${Crypto.getSha256Hash(JSON.stringify(parts)).slice(0, 40)}`;
}

/*
 * A record's id, made of what the record says of itself - the same in the
 * stream's line, a pipeline's batch and a storage account's archive, so a
 * record that arrives twice is one event (SecurityEventStoreOnce). "" when
 * the record says too little to tell it from another: it is then known by
 * the line it came in.
 *
 *   - Key Vault writes no request id (correlationId is the caller's, and
 *     often empty): its time, to a tenth of a microsecond, with the vault,
 *     the operation, the caller, the address, the object and the result.
 *   - Storage: its correlationId, "unique per request and can be used for
 *     deduplication" (Microsoft), with the operation - a copy logs two -
 *     and the time.
 *   - Azure SQL: its event_id, or its sequence_group_id and sequence_number
 *     (a long statement is several records of one group), with the action,
 *     the session and the event's time.
 */
export function getAzureResourceLogRecordUid(record: JSONObject): string {
  const service: AzureResourceLogService | null =
    getAzureResourceLogService(record);

  if (!service) {
    return "";
  }

  const resourceId: string = resourceIdOf(record);
  const resourceKey: string =
    getAzureResourceIdKey(resourceId) || resourceId.toLowerCase();
  const time: string = text(field(record, "time"));
  const operation: string = text(field(record, "operationName")).toLowerCase();

  if (!resourceKey || !time) {
    return "";
  }

  if (service === AzureResourceLogService.KeyVault) {
    const properties: JSONObject = asObject(field(record, "properties")) || {};

    if (!operation) {
      return "";
    }

    return uidOf(service, [
      resourceKey,
      time,
      operation,
      readKeyVaultCaller(record).toLowerCase(),
      text(field(record, "callerIpAddress")),
      text(properties["id"]).toLowerCase(),
      text(properties["requestUri"]).toLowerCase(),
      text(field(record, "resultSignature")).toLowerCase(),
      text(field(record, "durationMs")),
      text(field(record, "correlationId")).toLowerCase(),
    ]);
  }

  if (service === AzureResourceLogService.Storage) {
    const correlationId: string = text(
      field(record, "correlationId"),
    ).toLowerCase();

    if (!correlationId || !operation) {
      return "";
    }

    return uidOf(service, [
      resourceKey,
      categoryOf(record),
      correlationId,
      operation,
      time,
    ]);
  }

  const properties: JSONObject = asObject(field(record, "properties")) || {};
  const eventId: string = sqlText(properties, "event_id").toLowerCase();
  const groupId: string = sqlText(
    properties,
    "sequence_group_id",
  ).toLowerCase();

  if (!eventId && !groupId) {
    return "";
  }

  return uidOf(service, [
    resourceKey,
    eventId,
    groupId,
    sqlText(properties, "sequence_number"),
    sqlText(properties, "action_id").toUpperCase(),
    sqlText(properties, "session_id"),
    sqlText(properties, "event_time") || time,
  ]);
}

// ---------- Key Vault ----------

// A secret handed out: its value is in the answer (Get Deleted Secret's too).
const KEY_VAULT_SECRET_READS: ReadonlyArray<string> = [
  "secretget",
  "secretgetdeleted",
];

// What takes a secret, key or certificate out of the vault whole.
const KEY_VAULT_BACKUPS: ReadonlyArray<string> = [
  "secretbackup",
  "keybackup",
  "certificatebackup",
];

const KEY_VAULT_DELETES: ReadonlyArray<string> = [
  "vaultdelete",
  "secretdelete",
  "keydelete",
  "certificatedelete",
  "certificateissuerdelete",
  "certificatecontactsdelete",
  "certificatependingdelete",
];

// Gone for good: a purged key's data can never be decrypted again.
const KEY_VAULT_PURGES: ReadonlyArray<string> = [
  "secretpurge",
  "keypurge",
  "certificatepurge",
];

// Who may reach the vault's secrets changed: logged whether or not Event Grid has a subscriber.
const KEY_VAULT_ACCESS_CHANGES: ReadonlyArray<string> = [
  "vaultaccesspolicychangedeventgridnotification",
];

// What the vault holds, or the vault itself, changed.
const KEY_VAULT_CHANGES: ReadonlyArray<string> = [
  "vaultput",
  "vaultpatch",
  "vaultrecover",
  "secretset",
  "secretupdate",
  "secretrestore",
  "secretrecover",
  "keycreate",
  "keyimport",
  "keyupdate",
  "keyrestore",
  "keyrecover",
  "keyrotate",
  "keyrotationpolicyset",
  "certificatecreate",
  "certificateimport",
  "certificateupdate",
  "certificaterestore",
  "certificaterecover",
  "certificatepolicyset",
  "certificatepolicyupdate",
  "certificatecontactsset",
  "certificateissuerset",
  "certificateissuerupdate",
  "certificatependingmerge",
  "certificatependingupdate",
];

// The operations that are events when they succeed, lowercase.
export const KEY_VAULT_EVENT_OPERATIONS: ReadonlyArray<string> = [
  ...KEY_VAULT_SECRET_READS,
  ...KEY_VAULT_BACKUPS,
  ...KEY_VAULT_DELETES,
  ...KEY_VAULT_PURGES,
  ...KEY_VAULT_ACCESS_CHANGES,
  ...KEY_VAULT_CHANGES,
];

// The operation Key Vault logs a request's token challenge under.
const KEY_VAULT_AUTHENTICATION: string = "authentication";

// resultSignature's words for the statuses read, when properties.httpStatusCode is missing.
const KEY_VAULT_SIGNATURES: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ["ok", 200],
  ["created", 201],
  ["accepted", 202],
  ["nocontent", 204],
  ["unauthorized", 401],
  ["forbidden", 403],
  ["notfound", 404],
  ["conflict", 409],
  ["toomanyrequests", 429],
]);

const UPN_CLAIM: string =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn";
const NAME_CLAIM: string =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
const OBJECT_ID_CLAIM: string =
  "http://schemas.microsoft.com/identity/claims/objectidentifier";

/*
 * Who made a request: the claims of the token it presented, as Key Vault
 * keeps them (identity.claim) - a person by their UPN, an app by its id.
 * "" for a request that presented none.
 */
export function readKeyVaultCaller(record: JSONObject): string {
  const identity: JSONObject | null = asObject(field(record, "identity"));
  const claims: JSONObject =
    asObject(identity?.["claim"]) || asObject(identity?.["claims"]) || {};

  return (
    text(claims[UPN_CLAIM]) ||
    text(claims["upn"]) ||
    text(claims[NAME_CLAIM]) ||
    text(claims["unique_name"]) ||
    text(claims["appid"]) ||
    text(claims[OBJECT_ID_CLAIM]) ||
    text(claims["oid"])
  );
}

function readKeyVaultStatus(
  record: JSONObject,
  properties: JSONObject,
): number {
  const status: number = statusNumber(properties["httpStatusCode"]);

  if (status) {
    return status;
  }

  const signature: string = text(field(record, "resultSignature"))
    .toLowerCase()
    .split(" ")
    .join("");

  return KEY_VAULT_SIGNATURES.get(signature) || 0;
}

// "https://kv.vault.azure.net/secrets/db-password/9f1c" -> "secrets/db-password/9f1c".
function keyVaultObjectPath(objectId: string): string {
  const scheme: number = objectId.indexOf("://");
  const path: number = scheme === -1 ? -1 : objectId.indexOf("/", scheme + 3);

  if (path === -1) {
    return "";
  }

  const value: string = objectId.slice(path + 1);

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function readKeyVaultAuditRecord(
  record: JSONObject,
): SecurityRecordReading | null {
  const properties: JSONObject = asObject(field(record, "properties")) || {};
  const operation: string = text(field(record, "operationName"));
  const lower: string = operation.toLowerCase();
  const status: number = readKeyVaultStatus(record, properties);
  const caller: string = readKeyVaultCaller(record);

  if (!operation) {
    return null;
  }

  // The token challenge every Azure SDK client gets first: no refusal.
  if (status === 401 && (lower === KEY_VAULT_AUTHENTICATION || !caller)) {
    return null;
  }

  const refused: boolean = status === 401 || status === 403;
  let severity: OcsfSeverity = OcsfSeverity.Informational;

  if (refused) {
    severity = OcsfSeverity.Low;
  } else if (!isServed(status)) {
    // Not found, a conflict, throttled, a server error: no security event.
    return null;
  } else if (
    KEY_VAULT_BACKUPS.includes(lower) ||
    KEY_VAULT_DELETES.includes(lower) ||
    KEY_VAULT_PURGES.includes(lower) ||
    KEY_VAULT_ACCESS_CHANGES.includes(lower)
  ) {
    severity = OcsfSeverity.Low;
  } else if (
    !KEY_VAULT_SECRET_READS.includes(lower) &&
    !KEY_VAULT_CHANGES.includes(lower)
  ) {
    return null;
  }

  const resourceId: string = resourceIdOf(record);
  const vault: string = nameOf(resourceId);
  const objectId: string = text(properties["id"]);
  const object: string = keyVaultObjectPath(objectId);
  const who: string = caller || "Someone";
  const where: string = `key vault ${vault}${object ? ` (${object})` : ""}`;
  const statusWord: string =
    text(field(record, "resultSignature")) || String(status);

  return {
    time: parseEventTime(field(record, "time") ?? null),
    eventUid: getAzureResourceLogRecordUid(record),
    classUid: API_ACTIVITY,
    activityName: operation,
    statusName: refused ? "Failure" : "Success",
    severity,
    message: refused
      ? `${who} was refused ${operation} on ${where}: ${statusWord}`
      : `${who} called ${operation} on ${where}`,
    principalUser: caller,
    principalIp: readAzureCallerAddress(text(field(record, "callerIpAddress"))),
    targetHost: subscriptionOf(resourceId),
    targetResource: objectId || resourceId,
    resourceIds: readAzureResourceLogResourceIds(record),
    attributes: boundAttributes(flattenPayload(record)),
  };
}

// ---------- Storage ----------

// A container's, share's, queue's, table's or a Data Lake path's access list set.
const STORAGE_ACCESS_CHANGES: ReadonlyArray<string> = [
  "setcontaineracl",
  "setshareacl",
  "setqueueacl",
  "settableacl",
  "setpathaccesscontrol",
];

// A whole container, file system, share, queue or table deleted.
const STORAGE_WHOLE_DELETES: ReadonlyArray<string> = [
  "deletecontainer",
  "deletefilesystem",
  "deleteshare",
  "deletequeue",
  "deletetable",
];

// The anonymous refusal of an account that allows no anonymous access (409).
const STORAGE_PUBLIC_ACCESS_NOT_PERMITTED: string = "publicaccessnotpermitted";

export enum StorageAuthorization {
  Anonymous = "anonymous",
  SharedAccessSignature = "sas",
  AccountKey = "account-key",
  EntraId = "entra-id",
  Other = "other",
}

/*
 * How a request was authorized: identity.type as Storage writes it (OAuth,
 * Kerberos, SAS, a user delegation SAS, AccountKey, Anonymous, with or
 * without a space), else what its status text starts with (SASSuccess,
 * AnonymousSuccess).
 */
export function readStorageAuthorization(
  record: JSONObject,
): StorageAuthorization {
  const identity: JSONObject | null = asObject(field(record, "identity"));
  const type: string = text(identity?.["type"])
    .toLowerCase()
    .split(" ")
    .join("");

  if (type === "anonymous") {
    return StorageAuthorization.Anonymous;
  }

  if (type === "sas" || type === "saskey" || type === "delegationsas") {
    return StorageAuthorization.SharedAccessSignature;
  }

  if (type === "accountkey") {
    return StorageAuthorization.AccountKey;
  }

  if (type === "oauth" || type === "kerberos") {
    return StorageAuthorization.EntraId;
  }

  if (type) {
    return StorageAuthorization.Other;
  }

  const status: string = text(field(record, "statusText")).toLowerCase();

  if (status.startsWith("anonymous")) {
    return StorageAuthorization.Anonymous;
  }

  if (status.startsWith("sas")) {
    return StorageAuthorization.SharedAccessSignature;
  }

  return StorageAuthorization.Other;
}

// Who signed a request in, as a person reads it.
function storageCaller(
  record: JSONObject,
  authorization: StorageAuthorization,
): string {
  const identity: JSONObject = asObject(field(record, "identity")) || {};
  const requester: JSONObject = asObject(identity["requester"]) || {};

  if (authorization === StorageAuthorization.EntraId) {
    return (
      text(requester["upn"]) ||
      text(requester["uniqueName"]) ||
      text(requester["appId"]) ||
      text(requester["objectId"])
    );
  }

  return "";
}

// The object a request named: "/account/container/blob", as Storage keeps it.
function storageObjectKey(record: JSONObject): string {
  const properties: JSONObject = asObject(field(record, "properties")) || {};
  const identity: JSONObject = asObject(field(record, "identity")) || {};
  const identityProperties: JSONObject = asObject(identity["properties"]) || {};

  return text(properties["objectKey"]) || text(identityProperties["objectKey"]);
}

// The host a request was sent to, from its URI.
function hostOf(uri: string): string {
  const scheme: number = uri.indexOf("://");

  if (scheme === -1) {
    return "";
  }

  const start: number = scheme + 3;
  let end: number = uri.length;

  for (const stop of ["/", "?", "#"]) {
    const at: number = uri.indexOf(stop, start);

    if (at !== -1 && at < end) {
      end = at;
    }
  }

  return uri.slice(start, end).toLowerCase();
}

/*
 * A static website's page: sent to the account's web endpoint
 * (<account>.<zone>.web.core.windows.net), or an object of its $web
 * container. Anonymous by design.
 */
function isStaticWebsiteRequest(record: JSONObject): boolean {
  const properties: JSONObject = asObject(field(record, "properties")) || {};
  const hosts: Array<string> = [
    hostOf(text(field(record, "uri"))),
    hostOf(text(properties["requestUrl"])),
  ];

  if (
    hosts.some((host: string): boolean => {
      return host.indexOf(".web.core.") !== -1;
    })
  ) {
    return true;
  }

  // "/account/$web/index.html": its container is the second segment.
  const segments: Array<string> = storageObjectKey(record).split("/");

  return (segments[2] || "").toLowerCase() === "$web";
}

export function readStorageRecord(
  record: JSONObject,
): SecurityRecordReading | null {
  const operation: string = text(field(record, "operationName"));
  const lower: string = operation.toLowerCase();
  const category: string = categoryOf(record);
  const status: number = statusNumber(field(record, "statusCode"));
  const statusText: string = text(field(record, "statusText"));
  const authorization: StorageAuthorization = readStorageAuthorization(record);

  // A CORS preflight reads nothing, and is anonymous whatever follows it.
  if (!operation || lower.endsWith("preflightrequest")) {
    return null;
  }

  const refused: boolean =
    status === 401 ||
    status === 403 ||
    statusText.toLowerCase() === STORAGE_PUBLIC_ACCESS_NOT_PERMITTED;
  let severity: OcsfSeverity = OcsfSeverity.Low;

  if (!refused) {
    if (!isServed(status)) {
      return null;
    }

    if (authorization === StorageAuthorization.Anonymous) {
      // Served with no credential: Low, but a static website's page.
      if (isStaticWebsiteRequest(record)) {
        return null;
      }
    } else if (
      !STORAGE_ACCESS_CHANGES.includes(lower) &&
      !STORAGE_WHOLE_DELETES.includes(lower)
    ) {
      // Else only a change a shared access signature made: Informational.
      if (
        authorization !== StorageAuthorization.SharedAccessSignature ||
        (category !== "storagewrite" && category !== "storagedelete")
      ) {
        return null;
      }

      severity = OcsfSeverity.Informational;
    }
  }

  const resourceId: string = resourceIdOf(record);
  const account: string =
    segmentAfter(resourceId, "/storageaccounts/") || nameOf(resourceId);
  const object: string = storageObjectKey(record);
  const caller: string = storageCaller(record, authorization);
  const ip: string = readAzureCallerAddress(
    text(field(record, "callerIpAddress")),
  );
  const who: string =
    caller ||
    (authorization === StorageAuthorization.Anonymous
      ? "An anonymous caller"
      : authorization === StorageAuthorization.SharedAccessSignature
        ? "A shared access signature"
        : authorization === StorageAuthorization.AccountKey
          ? "The account key"
          : "Someone");
  const where: string = `storage account ${account}${object ? ` (${object})` : ""}`;

  return {
    time: parseEventTime(field(record, "time") ?? null),
    eventUid: getAzureResourceLogRecordUid(record),
    classUid: API_ACTIVITY,
    activityName: operation,
    statusName: refused ? "Failure" : "Success",
    severity,
    message: refused
      ? `${who} was refused ${operation} on ${where}: ${statusText || String(status)}`
      : `${who} called ${operation} on ${where}${ip ? ` from ${ip}` : ""}`,
    principalUser: caller,
    principalIp: ip,
    targetHost: subscriptionOf(resourceId),
    targetResource: object || resourceId,
    resourceIds: readAzureResourceLogResourceIds(record),
    attributes: boundAttributes(flattenPayload(record)),
  };
}

// ---------- Azure SQL ----------

/*
 * A field of an audit record's properties: as an event hub carries it
 * (action_name), or as Log Analytics suffixes it by its type
 * (action_name_s, session_id_d, event_time_t, sequence_group_id_g).
 */
function sqlText(properties: JSONObject, name: string): string {
  for (const key of [
    name,
    `${name}_s`,
    `${name}_d`,
    `${name}_t`,
    `${name}_g`,
  ]) {
    const value: string = text(properties[key]);

    if (value) {
      return value;
    }
  }

  return "";
}

const SQL_FAILED_SIGN_INS: ReadonlyArray<string> = ["DBAF", "LGIF"];
const SQL_SIGN_INS: ReadonlyArray<string> = ["DBAS", "LGIS"];
const SQL_FAILED_SIGN_IN_NAMES: ReadonlyArray<string> = [
  "DATABASE AUTHENTICATION FAILED",
  "LOGIN FAILED",
];
const SQL_SIGN_IN_NAMES: ReadonlyArray<string> = [
  "DATABASE AUTHENTICATION SUCCEEDED",
  "LOGIN SUCCEEDED",
];

// What a reused connection's sign-in says in its additional_information.
export const SQL_POOLED_CONNECTION_MARKER: string =
  "<pooled_connection>1</pooled_connection>";

/*
 * A batch, an RPC or a transaction: the bulk of an audit. A batch's
 * succeeded is its own result, not a permission check.
 */
const SQL_BULK_ACTION_NAMES: ReadonlyArray<string> = [
  "BATCH COMPLETED",
  "BATCH STARTED",
  "RPC COMPLETED",
  "RPC STARTED",
];

// Who may do what: the action names that change it, as they start.
const SQL_PERMISSION_ACTION_STARTS: ReadonlyArray<string> = [
  "GRANT",
  "DENY",
  "REVOKE",
  "ADD MEMBER",
  "DROP MEMBER",
  "IMPERSONATE",
];

// A password changed, reset or made to change, the principal's own or another's.
const SQL_PASSWORD_ACTION_STARTS: ReadonlyArray<string> = [
  "CHANGE PASSWORD",
  "CHANGE OWN PASSWORD",
  "RESET PASSWORD",
  "RESET OWN PASSWORD",
  "MUST CHANGE PASSWORD",
];

// The principals' classes: a SQL or Windows login, a Windows group, a user, a role.
const SQL_PRINCIPAL_CLASSES: ReadonlyArray<string> = [
  "SL",
  "WL",
  "WG",
  "US",
  "RL",
  "SG",
  "AR",
];

const SQL_PRINCIPAL_CHANGES: ReadonlyArray<string> = [
  "CREATE",
  "ALTER",
  "DROP",
];

function isFalse(value: string): boolean {
  const lower: string = value.toLowerCase();

  return lower === "false" || lower === "0";
}

export function readSqlAuditRecord(
  record: JSONObject,
): SecurityRecordReading | null {
  const properties: JSONObject = asObject(field(record, "properties")) || {};
  const actionId: string = sqlText(properties, "action_id").toUpperCase();
  const actionName: string = sqlText(properties, "action_name").toUpperCase();
  const succeeded: boolean = !isFalse(sqlText(properties, "succeeded"));
  const login: string =
    sqlText(properties, "server_principal_name") ||
    sqlText(properties, "session_server_principal_name") ||
    sqlText(properties, "database_principal_name");
  const database: string =
    sqlText(properties, "database_name") ||
    sqlText(properties, "server_instance_name");
  const ip: string = readRemoteIpAddress(sqlText(properties, "client_ip"));
  const resourceId: string = resourceIdOf(record);
  // When the action fired; the record's own time is when Azure wrote it down.
  const eventTime: string = sqlText(properties, "event_time");
  const base: {
    time: Date | null;
    eventUid: string;
    principalUser: string;
    principalIp: string;
    targetHost: string;
    resourceIds: Array<string>;
    attributes: JSONObject;
  } = {
    time: parseEventTime(eventTime || field(record, "time") || null),
    eventUid: getAzureResourceLogRecordUid(record),
    principalUser: login,
    principalIp: ip,
    targetHost: subscriptionOf(resourceId),
    resourceIds: readAzureResourceLogResourceIds(record),
    attributes: boundAttributes(flattenPayload(record)),
  };
  const onDatabase: string = database ? ` to ${database}` : "";
  const from: string = ip ? ` from ${ip}` : "";

  if (!actionId && !actionName) {
    return null;
  }

  // A sign-in.
  if (
    SQL_FAILED_SIGN_INS.includes(actionId) ||
    SQL_FAILED_SIGN_IN_NAMES.includes(actionName)
  ) {
    return {
      ...base,
      classUid: AUTHENTICATION,
      activityName: "Logon",
      statusName: "Failure",
      severity: OcsfSeverity.Low,
      message: `Failed Azure SQL sign-in${login ? ` for ${login}` : ""}${onDatabase}${from}`,
      targetResource: database || resourceId,
    };
  }

  if (
    SQL_SIGN_INS.includes(actionId) ||
    SQL_SIGN_IN_NAMES.includes(actionName)
  ) {
    // A pooled connection's reuse is audited on every reuse: only a new connection's is a sign-in.
    if (
      sqlText(properties, "additional_information")
        .toLowerCase()
        .indexOf(SQL_POOLED_CONNECTION_MARKER) !== -1
    ) {
      return null;
    }

    return {
      ...base,
      classUid: AUTHENTICATION,
      activityName: "Logon",
      statusName: "Success",
      severity: OcsfSeverity.Informational,
      message: `Azure SQL sign-in${login ? ` for ${login}` : ""}${onDatabase}${from}`,
      targetResource: database || resourceId,
    };
  }

  if (SQL_BULK_ACTION_NAMES.includes(actionName)) {
    return null;
  }

  const object: string = [
    sqlText(properties, "schema_name"),
    sqlText(properties, "object_name"),
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(".");
  const target: string =
    sqlText(properties, "target_database_principal_name") ||
    sqlText(properties, "target_server_principal_name");
  const classType: string = sqlText(properties, "class_type").toUpperCase();
  const changesAccess: boolean =
    [...SQL_PERMISSION_ACTION_STARTS, ...SQL_PASSWORD_ACTION_STARTS].some(
      (start: string): boolean => {
        return actionName.startsWith(start);
      },
    ) ||
    (SQL_PRINCIPAL_CHANGES.includes(actionName) &&
      SQL_PRINCIPAL_CLASSES.includes(classType));

  if (!changesAccess && succeeded) {
    return null;
  }

  const action: string = actionName || actionId;
  const on: string = `${database ? ` on ${database}` : ""}${object ? ` (${object})` : ""}`;

  return {
    ...base,
    classUid: API_ACTIVITY,
    activityName: action,
    statusName: succeeded ? "Success" : "Failure",
    severity: succeeded ? OcsfSeverity.Informational : OcsfSeverity.Low,
    message: succeeded
      ? `${login || "Someone"} ran ${action}${on}${target ? ` for ${target}` : ""}`
      : `${login || "Someone"} was refused ${action}${on}${target ? ` for ${target}` : ""}`,
    targetUser: target,
    targetResource: [database, object].filter(Boolean).join(".") || resourceId,
  };
}

// ---------- what the log scan asks the database for ----------

/*
 * The words a line holds when one of its records is an event, as each
 * shape writes them - "key":"value" and "key": "value" - lowercase. Every
 * line the parser keeps passes one of these groups, as the database's
 * prefilter reads it (SecurityLogParser's SECURITY_LOG_PREFILTER), and most
 * lines that pass are worth reading: a Storage account's successful reads,
 * a SQL database's batches and pooled sign-ins, and the Azure SDK's token
 * challenges never leave the database.
 */
export interface AzureResourceLogPrefilterGroup {
  requires: string;
  anyOf: ReadonlyArray<string>;
  noneOf?: ReadonlyArray<string> | undefined;
  unlessAnyOf?: ReadonlyArray<string> | undefined;
}

function markers(key: string, values: ReadonlyArray<string>): Array<string> {
  return values.flatMap((value: string): Array<string> => {
    return [`"${key}":"${value}"`, `"${key}": "${value}"`];
  });
}

// The start of a value: "action_name":"grant matches GRANT and GRANT WITH GRANT.
function startMarkers(
  key: string,
  values: ReadonlyArray<string>,
): Array<string> {
  return values.flatMap((value: string): Array<string> => {
    return [`"${key}":"${value}`, `"${key}": "${value}`];
  });
}

function numberMarkers(
  key: string,
  values: ReadonlyArray<number>,
): Array<string> {
  return values.flatMap((value: number): Array<string> => {
    return [
      `"${key}":${value}`,
      `"${key}": ${value}`,
      `"${key}":"${value}"`,
      `"${key}": "${value}"`,
    ];
  });
}

const KEY_VAULT_REQUIRES: string = AZURE_KEY_VAULT_ID_MARKER.slice(1);

const KEY_VAULT_FORBIDDEN_MARKERS: Array<string> = [
  ...numberMarkers("httpstatuscode", [403]),
  ...markers("resultsignature", ["forbidden"]),
];

const KEY_VAULT_UNAUTHORIZED_MARKERS: Array<string> = [
  ...numberMarkers("httpstatuscode", [401]),
  ...markers("resultsignature", ["unauthorized"]),
];

export const KEY_VAULT_PREFILTER_GROUPS: ReadonlyArray<AzureResourceLogPrefilterGroup> =
  [
    // What the vault did that is an event, and any of it refused.
    {
      requires: KEY_VAULT_REQUIRES,
      anyOf: [
        ...markers("operationname", KEY_VAULT_EVENT_OPERATIONS),
        ...KEY_VAULT_FORBIDDEN_MARKERS,
      ],
    },
    // A token the vault refused - never its Authentication challenge.
    {
      requires: KEY_VAULT_REQUIRES,
      anyOf: KEY_VAULT_UNAUTHORIZED_MARKERS,
      noneOf: markers("operationname", [KEY_VAULT_AUTHENTICATION]),
    },
  ];

const STORAGE_REFUSED_MARKERS: Array<string> = [
  ...numberMarkers("statuscode", [401, 403]),
  STORAGE_PUBLIC_ACCESS_NOT_PERMITTED,
];

const STORAGE_ANONYMOUS_MARKERS: Array<string> = [
  ...markers("type", ["anonymous"]),
  "anonymoussuccess",
];

const STORAGE_SAS_MARKERS: Array<string> = [
  ...startMarkers("type", ["sas"]),
  ...markers("type", ["delegationsas"]),
  "sassuccess",
];

// A static website's page and a CORS preflight: anonymous by nature.
const STORAGE_ANONYMOUS_BY_DESIGN_MARKERS: Array<string> = [
  ".web.core.",
  "/$web/",
  "preflightrequest",
];

export const STORAGE_PREFILTER_GROUPS: ReadonlyArray<AzureResourceLogPrefilterGroup> =
  [
    {
      requires: "storageread",
      anyOf: [...STORAGE_REFUSED_MARKERS, ...STORAGE_ANONYMOUS_MARKERS],
      noneOf: STORAGE_ANONYMOUS_BY_DESIGN_MARKERS,
      unlessAnyOf: STORAGE_REFUSED_MARKERS,
    },
    {
      requires: "storagewrite",
      anyOf: [
        ...STORAGE_REFUSED_MARKERS,
        ...STORAGE_ANONYMOUS_MARKERS,
        ...STORAGE_SAS_MARKERS,
        ...markers("operationname", STORAGE_ACCESS_CHANGES),
      ],
    },
    {
      requires: "storagedelete",
      anyOf: [
        ...STORAGE_REFUSED_MARKERS,
        ...STORAGE_ANONYMOUS_MARKERS,
        ...STORAGE_SAS_MARKERS,
        ...markers("operationname", STORAGE_WHOLE_DELETES),
      ],
    },
  ];

// A pooled connection's sign-in, as JSON writes it - its < and > as they are, or escaped.
const SQL_POOLED_MARKERS: Array<string> = [
  SQL_POOLED_CONNECTION_MARKER,
  "\\u003cpooled_connection\\u003e1\\u003c/pooled_connection\\u003e",
];

/*
 * An audit field's value as the line writes it, under its own name and the
 * one Log Analytics suffixes it with: never the same words inside a
 * statement, whose quotes JSON escapes.
 */
function sqlMarkers(
  key: string,
  values: ReadonlyArray<string>,
  suffix: string = "_s",
): Array<string> {
  const lower: Array<string> = values.map((value: string): string => {
    return value.toLowerCase();
  });

  return [...markers(key, lower), ...markers(`${key}${suffix}`, lower)];
}

function sqlStartMarkers(
  key: string,
  values: ReadonlyArray<string>,
): Array<string> {
  const lower: Array<string> = values.map((value: string): string => {
    return value.toLowerCase();
  });

  return [...startMarkers(key, lower), ...startMarkers(`${key}_s`, lower)];
}

const SQL_FAILED_SIGN_IN_MARKERS: Array<string> = [
  ...sqlMarkers("action_id", SQL_FAILED_SIGN_INS),
  ...sqlMarkers("action_name", SQL_FAILED_SIGN_IN_NAMES),
];

export const SQL_PREFILTER_GROUPS: ReadonlyArray<AzureResourceLogPrefilterGroup> =
  [
    // A failed sign-in, always.
    {
      requires: AZURE_SQL_AUDIT_CATEGORY,
      anyOf: SQL_FAILED_SIGN_IN_MARKERS,
    },
    // A sign-in on a new connection.
    {
      requires: AZURE_SQL_AUDIT_CATEGORY,
      anyOf: [
        ...sqlMarkers("action_id", SQL_SIGN_INS),
        ...sqlMarkers("action_name", SQL_SIGN_IN_NAMES),
      ],
      noneOf: SQL_POOLED_MARKERS,
    },
    // Who may do what changed, or a permission check failed - never a batch.
    {
      requires: AZURE_SQL_AUDIT_CATEGORY,
      anyOf: [
        ...sqlMarkers("succeeded", ["false", "0"]),
        ...numberMarkers("succeeded", [0]),
        '"succeeded":false',
        '"succeeded": false',
        ...sqlStartMarkers("action_name", SQL_PERMISSION_ACTION_STARTS),
        ...sqlStartMarkers("action_name", SQL_PASSWORD_ACTION_STARTS),
        ...sqlMarkers("class_type", SQL_PRINCIPAL_CLASSES),
      ],
      noneOf: [
        ...SQL_POOLED_MARKERS,
        ...sqlMarkers("action_name", SQL_BULK_ACTION_NAMES),
      ],
      unlessAnyOf: SQL_FAILED_SIGN_IN_MARKERS,
    },
  ];

export const AZURE_RESOURCE_LOG_PREFILTER_GROUPS: ReadonlyArray<AzureResourceLogPrefilterGroup> =
  [
    ...KEY_VAULT_PREFILTER_GROUPS,
    ...STORAGE_PREFILTER_GROUPS,
    ...SQL_PREFILTER_GROUPS,
  ];

function holdsAny(lowerText: string, words: ReadonlyArray<string>): boolean {
  return words.some((word: string): boolean => {
    return lowerText.indexOf(word) !== -1;
  });
}

// Whether a line passes one of the groups, as the database reads it.
export function matchesAzureResourceLogGroups(
  lowerText: string,
  groups: ReadonlyArray<AzureResourceLogPrefilterGroup>,
): boolean {
  return groups.some((group: AzureResourceLogPrefilterGroup): boolean => {
    if (
      lowerText.indexOf(group.requires) === -1 ||
      !holdsAny(lowerText, group.anyOf)
    ) {
      return false;
    }

    if (group.noneOf && holdsAny(lowerText, group.noneOf)) {
      return Boolean(
        group.unlessAnyOf && holdsAny(lowerText, group.unlessAnyOf),
      );
    }

    return true;
  });
}

const SERVICE_GROUPS: Readonly<
  Record<AzureResourceLogService, ReadonlyArray<AzureResourceLogPrefilterGroup>>
> = {
  [AzureResourceLogService.KeyVault]: KEY_VAULT_PREFILTER_GROUPS,
  [AzureResourceLogService.Storage]: STORAGE_PREFILTER_GROUPS,
  [AzureResourceLogService.Sql]: SQL_PREFILTER_GROUPS,
};

const SERVICE_PRODUCTS: Readonly<Record<AzureResourceLogService, string>> = {
  [AzureResourceLogService.KeyVault]: AZURE_KEY_VAULT_PRODUCT_NAME,
  [AzureResourceLogService.Storage]: AZURE_STORAGE_PRODUCT_NAME,
  [AzureResourceLogService.Sql]: AZURE_SQL_PRODUCT_NAME,
};

const SERVICE_READERS: Readonly<
  Record<
    AzureResourceLogService,
    (record: JSONObject) => SecurityRecordReading | null
  >
> = {
  [AzureResourceLogService.KeyVault]: readKeyVaultAuditRecord,
  [AzureResourceLogService.Storage]: readStorageRecord,
  [AzureResourceLogService.Sql]: readSqlAuditRecord,
};

// One record of one of the three services as a reading, or null.
export function readAzureResourceLogRecord(
  record: JSONObject,
): SecurityRecordReading | null {
  const service: AzureResourceLogService | null =
    getAzureResourceLogService(record);

  return service ? SERVICE_READERS[service](record) : null;
}

export default class AzureResourceLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const events: Array<NormalizedSecurityEvent> = [];
    const lowerBody: string = (line.body || "").toLowerCase();
    // Whether the line passes a service's groups, decided once a line.
    const passes: Map<AzureResourceLogService, boolean> = new Map();

    readAzureRecords(line.body).forEach(
      (record: JSONObject, index: number): void => {
        const service: AzureResourceLogService | null =
          getAzureResourceLogService(record);

        if (!service) {
          return;
        }

        // As the database's prefilter reads the line, first.
        if (!passes.has(service)) {
          passes.set(
            service,
            matchesAzureResourceLogGroups(lowerBody, SERVICE_GROUPS[service]),
          );
        }

        if (!passes.get(service)) {
          return;
        }

        const reading: SecurityRecordReading | null =
          SERVICE_READERS[service](record);

        if (!reading) {
          return;
        }

        events.push(
          buildLogSecurityEvent({
            line,
            format: SecurityLogFormat.AzureResourceLogs,
            classUid: reading.classUid,
            activityName: reading.activityName,
            statusName: reading.statusName,
            severity: reading.severity,
            message: reading.message,
            time: reading.time || undefined,
            vendorName: "Microsoft",
            productName: SERVICE_PRODUCTS[service],
            eventUid: reading.eventUid || undefined,
            recordIndex: index,
            principalUser: reading.principalUser,
            principalIp: reading.principalIp,
            targetUser: reading.targetUser,
            targetHost: reading.targetHost,
            targetResource: reading.targetResource,
            resourceIds: reading.resourceIds,
            attributes: reading.attributes,
          }),
        );
      },
    );

    return events;
  }
}
