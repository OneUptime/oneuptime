import {
  CloudStreamProblem,
  getCloudStreamPubSubEndpoint,
  getCloudStreamPushServiceAccountEmail,
  isGcpProjectId,
} from "Common/Types/CloudConnection/CloudStream";
import {
  GcpCloudStreamLogs,
  GcpCloudStreamNames,
  getGcpCloudStreamCommand,
  getGcpCloudStreamDeleteCommand,
  getGcpCloudStreamFilter,
  getGcpCloudStreamNames,
  getGcpCloudStreamProblem,
  readGcpCloudStreamProjects,
} from "Common/Types/CloudConnection/CloudStreamGcp";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getCloudStreamReadAccounts } from "./CloudStreamWords";

/*
 * What the Google Cloud streaming dialog's choices make: the push
 * endpoint, the sinks' filter, the projects whose logs to stream, the
 * project the topic goes in - the one the connection's own service account
 * is from, where the push service account is made - and what is wrong with
 * the choices when a command cannot be written from them. React-free:
 * App's tests and the dialog read it alike.
 *
 * Cloud Monitoring has no export that pushes metrics, so a Google Cloud
 * stream carries logs: Cloud Logging routes them through a sink to a
 * Pub/Sub topic, whose push subscription delivers each entry. Most people
 * want what went wrong, not every request, so the dialog starts on
 * warnings and errors; every log but the Data Access audit logs, or a
 * filter of one's own, is a choice away. The projects start as the ones
 * the connection reads, folded under More fields.
 */

// The docs page that sets a Google Cloud stream up step by step.
export const GCP_STREAM_DOCS_PATH: string =
  "/docs/telemetry/cloud-streaming-google-cloud";

export interface GcpStreamChoices {
  logs: GcpCloudStreamLogs;
  // A Cloud Logging query, for Custom.
  customFilter: string;
  // Project IDs, one a line or separated by commas.
  projectsText: string;
}

export const GCP_STREAM_LOGS_OPTIONS: ReadonlyArray<{
  key: GcpCloudStreamLogs;
  label: string;
  description: string;
}> = [
  {
    key: GcpCloudStreamLogs.WarningsAndErrors,
    label: translationKey("Warnings and errors"),
    description: translationKey(
      "Every entry of severity WARNING or above: what went wrong, not every request.",
    ),
  },
  {
    key: GcpCloudStreamLogs.Every,
    label: translationKey("Every log"),
    description: translationKey(
      "Every entry the projects write but the Data Access audit logs, which record every read. A busy project's logs can cost far more.",
    ),
  },
  {
    key: GcpCloudStreamLogs.Custom,
    label: translationKey("A filter of your own"),
    description: translationKey("The entries a Cloud Logging query matches."),
  },
];

/*
 * The project the topic and the push service account go in: the project of
 * the connection's own service account, as OneUptime wrote it on save. The
 * server signs a key's pushes off against a service account of this
 * project, so the command must make it here.
 */
export function getGcpStreamHostProject(connection: {
  config?: JSONObject | undefined;
}): string {
  const project: unknown = connection.config?.["keyProjectId"];

  return typeof project === "string" ? project.trim().toLowerCase() : "";
}

/*
 * The projects a connection streams the logs of unless told otherwise: the
 * ones it is set to read, else the ones its last read reached, else its
 * service account's own.
 */
export function getGcpStreamDefaultProjects(connection: {
  config?: JSONObject | undefined;
  lastPullResult?: JSONObject | undefined;
}): Array<string> {
  const configured: unknown = connection.config?.["projectIds"];
  const named: Array<string> =
    typeof configured === "string"
      ? readGcpCloudStreamProjects(configured)
      : [];

  if (named.length > 0) {
    return named;
  }

  const read: Array<string> = getCloudStreamReadAccounts(
    connection.lastPullResult,
  ).filter((account: string): boolean => {
    return isGcpProjectId(account);
  });

  if (read.length > 0) {
    return read;
  }

  const host: string = getGcpStreamHostProject(connection);

  return isGcpProjectId(host) ? [host] : [];
}

export function getDefaultGcpStreamChoices(
  projects: Array<string>,
): GcpStreamChoices {
  return {
    logs: GcpCloudStreamLogs.WarningsAndErrors,
    customFilter: "",
    projectsText: projects.join(", "),
  };
}

export interface GcpStreamSetup {
  projects: Array<string>;
  hostProjectId: string;
  endpoint: string;
  // The sinks' filter, in the Cloud Logging query language.
  filter: string;
  names: GcpCloudStreamNames;
  // What Pub/Sub signs its pushes as: empty without a project.
  pushServiceAccount: string;
  // What stops a command being written, or null.
  problem: CloudStreamProblem | null;
}

export function getGcpStreamSetup(data: {
  choices: GcpStreamChoices;
  connectionId: string;
  hostProjectId: string;
  oneuptimeUrl: string;
}): GcpStreamSetup {
  const projects: Array<string> = readGcpCloudStreamProjects(
    data.choices.projectsText,
  );
  const endpoint: string = getCloudStreamPubSubEndpoint(data.oneuptimeUrl);
  const hostProjectId: string = data.hostProjectId.trim().toLowerCase();

  return {
    projects,
    hostProjectId,
    endpoint,
    filter: getGcpCloudStreamFilter({
      logs: data.choices.logs,
      customFilter: data.choices.customFilter,
    }),
    names: getGcpCloudStreamNames(data.connectionId),
    pushServiceAccount:
      getCloudStreamPushServiceAccountEmail({
        connectionId: data.connectionId,
        projectId: hostProjectId,
      }) || "",
    problem: getGcpCloudStreamProblem({
      hostProjectId,
      projectIds: projects,
      logs: data.choices.logs,
      customFilter: data.choices.customFilter,
      endpoint,
    }),
  };
}

// The command for a setup that has no problem; a key of null leaves its placeholder.
export function getGcpStreamCommand(data: {
  setup: GcpStreamSetup;
  connectionId: string;
  streamKey: string | null;
}): string {
  if (data.setup.problem) {
    return "";
  }

  return getGcpCloudStreamCommand({
    connectionId: data.connectionId,
    hostProjectId: data.setup.hostProjectId,
    projectIds: data.setup.projects,
    endpoint: data.setup.endpoint,
    filter: data.setup.filter,
    streamKey: data.streamKey,
  });
}

/*
 * Stop streaming's command for a Google Cloud connection: the sinks of the
 * projects it reads, then the subscription, the topic and the push service
 * account in its service account's project.
 */
export function getGcpStreamStopCommand(data: {
  connectionId: string;
  config?: JSONObject | undefined;
  lastPullResult?: JSONObject | undefined;
}): string {
  return getGcpCloudStreamDeleteCommand({
    connectionId: data.connectionId,
    hostProjectId: getGcpStreamHostProject(data),
    projectIds: getGcpStreamDefaultProjects(data),
  });
}
