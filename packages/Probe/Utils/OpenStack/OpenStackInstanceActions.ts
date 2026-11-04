import {
  OpenStackApiError,
  OpenStackBudgetExceededError,
} from "./OpenStackCollectionErrors";
import OpenStackCollectorMemory, {
  INSTANCE_STATE_IDLE_TIMEOUT_IN_MS,
} from "./OpenStackCollectorMemory";
import { CHANGES_SINCE_OVERLAP_IN_MS } from "./OpenStackInstanceReader";
import { NovaServerRecord } from "./OpenStackInventory";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "./OpenStackServiceClient";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import { OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX } from "Common/Utils/OpenStack/OpenStackNotifications";

/*
 * WHAT NOVA SAYS AN INSTANCE WENT THROUGH, FOR A CLOUD THAT CANNOT TURN NOTIFICATIONS ON.
 *
 * A cloud's config is not always someone's to change, and Nova keeps an action record per
 * request regardless: what was asked, by whom, under which request ID and whether it
 * failed. So the probe reads that for the instances worth asking about, which are the ones
 * that changed since it last looked, and says each thing as the notification Nova would have
 * sent. The rest of the path cannot tell the difference: the ingest reads it, and the part's
 * feed, its charts, OneUptime AI and the two alerts on what fails all read the result. The
 * recorder leaves these out for a cloud whose own notifications are arriving, so a failure
 * is not said twice (OpenStackEventRecorder).
 *
 *   - One call per instance that changed, and one more per failed action. Bounded by the
 *     budgets below, and whatever those leave is read at the next collection, the failed
 *     instances first. A quiet cloud makes no calls here at all.
 *   - changes-since on the action list needs microversion 2.58. Before that the whole list
 *     comes back, and only what is new is kept.
 *   - An action with no failure is said only once its instance has no task left running.
 *     Until then "rebooted" would be a guess. The instance's own record changes when its task
 *     ends, which brings it back here.
 *   - An event's `traceback` is never read, and `details` is only the message Nova keeps for
 *     people. Most credentials may not see either, and then the instance's fault says why.
 *   - What a read costs is the probe's, so a credential that may not read a thing, or an
 *     instance deleted while reading, is an answer and not an error.
 */

export const MAX_SERVERS_READ_PER_COLLECTION: number = 25;
export const MAX_ACTIONS_READ_PER_SERVER: number = 10;
// How many instances may wait for a later collection. Past this, the oldest are dropped.
export const MAX_SERVERS_LEFT_FOR_LATER: number = 500;
// The most action keys remembered, enough for the overlap of two collections.
export const MAX_ACTIONS_REMEMBERED: number = 2000;
/*
 * How far back the first read after a restart asks. Longer would repeat what was said
 * before the restart, and the server holds a day's message IDs to catch what this repeats.
 */
export const FIRST_READ_LOOKBACK_IN_MS: number = 15 * 60_000;

// Nova's words for what an action is, as the step its notification would have named.
const STEP_OF_ACTION: ReadonlyMap<string, string> = new Map<string, string>([
  ["stop", "power_off"],
  ["start", "power_on"],
  ["confirmResize", "resize_confirm"],
  ["revertResize", "resize_revert"],
  ["live-migration", "live_migration"],
  ["createImage", "snapshot"],
  ["createBackup", "backup"],
  ["attach_volume", "volume_attach"],
  ["detach_volume", "volume_detach"],
  ["swap_volume", "volume_swap"],
  ["attach_interface", "interface_attach"],
  ["detach_interface", "interface_detach"],
  ["shelveOffload", "shelve_offload"],
]);

interface LeftForLater {
  id: string;
  since: string;
}

interface OpenStackInstanceActionState {
  // Where the next read asks from, by Nova's clock.
  cursor: string;
  later: Array<LeftForLater>;
  said: Array<string>;
}

export interface OpenStackInstanceActionRead {
  // Each as the notification Nova would have sent: see toInstanceActionNotification.
  notifications: Array<JSONObject>;
  serversRead: number;
  serversLeftForLater: number;
}

export interface NovaInstanceActionRecord {
  action: string;
  requestId: string;
  userId: string | null;
  projectId: string | null;
  message: string | null;
  startTime: string | null;
  updatedAt: string | null;
}

