import { translationKey } from "../Translator";
import {
  CLOUD_STREAM_PUBSUB_ACK_DEADLINE_SECONDS,
  CLOUD_STREAM_PUBSUB_MAX_RETRY_SECONDS,
  CLOUD_STREAM_PUBSUB_MIN_RETRY_SECONDS,
  CLOUD_STREAM_PUBSUB_RETENTION_SECONDS,
  canPubSubPushTo,
  getCloudStreamPushServiceAccountEmail,
  getCloudStreamPushServiceAccountId,
  getCloudStreamSuffix,
  CloudStreamProblem,
  isGcpProjectId,
  quoteForShell,
} from "./CloudStream";

/*
 * STREAMING A GOOGLE CLOUD CONNECTION'S LOGS INTO ONEUPTIME.
 *
 * Cloud Logging routes a project's log entries through a log sink into a
 * Pub/Sub topic, and the topic's push subscription delivers each entry to
 * OneUptime (CloudStream's CLOUD_STREAM_PUBSUB_LOGS_PATH) - all of it
 * Google's managed services, with nothing to run. One command in Google
 * Cloud Shell sets it up (getGcpCloudStreamCommand), in the project the
 * connection's own service account is from:
 *
 *   - a service account made for the pushes alone, oneuptime-push-<8 hex>,
 *     holding no role: Pub/Sub signs an OIDC token for it with every push,
 *     and OneUptime takes a push only with a token Google signed for it;
 *     Pub/Sub's own service agent may make those tokens and nothing else
 *     (Service Account OpenID Connect Identity Token Creator, on that
 *     service account alone);
 *   - a topic, oneuptime-stream-<8 hex>, and its push subscription, whose
 *     token's audience is the connection's stream key - the key that names
 *     the connection and so the project - and which keeps what it could not
 *     deliver for a day, pushing it again with a growing pause;
 *   - a log sink of the same name in each project to stream, with the
 *     filter chosen, whose writer may publish to that topic and nothing
 *     else (Pub/Sub Publisher, on the topic alone).
 *
 * Nothing it makes can read a project, and it gives OneUptime no access to
 * any: entries only flow out. Cloud Monitoring has no export that pushes
 * metrics, so a Google Cloud stream carries logs and the connection keeps
 * reading its metrics on its schedule.
 *
 * The command never calls exit (pasted into Cloud Shell, it would close the
 * shell): it is one function that stops at the first step Google refuses,
 * says so, and sets nothing more up. Running it again updates what it made.
 */

export enum GcpCloudStreamLogs {
  // What most people want: what went wrong, not every request.
  WarningsAndErrors = "warnings-and-errors",
  // Every entry the projects write but the audit logs of data reads.
  Every = "every",
  // A Cloud Logging query of the person's own.
  Custom = "custom",
}

export const GCP_CLOUD_STREAM_LOGS_CHOICES: ReadonlyArray<GcpCloudStreamLogs> =
  Object.values(GcpCloudStreamLogs);

/*
 * The sink's filter for each choice, in the Cloud Logging query language.
 * Every log leaves out the Data Access audit logs, which record every read
 * of every resource and can outweigh everything else a project writes.
 */
export const GCP_CLOUD_STREAM_WARNINGS_FILTER: string = "severity>=WARNING";
export const GCP_CLOUD_STREAM_EVERY_LOG_FILTER: string =
  'NOT log_id("cloudaudit.googleapis.com/data_access")';

// The longest filter Cloud Logging takes.
export const GCP_CLOUD_STREAM_MAX_FILTER_LENGTH: number = 20_000;

// The most projects one command sets sinks up in.
export const GCP_CLOUD_STREAM_MAX_PROJECTS: number = 100;

// The roles the command grants, and on what: each the least it can be.
export const GCP_PUSH_TOKEN_ROLE: string =
  "roles/iam.serviceAccountOpenIdTokenCreator";
export const GCP_SINK_WRITER_ROLE: string = "roles/pubsub.publisher";

// The APIs the command turns on: Pub/Sub may be off in a project.
export const GCP_CLOUD_STREAM_SERVICES: ReadonlyArray<string> = [
  "pubsub.googleapis.com",
  "logging.googleapis.com",
];

