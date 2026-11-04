import {
  canFirehoseDeliverTo,
  getCloudStreamEndpoints,
} from "Common/Types/CloudConnection/CloudStream";
import {
  CloudStreamLogGroup,
  CloudStreamLogsMode,
  CloudStreamMetricsMode,
  CloudStreamProblem,
  CloudStreamTemplateOptions,
  getCloudStreamOptionsProblem,
  parseCloudStreamLogGroups,
  splitCloudStreamList,
} from "Common/Types/CloudConnection/CloudStreamTemplate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the streaming dialog's choices make: the CloudFormation template's
 * options, the Regions the command deploys in, and what is wrong with the
 * choices when a command cannot be written from them. React-free: App's
 * tests and the dialog read it alike.
 *
 * Most people want one thing - every key metric of every resource, once a
 * minute - so the dialog asks one question, what to stream, and starts on
 * metrics. Logs are a choice away: the log groups named (a name is in the
 * Region chosen, an ARN in its own), or every log group of the account.
 * Every metric rather than the key ones, and the Regions, are folded under
 * More fields: the Regions start as the ones the connection found
 * resources in.
 */

export enum CloudStreamWhat {
  Metrics = "metrics",
  MetricsAndLogs = "metrics-and-logs",
  Logs = "logs",
}

export interface CloudStreamChoices {
  what: CloudStreamWhat;
  // The log groups named, one a line.
  logGroupsText: string;
  // The Region a log group named by its name is in.
  logGroupsRegion: string;
  everyLogGroup: boolean;
  everyMetric: boolean;
  // Where to stream from, separated by commas.
  regionsText: string;
}

export const CLOUD_STREAM_FALLBACK_REGION: string = "us-east-1";

// The docs page that sets streaming up step by step.
export const CLOUD_STREAM_DOCS_PATH: string = "/docs/telemetry/cloud-streaming";

export const CLOUD_STREAM_WHAT_OPTIONS: ReadonlyArray<{
  key: CloudStreamWhat;
  label: string;
  description: string;
}> = [
  {
    key: CloudStreamWhat.Metrics,
    label: translationKey("Metrics"),
    description: translationKey(
      "Every key metric of every resource, once a minute: what OneUptime charts and judges each resource by.",
    ),
  },
  {
    key: CloudStreamWhat.MetricsAndLogs,
    label: translationKey("Metrics and logs"),
    description: translationKey(
      "And CloudWatch Logs: the log groups you name, or every one.",
    ),
  },
  {
    key: CloudStreamWhat.Logs,
    label: translationKey("Logs"),
    description: translationKey(
      "CloudWatch Logs alone: the connection keeps reading metrics on its schedule.",
    ),
  },
];

export const NOT_HTTPS_PROBLEM: string = translationKey(
  "Firehose delivers to https:// addresses only, and this OneUptime is not served over HTTPS. Serve it over HTTPS, with a certificate AWS trusts, to stream.",
);

export function getDefaultCloudStreamChoices(
  defaultRegions: Array<string>,
): CloudStreamChoices {
  return {
    what: CloudStreamWhat.Metrics,
    logGroupsText: "",
    logGroupsRegion: defaultRegions[0] || CLOUD_STREAM_FALLBACK_REGION,
    everyLogGroup: false,
    everyMetric: false,
    regionsText: defaultRegions.join(", "),
  };
}

export function streamsMetrics(what: CloudStreamWhat): boolean {
  return what !== CloudStreamWhat.Logs;
}

export function streamsLogs(what: CloudStreamWhat): boolean {
  return what !== CloudStreamWhat.Metrics;
}

export interface CloudStreamSetup {
  options: CloudStreamTemplateOptions;
  // Where the command deploys, as the person listed them.
  regions: Array<string>;
  logGroups: Array<CloudStreamLogGroup>;
  metricsUrl: string;
  logsUrl: string;
  // What stops a command being written, or null.
  problem: CloudStreamProblem | null;
}

export function getCloudStreamSetup(data: {
  choices: CloudStreamChoices;
  connectionId: string;
  oneuptimeUrl: string;
}): CloudStreamSetup {
  const endpoints: { metricsUrl: string; logsUrl: string } =
    getCloudStreamEndpoints(data.oneuptimeUrl);
  const regions: Array<string> = splitCloudStreamList(
    data.choices.regionsText,
  ).map((region: string): string => {
    return region.toLowerCase();
  });
  const metrics: CloudStreamMetricsMode = streamsMetrics(data.choices.what)
    ? data.choices.everyMetric
      ? CloudStreamMetricsMode.All
      : CloudStreamMetricsMode.Key
    : CloudStreamMetricsMode.Off;
  const logs: CloudStreamLogsMode = streamsLogs(data.choices.what)
    ? data.choices.everyLogGroup
      ? CloudStreamLogsMode.All
      : CloudStreamLogsMode.Groups
    : CloudStreamLogsMode.Off;
  const logGroups: Array<CloudStreamLogGroup> =
    logs === CloudStreamLogsMode.Groups
      ? parseCloudStreamLogGroups(
          data.choices.logGroupsText,
          data.choices.logGroupsRegion,
        )
      : [];

  const problem: CloudStreamProblem | null = canFirehoseDeliverTo(
    endpoints.metricsUrl,
  )
    ? getCloudStreamOptionsProblem({ metrics, logs, logGroups, regions })
    : { text: NOT_HTTPS_PROBLEM, values: {} };

  return {
    options: {
      connectionId: data.connectionId,
      metricsUrl: endpoints.metricsUrl,
      logsUrl: endpoints.logsUrl,
      metrics,
      logs,
      logGroups,
    },
    regions,
    logGroups,
    metricsUrl: endpoints.metricsUrl,
    logsUrl: endpoints.logsUrl,
    problem,
  };
}
