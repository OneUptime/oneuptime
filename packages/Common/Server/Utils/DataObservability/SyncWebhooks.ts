import crypto from "crypto";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  MAX_DATASETS_PER_EVENT,
  OpenLineageRunEvent,
  OpenLineageRunState,
} from "./OpenLineageEvent";
import OpenLineageIngest, { ProjectCatalog } from "./OpenLineageIngest";

/*
 * FIVETRAN AND AIRBYTE SYNCS, AS PIPELINE RUNS.
 *
 * Managed ingestion tools load warehouses' raw tables and send no
 * OpenLineage events, but their webhooks say when each sync starts and
 * ends. Each Fivetran connector and Airbyte connection becomes a pipeline
 * and each sync a run, through the same path as an OpenLineage run
 * (OpenLineageIngest): run history, a learned duration and schedule, and
 * the Failed, Unusually Long and Late alerts, for syncs too.
 *
 *  - Fivetran sends sync_start and sync_end (SUCCESSFUL, FAILURE,
 *    FAILURE_WITH_TASK or RESCHEDULED), signed with the webhook's secret.
 *    A connector loads the schema of its destination named after it: the
 *    tables of that schema, where exactly one watched database has it,
 *    record the connector as their writer, so a table it stopped loading
 *    points at the sync that should have loaded it.
 *  - Airbyte sends one notification when a sync ends, succeeded or failed,
 *    with when it started: a run, start and end, from one delivery. It
 *    names no tables.
 *
 * A pipeline is its tool's connector in its destination or workspace:
 * fivetran://<destination group> or airbyte://<workspace>, named as the
 * tool names it. Everything is read strictly; what does not fit is
 * dropped, never guessed.
 */

export const FIVETRAN_SIGNATURE_HEADER: string = "x-fivetran-signature-256";

const MAX_ID_LENGTH: number = 200;
const MAX_NAME_LENGTH: number = 500;
const MAX_ERROR_LENGTH: number = 2000;
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PREFIX: RegExp = /^sha256=/i;

const EMPTY_CATALOG: ProjectCatalog = {
  stores: [],
  assets: [],
  storeNames: new Map(),
};

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text ? text.slice(0, maxLength) : null;
}

// A tool's time, taken as now when its clock is far off, as an OpenLineage producer's is.
function readTime(value: unknown, now: Date): Date {
  const parsed: number = Date.parse(String(value ?? ""));

  return Number.isFinite(parsed) &&
    parsed <= now.getTime() + 5 * 60 * 1000 &&
    parsed >= now.getTime() - 30 * 24 * 60 * 60 * 1000
    ? new Date(parsed)
    : now;
}

