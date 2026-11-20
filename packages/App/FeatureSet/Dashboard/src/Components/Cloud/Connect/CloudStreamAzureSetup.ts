import { CloudStreamProblem } from "Common/Types/CloudConnection/CloudStream";
import {
  AzureCloudStreamNames,
  STREAM_NOT_A_SUBSCRIPTION,
  STREAM_NO_SUBSCRIPTION,
  STREAM_TOO_MANY_SUBSCRIPTIONS,
  getAzureCloudStreamCommand,
  getAzureCloudStreamDeleteCommand,
  getAzureCloudStreamEntraCommand,
  getAzureCloudStreamNames,
  getAzureCloudStreamProblem,
  readAzureCloudStreamSubscriptions,
} from "Common/Types/CloudConnection/CloudStreamAzure";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  CloudStreamWhat,
  streamsLogs,
  streamsMetrics,
} from "./CloudStreamSetup";
import { getCloudStreamReadAccounts } from "./CloudStreamWords";

/*
 * What the Azure streaming dialog's choices make: the one command for
 * Azure Cloud Shell (CloudStreamAzure), the subscriptions it sets up -
 * the first holds the event hubs, and is the one OneUptime reads them in -
 * and what is wrong with the choices when a command cannot be written
 * from them. React-free: App's tests and the dialog read it alike.
 *
 * Azure Monitor has no way to push to OneUptime that needs nothing of
 * yours to run: a diagnostic setting sends to an event hub, a storage
 * account or a Log Analytics workspace. So the command makes the event
 * hubs - one Event Hubs namespace in each region, in a resource group of
 * its own - points each resource's diagnostic setting at its region's,
 * and lets the connection's app read them, and OneUptime reads them every
 * minute. The dialog asks what to stream, as AWS's does; the subscriptions
 * start as the ones the connection reads, folded under More fields.
 */

// The docs page that sets an Azure stream up step by step.
export const AZURE_STREAM_DOCS_PATH: string =
  "/docs/telemetry/cloud-streaming-azure";

export interface AzureStreamChoices {
  what: CloudStreamWhat;
  // Subscription IDs, one a line or separated by commas.
  subscriptionsText: string;
  /*
   * For Security Events (#10111): each subscription's Activity Log, which
   * the command sets up too, and Microsoft Entra ID's logs, a command of
   * their own for a Security Administrator of the tenant.
   */
  activityLog: boolean;
  entraId: boolean;
}

/*
 * The audit logs the dialog offers beside what it streams, each a switch:
 * what it sends, in a line.
 */
export const AZURE_STREAM_AUDIT_LOG_OPTIONS: ReadonlyArray<{
  key: "activityLog" | "entraId";
  title: string;
  description: string;
}> = [
  {
    key: "activityLog",
    title: translationKey("Each subscription's Activity Log"),
    description: translationKey(
      "Changes made, Defender for Cloud alerts and what Azure Policy refused, which Security Events reads.",
    ),
  },
  {
    key: "entraId",
    title: translationKey("Microsoft Entra ID's sign-in and audit logs"),
    description: translationKey(
      "Sign-ins, directory changes and risks, set up by a second command for a Security Administrator of your tenant.",
    ),
  },
];

export const AZURE_STREAM_WHAT_OPTIONS: ReadonlyArray<{
  key: CloudStreamWhat;
  label: string;
  description: string;
}> = [
  {
    key: CloudStreamWhat.Metrics,
    label: translationKey("Metrics"),
    /*
     * Not every key metric: a diagnostic setting cannot send some of them,
     * and a Service Bus or Event Hubs namespace's stay with the reads
     * (isAzureStreamedKeyMetric).
     */
    description: translationKey(
      "The key metrics Azure can stream, a minute at a time: the connection keeps reading the rest.",
    ),
  },
  {
    key: CloudStreamWhat.MetricsAndLogs,
    label: translationKey("Metrics and logs"),
    description: translationKey(
      "And every resource's own logs: each log category Azure keeps for it.",
    ),
  },
  {
    key: CloudStreamWhat.Logs,
    label: translationKey("Logs"),
    description: translationKey(
      "Resource logs alone: the connection keeps reading metrics on its schedule.",
    ),
  },
];

/*
 * The subscriptions a connection streams from unless told otherwise: the
 * ones it is set to read, else the ones its last read reached.
 */
