import { isAwsRegion } from "../Cloud/AwsRegionCode";
import {
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  DAILY_PERIOD_SECONDS,
} from "../Cloud/CloudKeyMetrics";
import { AWS_LOG_GROUP_NAME_MAX_LENGTH } from "../Cloud/CloudLogGroups";
import { JSONObject } from "../JSON";
import {
  CLOUD_STREAM_BUFFER_INTERVAL_SECONDS,
  CLOUD_STREAM_BUFFER_SIZE_MIB,
  CLOUD_STREAM_FAILED_DELIVERY_DAYS,
  CLOUD_STREAM_KEY_PREFIX,
  CLOUD_STREAM_KEY_SECRET_LENGTH,
  CLOUD_STREAM_RETRY_DURATION_SECONDS,
} from "./CloudStream";

/*
 * THE CLOUDFORMATION STACK THAT STREAMS ONE AWS REGION INTO ONEUPTIME.
 *
 * One stack per connection and Region, made by one command in AWS
 * CloudShell (getAwsCloudStreamCommand), the same template in every
 * Region. It holds what a stream needs and nothing more:
 *
 *   - a CloudWatch metric stream, in OpenTelemetry 1.0, of the key metrics
 *     OneUptime charts and judges each resource by (CloudKeyMetrics) or of
 *     every metric, into a Firehose stream;
 *   - CloudWatch Logs subscription filters on the log groups named, or one
 *     account-level subscription policy for every log group, into a second
 *     Firehose stream;
 *   - the two Firehose streams, each delivering to OneUptime's endpoint
 *     (CloudStream) with the connection's stream key, GZIP, a 1 MiB / 60 s
 *     buffer and an hour of retries, encrypted at rest;
 *   - a bucket - public access blocked, encrypted, objects owned by the
 *     account, emptied after CLOUD_STREAM_FAILED_DELIVERY_DAYS - where
 *     Firehose keeps a batch it could not deliver, and a log group where
 *     it says why;
 *   - three roles, each its service's alone and each allowed one thing:
 *     the metric stream and the subscriptions may put records into their
 *     own Firehose stream, Firehose may write its bucket and its log group.
 *     Nothing in the stack can read anything else of the account, and the
 *     stack gives OneUptime no access to it: data only flows out.
 *
 * The stream key is a NoEcho parameter, never in the template. Deleting
 * the stack stops the stream; the bucket of failed deliveries is kept.
 *
 * The template is written here, so the dashboard's dialog, its download
 * and the docs show the same one, and CloudStreamTemplate.test holds it to
 * a pinned list of resources and permissions.
 */

export enum CloudStreamMetricsMode {
  // The key metrics of every namespace OneUptime reads: what most people need.
  Key = "key",
  // Every metric CloudWatch has for the Region, the account's own included.
  All = "all",
  Off = "off",
}

export enum CloudStreamLogsMode {
  Off = "off",
  // The log groups named, in one Region (logsRegion).
  Groups = "groups",
  // Every log group of the account, in every Region the stack is in.
  All = "all",
}

export const CLOUD_STREAM_METRICS_MODES: ReadonlyArray<CloudStreamMetricsMode> =
  Object.values(CloudStreamMetricsMode);
export const CLOUD_STREAM_LOGS_MODES: ReadonlyArray<CloudStreamLogsMode> =
  Object.values(CloudStreamLogsMode);

// The most log groups one stack subscribes by name.
export const CLOUD_STREAM_MAX_LOG_GROUPS: number = 50;

// The most Regions one command sets streams up in.
export const CLOUD_STREAM_MAX_REGIONS: number = 30;

/*
 * The longest template `aws cloudformation deploy` takes from a file: the
 * body CloudFormation accepts without an S3 bucket.
 */
export const CLOUDFORMATION_TEMPLATE_BODY_MAX_BYTES: number = 51_200;

export const CLOUD_STREAM_TEMPLATE_FILE: string = "oneuptime-stream.json";

export interface CloudStreamTemplateOptions {
  connectionId: string;
  metricsUrl: string;
  logsUrl: string;
  metrics: CloudStreamMetricsMode;
  logs: CloudStreamLogsMode;
  // CloudStreamLogsMode.Groups: the groups, and the Region they are in.
  logGroups?: Array<string> | undefined;
  logsRegion?: string | undefined;
}

