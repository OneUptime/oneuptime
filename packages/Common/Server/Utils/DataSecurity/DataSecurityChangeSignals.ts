import DataStore from "../../../Models/DatabaseModels/DataStore";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import { Results } from "../../Services/AnalyticsDatabaseService";
import ChangeEventService from "../../Services/ChangeEventService";
import DataStoreService from "../../Services/DataStoreService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../Services/SecurityEventService";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { CLOUD_CHANGE_CLAIM_SECONDS } from "../CloudConnection/CloudChangeRecorder";
import logger from "../Logger";
import SecurityEventDedupe from "../SecurityEvent/SecurityEventDedupe";
import { buildSecurityEventDbRow } from "../SecurityEvent/SecurityEventRow";
import ThreatIntelEnricher from "../SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { getEffectiveStoreSensitivity } from "./DataSecurityCriticalitySync";
import { POSTURE_CHANGING_OPERATIONS } from "./DataSecurityRunner";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  CloudIndexEntry,
  CloudResourceIndex,
} from "../../../Types/Cloud/CloudResourceIndex";
import DataSensitivity, {
  isAtLeastAsSensitive,
} from "../../../Types/DataSecurity/DataSensitivity";
import { DataStorePostureFacts } from "../../../Types/DataSecurity/DataStorePosture";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getDataStoreEntityValue } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DATA_SECURITY_SIGNAL_PRODUCT_NAME,
  DATA_SECURITY_SIGNAL_SERVICE_NAME,
  DATA_SECURITY_SIGNAL_SOURCE,
  DATA_SECURITY_SIGNAL_VENDOR_NAME,
  DATA_SECURITY_STORE_CHANGE_SIGNAL,
  DATA_STORE_PROTECTION_OPERATIONS,
  DATA_STORE_SIGNAL_ATTRIBUTES,
  DATA_STORE_SIGNAL_OPERATIONS,
  DataStoreChangeAttack,
  DataStoreProtection,
  getDataStoreChangeAttack,
} from "../../../Types/SecurityEvent/DataSecuritySignal";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../../Types/SecurityEvent/OcsfEventClass";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "../../../Types/SecurityEvent/SecurityLogFormat";
import { SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { resolveTelemetryRetentionInDays } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import { buildObservables } from "../../../Utils/SecurityEvent/NormalizerHelpers";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
} from "../../../Utils/Telemetry/ChangeEventFields";
import { ResponseJSON } from "@clickhouse/client";
import crypto from "crypto";

/*
 * DETECTION AND RESPONSE FOR DATA: A CHANGE TO A SENSITIVE STORE, AS A
 * SECURITY EVENT.
 *
 * A cloud's activity log already reaches OneUptime as change events
 * (CloudConnection/CloudChangeRecorder): "alice ran s3:PutBucketPolicy on
 * orders-exports". On its own that is one of thousands of changes a day.
 * Data Security knows which stores hold Confidential or Restricted data,
 * so the change to one of those is worth a detection rule's look - this
 * writes it into Security Events (Types/SecurityEvent/DataSecuritySignal),
 * where the rule library's Data security rules read it, its case groups on
 * the store, and the store's risk and criticality count:
 *
 *  - The changes read are the cloud's own (oneuptime.change.source =
 *    cloud), of the operations that change a store's exposure, encryption
 *    or sharing, by when they ARRIVED since `since`: the activity log
 *    reaches OneUptime minutes after the fact, and a change that arrives
 *    late is still read once. Nothing older than a day is read.
 *  - A change is the store's when it names the store's Cloud Resource
 *    (oneuptime.resource.id), or the store's own id at the provider, whole
 *    or by its last segment, within the change's account (CloudResourceIndex,
 *    which never guesses between two stores of one name).
 *  - Only a store at Confidential or above, not archived, is written about;
 *    the rest is any other change, and stays one.
 *  - Each change is written once: its event id is its identity, looked up
 *    before the insert under a lock of the project's (SecurityEventDedupe).
 *  - The event is stamped when it is written, the change's own time kept
 *    beside it (oneuptime.change.time): a rule reads events by their time,
 *    two minutes behind the clock, and would have passed a change that
 *    arrived twenty minutes late.
 *
 * The words are the cloud's - an operation's name, a principal - and are
 * data, never instructions, wherever they are read.
 */