export interface NovaFailedStep {
  event: string | null;
  // The message Nova keeps with the step, where this credential may read it.
  details: string | null;
}

function text(value: JSONValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function toNovaInstanceAction(
  item: JSONObject,
): NovaInstanceActionRecord | null {
  const action: string | null = text(item["action"]);
  const requestId: string | null = text(item["request_id"]);

  if (!action || !requestId) {
    return null;
  }

  return {
    action,
    requestId,
    userId: text(item["user_id"]),
    projectId: text(item["project_id"]),
    message: text(item["message"]),
    startTime: text(item["start_time"]),
    updatedAt: text(item["updated_at"]),
  };
}

// The step that failed, from an action's detail: never its traceback.
export function toNovaFailedStep(body: JSONObject): NovaFailedStep | null {
  const action: JSONValue | undefined = body["instanceAction"];
  const events: JSONValue | undefined =
    action && typeof action === "object" && !Array.isArray(action)
      ? (action as JSONObject)["events"]
      : undefined;

  if (!Array.isArray(events)) {
    return null;
  }

  for (const event of events as JSONArray) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      continue;
    }

    const record: JSONObject = event as JSONObject;
    const result: string | null = text(record["result"]);

    if (result && result.toLowerCase() === "error") {
      return { event: text(record["event"]), details: text(record["details"]) };
    }
  }

  return null;
}

function readTime(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }

  // Nova writes an action's times in UTC, with no zone.
  const hasZone: boolean =
    value.endsWith("Z") ||
    value.indexOf("+", 10) !== -1 ||
    value.indexOf("-", 11) !== -1;

  return Date.parse(hasZone ? value : `${value}Z`);
}

function actionTime(action: NovaInstanceActionRecord): number {
  const updated: number = readTime(action.updatedAt);

  return Number.isNaN(updated) ? readTime(action.startTime) : updated;
}

function toNovaTime(time: number): string {
  return `${new Date(time).toISOString().substring(0, 19)}Z`;
}

function isFailed(server: NovaServerRecord): boolean {
  return server.status === "ERROR";
}

/*
 * Which instances to read: those that changed since the last read, the failed ones first
 * and then the newest. Exported for tests.
 */
export function chooseServersToRead(data: {
  servers: ReadonlyArray<NovaServerRecord>;
  since: string;
  later: ReadonlyArray<LeftForLater>;
  limit: number;
}): {
  toRead: Array<{ server: NovaServerRecord; since: string }>;
  later: Array<LeftForLater>;
} {
  const sinceTime: number = readTime(data.since);
  const laterById: Map<string, string> = new Map<string, string>();

  for (const left of data.later) {
    laterById.set(left.id, left.since);
  }

  const due: Array<{ server: NovaServerRecord; since: string }> = [];

  for (const server of data.servers) {
    const updated: number = readTime(server.updatedAt);
    const leftSince: string | undefined = laterById.get(server.id);

    if (leftSince !== undefined) {
      due.push({ server, since: leftSince });
    } else if (!Number.isNaN(updated) && updated >= sinceTime) {
      due.push({ server, since: data.since });
    }
  }

  due.sort(
    (
      a: { server: NovaServerRecord; since: string },
      b: { server: NovaServerRecord; since: string },
    ): number => {
      if (isFailed(a.server) !== isFailed(b.server)) {
        return isFailed(a.server) ? -1 : 1;
      }

      return (
        (readTime(b.server.updatedAt) || 0) -
        (readTime(a.server.updatedAt) || 0)
      );
    },
  );

  const limit: number = Math.max(0, data.limit);

  return {
    toRead: due.slice(0, limit),
    later: due
      .slice(limit)
      .slice(0, MAX_SERVERS_LEFT_FOR_LATER)
      .map(
        (left: { server: NovaServerRecord; since: string }): LeftForLater => {
          return { id: left.server.id, since: left.since };
        },
      ),
  };
}

/*
 * One action as the notification Nova would have sent, so everything past the ingest reads
 * it as one. Its message ID stands still for the same action and outcome, which is what
 * lets the server drop a repeat of it. Exported for tests.
 */