// The first 8 hex characters of the connection: what its AWS names end in.
export function getCloudStreamSuffix(connectionId: string): string {
  let suffix: string = "";

  for (const character of connectionId.toLowerCase()) {
    if (
      (character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f")
    ) {
      suffix += character;
    }

    if (suffix.length === 8) {
      break;
    }
  }

  return suffix;
}

/*
 * What the stack and the things in it are called: one stack per
 * connection and Region, so two connections - two projects - stream the
 * same account side by side.
 */
export function getCloudStreamNames(connectionId: string): {
  stackName: string;
  metricsDeliveryStream: string;
  logsDeliveryStream: string;
  metricStream: string;
  deliveryLogGroup: string;
  subscriptionFilter: string;
  accountPolicy: string;
} {
  const suffix: string = getCloudStreamSuffix(connectionId);

  return {
    stackName: `OneUptimeStream-${suffix}`,
    metricsDeliveryStream: `OneUptime-${suffix}-metrics`,
    logsDeliveryStream: `OneUptime-${suffix}-logs`,
    metricStream: `OneUptime-${suffix}`,
    deliveryLogGroup: `/aws/kinesisfirehose/OneUptime-${suffix}`,
    subscriptionFilter: `OneUptime-${suffix}`,
    accountPolicy: `OneUptime-${suffix}`,
  };
}

/*
 * A log group's name as CloudWatch Logs takes it: 1 to 512 of letters,
 * digits, "_", "-", "/", "." and "#".
 */
export function isAwsLogGroupName(value: string): boolean {
  if (value.length === 0 || value.length > AWS_LOG_GROUP_NAME_MAX_LENGTH) {
    return false;
  }

  for (const character of value) {
    const isAllowed: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === "_" ||
      character === "-" ||
      character === "/" ||
      character === "." ||
      character === "#";

    if (!isAllowed) {
      return false;
    }
  }

  return true;
}

/*
 * Names typed one a line or separated by commas, each once, in order. A
 * log group's ARN is read as its name.
 */
export function splitCloudStreamNames(text: string): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const line of text.split("\n")) {
    for (const piece of line.split(",")) {
      let name: string = piece.trim();
      const marker: string = ":log-group:";
      const at: number = name.indexOf(marker);

      if (name.startsWith("arn:") && at > 0) {
        name = name.slice(at + marker.length);

        if (name.endsWith(":*")) {
          name = name.slice(0, -2);
        }
      }

      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  return names;
}

/*
 * What is wrong with the options, in the dialog's words - or null when a
 * template can be written from them.
 */
export function getCloudStreamOptionsProblem(data: {
  metrics: CloudStreamMetricsMode;
  logs: CloudStreamLogsMode;
  logGroups: Array<string>;
  logsRegion?: string | undefined;
  regions: Array<string>;
}): string | null {
  if (
    data.metrics === CloudStreamMetricsMode.Off &&
    data.logs === CloudStreamLogsMode.Off
  ) {
    return "Choose metrics, logs or both to stream.";
  }

  if (data.regions.length > CLOUD_STREAM_MAX_REGIONS) {
    return `List at most ${CLOUD_STREAM_MAX_REGIONS} Regions.`;
  }

  for (const region of data.regions) {
    if (!isAwsRegion(region)) {
      return "List Regions by their codes, such as us-east-1 or eu-central-1.";
    }
  }

  if (data.logs === CloudStreamLogsMode.Groups) {
    if (data.logGroups.length === 0) {
      return "Name at least one log group.";
    }

    if (data.logGroups.length > CLOUD_STREAM_MAX_LOG_GROUPS) {
      return `Name at most ${CLOUD_STREAM_MAX_LOG_GROUPS} log groups, or stream every log group.`;
    }

    for (const logGroup of data.logGroups) {
      if (!isAwsLogGroupName(logGroup)) {
        return "A log group's name has letters, digits and _ - / . # only.";
      }
    }

    if (!data.logsRegion || !isAwsRegion(data.logsRegion)) {
      return "Choose the Region the log groups are in.";
    }
  }

  return null;
}

/*
 * The metric stream's filters for the key metrics: each namespace
 * OneUptime reads, with its key metrics. Amazon S3's are left out: they are
 * daily storage metrics, which a metric stream does not carry, so the
 * connection's own reads keep reading them.
 */
export function getCloudStreamKeyMetricFilters(): Array<{
  Namespace: string;
  MetricNames: Array<string>;
}> {
  const filters: Array<{ Namespace: string; MetricNames: Array<string> }> =
    [];

  for (const namespace of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
    const metricNames: Array<string> = namespace.metrics
      .filter((metric: AwsKeyMetric): boolean => {
        return metric.periodSeconds < DAILY_PERIOD_SECONDS;
      })
      .map((metric: AwsKeyMetric): string => {
        return metric.metricName;
      });

    if (metricNames.length === 0) {
      continue;
    }

    const existing:
      | { Namespace: string; MetricNames: Array<string> }
      | undefined = filters.find(
      (filter: { Namespace: string; MetricNames: Array<string> }): boolean => {
        return filter.Namespace === namespace.namespace;
      },
    );

    if (existing) {
      for (const metricName of metricNames) {
        if (!existing.MetricNames.includes(metricName)) {
          existing.MetricNames.push(metricName);
        }
      }

      continue;
    }

    filters.push({ Namespace: namespace.namespace, MetricNames: metricNames });
  }

  return filters;
}

function getAtt(resource: string, attribute: string): JSONObject {
  return { "Fn::GetAtt": [resource, attribute] };
}

function ref(name: string): JSONObject {
  return { Ref: name };
}

// A role only one AWS service may take, on behalf of this account only.
function serviceRole(data: {
  description: string;
  service: string;
  condition: JSONObject;
  policyName: string;
  statements: Array<JSONObject>;
  stackCondition?: string | undefined;
}): JSONObject {
  return {
    Type: "AWS::IAM::Role",
    ...(data.stackCondition ? { Condition: data.stackCondition } : {}),
    Properties: {
      Description: data.description,
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: data.service },
            Action: "sts:AssumeRole",
            Condition: data.condition,
          },
        ],
      },
      Policies: [
        {
          PolicyName: data.policyName,
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: data.statements,
          },
        },
      ],
    },
  };
}