// The most changes one call reads, the earliest to arrive first.
export const MAX_POSTURE_CHANGES_PER_RUN: number = 2000;

// How far back a call reads, whatever `since` it is given.
export const POSTURE_CHANGE_MAX_LOOKBACK_IN_HOURS: number = 24;

// OCSF API Activity: a call to the cloud's API, as the activity log records it.
export const API_ACTIVITY_CLASS_UID: number = 6003;

// The longest message, and the longest value of one attribute, an event keeps.
const MAX_MESSAGE_LENGTH: number = 1000;
const MAX_ATTRIBUTE_LENGTH: number = 2000;

const LOCK_NAMESPACE: string = "DataSecurityChangeSignals";

const ROOT: { isRoot: true } = { isRoot: true };

/*
 * The operations read: the ones that make Data Security read a store again,
 * and every one a Data security rule of the library reads.
 */
export function getPostureChangeOperations(): Array<string> {
  return Array.from(
    new Set<string>([
      ...POSTURE_CHANGING_OPERATIONS,
      ...DATA_STORE_SIGNAL_OPERATIONS,
    ]),
  );
}

// One change of a store's posture, as the change events table holds it.
export interface PostureChange {
  time: Date;
  operation: string;
  actor: string;
  provider: string;
  accountId: string;
  region: string;
  // What it changed, as the cloud names it (cloud.resource_id).
  providerResourceId: string;
  // The Cloud Resource it changed, when the connection holds it.
  cloudResourceId: string;
  eventId: string;
  failed: boolean;
}

/*
 * The changes of the cloud that arrived since `since`, of the operations
 * read: every value travels as a parameter, the attribute keys too.
 */