// What the command says, in English as the shell prints it.
export const GCP_CLOUD_STREAM_COMMAND_DONE: string =
  "Done. Pub/Sub pushes the projects' logs to OneUptime within a minute or two.";
export const GCP_CLOUD_STREAM_COMMAND_STOPPED: string =
  "Stopped: fix what Google said above, then run this command again.";

export interface GcpCloudStreamNames {
  topic: string;
  subscription: string;
  sink: string;
  pushServiceAccountId: string;
}

// What the command's resources are called, after the connection.
export function getGcpCloudStreamNames(
  connectionId: string,
): GcpCloudStreamNames {
  const suffix: string = getCloudStreamSuffix(connectionId);

  return {
    topic: `oneuptime-stream-${suffix}`,
    subscription: `oneuptime-stream-${suffix}-push`,
    sink: `oneuptime-stream-${suffix}`,
    pushServiceAccountId: getCloudStreamPushServiceAccountId(connectionId),
  };
}

// The sink's filter for a choice: the person's own for Custom.
export function getGcpCloudStreamFilter(data: {
  logs: GcpCloudStreamLogs;
  customFilter: string;
}): string {
  if (data.logs === GcpCloudStreamLogs.Every) {
    return GCP_CLOUD_STREAM_EVERY_LOG_FILTER;
  }

  if (data.logs === GcpCloudStreamLogs.Custom) {
    return data.customFilter.trim();
  }

  return GCP_CLOUD_STREAM_WARNINGS_FILTER;
}

export const STREAM_NO_HOST_PROJECT: string = translationKey(
  "This connection does not say which project its service account is from. Save the connection again with its key to stream.",
);
export const STREAM_NO_PROJECT: string = translationKey(
  "List at least one project to stream logs from.",
);
export const STREAM_TOO_MANY_PROJECTS: string = translationKey(
  "List at most {{count}} projects.",
);
export const STREAM_NOT_A_PROJECT: string = translationKey(
  "List projects by their IDs, such as my-project-123456.",
);
export const STREAM_NO_FILTER: string = translationKey(
  "Write the filter, in the Cloud Logging query language.",
);
export const STREAM_FILTER_TOO_LONG: string = translationKey(
  "A filter is at most {{count}} characters.",
);
export const STREAM_NOT_HTTPS_FOR_PUBSUB: string = translationKey(
  "Pub/Sub pushes to https:// addresses only, and this OneUptime is not served over HTTPS. Serve it over HTTPS, with a certificate Google trusts, to stream.",
);

/*
 * What stops a command being written from the choices - or null when one
 * can be.
 */
export function getGcpCloudStreamProblem(data: {
  hostProjectId: string;
  projectIds: Array<string>;
  logs: GcpCloudStreamLogs;
  customFilter: string;
  endpoint: string;
}): CloudStreamProblem | null {
  if (!canPubSubPushTo(data.endpoint)) {
    return { text: STREAM_NOT_HTTPS_FOR_PUBSUB, values: {} };
  }

  if (!isGcpProjectId(data.hostProjectId.trim().toLowerCase())) {
    return { text: STREAM_NO_HOST_PROJECT, values: {} };
  }

  if (data.projectIds.length === 0) {
    return { text: STREAM_NO_PROJECT, values: {} };
  }

  if (data.projectIds.length > GCP_CLOUD_STREAM_MAX_PROJECTS) {
    return {
      text: STREAM_TOO_MANY_PROJECTS,
      values: { count: String(GCP_CLOUD_STREAM_MAX_PROJECTS) },
    };
  }

  for (const projectId of data.projectIds) {
    if (!isGcpProjectId(projectId)) {
      return { text: STREAM_NOT_A_PROJECT, values: {} };
    }
  }

  if (data.logs === GcpCloudStreamLogs.Custom) {
    const filter: string = data.customFilter.trim();

    if (!filter) {
      return { text: STREAM_NO_FILTER, values: {} };
    }

    if (filter.length > GCP_CLOUD_STREAM_MAX_FILTER_LENGTH) {
      return {
        text: STREAM_FILTER_TOO_LONG,
        values: { count: String(GCP_CLOUD_STREAM_MAX_FILTER_LENGTH) },
      };
    }
  }

  return null;
}