export function toInstanceActionNotification(data: {
  server: NovaServerRecord;
  action: NovaInstanceActionRecord;
  failedStep: NovaFailedStep | null;
  // The instance's own fault, only for its newest failure: it says nothing of the older.
  faultMessage: string | null;
}): JSONObject {
  const { server, action, failedStep } = data;
  const failed: boolean = Boolean(action.message);
  const step: string = STEP_OF_ACTION.get(action.action) || action.action;
  const reason: string | null =
    (failedStep && failedStep.details) ||
    data.faultMessage ||
    (failedStep && failedStep.event
      ? `Nova's step ${failedStep.event} failed.`
      : null);

  return {
    message_id: `${OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX}${server.id}/${action.requestId}/${failed ? "failed" : "done"}`,
    event_type: `instance.${step}.${failed ? "error" : "end"}`,
    priority: failed ? "ERROR" : "INFO",
    // Nova's API is what said this, whichever process asked it.
    publisher_id: "nova-api",
    timestamp: action.updatedAt || action.startTime || "",
    payload: {
      "nova_object.data": {
        uuid: server.id,
        display_name: server.name || "",
        node: server.hypervisorHostname || "",
        tenant_id: action.projectId || server.tenantId || "",
        user_id: action.userId || "",
        request_id: action.requestId,
        state: (server.status || "").toLowerCase(),
        ...(failed && reason
          ? {
              fault: {
                "nova_object.data": {
                  exception_message: reason,
                },
              },
            }
          : {}),
      },
    },
  };
}

function isAnAnswer(error: unknown): boolean {
  return (
    error instanceof OpenStackApiError &&
    (error.kind === "refused" || error.kind === "absent")
  );
}

async function readFailedStep(data: {
  client: OpenStackServiceClient;
  serverId: string;
  requestId: string;
}): Promise<NovaFailedStep | null> {
  try {
    const answer: OpenStackJsonAnswer = await data.client.get({
      read: "an instance's failed action",
      path: `/servers/${encodeURIComponent(data.serverId)}/os-instance-actions/${encodeURIComponent(data.requestId)}`,
    });

    return toNovaFailedStep(answer.body);
  } catch (error) {
    if (isAnAnswer(error)) {
      return null;
    }

    throw error;
  }
}

async function readServerActions(data: {
  client: OpenStackServiceClient;
  server: NovaServerRecord;
  since: string;
  canAskForChanges: boolean;
  said: Set<string>;
  notifications: Array<JSONObject>;
}): Promise<void> {
  const { client, server, said } = data;
  let answer: OpenStackListAnswer;

  try {
    answer = await client.list({
      read: "an instance's actions",
      path: `/servers/${encodeURIComponent(server.id)}/os-instance-actions`,
      key: "instanceActions",
      paging: "none",
      idField: "request_id",
      query: data.canAskForChanges ? { "changes-since": data.since } : {},
    });
  } catch (error) {
    if (isAnAnswer(error)) {
      return;
    }

    throw error;
  }

  const sinceTime: number = readTime(data.since);
  const actions: Array<NovaInstanceActionRecord> = answer.items
    .map(toNovaInstanceAction)
    .filter(
      (
        action: NovaInstanceActionRecord | null,
      ): action is NovaInstanceActionRecord => {
        return action !== null && actionTime(action) >= sinceTime;
      },
    )
    .sort(
      (a: NovaInstanceActionRecord, b: NovaInstanceActionRecord): number => {
        return actionTime(a) - actionTime(b);
      },
    )
    .slice(-MAX_ACTIONS_READ_PER_SERVER);

  const newestFailure: NovaInstanceActionRecord | undefined = actions
    .filter((action: NovaInstanceActionRecord): boolean => {
      return Boolean(action.message);
    })
    .pop();

  for (const action of actions) {
    const key: string = `${server.id}/${action.requestId}/${action.message ? "failed" : "done"}`;

    if (said.has(key)) {
      continue;
    }

    // Said once it has finished: see the top of this file.
    if (!action.message && server.taskState) {
      continue;
    }

    data.notifications.push(
      toInstanceActionNotification({
        server,
        action,
        failedStep: action.message
          ? await readFailedStep({
              client,
              serverId: server.id,
              requestId: action.requestId,
            })
          : null,
        faultMessage:
          action === newestFailure ? server.faultMessage || null : null,
      }),
    );
    said.add(key);
  }
}