// One Firehose stream delivering to OneUptime.
function deliveryStream(data: {
  name: string;
  url: string;
  endpointName: string;
  backupPrefix: string;
  logStream: string;
  stackCondition?: string | undefined;
}): JSONObject {
  return {
    Type: "AWS::KinesisFirehose::DeliveryStream",
    ...(data.stackCondition ? { Condition: data.stackCondition } : {}),
    Properties: {
      DeliveryStreamName: data.name,
      DeliveryStreamType: "DirectPut",
      DeliveryStreamEncryptionConfigurationInput: { KeyType: "AWS_OWNED_CMK" },
      HttpEndpointDestinationConfiguration: {
        EndpointConfiguration: {
          Name: data.endpointName,
          Url: data.url,
          AccessKey: ref("StreamKey"),
        },
        RequestConfiguration: { ContentEncoding: "GZIP" },
        BufferingHints: {
          SizeInMBs: CLOUD_STREAM_BUFFER_SIZE_MIB,
          IntervalInSeconds: CLOUD_STREAM_BUFFER_INTERVAL_SECONDS,
        },
        RetryOptions: { DurationInSeconds: CLOUD_STREAM_RETRY_DURATION_SECONDS },
        RoleARN: getAtt("FirehoseRole", "Arn"),
        S3BackupMode: "FailedDataOnly",
        S3Configuration: {
          BucketARN: getAtt("FailedDeliveryBucket", "Arn"),
          RoleARN: getAtt("FirehoseRole", "Arn"),
          Prefix: data.backupPrefix,
          CompressionFormat: "GZIP",
        },
        CloudWatchLoggingOptions: {
          Enabled: true,
          LogGroupName: ref("DeliveryLogGroup"),
          LogStreamName: ref(data.logStream),
        },
      },
    },
  };
}

function logicalIdForLogGroup(index: number): string {
  return `LogGroupSubscription${index + 1}`;
}