// Project IDs typed one a line or separated by commas, lower case, each once.
export function readGcpCloudStreamProjects(text: string): Array<string> {
  const projects: Array<string> = [];

  for (const line of text.split("\n")) {
    for (const piece of line.split(",")) {
      const value: string = piece.trim().toLowerCase();

      if (value && !projects.includes(value)) {
        projects.push(value);
      }
    }
  }

  return projects;
}

/*
 * The one command, for Google Cloud Shell. A key of null leaves
 * <YOUR_STREAM_KEY> for the person to fill in.
 */
export function getGcpCloudStreamCommand(data: {
  connectionId: string;
  // The project of the connection's own service account: the topic's home.
  hostProjectId: string;
  // The projects whose logs to stream.
  projectIds: Array<string>;
  endpoint: string;
  filter: string;
  streamKey: string | null;
}): string {
  const names: GcpCloudStreamNames = getGcpCloudStreamNames(data.connectionId);
  const host: string = data.hostProjectId.trim().toLowerCase();
  const pusher: string =
    getCloudStreamPushServiceAccountEmail({
      connectionId: data.connectionId,
      projectId: host,
    }) || "";
  const sources: string = data.projectIds
    .filter((projectId: string): boolean => {
      return isGcpProjectId(projectId);
    })
    .slice(0, GCP_CLOUD_STREAM_MAX_PROJECTS)
    .map(quoteForShell)
    .join(" ");
  const stop: (what: string) => string = (what: string): string => {
    return `|| { echo ${quoteForShell(what)}; return 1; }`;
  };

  return [
    "oneuptime_stream() {",
    `  local PROJECT=${quoteForShell(host)}`,
    `  local TOPIC=${names.topic}`,
    `  local SUBSCRIPTION=${names.subscription}`,
    `  local SINK=${names.sink}`,
    `  local PUSHER=${quoteForShell(pusher)}`,
    `  local STREAM_KEY=${quoteForShell(data.streamKey || "<YOUR_STREAM_KEY>")}`,
    `  local ENDPOINT=${quoteForShell(data.endpoint)}`,
    `  local FILTER=${quoteForShell(data.filter)}`,
    "  local NUMBER SOURCE WRITER OUT",
    `  gcloud services enable ${GCP_CLOUD_STREAM_SERVICES.join(" ")} --project "$PROJECT" ${stop("Pub/Sub and Cloud Logging could not be turned on in the project.")}`,
    // The push service account: it signs Pub/Sub's pushes, and holds no role.
    `  gcloud iam service-accounts describe "$PUSHER" --project "$PROJECT" > /dev/null 2>&1 || gcloud iam service-accounts create ${names.pushServiceAccountId} --project "$PROJECT" --display-name "OneUptime stream push" --description "Signs Pub/Sub's pushes to OneUptime. It holds no role." > /dev/null ${stop("The push service account could not be made.")}`,
    `  NUMBER=$(gcloud projects describe "$PROJECT" --format "value(projectNumber)") ${stop("The project could not be read.")}`,
    `  gcloud iam service-accounts add-iam-policy-binding "$PUSHER" --project "$PROJECT" --member "serviceAccount:service-$NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" --role ${GCP_PUSH_TOKEN_ROLE} > /dev/null ${stop("Pub/Sub could not be let sign tokens for the push service account.")}`,
    // The topic, and its push subscription: made the first time, updated after.
    `  gcloud pubsub topics describe "$TOPIC" --project "$PROJECT" > /dev/null 2>&1 || gcloud pubsub topics create "$TOPIC" --project "$PROJECT" > /dev/null ${stop("The topic could not be made.")}`,
    `  if gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project "$PROJECT" > /dev/null 2>&1; then`,
    `    gcloud pubsub subscriptions update "$SUBSCRIPTION" --project "$PROJECT" --push-endpoint "$ENDPOINT" --push-auth-service-account "$PUSHER" --push-auth-token-audience "$STREAM_KEY" > /dev/null ${stop("The push subscription could not be updated.")}`,
    "  else",
    `    gcloud pubsub subscriptions create "$SUBSCRIPTION" --project "$PROJECT" --topic "$TOPIC" --push-endpoint "$ENDPOINT" --push-auth-service-account "$PUSHER" --push-auth-token-audience "$STREAM_KEY" --ack-deadline ${CLOUD_STREAM_PUBSUB_ACK_DEADLINE_SECONDS} --message-retention-duration ${CLOUD_STREAM_PUBSUB_RETENTION_SECONDS}s --expiration-period never --min-retry-delay ${CLOUD_STREAM_PUBSUB_MIN_RETRY_SECONDS}s --max-retry-delay ${CLOUD_STREAM_PUBSUB_MAX_RETRY_SECONDS}s > /dev/null ${stop("The push subscription could not be made.")}`,
    "  fi",
    // A sink in each project, whose writer may publish to the topic alone.
    `  for SOURCE in ${sources}; do`,
    // Google's own words are said only when it refuses: its reminder to grant the writer is done below.
    `    if gcloud logging sinks describe "$SINK" --project "$SOURCE" > /dev/null 2>&1; then`,
    `      OUT=$(gcloud logging sinks update "$SINK" "pubsub.googleapis.com/projects/$PROJECT/topics/$TOPIC" --project "$SOURCE" --log-filter "$FILTER" 2>&1) || { echo "$OUT"; echo "$SOURCE: the log sink could not be updated."; return 1; }`,
    "    else",
    `      OUT=$(gcloud logging sinks create "$SINK" "pubsub.googleapis.com/projects/$PROJECT/topics/$TOPIC" --project "$SOURCE" --log-filter "$FILTER" 2>&1) || { echo "$OUT"; echo "$SOURCE: the log sink could not be made."; return 1; }`,
    "    fi",
    `    WRITER=$(gcloud logging sinks describe "$SINK" --project "$SOURCE" --format "value(writerIdentity)") || { echo "$SOURCE: the log sink could not be read."; return 1; }`,
    `    gcloud pubsub topics add-iam-policy-binding "$TOPIC" --project "$PROJECT" --member "$WRITER" --role ${GCP_SINK_WRITER_ROLE} > /dev/null || { echo "$SOURCE: the log sink could not be let publish to the topic."; return 1; }`,
    `    echo "$SOURCE: streaming."`,
    "  done",
    `  echo ${quoteForShell(GCP_CLOUD_STREAM_COMMAND_DONE)}`,
    "}",
    `oneuptime_stream || echo ${quoteForShell(GCP_CLOUD_STREAM_COMMAND_STOPPED)}`,
  ].join("\n");
}