export async function readOpenStackInstanceActions(data: {
  client: OpenStackServiceClient;
  memory: OpenStackCollectorMemory;
  // Per credential and region.
  stateKey: string;
  servers: ReadonlyArray<NovaServerRecord>;
  // Whether this Nova takes changes-since on an action list: microversion 2.58.
  canAskForChanges: boolean;
  // Where the next read should start, by Nova's clock, if this read finishes.
  nextCursor: string | null;
}): Promise<OpenStackInstanceActionRead> {
  const now: number = data.client.now();
  const state: OpenStackInstanceActionState = data.memory.recall<OpenStackInstanceActionState>(
    data.stateKey,
    INSTANCE_STATE_IDLE_TIMEOUT_IN_MS,
    now,
  ) || {
    cursor: toNovaTime(now - FIRST_READ_LOOKBACK_IN_MS),
    later: [],
    said: [],
  };

  const chosen: {
    toRead: Array<{ server: NovaServerRecord; since: string }>;
    later: Array<LeftForLater>;
  } = chooseServersToRead({
    servers: data.servers,
    since: state.cursor,
    later: state.later,
    limit: MAX_SERVERS_READ_PER_COLLECTION,
  });

  const notifications: Array<JSONObject> = [];
  const said: Set<string> = new Set<string>(state.said);
  const later: Array<LeftForLater> = [...chosen.later];
  let serversRead: number = 0;

  for (let index: number = 0; index < chosen.toRead.length; index++) {
    const { server, since } = chosen.toRead[index]!;

    try {
      await readServerActions({
        client: data.client,
        server,
        since,
        canAskForChanges: data.canAskForChanges,
        said,
        notifications,
      });
      serversRead++;
    } catch (error) {
      /*
       * Out of time or failing: what was read is kept, and the instances not reached wait
       * for the next collection, from where they were due.
       */
      if (
        !(error instanceof OpenStackBudgetExceededError) &&
        !(error instanceof OpenStackApiError)
      ) {
        throw error;
      }

      for (const left of chosen.toRead.slice(index)) {
        later.push({ id: left.server.id, since: left.since });
      }

      break;
    }
  }

  data.memory.remember(
    data.stateKey,
    {
      cursor:
        data.nextCursor || toNovaTime(now - CHANGES_SINCE_OVERLAP_IN_MS),
      later: later.slice(0, MAX_SERVERS_LEFT_FOR_LATER),
      said: Array.from(said).slice(-MAX_ACTIONS_REMEMBERED),
    } as OpenStackInstanceActionState,
    now,
  );

  return {
    notifications,
    serversRead,
    serversLeftForLater: later.length,
  };
}

/*
 * What a collection's instance actions are as OTLP/JSON logs: one resource per region, each
 * record's body the notification itself. The server stamps which cloud they are of
 * (OpenStackProbeLogs), and the ingest reads the rest.
 */
export function buildOpenStackInstanceActionLogs(data: {
  byRegion: ReadonlyArray<{
    regionName: string;
    notifications: ReadonlyArray<JSONObject>;
  }>;
  scopeVersion: string;
  now: number;
}): JSONArray {
  const resourceLogs: JSONArray = [];

  for (const region of data.byRegion) {
    if (region.notifications.length === 0) {
      continue;
    }

    resourceLogs.push({
      resource: {
        attributes: [
          {
            key: "openstack.region.name",
            value: { stringValue: region.regionName },
          },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "oneuptime-probe-openstack", version: data.scopeVersion },
          logRecords: region.notifications.map(
            (notification: JSONObject): JSONObject => {
              const failed: boolean = notification["priority"] === "ERROR";
              const at: number = readTime(
                text(notification["timestamp"]),
              );

              return {
                timeUnixNano: `${(Number.isNaN(at) ? data.now : at) * 1_000_000}`,
                severityNumber: failed ? 17 : 9,
                severityText: failed ? "ERROR" : "INFO",
                body: { stringValue: JSON.stringify(notification) },
              };
            },
          ),
        },
      ],
    });
  }

  return resourceLogs;
}