export function buildPostureChangeStatement(data: {
  projectId: ObjectID;
  since: Date;
}): Statement {
  const happenedAfter: Date = OneUptimeDate.addRemoveSeconds(
    data.since,
    -CLOUD_CHANGE_CLAIM_SECONDS,
  );

  const statement: Statement = SQL`SELECT toUnixTimestamp64Milli(time) AS timeInMs, attributes FROM `;
  statement.append(
    `${getClickhouseDatabaseName()}.${AnalyticsTableName.ChangeEvent}`,
  );
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: happenedAfter,
    }} AND createdAt >= ${{
      type: TableColumnType.Date,
      value: data.since,
    }} AND attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.Source,
    }}] = ${{
      type: TableColumnType.Text,
      value: ChangeEventSource.Cloud,
    }} AND attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudOperation,
    }}] IN ${{
      type: TableColumnType.ArrayText,
      value: getPostureChangeOperations(),
    }} AND retentionDate >= now() ORDER BY createdAt ASC, time ASC LIMIT ${{
      type: TableColumnType.Number,
      value: MAX_POSTURE_CHANGES_PER_RUN,
    }}`,
  );
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: 60,
      timeoutOverflowMode: "throw",
    }),
  );

  return statement;
}

function readText(attributes: JSONObject, key: string): string {
  const value: unknown = attributes[key];

  return typeof value === "string" ? value.trim() : "";
}

// One row of the statement as a change, or null for a row that does not read as one.
export function readPostureChange(row: JSONObject): PostureChange | null {
  const attributes: JSONObject =
    row["attributes"] &&
    typeof row["attributes"] === "object" &&
    !Array.isArray(row["attributes"])
      ? (row["attributes"] as JSONObject)
      : {};
  const timeInMs: number = Number(row["timeInMs"]);
  const operation: string = readText(
    attributes,
    ChangeEventAttribute.CloudOperation,
  );

  if (!operation || !Number.isFinite(timeInMs)) {
    return null;
  }

  return {
    time: new Date(timeInMs),
    operation,
    actor: readText(attributes, ChangeEventAttribute.CloudActor),
    provider: readText(attributes, ChangeEventAttribute.CloudProvider),
    accountId: readText(attributes, ChangeEventAttribute.CloudAccountId),
    region: readText(attributes, ChangeEventAttribute.CloudRegion),
    providerResourceId: readText(
      attributes,
      ChangeEventAttribute.CloudResourceId,
    ),
    cloudResourceId:
      readText(attributes, ChangeEventAttribute.ResourceType) ===
      "CloudResource"
        ? readText(attributes, ChangeEventAttribute.ResourceId)
        : "",
    eventId: readText(attributes, ChangeEventAttribute.CloudEventId),
    failed:
      readText(attributes, ChangeEventAttribute.Status) ===
      ChangeEventStatus.Failed,
  };
}

// The columns of a store a change is matched to and written about.
export type DataStoreForSignal = Pick<
  DataStore,
  | "_id"
  | "id"
  | "name"
  | "storeKey"
  | "kind"
  | "sensitivity"
  | "sensitivityOverride"
  | "exposure"
  | "posture"
  | "configurationReadAt"
  | "cloudResourceId"
  | "providerResourceId"
  | "cloudAccountNumber"
  | "region"
>;

/*
 * Which store a change is about: by the Cloud Resource it changed, else by
 * what it changed at the provider within its account - whole, or by its
 * last segment, as CloudChangeRecorder finds the Cloud Resource itself
 * (CloudTrail names a bucket by its name, the store by its ARN).
 */
export class DataStoreChangeMatcher {
  private byCloudResource: Map<string, DataStoreForSignal> = new Map();
  private byId: Map<string, DataStoreForSignal> = new Map();
  private byAccount: Map<string, CloudResourceIndex> = new Map();

  public constructor(stores: Array<DataStoreForSignal>) {
    const rowsByAccount: Map<
      string,
      Array<{
        id: ObjectID;
        name: string;
        providerResourceId: string;
        type: string;
      }>
    > = new Map();

    for (const store of stores) {
      const id: string = store.id?.toString() || "";

      if (!id) {
        continue;
      }

      this.byId.set(id, store);

      const cloudResourceId: string = store.cloudResourceId?.toString() || "";

      if (cloudResourceId && !this.byCloudResource.has(cloudResourceId)) {
        this.byCloudResource.set(cloudResourceId, store);
      }

      const providerResourceId: string = (
        store.providerResourceId || ""
      ).trim();

      if (!providerResourceId) {
        continue;
      }

      const account: string = (store.cloudAccountNumber || "")
        .trim()
        .toLowerCase();

      rowsByAccount.set(account, [
        ...(rowsByAccount.get(account) || []),
        {
          id: new ObjectID(id),
          name: store.name || "",
          providerResourceId,
          type: store.kind || "",
        },
      ]);
    }

    for (const [account, rows] of rowsByAccount.entries()) {
      this.byAccount.set(account, new CloudResourceIndex(rows));
    }
  }

  public match(change: PostureChange): DataStoreForSignal | null {
    const byResource: DataStoreForSignal | undefined = change.cloudResourceId
      ? this.byCloudResource.get(change.cloudResourceId)
      : undefined;

    if (byResource) {
      return byResource;
    }

    if (!change.providerResourceId) {
      return null;
    }

    const index: CloudResourceIndex | undefined = this.byAccount.get(
      change.accountId.trim().toLowerCase(),
    );
    const found: CloudIndexEntry | null = index
      ? index.find({ id: change.providerResourceId })
      : null;

    return found ? this.byId.get(found.id.toString()) || null : null;
  }
}

function readTime(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const time: Date = new Date(value);

  return Number.isNaN(time.getTime()) ? null : time;
}

/*
 * The safeguard a change took off the store, if it took one. Removing a
 * bucket's encryption always does. Turning versioning or access logging
 * on and off is one call either way, and the activity log does not say
 * which, so the store's configuration does: a switch a call can only have
 * moved one way. Read after the change, the configuration says where the
 * change left it (off: taken away); read before, where the change moved it
 * from (on: taken away - or set on again, which a later read shows). A
 * failed call took nothing, and a configuration Data Security could not
 * read says nothing.
 */
export function getRemovedProtection(data: {
  operation: string;
  failed: boolean;
  changedAt: Date;
  posture: DataStorePostureFacts | null | undefined;
  postureReadAt: Date | null | undefined;
}): DataStoreProtection | undefined {
  const protection: DataStoreProtection | undefined =
    Object.prototype.hasOwnProperty.call(
      DATA_STORE_PROTECTION_OPERATIONS,
      data.operation,
    )
      ? DATA_STORE_PROTECTION_OPERATIONS[data.operation]
      : undefined;

  if (!protection || data.failed) {
    return undefined;
  }

  if (protection === DataStoreProtection.Encryption) {
    return protection;
  }

  const fact: boolean | null | undefined =
    protection === DataStoreProtection.Versioning
      ? data.posture?.versioning
      : data.posture?.accessLogging;

  if (fact !== true && fact !== false) {
    return undefined;
  }

  const isReadAfter: boolean = Boolean(
    data.postureReadAt &&
      data.postureReadAt.getTime() > data.changedAt.getTime(),
  );

  return (isReadAfter ? fact === false : fact === true)
    ? protection
    : undefined;
}

// What the change did to the store's API, as OCSF API Activity names it.
function activityOf(operation: string): string {
  const verb: string = operation.slice(operation.indexOf(":") + 1);

  if (verb.startsWith("Create") || verb.startsWith("Copy")) {
    return "Create";
  }

  if (verb.startsWith("Delete")) {
    return "Delete";
  }

  return "Update";
}

function cut(text: string, limit: number): string {
  const value: string = (text || "").trim();

  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

// The change's identity: the cloud's own event id, or what it was when it has none.
export function getDataStoreChangeEventUid(change: PostureChange): string {
  const identity: string = change.eventId
    ? `${change.provider}|${change.accountId}|${change.eventId}`
    : `${change.provider}|${change.accountId}|${change.time.toISOString()}|${change.operation}|${change.providerResourceId}|${change.actor}`;

  return `data-store-change:${crypto
    .createHash("sha256")
    .update(identity.toLowerCase(), "utf8")
    .digest("hex")}`;
}

/*
 * One change to a sensitive store, as the security event it is stored as:
 * the cloud's API call (OCSF API Activity), by whom, on which store, how
 * sensitive it is, and the safeguard it took off when it took one.
 */
export function buildDataStoreChangeEvent(data: {
  change: PostureChange;
  store: DataStoreForSignal;
  sensitivity: DataSensitivity;
  recordedAt: Date;
}): NormalizedSecurityEvent {
  const { change, store, sensitivity } = data;
  const posture: DataStorePostureFacts | undefined =
    (store.posture as DataStorePostureFacts | undefined) || undefined;
  const protectionRemoved: DataStoreProtection | undefined =
    getRemovedProtection({
      operation: change.operation,
      failed: change.failed,
      changedAt: change.time,
      posture,
      postureReadAt:
        readTime(posture?.readAt) || readTime(store.configurationReadAt),
    });
  const attack: DataStoreChangeAttack = getDataStoreChangeAttack({
    operation: change.operation,
    protectionRemoved,
  });
  const category: { categoryUid: number; categoryName: string } =
    ocsfCategoryForClassUid(API_ACTIVITY_CLASS_UID);
  const entity: string = getDataStoreEntityValue(store.storeKey || "");
  const storeName: string = cut(store.name || store.storeKey || "", 300);
  const actor: string = cut(change.actor, 300);
  const severity: OcsfSeverity =
    sensitivity === DataSensitivity.Restricted
      ? OcsfSeverity.High
      : OcsfSeverity.Medium;

  const attributes: JSONObject = {
    [SECURITY_LOG_SOURCE_ATTRIBUTE]: DATA_SECURITY_SIGNAL_SOURCE,
    [SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE]: DATA_SECURITY_STORE_CHANGE_SIGNAL,
    [DATA_STORE_SIGNAL_ATTRIBUTES.entity]: cut(entity, MAX_ATTRIBUTE_LENGTH),
    [DATA_STORE_SIGNAL_ATTRIBUTES.id]: store.id?.toString() || "",
    [DATA_STORE_SIGNAL_ATTRIBUTES.name]: storeName,
    [DATA_STORE_SIGNAL_ATTRIBUTES.kind]: store.kind || "",
    [DATA_STORE_SIGNAL_ATTRIBUTES.sensitivity]: sensitivity,
    [DATA_STORE_SIGNAL_ATTRIBUTES.changedAt]: change.time.toISOString(),
    [ChangeEventAttribute.CloudOperation]: cut(change.operation, 300),
    [ChangeEventAttribute.Status]: change.failed
      ? ChangeEventStatus.Failed
      : ChangeEventStatus.Succeeded,
  };

  if (store.exposure) {
    attributes[DATA_STORE_SIGNAL_ATTRIBUTES.exposure] = store.exposure;
  }

  if (protectionRemoved) {
    attributes[DATA_STORE_SIGNAL_ATTRIBUTES.protectionRemoved] =
      protectionRemoved;
  }

  const optional: Array<[string, string, number]> = [
    [ChangeEventAttribute.CloudActor, actor, 300],
    [ChangeEventAttribute.CloudProvider, change.provider, 100],
    [ChangeEventAttribute.CloudAccountId, change.accountId, 300],
    [
      ChangeEventAttribute.CloudRegion,
      change.region || store.region || "",
      100,
    ],
    [
      ChangeEventAttribute.CloudResourceId,
      change.providerResourceId,
      MAX_ATTRIBUTE_LENGTH,
    ],
    [ChangeEventAttribute.CloudEventId, change.eventId, 300],
  ];

  for (const [key, value, limit] of optional) {
    if (value) {
      attributes[key] = cut(value, limit);
    }
  }

  const message: string = `${actor || "Someone"} ${
    change.failed ? "tried to run" : "ran"
  } ${change.operation} on ${storeName}, ${store.kind ? `${store.kind} ` : ""}holding ${sensitivity} data${
    protectionRemoved
      ? `, and took its ${protectionRemoved.replace("-", " ")} off`
      : ""
  }.`;

  return {
    time: data.recordedAt,
    eventUid: getDataStoreChangeEventUid(change),
    categoryUid: category.categoryUid,
    categoryName: category.categoryName,
    classUid: API_ACTIVITY_CLASS_UID,
    className:
      ocsfEventClassByUid(API_ACTIVITY_CLASS_UID)?.name || "API Activity",
    activityName: activityOf(change.operation),
    severityId: OcsfSeverityId[severity],
    severityName: severity,
    statusName: change.failed ? "Failure" : "Success",
    message: cut(message, MAX_MESSAGE_LENGTH),
    vendorName: DATA_SECURITY_SIGNAL_VENDOR_NAME,
    productName: DATA_SECURITY_SIGNAL_PRODUCT_NAME,
    ruleId: "",
    ruleName: "",
    mitreTactics: attack.tactics,
    mitreTechniques: attack.techniques,
    principalUser: actor,
    principalHost: "",
    principalIp: "",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: cut(
      store.providerResourceId || change.providerResourceId || storeName,
      MAX_ATTRIBUTE_LENGTH,
    ),
    observables: buildObservables([
      actor,
      cut(entity, MAX_ATTRIBUTE_LENGTH),
      cut(change.providerResourceId, MAX_ATTRIBUTE_LENGTH),
    ]),
    attributes,
  };
}

/*
 * Stores the events, each id once - in the batch, and against what the
 * project already holds - enriched with threat intel as ingest is, under
 * Data Security's own service. Returns the events stored.
 */
export async function storeDataSecurityEvents(data: {
  projectId: ObjectID;
  events: Array<NormalizedSecurityEvent>;
}): Promise<Array<NormalizedSecurityEvent>> {
  const seen: Set<string> = new Set();
  let events: Array<NormalizedSecurityEvent> = data.events.filter(
    (event: NormalizedSecurityEvent): boolean => {
      if (!event.eventUid || seen.has(event.eventUid)) {
        return false;
      }

      seen.add(event.eventUid);
      return true;
    },
  );

  if (events.length === 0) {
    return [];
  }

  const existing: Set<string> = await SecurityEventDedupe.findExistingEventUids(
    {
      projectId: data.projectId,
      vendorName: DATA_SECURITY_SIGNAL_VENDOR_NAME,
      productName: DATA_SECURITY_SIGNAL_PRODUCT_NAME,
      ids: events.map((event: NormalizedSecurityEvent): string => {
        return event.eventUid;
      }),
    },
  );

  events = events.filter((event: NormalizedSecurityEvent): boolean => {
    return !existing.has(event.eventUid);
  });

  if (events.length === 0) {
    return [];
  }

  const serviceMetadata: TelemetryServiceMetadata =
    await OTelIngestService.telemetryServiceFromName({
      serviceName: DATA_SECURITY_SIGNAL_SERVICE_NAME,
      projectId: data.projectId,
    });

  await ThreatIntelEnricher.enrichNormalizedEvents({
    projectId: data.projectId,
    events,
  });

  const retentionDays: number = resolveTelemetryRetentionInDays({
    pillar: "securityEvents",
    serviceConfig: serviceMetadata.serviceRetentionConfig,
    serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
    projectConfig: serviceMetadata.projectRetentionConfig,
    projectRetentionInDays: serviceMetadata.projectRetentionInDays,
  });

  await SecurityEventService.insertJsonRows(
    events.map((normalized: NormalizedSecurityEvent): JSONObject => {
      return buildSecurityEventDbRow({
        normalized,
        projectId: data.projectId,
        serviceMetadata,
        retentionDays,
      });
    }),
  );

  return events;
}

export interface DataSecurityChangeSignalsResult {
  // Changes of the operations read that arrived since `since`.
  changesRead: number;
  // Of them, the ones about a store Data Security knows.
  changesMatched: number;
  // Events written: the changes to a store at Confidential or above, each once.
  eventsRecorded: number;
  // The call read its most; the next reads on from where these arrived.
  isTruncated: boolean;
}

async function readPostureChanges(
  projectId: ObjectID,
  since: Date,
): Promise<Array<PostureChange>> {
  const result: Results = await ChangeEventService.executeQuery(
    buildPostureChangeStatement({ projectId, since }),
  );
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return ((response.data || []) as Array<JSONObject>)
    .map(readPostureChange)
    .filter((change: PostureChange | null): change is PostureChange => {
      return change !== null;
    });
}

/*
 * Writes a security event for every change to a sensitive store that
 * arrived since `since` (at most POSTURE_CHANGE_MAX_LOOKBACK_IN_HOURS
 * back), as the comment at the top says. Safe to call with overlapping
 * windows: a change already written is not written again. Never throws:
 * what could not be read or written is logged, and the next call reads it
 * again.
 */
export async function recordPostureChangeSignals(
  projectId: ObjectID,
  since: Date,
): Promise<DataSecurityChangeSignalsResult> {
  const result: DataSecurityChangeSignalsResult = {
    changesRead: 0,
    changesMatched: 0,
    eventsRecorded: 0,
    isTruncated: false,
  };
  const now: Date = OneUptimeDate.getCurrentDate();
  const earliest: Date = OneUptimeDate.addRemoveHours(
    now,
    -POSTURE_CHANGE_MAX_LOOKBACK_IN_HOURS,
  );
  const from: Date =
    since &&
    !Number.isNaN(since.getTime()) &&
    since.getTime() > earliest.getTime()
      ? since
      : earliest;

  let mutex: SemaphoreMutex;

  try {
    mutex = await Semaphore.lock({
      key: projectId.toString(),
      namespace: LOCK_NAMESPACE,
      lockTimeout: 2 * 60 * 1000,
      acquireTimeout: 30 * 1000,
    });
  } catch (error) {
    // Another call is writing the project's changes: it writes these too.
    logger.warn(
      `DataSecurity: could not lock project ${projectId.toString()} to record its store changes: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return result;
  }

  try {
    const changes: Array<PostureChange> = await readPostureChanges(
      projectId,
      from,
    );

    result.changesRead = changes.length;
    result.isTruncated = changes.length >= MAX_POSTURE_CHANGES_PER_RUN;

    if (changes.length === 0) {
      return result;
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        name: true,
        storeKey: true,
        kind: true,
        sensitivity: true,
        sensitivityOverride: true,
        exposure: true,
        posture: true,
        configurationReadAt: true,
        cloudResourceId: true,
        providerResourceId: true,
        cloudAccountNumber: true,
        region: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: ROOT,
    });

    const matcher: DataStoreChangeMatcher = new DataStoreChangeMatcher(stores);
    const events: Array<NormalizedSecurityEvent> = [];

    for (const change of changes) {
      const store: DataStoreForSignal | null = matcher.match(change);

      if (!store || !store.storeKey) {
        continue;
      }

      result.changesMatched++;

      const sensitivity: DataSensitivity = getEffectiveStoreSensitivity(store);

      if (!isAtLeastAsSensitive(sensitivity, DataSensitivity.Confidential)) {
        continue;
      }

      events.push(
        buildDataStoreChangeEvent({
          change,
          store,
          sensitivity,
          recordedAt: now,
        }),
      );
    }

    result.eventsRecorded = (
      await storeDataSecurityEvents({ projectId, events })
    ).length;
  } catch (error) {
    logger.error(
      `DataSecurity: could not record the store changes of project ${projectId.toString()}:`,
    );
    logger.error(error);
  } finally {
    await Semaphore.release(mutex);
  }

  return result;
}