export function getAwsCloudStreamTemplate(
  options: CloudStreamTemplateOptions,
): JSONObject {
  const names: ReturnType<typeof getCloudStreamNames> = getCloudStreamNames(
    options.connectionId,
  );
  const streamsMetrics: boolean =
    options.metrics !== CloudStreamMetricsMode.Off;
  const streamsLogs: boolean = options.logs !== CloudStreamLogsMode.Off;
  /*
   * Named log groups live in one Region: the logs half of the stack is made
   * there only, the metrics half in every Region.
   */
  const logsCondition: string | undefined =
    options.logs === CloudStreamLogsMode.Groups ? "StreamLogsHere" : undefined;

  const resources: JSONObject = {
    FailedDeliveryBucket: {
      Type: "AWS::S3::Bucket",
      // What Firehose could not deliver is the account's data: kept when the stack goes.
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
          ],
        },
        OwnershipControls: {
          Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
        },
        LifecycleConfiguration: {
          Rules: [
            {
              Id: "ExpireFailedDeliveries",
              Status: "Enabled",
              ExpirationInDays: CLOUD_STREAM_FAILED_DELIVERY_DAYS,
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            },
          ],
        },
      },
    },
    DeliveryLogGroup: {
      Type: "AWS::Logs::LogGroup",
      Properties: {
        LogGroupName: names.deliveryLogGroup,
        RetentionInDays: 14,
      },
    },
    FirehoseRole: serviceRole({
      description:
        "OneUptime: lets Amazon Data Firehose keep a batch it could not deliver in this stack's bucket, and say why in its log group.",
      service: "firehose.amazonaws.com",
      condition: { StringEquals: { "sts:ExternalId": ref("AWS::AccountId") } },
      policyName: "OneUptimeFirehoseBackup",
      statements: [
        {
          Effect: "Allow",
          Action: [
            "s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject",
          ],
          Resource: [
            getAtt("FailedDeliveryBucket", "Arn"),
            { "Fn::Sub": "${FailedDeliveryBucket.Arn}/*" },
          ],
        },
        {
          Effect: "Allow",
          Action: ["logs:PutLogEvents"],
          Resource: getAtt("DeliveryLogGroup", "Arn"),
        },
      ],
    }),
  };

  if (streamsMetrics) {
    resources["MetricsDeliveryLogStream"] = {
      Type: "AWS::Logs::LogStream",
      Properties: {
        LogGroupName: ref("DeliveryLogGroup"),
        LogStreamName: "metrics",
      },
    };

    resources["MetricsDeliveryStream"] = deliveryStream({
      name: names.metricsDeliveryStream,
      url: options.metricsUrl,
      endpointName: "OneUptime metrics",
      backupPrefix: "metrics/",
      logStream: "MetricsDeliveryLogStream",
    });

    resources["MetricStreamRole"] = serviceRole({
      description:
        "OneUptime: lets the CloudWatch metric stream put its records into its Firehose stream, and nothing else.",
      service: "streams.metrics.cloudwatch.amazonaws.com",
      condition: { StringEquals: { "sts:ExternalId": ref("AWS::AccountId") } },
      policyName: "OneUptimeMetricStream",
      statements: [
        {
          Effect: "Allow",
          Action: ["firehose:PutRecord", "firehose:PutRecordBatch"],
          Resource: getAtt("MetricsDeliveryStream", "Arn"),
        },
      ],
    });

    resources["MetricStream"] = {
      Type: "AWS::CloudWatch::MetricStream",
      Properties: {
        Name: names.metricStream,
        FirehoseArn: getAtt("MetricsDeliveryStream", "Arn"),
        RoleArn: getAtt("MetricStreamRole", "Arn"),
        OutputFormat: "opentelemetry1.0",
        ...(options.metrics === CloudStreamMetricsMode.Key
          ? { IncludeFilters: getCloudStreamKeyMetricFilters() }
          : {}),
      },
    };
  }

  if (streamsLogs) {
    resources["LogsDeliveryLogStream"] = {
      Type: "AWS::Logs::LogStream",
      ...(logsCondition ? { Condition: logsCondition } : {}),
      Properties: {
        LogGroupName: ref("DeliveryLogGroup"),
        LogStreamName: "logs",
      },
    };

    resources["LogsDeliveryStream"] = deliveryStream({
      name: names.logsDeliveryStream,
      url: options.logsUrl,
      endpointName: "OneUptime logs",
      backupPrefix: "logs/",
      logStream: "LogsDeliveryLogStream",
      stackCondition: logsCondition,
    });

    resources["LogsSubscriptionRole"] = serviceRole({
      description:
        "OneUptime: lets CloudWatch Logs put the subscribed log groups' events into their Firehose stream, and nothing else.",
      service: "logs.amazonaws.com",
      condition: {
        StringLike: {
          "aws:SourceArn": {
            "Fn::Sub": "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*",
          },
        },
      },
      policyName: "OneUptimeLogsSubscription",
      statements: [
        {
          Effect: "Allow",
          Action: ["firehose:PutRecord", "firehose:PutRecordBatch"],
          Resource: getAtt("LogsDeliveryStream", "Arn"),
        },
      ],
      stackCondition: logsCondition,
    });

    if (options.logs === CloudStreamLogsMode.All) {
      resources["LogsAccountSubscription"] = {
        Type: "AWS::Logs::AccountPolicy",
        Properties: {
          PolicyName: names.accountPolicy,
          PolicyType: "SUBSCRIPTION_FILTER_POLICY",
          Scope: "ALL",
          // Never Firehose's own log group: its errors would stream back into it.
          SelectionCriteria: `LogGroupName NOT IN ["${names.deliveryLogGroup}"]`,
          PolicyDocument: {
            "Fn::Sub":
              '{"DestinationArn":"${LogsDeliveryStream.Arn}","RoleArn":"${LogsSubscriptionRole.Arn}","FilterPattern":""}',
          },
        },
      };
    } else {
      (options.logGroups || [])
        .slice(0, CLOUD_STREAM_MAX_LOG_GROUPS)
        .forEach((logGroup: string, index: number): void => {
          resources[logicalIdForLogGroup(index)] = {
            Type: "AWS::Logs::SubscriptionFilter",
            ...(logsCondition ? { Condition: logsCondition } : {}),
            Properties: {
              LogGroupName: logGroup,
              FilterName: names.subscriptionFilter,
              FilterPattern: "",
              DestinationArn: getAtt("LogsDeliveryStream", "Arn"),
              RoleArn: getAtt("LogsSubscriptionRole", "Arn"),
            },
          };
        });
    }
  }

  const outputs: JSONObject = {
    FailedDeliveryBucket: {
      Description: "Where Firehose keeps a batch it could not deliver.",
      Value: ref("FailedDeliveryBucket"),
    },
  };

  if (streamsMetrics) {
    outputs["MetricsDeliveryStreamArn"] = {
      Value: getAtt("MetricsDeliveryStream", "Arn"),
    };
  }

  if (streamsLogs) {
    outputs["LogsDeliveryStreamArn"] = {
      ...(logsCondition ? { Condition: logsCondition } : {}),
      Value: getAtt("LogsDeliveryStream", "Arn"),
    };
  }

  const streams: Array<string> = [
    ...(streamsMetrics ? ["CloudWatch metrics"] : []),
    ...(streamsLogs ? ["CloudWatch Logs"] : []),
  ];

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `OneUptime: streams this Region's ${streams.join(
      " and ",
    )} to OneUptime through Amazon Data Firehose. Nothing in it can read anything else of the account.`,
    Parameters: {
      StreamKey: {
        Type: "String",
        NoEcho: true,
        Description:
          "The connection's stream key, from Cloud > Connect in OneUptime.",
        AllowedPattern: `^${CLOUD_STREAM_KEY_PREFIX}_[0-9a-f-]{36}_[0-9a-f]{${CLOUD_STREAM_KEY_SECRET_LENGTH}}$`,
        ConstraintDescription:
          "The stream key OneUptime showed with this command, starting with oucs_.",
      },
    },
    ...(logsCondition
      ? {
          Conditions: {
            [logsCondition]: {
              "Fn::Equals": [
                ref("AWS::Region"),
                (options.logsRegion || "").toLowerCase(),
              ],
            },
          },
        }
      : {}),
    Resources: resources,
    Outputs: outputs,
  };
}