/*
 * Stopping for good: each project's sink, the subscription, the topic and
 * the push service account deleted. What was streamed stays in OneUptime.
 */
export function getGcpCloudStreamDeleteCommand(data: {
  connectionId: string;
  hostProjectId: string;
  projectIds: Array<string>;
}): string {
  const names: GcpCloudStreamNames = getGcpCloudStreamNames(data.connectionId);
  const host: string = data.hostProjectId.trim().toLowerCase();
  const pusher: string =
    getCloudStreamPushServiceAccountEmail({
      connectionId: data.connectionId,
      projectId: host,
    }) || "";
  const sources: Array<string> = data.projectIds
    .map((projectId: string): string => {
      return projectId.trim().toLowerCase();
    })
    .filter(
      (projectId: string, index: number, all: Array<string>): boolean => {
        return isGcpProjectId(projectId) && all.indexOf(projectId) === index;
      },
    );

  return [
    ...(sources.length > 0
      ? [
          `for SOURCE in ${sources.map(quoteForShell).join(" ")}; do`,
          `  gcloud logging sinks delete ${names.sink} --project "$SOURCE" --quiet`,
          "done",
        ]
      : []),
    `gcloud pubsub subscriptions delete ${names.subscription} --project ${quoteForShell(host)} --quiet`,
    `gcloud pubsub topics delete ${names.topic} --project ${quoteForShell(host)} --quiet`,
    `gcloud iam service-accounts delete ${quoteForShell(pusher)} --project ${quoteForShell(host)} --quiet`,
  ].join("\n");
}