// A run's id: the tool's own when it is a UUID, else one derived from it, the same every time.
export function toRunId(value: string): string {
  if (UUID_PATTERN.test(value)) {
    return value.toLowerCase();
  }

  const hex: string = crypto.createHash("sha256").update(value).digest("hex");
  const variant: string = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/*
 * Whether Fivetran signed this delivery with the secret: an HMAC-SHA256 of
 * the body as sent, in hex (Fivetran writes it in upper case), compared in
 * constant time.
 */
export function isSignedByFivetran(data: {
  rawBody: string;
  signature: unknown;
  secret: string;
}): boolean {
  const header: unknown = Array.isArray(data.signature)
    ? data.signature[0]
    : data.signature;
  const signature: string =
    typeof header === "string"
      ? header.trim().replace(SHA256_PREFIX, "").toUpperCase()
      : "";

  if (!signature || !data.secret) {
    return false;
  }

  const expected: string = crypto
    .createHmac("sha256", data.secret)
    .update(data.rawBody, "utf8")
    .digest("hex")
    .toUpperCase();

  return (
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

export interface FivetranSyncEvent {
  event: "sync_start" | "sync_end";
  connectorId: string;
  // The connector's name, which is its destination schema's.
  connectorName: string;
  connectorType: string | null;
  destinationGroupId: string;
  syncId: string | null;
  at: Date;
  // A sync_end's status, upper case: SUCCESSFUL, FAILURE, FAILURE_WITH_TASK, RESCHEDULED.
  status: string | null;
  reason: string | null;
}

/*
 * A Fivetran delivery, when it is a sync's start or end; any other event
 * (a connector created or paused, the test sent when a webhook is made)
 * is no sync. Connections were connectors in Fivetran's older payloads,
 * so either name is read.
 */
export function readFivetranSyncEvent(
  body: unknown,
  now: Date,
): FivetranSyncEvent | null {
  const item: JSONObject = readObject(body);
  const event: string = (readText(item["event"], 50) || "").toLowerCase();

  if (event !== "sync_start" && event !== "sync_end") {
    return null;
  }

  const connectorId: string | null = readText(
    item["connector_id"] ?? item["connection_id"],
    MAX_ID_LENGTH,
  );
  const connectorName: string | null =
    readText(
      item["connector_name"] ?? item["connection_name"],
      MAX_NAME_LENGTH,
    ) || connectorId;
  const destinationGroupId: string | null = readText(
    item["destination_group_id"] ?? item["group_id"],
    MAX_ID_LENGTH,
  );

  if (!connectorId || !connectorName || !destinationGroupId) {
    return null;
  }

  const data: JSONObject = readObject(item["data"]);

  return {
    event,
    connectorId,
    connectorName,
    connectorType: readText(
      item["connector_type"] ?? item["connection_type"],
      MAX_ID_LENGTH,
    ),
    destinationGroupId,
    syncId: readText(item["sync_id"], MAX_ID_LENGTH),
    at: readTime(item["created"], now),
    status: readText(data["status"], 50)?.toUpperCase() || null,
    reason: readText(data["reason"] ?? data["message"], MAX_ERROR_LENGTH),
  };
}

/*
 * How a sync ended, as a run's state: a rescheduled sync (an API's rate
 * limit) ends as neither a success nor a failure; any status but these
 * two is a failure, named in the run's error.
 */
export function getFivetranRunState(
  event: FivetranSyncEvent,
): OpenLineageRunState {
  if (event.event === "sync_start") {
    return OpenLineageRunState.Start;
  }

  switch (event.status) {
    case "SUCCESSFUL":
      return OpenLineageRunState.Complete;
    case "RESCHEDULED":
      return OpenLineageRunState.Rescheduled;
    default:
      return OpenLineageRunState.Fail;
  }
}

function getFivetranErrorMessage(
  event: FivetranSyncEvent,
  state: OpenLineageRunState,
): string | null {
  if (state === OpenLineageRunState.Rescheduled) {
    return (
      event.reason
        ? `Rescheduled by Fivetran: ${event.reason}`
        : "Rescheduled by Fivetran."
    ).slice(0, MAX_ERROR_LENGTH);
  }

  if (state === OpenLineageRunState.Fail) {
    return (
      event.reason ||
      `Fivetran ended the sync ${event.status ? event.status.toLowerCase() : "with no status"}.`
    ).slice(0, MAX_ERROR_LENGTH);
  }

  return null;
}

export function buildFivetranRunEvent(
  event: FivetranSyncEvent,
  // The watched tables the sync wrote, by id: its destination schema's.
  outputDataAssetIds: Array<string> = [],
): OpenLineageRunEvent {
  const state: OpenLineageRunState = getFivetranRunState(event);

  return {
    eventType: state,
    eventTime: event.at,
    // A sync's start and end share its sync_id; with none, the event is a run of its own.
    runId: toRunId(
      event.syncId || `fivetran:${event.connectorId}:${event.at.toISOString()}`,
    ),
    jobNamespace: `fivetran://${event.destinationGroupId}`,
    jobName: event.connectorName,
    errorMessage: getFivetranErrorMessage(event, state),
    scheduledAt: null,
    inputs: [],
    outputs: [],
    outputDataAssetIds,
  };
}

/*
 * The watched tables of a schema, when exactly one watched database has a
 * schema of that name (any case: Snowflake writes it upper case). Two have
 * it - a development and a production warehouse, say - and neither is
 * chosen.
 */
export function findSchemaTables(
  catalog: ProjectCatalog,
  schemaName: string,
): Array<string> {
  const schema: string = schemaName.toLowerCase();
  const byStore: Map<string, Array<string>> = new Map();

  for (const asset of catalog.assets) {
    if ((asset.schemaName || "").toLowerCase() === schema) {
      const tables: Array<string> = byStore.get(asset.dataStoreId) || [];
      tables.push(asset.dataAssetId);
      byStore.set(asset.dataStoreId, tables);
    }
  }

  return byStore.size === 1
    ? Array.from(byStore.values())[0]!.slice(0, MAX_DATASETS_PER_EVENT)
    : [];
}

/*
 * An Airbyte notification, when it is a sync's end (succeeded or failed):
 * its run's start and its end. Airbyte's other notifications carry no
 * data, only text for Slack, and are no sync.
 */
export function readAirbyteRunEvents(
  body: unknown,
  now: Date,
): Array<OpenLineageRunEvent> {
  const data: JSONObject = readObject(readObject(body)["data"]);
  const connection: JSONObject = readObject(data["connection"]);
  const workspace: JSONObject = readObject(data["workspace"]);
  const connectionId: string | null = readText(connection["id"], MAX_ID_LENGTH);
  const connectionName: string | null =
    readText(connection["name"], MAX_NAME_LENGTH) || connectionId;
  const success: unknown = data["success"];

  if (!connectionName || typeof success !== "boolean") {
    return [];
  }

  const finishedAt: Date = readTime(data["finishedAt"], now);
  const duration: number = Number(data["durationInSeconds"]);
  const startedAt: Date =
    data["startedAt"] !== undefined
      ? readTime(data["startedAt"], now)
      : Number.isFinite(duration) && duration >= 0
        ? new Date(finishedAt.getTime() - duration * 1000)
        : finishedAt;
  const jobId: string | null = readText(data["jobId"], MAX_ID_LENGTH);
  const errorMessage: string | null = readText(
    data["errorMessage"],
    MAX_ERROR_LENGTH,
  );
  const errorDetails: Array<string> = [
    readText(data["errorType"], 100),
    readText(data["errorOrigin"], 100),
  ].filter((detail: string | null): detail is string => {
    return detail !== null;
  });
  const base: Omit<
    OpenLineageRunEvent,
    "eventType" | "eventTime" | "errorMessage"
  > = {
    runId: toRunId(
      `airbyte:${connectionId || connectionName}:${jobId || finishedAt.toISOString()}`,
    ),
    jobNamespace: `airbyte://${readText(workspace["id"], MAX_ID_LENGTH) || "workspace"}`,
    jobName: connectionName,
    scheduledAt: null,
    inputs: [],
    outputs: [],
  };

  return [
    {
      ...base,
      eventType: OpenLineageRunState.Start,
      // A start after its end is the clocks disagreeing: the end stands.
      eventTime: startedAt <= finishedAt ? startedAt : finishedAt,
      errorMessage: null,
    },
    {
      ...base,
      eventType: success
        ? OpenLineageRunState.Complete
        : OpenLineageRunState.Fail,
      eventTime: finishedAt,
      errorMessage: success
        ? null
        : `${errorMessage || "The Airbyte sync failed."}${
            errorDetails.length > 0 ? ` (${errorDetails.join(", ")})` : ""
          }`.slice(0, MAX_ERROR_LENGTH),
    },
  ];
}

export default class SyncWebhookIngest {
  // A Fivetran delivery: the runs it records (0 for an event that is no sync).
  public static async ingestFivetran(data: {
    projectId: ObjectID;
    body: unknown;
    now: Date;
  }): Promise<number> {
    const event: FivetranSyncEvent | null = readFivetranSyncEvent(
      data.body,
      data.now,
    );

    if (!event) {
      return 0;
    }

    // A sync's end says what it wrote: its schema's tables. Its start writes nothing yet.
    const catalog: ProjectCatalog =
      event.event === "sync_end"
        ? await OpenLineageIngest.readCatalog(data.projectId)
        : EMPTY_CATALOG;

    return await OpenLineageIngest.ingest({
      projectId: data.projectId,
      events: [
        buildFivetranRunEvent(
          event,
          event.event === "sync_end"
            ? findSchemaTables(catalog, event.connectorName)
            : [],
        ),
      ],
      now: data.now,
      catalog,
    });
  }

  // An Airbyte delivery: its run's start and end, or nothing for a notification that is no sync.
  public static async ingestAirbyte(data: {
    projectId: ObjectID;
    body: unknown;
    now: Date;
  }): Promise<number> {
    const events: Array<OpenLineageRunEvent> = readAirbyteRunEvents(
      data.body,
      data.now,
    );

    if (events.length === 0) {
      return 0;
    }

    // Airbyte names no tables, so no catalog is read.
    return await OpenLineageIngest.ingest({
      projectId: data.projectId,
      events,
      now: data.now,
      catalog: EMPTY_CATALOG,
    });
  }
}
