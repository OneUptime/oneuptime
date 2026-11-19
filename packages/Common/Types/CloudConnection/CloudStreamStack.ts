import {
  AWS_STREAM_TEMPLATE_UNVERSIONED,
  AWS_STREAM_TEMPLATE_VERSION,
  AwsKeyMetric,
  countAwsKeyMetricsAddedSince,
  isAwsKeyMetricInTemplate,
  isAwsKeyMetricStreamable,
} from "../Cloud/CloudKeyMetrics";
import {
  CLOUD_STREAM_ACTIVE_WINDOW_MS,
  CloudStreamMetricSource,
  CloudStreamSummary,
  readTemplateVersion,
} from "./CloudStream";

/*
 * WHAT AN AWS STREAM'S STACK CARRIES, AND WHAT THE READS LEAVE TO IT.
 *
 * A stream's CloudFormation stack is made once, from the template of its
 * day (CloudStreamTemplate), and its metric stream's key-metric filters
 * stay as they were until the command is run again. So each template says
 * what it is, with every delivery: its metrics Firehose stream sends two
 * common attributes, which Firehose puts in the X-Amz-Firehose-Common-
 * Attributes header of each request -
 *
 *   oneuptime-stream-template   the template's version
 *                               (AWS_STREAM_TEMPLATE_VERSION);
 *   oneuptime-stream-metrics    "key" or "all": the key metrics, or every
 *                               metric CloudWatch has.
 *
 * A delivery without them is from a stack made before templates said so,
 * or one set up another way, with Terraform or the console: it is held to
 * the key metrics every stack has carried since streams began
 * (AWS_STREAM_TEMPLATE_UNVERSIONED), never more, so nothing it may not
 * carry is left to it.
 *
 * What a stack carries decides, per key metric, who writes it:
 *
 *   - the ingest (CloudWatchMetricStream) writes a key metric its stack
 *     carries, in the read's shape, and leaves one it does not carry to
 *     the read: a stream of every metric that has no version (made before)
 *     delivers the newer ones, which the read writes;
 *   - the reads (AwsCloudConnector, CloudStreamedMetrics) leave to the
 *     stream every key metric its stack carries, of a namespace it
 *     delivered lately (CLOUD_STREAM_ACTIVE_WINDOW_MS): they do not write
 *     it, and they read it from CloudWatch only where a resource's health
 *     or headline is judged from it - so an account that streams stops
 *     paying CloudWatch to read what its stream sends, and nothing is
 *     written twice. A metric a stack does not carry is read and written
 *     as if the account did not stream, so nothing goes missing.
 *
 * React-free and Node-free: the server, the ingest and the dashboard read
 * it alike.
 */

// The common attributes the template's metrics Firehose stream sends.
export const CLOUD_STREAM_TEMPLATE_ATTRIBUTE: string =
  "oneuptime-stream-template";
export const CLOUD_STREAM_METRICS_ATTRIBUTE: string =
  "oneuptime-stream-metrics";

// The value of oneuptime-stream-metrics a stream of every metric sends.
export const CLOUD_STREAM_EVERY_METRIC_VALUE: string = "all";

// The longest header read: Firehose sends at most 50 attributes, each short.
export const CLOUD_STREAM_MAX_COMMON_ATTRIBUTES_LENGTH: number = 64 * 1024;

export interface AwsStreamStack {
  // The version of the template it was made from.
  templateVersion: number;
  // It streams every metric CloudWatch has, not only the key ones.
  everyMetric: boolean;
}

// A stack that says nothing of itself: made before, or set up another way.
export const UNVERSIONED_AWS_STREAM_STACK: Readonly<AwsStreamStack> = {
  templateVersion: AWS_STREAM_TEMPLATE_UNVERSIONED,
  everyMetric: false,
};

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/*
 * The stack a delivery came from, by its X-Amz-Firehose-Common-Attributes
 * header (a string, or the first of several): the unversioned stack for a
 * header that is missing, is not JSON or says no version. Never throws.
 */
export function readAwsStreamStack(header: unknown): AwsStreamStack {
  const text: string = Array.isArray(header)
    ? String(header[0] ?? "")
    : typeof header === "string"
      ? header
      : "";

  if (!text.trim() || text.length > CLOUD_STREAM_MAX_COMMON_ATTRIBUTES_LENGTH) {
    return { ...UNVERSIONED_AWS_STREAM_STACK };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...UNVERSIONED_AWS_STREAM_STACK };
  }

  const attributes: Record<string, unknown> = readObject(
    readObject(parsed)["commonAttributes"],
  );
  const templateVersion: number | undefined = readTemplateVersion(
    attributes[CLOUD_STREAM_TEMPLATE_ATTRIBUTE],
  );

  if (templateVersion === undefined) {
    return { ...UNVERSIONED_AWS_STREAM_STACK };
  }

  const metrics: unknown = attributes[CLOUD_STREAM_METRICS_ATTRIBUTE];

  return {
    templateVersion,
    everyMetric:
      typeof metrics === "string" &&
      metrics.trim().toLowerCase() === CLOUD_STREAM_EVERY_METRIC_VALUE,
  };
}