// The template as the command writes it: one line, the smallest body.
export function getAwsCloudStreamTemplateBody(
  options: CloudStreamTemplateOptions,
): string {
  return JSON.stringify(getAwsCloudStreamTemplate(options));
}

/*
 * The Regions a command sets streams up in: the ones named, each once, in
 * order - and, for named log groups, their Region too.
 */
export function getCloudStreamCommandRegions(data: {
  regions: Array<string>;
  logs: CloudStreamLogsMode;
  logsRegion?: string | undefined;
  metrics: CloudStreamMetricsMode;
}): Array<string> {
  const regions: Array<string> = [];

  const add: (region: string | undefined) => void = (
    region: string | undefined,
  ): void => {
    const code: string = (region || "").trim().toLowerCase();

    if (code && isAwsRegion(code) && !regions.includes(code)) {
      regions.push(code);
    }
  };

  /*
   * Named log groups and no metrics: the stack is needed in the groups'
   * Region alone.
   */
  if (
    data.metrics === CloudStreamMetricsMode.Off &&
    data.logs === CloudStreamLogsMode.Groups
  ) {
    add(data.logsRegion);
    return regions;
  }

  for (const region of data.regions) {
    add(region);
  }

  if (data.logs === CloudStreamLogsMode.Groups) {
    add(data.logsRegion);
  }

  return regions.slice(0, CLOUD_STREAM_MAX_REGIONS);
}