export function getAzureStreamDefaultSubscriptions(connection: {
  config?: JSONObject | undefined;
  lastPullResult?: JSONObject | undefined;
}): Array<string> {
  const configured: unknown = connection.config?.["subscriptionIds"];
  const named: Array<string> =
    typeof configured === "string"
      ? readAzureCloudStreamSubscriptions(configured)
      : [];

  if (named.length > 0) {
    return named;
  }

  return getCloudStreamReadAccounts(connection.lastPullResult).filter(
    (account: string): boolean => {
      return ObjectID.isValidUUID(account);
    },
  );
}

/*
 * The subscriptions the dialog starts on. While reading is on, the one
 * whose event hubs are read comes first, so the command makes them where
 * OneUptime reads them - however the next read happens to list the
 * subscriptions - then the ones the connection reads.
 */
export function getAzureStreamStartSubscriptions(data: {
  // The subscription whose event hubs are read, while reading is on.
  readSubscriptionId: string | null;
  config?: JSONObject | undefined;
  lastPullResult?: JSONObject | undefined;
}): Array<string> {
  const subscriptions: Array<string> = getAzureStreamDefaultSubscriptions(data);
  const read: string = (data.readSubscriptionId || "").trim().toLowerCase();

  if (!ObjectID.isValidUUID(read)) {
    return subscriptions;
  }

  return [
    read,
    ...subscriptions.filter((subscription: string): boolean => {
      return subscription !== read;
    }),
  ];
}

/*
 * Metrics, and no audit log: what most people open the dialog for. The
 * Activity Log and Entra ID's logs are a switch away, each said in a line.
 */
export function getDefaultAzureStreamChoices(
  subscriptions: Array<string>,
): AzureStreamChoices {
  return {
    what: CloudStreamWhat.Metrics,
    subscriptionsText: subscriptions.join(", "),
    activityLog: false,
    entraId: false,
  };
}

export interface AzureStreamSetup {
  subscriptions: Array<string>;
  // Where the command makes the event hubs, and OneUptime reads them.
  hostSubscriptionId: string;
  names: AzureCloudStreamNames;
  command: string;
  /*
   * Microsoft Entra ID's logs' own command, for a Security Administrator
   * of the tenant - or "" while they are not chosen, or a command cannot
   * be written.
   */
  entraCommand: string;
  // What stops a command being written, or null.
  problem: CloudStreamProblem | null;
}

export function getAzureStreamSetup(data: {
  choices: AzureStreamChoices;
  connectionId: string;
  // The connection's app registration (its client ID).
  appId: string;
}): AzureStreamSetup {
  const subscriptions: Array<string> = readAzureCloudStreamSubscriptions(
    data.choices.subscriptionsText,
  );
  const problem: CloudStreamProblem | null = getAzureCloudStreamProblem({
    appId: data.appId,
    subscriptionIds: subscriptions,
  });
  const hostSubscriptionId: string = problem ? "" : subscriptions[0] || "";

  return {
    subscriptions,
    hostSubscriptionId,
    names: getAzureCloudStreamNames(data.connectionId),
    command: problem
      ? ""
      : getAzureCloudStreamCommand({
          connectionId: data.connectionId,
          appId: data.appId.trim(),
          subscriptionIds: subscriptions,
          metrics: streamsMetrics(data.choices.what),
          logs: streamsLogs(data.choices.what),
          activityLog: data.choices.activityLog,
        }),
    entraCommand:
      problem || !data.choices.entraId
        ? ""
        : getAzureCloudStreamEntraCommand({
            connectionId: data.connectionId,
            hostSubscriptionId,
          }),
    problem,
  };
}

/*
 * Whether what stops the command is the subscriptions - none listed, one
 * that is no ID, more than one command sets up - which only the person in
 * the dialog can put right (an app the connection does not name is its
 * form's to fix).
 */
export function isAzureStreamSubscriptionsProblem(
  problem: CloudStreamProblem | null,
): boolean {
  return (
    problem !== null &&
    [
      STREAM_NO_SUBSCRIPTION,
      STREAM_NOT_A_SUBSCRIPTION,
      STREAM_TOO_MANY_SUBSCRIPTIONS,
    ].includes(problem.text)
  );
}

/*
 * Stop streaming's command for an Azure connection: each resource's
 * diagnostic setting deleted, in the subscription its event hubs are read
 * in and the ones it reads, then the resource group wherever it is.
 */
export function getAzureStreamStopCommand(data: {
  connectionId: string;
  hostSubscriptionId: string | null;
  config?: JSONObject | undefined;
  lastPullResult?: JSONObject | undefined;
}): string {
  return getAzureCloudStreamDeleteCommand({
    connectionId: data.connectionId,
    subscriptionIds: [
      ...(data.hostSubscriptionId ? [data.hostSubscriptionId] : []),
      ...getAzureStreamDefaultSubscriptions(data),
    ],
  });
}