// What a summary's source says of its stack: the unversioned one when nothing.
export function getAwsStreamStackOfSource(
  source: Pick<CloudStreamMetricSource, "templateVersion" | "everyMetric">,
): AwsStreamStack {
  const templateVersion: number | undefined = readTemplateVersion(
    source.templateVersion,
  );

  return templateVersion === undefined
    ? { ...UNVERSIONED_AWS_STREAM_STACK }
    : { templateVersion, everyMetric: source.everyMetric === true };
}

/*
 * Whether a stack streams the key metric: one of every metric streams each
 * a stream can, one of the key metrics those of its template's filters.
 * None streams a daily or hourly one (AwsKeyMetric.streamedSince null).
 */
export function doesAwsStreamStackCarry(
  stack: AwsStreamStack,
  metric: AwsKeyMetric,
): boolean {
  if (!isAwsKeyMetricStreamable(metric)) {
    return false;
  }

  return (
    stack.everyMetric || isAwsKeyMetricInTemplate(metric, stack.templateVersion)
  );
}

// Whether a stack is of an older template than the one written today.
export function isAwsStreamStackOlder(stack: AwsStreamStack): boolean {
  return (
    !stack.everyMetric && stack.templateVersion < AWS_STREAM_TEMPLATE_VERSION
  );
}

// An AWS account and Region a stream delivered from lately, and its stack.
export interface AwsStreamedSource {
  accountId: string;
  region: string;
  // The namespaces it delivered lately, in lower case.
  namespaces: ReadonlySet<string>;
  stack: AwsStreamStack;
}

// By "<account>|<region>", in lower case.
export type AwsStreamCoverage = ReadonlyMap<string, AwsStreamedSource>;

export const NO_AWS_STREAM_COVERAGE: AwsStreamCoverage = new Map<
  string,
  AwsStreamedSource
>();

function placeKey(accountId: string, region: string): string {
  return `${accountId.trim().toLowerCase()}|${region.trim().toLowerCase()}`;
}

/*
 * The accounts and Regions a connection's streams delivered from in the
 * last CLOUD_STREAM_ACTIVE_WINDOW_MS, each with the namespaces it
 * delivered and its stack: what the reads leave to the streams. A stream
 * that goes quiet longer is read again.
 */
export function getAwsStreamCoverage(data: {
  summary: CloudStreamSummary;
  now: Date;
}): AwsStreamCoverage {
  const coverage: Map<string, AwsStreamedSource> = new Map<
    string,
    AwsStreamedSource
  >();
  const since: number = data.now.getTime() - CLOUD_STREAM_ACTIVE_WINDOW_MS;

  for (const source of data.summary.metricSources) {
    if (!(Date.parse(source.lastAt) >= since)) {
      continue;
    }

    coverage.set(placeKey(source.accountId, source.region), {
      accountId: source.accountId,
      region: source.region,
      namespaces: new Set<string>(
        source.namespaces.map((namespace: string): string => {
          return namespace.trim().toLowerCase();
        }),
      ),
      stack: getAwsStreamStackOfSource(source),
    });
  }

  return coverage;
}

/*
 * Whether a stream writes this key metric of this account, Region and
 * namespace in place of the read: one delivered the namespace lately, and
 * its stack carries the metric.
 */
export function isAwsKeyMetricLeftToStream(data: {
  coverage: AwsStreamCoverage;
  accountId: string;
  region: string;
  namespace: string;
  metric: AwsKeyMetric;
}): boolean {
  const source: AwsStreamedSource | undefined = data.coverage.get(
    placeKey(data.accountId, data.region),
  );

  return Boolean(
    source &&
      source.namespaces.has(data.namespace.trim().toLowerCase()) &&
      doesAwsStreamStackCarry(source.stack, data.metric),
  );
}

/*
 * The places that stream lately from a stack of an older template, the
 * newest first, each with how many key metrics running the command again
 * would stream there in place of the read: what the connections list and
 * the streaming dialog say should be updated.
 */
export function getOlderAwsStreamStacks(data: {
  summary: CloudStreamSummary;
  now: Date;
}): Array<{ accountId: string; region: string; metricsToStream: number }> {
  const older: Array<{
    accountId: string;
    region: string;
    metricsToStream: number;
  }> = [];

  for (const source of getAwsStreamCoverage(data).values()) {
    if (!isAwsStreamStackOlder(source.stack)) {
      continue;
    }

    older.push({
      accountId: source.accountId,
      region: source.region,
      metricsToStream: countAwsKeyMetricsAddedSince(
        source.stack.templateVersion,
      ),
    });
  }

  return older;
}