// A value in single quotes for the shell: what it holds is never read by it.
function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/*
 * The one command, for AWS CloudShell: write the template, then deploy it
 * in each Region - created the first time, updated after. With no Region
 * known it deploys in CloudShell's own. A key of null leaves STREAM_KEY for
 * the person to fill in.
 */
export function getAwsCloudStreamCommand(data: {
  options: CloudStreamTemplateOptions;
  regions: Array<string>;
  streamKey: string | null;
}): string {
  const names: ReturnType<typeof getCloudStreamNames> = getCloudStreamNames(
    data.options.connectionId,
  );
  const regions: Array<string> = getCloudStreamCommandRegions({
    regions: data.regions,
    logs: data.options.logs,
    logsRegion: data.options.logsRegion,
    metrics: data.options.metrics,
  });
  const regionList: string =
    regions.length > 0 ? regions.join(" ") : '"${AWS_REGION:-us-east-1}"';

  return [
    `cat > ${CLOUD_STREAM_TEMPLATE_FILE} <<'TEMPLATE'`,
    getAwsCloudStreamTemplateBody(data.options),
    "TEMPLATE",
    `STREAM_KEY=${shellQuote(data.streamKey || "<YOUR_STREAM_KEY>")}`,
    `for REGION in ${regionList}; do`,
    `  aws cloudformation deploy --region "$REGION" --stack-name ${names.stackName} --template-file ${CLOUD_STREAM_TEMPLATE_FILE} --capabilities CAPABILITY_IAM --parameter-overrides "StreamKey=$STREAM_KEY" --no-fail-on-empty-changeset`,
    "done",
  ].join("\n");
}

/*
 * Stopping for good: the stack in each Region deleted - the metric stream,
 * the subscriptions, the Firehose streams and the roles. The bucket of
 * failed deliveries is kept.
 */
export function getAwsCloudStreamDeleteCommand(data: {
  connectionId: string;
  regions: Array<string>;
}): string {
  const names: ReturnType<typeof getCloudStreamNames> = getCloudStreamNames(
    data.connectionId,
  );
  const regions: Array<string> = data.regions
    .map((region: string): string => {
      return region.trim().toLowerCase();
    })
    .filter((region: string, index: number, all: Array<string>): boolean => {
      return isAwsRegion(region) && all.indexOf(region) === index;
    });
  const regionList: string =
    regions.length > 0 ? regions.join(" ") : '"${AWS_REGION:-us-east-1}"';

  return [
    `for REGION in ${regionList}; do`,
    `  aws cloudformation delete-stack --region "$REGION" --stack-name ${names.stackName}`,
    "done",
  ].join("\n");
}
