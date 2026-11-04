import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AWS_KEY_METRICS,
  AwsNamespaceKeyMetrics,
  DAILY_PERIOD_SECONDS,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_STREAM_BUFFER_INTERVAL_SECONDS,
  CLOUD_STREAM_BUFFER_SIZE_MIB,
  CLOUD_STREAM_FAILED_DELIVERY_DAYS,
  CLOUD_STREAM_RETRY_DURATION_SECONDS,
  buildCloudStreamKey,
} from "../../../Types/CloudConnection/CloudStream";
import {
  CLOUDFORMATION_TEMPLATE_BODY_MAX_BYTES,
  CLOUD_STREAM_MAX_LOG_GROUPS,
  CLOUD_STREAM_MAX_REGIONS,
  CLOUD_STREAM_TEMPLATE_FILE,
  CloudStreamLogsMode,
  CloudStreamMetricsMode,
  CloudStreamTemplateOptions,
  getAwsCloudStreamCommand,
  getAwsCloudStreamDeleteCommand,
  getAwsCloudStreamTemplate,
  getAwsCloudStreamTemplateBody,
  getCloudStreamCommandRegions,
  getCloudStreamKeyMetricFilters,
  getCloudStreamNames,
  getCloudStreamOptionsProblem,
  getCloudStreamSuffix,
  isAwsLogGroupName,
  splitCloudStreamNames,
} from "../../../Types/CloudConnection/CloudStreamTemplate";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The CloudFormation stack that streams one Region of an AWS account into
 * OneUptime. Without CloudFormation to deploy it, the template is held to
 * what CloudFormation would refuse and to what it must never grant:
 *
 *   - every Ref, Fn::GetAtt, Fn::Sub and Condition names a parameter, a
 *     pseudo parameter, a resource or a condition of the template, and each
 *     resource carries the properties its type requires;
 *   - each mode makes exactly the pinned resources;
 *   - least privilege: each role is its one service's, behind that
 *     service's confused-deputy condition, and each may do exactly the
 *     pinned actions on exactly the stack's own resources - never "*";
 *   - the stream key is a NoEcho parameter, never in the template, and the
 *     pattern it is checked with takes the keys OneUptime makes;
 *   - the template fits the body `aws cloudformation deploy` sends, with 50
 *     log groups of the longest names.
 *
 * cfn-lint, where it is installed, lints every variant (it is not in CI;
 * cfn-lint 1.59.0 passed them all when the template was written).
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const METRICS_URL: string =
  "https://oneuptime.com/telemetry/aws-firehose/v1/metrics";
const LOGS_URL: string = "https://oneuptime.com/telemetry/aws-firehose/v1/logs";

function options(
  overrides: Partial<CloudStreamTemplateOptions> = {},
): CloudStreamTemplateOptions {
  return {
    connectionId: CONNECTION,
    metricsUrl: METRICS_URL,
    logsUrl: LOGS_URL,
    metrics: CloudStreamMetricsMode.Key,
    logs: CloudStreamLogsMode.Off,
    ...overrides,
  };
}

const VARIANTS: Array<{
  name: string;
  options: CloudStreamTemplateOptions;
}> = [];

for (const metrics of Object.values(CloudStreamMetricsMode)) {
  for (const logs of Object.values(CloudStreamLogsMode)) {
    if (
      metrics === CloudStreamMetricsMode.Off &&
      logs === CloudStreamLogsMode.Off
    ) {
      continue;
    }

    VARIANTS.push({
      name: `metrics ${metrics}, logs ${logs}`,
      options: options({
        metrics,
        logs,
        logGroups: ["/aws/lambda/checkout", "/aws/rds/instance/orders/error"],
        logsRegion: "eu-west-1",
      }),
    });
  }
}

function resourcesOf(template: JSONObject): Record<string, JSONObject> {
  return template["Resources"] as unknown as Record<string, JSONObject>;
}

function typesOf(template: JSONObject): Record<string, string> {
  const types: Record<string, string> = {};

  for (const [name, resource] of Object.entries(resourcesOf(template))) {
    types[name] = resource["Type"] as string;
  }

  return types;
}

const PSEUDO_PARAMETERS: ReadonlySet<string> = new Set<string>([
  "AWS::AccountId",
  "AWS::Region",
  "AWS::Partition",
  "AWS::StackName",
  "AWS::StackId",
  "AWS::URLSuffix",
  "AWS::NoValue",
]);

// Every name the template refers to: Ref, Fn::GetAtt, ${...} in Fn::Sub, Condition.
function collectReferences(
  value: JSONValue | undefined,
  found: { refs: Set<string>; getAtts: Set<string>; conditions: Set<string> },
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferences(item, found);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const object: JSONObject = value as JSONObject;

  for (const [key, entry] of Object.entries(object)) {
    if (key === "Ref" && typeof entry === "string") {
      found.refs.add(entry);
    } else if (key === "Fn::GetAtt" && Array.isArray(entry)) {
      found.getAtts.add(`${String(entry[0])}.${String(entry[1])}`);
    } else if (key === "Fn::Sub" && typeof entry === "string") {
      let at: number = entry.indexOf("${");

      while (at >= 0) {
        const end: number = entry.indexOf("}", at);
        const name: string = entry.slice(at + 2, end);

        if (name.includes(".")) {
          found.getAtts.add(name);
        } else {
          found.refs.add(name);
        }

        at = entry.indexOf("${", end);
      }
    } else if (key === "Condition" && typeof entry === "string") {
      found.conditions.add(entry);
    }

    collectReferences(entry, found);
  }
}

// What each resource type must say, as CloudFormation's own schema requires.
const REQUIRED_PROPERTIES: Record<string, Array<string>> = {
  "AWS::S3::Bucket": [],
  "AWS::Logs::LogGroup": [],
  "AWS::Logs::LogStream": ["LogGroupName"],
  "AWS::IAM::Role": ["AssumeRolePolicyDocument"],
  "AWS::KinesisFirehose::DeliveryStream": [],
  "AWS::CloudWatch::MetricStream": ["FirehoseArn", "RoleArn", "OutputFormat"],
  "AWS::Logs::SubscriptionFilter": [
    "DestinationArn",
    "FilterPattern",
    "LogGroupName",
  ],
  "AWS::Logs::AccountPolicy": ["PolicyDocument", "PolicyName", "PolicyType"],
};

const GET_ATT_ATTRIBUTES: Record<string, Array<string>> = {
  "AWS::S3::Bucket": ["Arn"],
  "AWS::Logs::LogGroup": ["Arn"],
  "AWS::IAM::Role": ["Arn"],
  "AWS::KinesisFirehose::DeliveryStream": ["Arn"],
};

describe("every variant of the template", () => {
  test.each(VARIANTS)(
    "refers only to what it holds ($name)",
    (variant: { name: string; options: CloudStreamTemplateOptions }) => {
      const template: JSONObject = getAwsCloudStreamTemplate(variant.options);
      const resources: Record<string, JSONObject> = resourcesOf(template);
      const parameters: Array<string> = Object.keys(
        template["Parameters"] as JSONObject,
      );
      const conditions: Array<string> = Object.keys(
        (template["Conditions"] as JSONObject | undefined) || {},
      );
      const found: {
        refs: Set<string>;
        getAtts: Set<string>;
        conditions: Set<string>;
      } = { refs: new Set(), getAtts: new Set(), conditions: new Set() };

      collectReferences(template, found);

      for (const ref of found.refs) {
        expect(
          parameters.includes(ref) ||
            PSEUDO_PARAMETERS.has(ref) ||
            Object.prototype.hasOwnProperty.call(resources, ref),
        ).toBe(true);
      }

      for (const getAtt of found.getAtts) {
        const [resource, attribute] = getAtt.split(".") as [string, string];
        const type: string = resources[resource]?.["Type"] as string;

        expect(type).toBeDefined();
        expect(GET_ATT_ATTRIBUTES[type]).toContain(attribute);
      }

      for (const condition of found.conditions) {
        expect(conditions).toContain(condition);
      }

      // A condition the template declares is used.
      for (const condition of conditions) {
        expect(found.conditions.has(condition)).toBe(true);
      }
    },
  );

  test.each(VARIANTS)(
    "gives each resource the properties its type requires ($name)",
    (variant: { name: string; options: CloudStreamTemplateOptions }) => {
      for (const resource of Object.values(
        resourcesOf(getAwsCloudStreamTemplate(variant.options)),
      )) {
        const type: string = resource["Type"] as string;
        const properties: JSONObject =
          (resource["Properties"] as JSONObject | undefined) || {};

        expect(REQUIRED_PROPERTIES[type]).toBeDefined();

        for (const property of REQUIRED_PROPERTIES[type]!) {
          expect(properties[property]).toBeDefined();
        }
      }
    },
  );

  test.each(VARIANTS)(
    "never writes a stream key into the template ($name)",
    (variant: { name: string; options: CloudStreamTemplateOptions }) => {
      const body: string = getAwsCloudStreamTemplateBody(variant.options);

      expect(body.includes("oucs_6f1c3a2e")).toBe(false);
      expect(
        (
          (getAwsCloudStreamTemplate(variant.options)["Parameters"] as JSONObject)[
            "StreamKey"
          ] as JSONObject
        )["NoEcho"],
      ).toBe(true);
    },
  );
});

describe("which resources each mode makes", () => {
  const BASE: Record<string, string> = {
    FailedDeliveryBucket: "AWS::S3::Bucket",
    DeliveryLogGroup: "AWS::Logs::LogGroup",
    FirehoseRole: "AWS::IAM::Role",
  };
  const METRICS: Record<string, string> = {
    MetricsDeliveryLogStream: "AWS::Logs::LogStream",
    MetricsDeliveryStream: "AWS::KinesisFirehose::DeliveryStream",
    MetricStreamRole: "AWS::IAM::Role",
    MetricStream: "AWS::CloudWatch::MetricStream",
  };
  const LOGS: Record<string, string> = {
    LogsDeliveryLogStream: "AWS::Logs::LogStream",
    LogsDeliveryStream: "AWS::KinesisFirehose::DeliveryStream",
    LogsSubscriptionRole: "AWS::IAM::Role",
  };

  test("key metrics, no logs", () => {
    expect(typesOf(getAwsCloudStreamTemplate(options()))).toEqual({
      ...BASE,
      ...METRICS,
    });
  });

  test("every log group: one account-level subscription policy", () => {
    expect(
      typesOf(
        getAwsCloudStreamTemplate(
          options({
            metrics: CloudStreamMetricsMode.Off,
            logs: CloudStreamLogsMode.All,
          }),
        ),
      ),
    ).toEqual({
      ...BASE,
      ...LOGS,
      LogsAccountSubscription: "AWS::Logs::AccountPolicy",
    });
  });

  test("named log groups: a subscription filter for each, in their Region only", () => {
    const template: JSONObject = getAwsCloudStreamTemplate(
      options({
        logs: CloudStreamLogsMode.Groups,
        logGroups: ["/aws/lambda/checkout", "/aws/lambda/cart"],
        logsRegion: "EU-WEST-1",
      }),
    );

    expect(typesOf(template)).toEqual({
      ...BASE,
      ...METRICS,
      ...LOGS,
      LogGroupSubscription1: "AWS::Logs::SubscriptionFilter",
      LogGroupSubscription2: "AWS::Logs::SubscriptionFilter",
    });

    expect(template["Conditions"]).toEqual({
      StreamLogsHere: {
        "Fn::Equals": [{ Ref: "AWS::Region" }, "eu-west-1"],
      },
    });

    // The logs half only where the groups are; the metrics half everywhere.
    const resources: Record<string, JSONObject> = resourcesOf(template);

    for (const name of [
      ...Object.keys(LOGS),
      "LogGroupSubscription1",
      "LogGroupSubscription2",
    ]) {
      expect(resources[name]!["Condition"]).toBe("StreamLogsHere");
    }

    for (const name of [...Object.keys(BASE), ...Object.keys(METRICS)]) {
      expect(resources[name]!["Condition"]).toBeUndefined();
    }

    expect(
      (resources["LogGroupSubscription2"]!["Properties"] as JSONObject)[
        "LogGroupName"
      ],
    ).toBe("/aws/lambda/cart");
  });

  test("subscribes at most 50 log groups by name", () => {
    const logGroups: Array<string> = Array.from({ length: 70 }).map(
      (_value: unknown, index: number) => {
        return `/aws/lambda/fn-${index}`;
      },
    );
    const types: Record<string, string> = typesOf(
      getAwsCloudStreamTemplate(
        options({
          logs: CloudStreamLogsMode.Groups,
          logGroups,
          logsRegion: "us-east-1",
        }),
      ),
    );

    expect(
      Object.values(types).filter((type: string): boolean => {
        return type === "AWS::Logs::SubscriptionFilter";
      }),
    ).toHaveLength(CLOUD_STREAM_MAX_LOG_GROUPS);
  });
});

describe("what the stack's roles may do: least privilege", () => {
  const template: JSONObject = getAwsCloudStreamTemplate(
    options({
      logs: CloudStreamLogsMode.Groups,
      logGroups: ["/aws/lambda/checkout"],
      logsRegion: "us-east-1",
    }),
  );
  const resources: Record<string, JSONObject> = resourcesOf(template);

  function roleOf(name: string): {
    trust: JSONObject;
    statements: Array<JSONObject>;
  } {
    const properties: JSONObject = resources[name]!["Properties"] as JSONObject;
    const trust: Array<JSONObject> = (
      properties["AssumeRolePolicyDocument"] as JSONObject
    )["Statement"] as Array<JSONObject>;
    const policies: Array<JSONObject> = properties["Policies"] as Array<JSONObject>;

    expect(trust).toHaveLength(1);
    expect(policies).toHaveLength(1);
    expect(properties["ManagedPolicyArns"]).toBeUndefined();

    return {
      trust: trust[0]!,
      statements: (policies[0]!["PolicyDocument"] as JSONObject)[
        "Statement"
      ] as Array<JSONObject>,
    };
  }

  test("only Firehose takes its role, for this account, to write its bucket and log", () => {
    const role: { trust: JSONObject; statements: Array<JSONObject> } =
      roleOf("FirehoseRole");

    expect(role.trust).toEqual({
      Effect: "Allow",
      Principal: { Service: "firehose.amazonaws.com" },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": { Ref: "AWS::AccountId" } } },
    });
    expect(role.statements).toEqual([
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
          { "Fn::GetAtt": ["FailedDeliveryBucket", "Arn"] },
          { "Fn::Sub": "${FailedDeliveryBucket.Arn}/*" },
        ],
      },
      {
        Effect: "Allow",
        Action: ["logs:PutLogEvents"],
        Resource: { "Fn::GetAtt": ["DeliveryLogGroup", "Arn"] },
      },
    ]);
  });

  test("only the metric stream takes its role, to put records into its own Firehose stream", () => {
    const role: { trust: JSONObject; statements: Array<JSONObject> } =
      roleOf("MetricStreamRole");

    expect(role.trust["Principal"]).toEqual({
      Service: "streams.metrics.cloudwatch.amazonaws.com",
    });
    expect(role.trust["Condition"]).toEqual({
      StringEquals: { "sts:ExternalId": { Ref: "AWS::AccountId" } },
    });
    expect(role.statements).toEqual([
      {
        Effect: "Allow",
        Action: ["firehose:PutRecord", "firehose:PutRecordBatch"],
        Resource: { "Fn::GetAtt": ["MetricsDeliveryStream", "Arn"] },
      },
    ]);
  });

  test("only this account's CloudWatch Logs takes its role, to put records into the logs stream", () => {
    const role: { trust: JSONObject; statements: Array<JSONObject> } =
      roleOf("LogsSubscriptionRole");

    expect(role.trust["Principal"]).toEqual({ Service: "logs.amazonaws.com" });
    expect(role.trust["Condition"]).toEqual({
      StringLike: {
        "aws:SourceArn": {
          "Fn::Sub": "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:*",
        },
      },
    });
    expect(role.statements).toEqual([
      {
        Effect: "Allow",
        Action: ["firehose:PutRecord", "firehose:PutRecordBatch"],
        Resource: { "Fn::GetAtt": ["LogsDeliveryStream", "Arn"] },
      },
    ]);
  });

  test("no statement of any variant allows an action on every resource", () => {
    for (const variant of VARIANTS) {
      const body: string = getAwsCloudStreamTemplateBody(variant.options);

      expect(body.includes('"Resource":"*"')).toBe(false);
      expect(body.includes('"Action":"*"')).toBe(false);
      expect(body.includes(":*:*")).toBe(false);
    }
  });

  test("nothing in the stack gives OneUptime, or anyone, access to the account", () => {
    for (const variant of VARIANTS) {
      for (const resource of Object.values(
        resourcesOf(getAwsCloudStreamTemplate(variant.options)),
      )) {
        if (resource["Type"] !== "AWS::IAM::Role") {
          continue;
        }

        const principal: JSONObject = (
          (
            (resource["Properties"] as JSONObject)[
              "AssumeRolePolicyDocument"
            ] as JSONObject
          )["Statement"] as Array<JSONObject>
        )[0]!["Principal"] as JSONObject;

        expect(Object.keys(principal)).toEqual(["Service"]);
      }
    }
  });
});

describe("the Firehose streams and the bucket", () => {
  const resources: Record<string, JSONObject> = resourcesOf(
    getAwsCloudStreamTemplate(
      options({ logs: CloudStreamLogsMode.All }),
    ),
  );

  function destination(name: string): JSONObject {
    return (resources[name]!["Properties"] as JSONObject)[
      "HttpEndpointDestinationConfiguration"
    ] as JSONObject;
  }

  test("deliver to OneUptime's two endpoints with the key, gzip, a 1 MiB buffer and an hour of retries", () => {
    for (const [name, url] of [
      ["MetricsDeliveryStream", METRICS_URL],
      ["LogsDeliveryStream", LOGS_URL],
    ] as Array<[string, string]>) {
      const config: JSONObject = destination(name);

      expect((config["EndpointConfiguration"] as JSONObject)["Url"]).toBe(url);
      expect(
        (config["EndpointConfiguration"] as JSONObject)["AccessKey"],
      ).toEqual({ Ref: "StreamKey" });
      expect(config["RequestConfiguration"]).toEqual({
        ContentEncoding: "GZIP",
      });
      expect(config["BufferingHints"]).toEqual({
        SizeInMBs: CLOUD_STREAM_BUFFER_SIZE_MIB,
        IntervalInSeconds: CLOUD_STREAM_BUFFER_INTERVAL_SECONDS,
      });
      expect(config["RetryOptions"]).toEqual({
        DurationInSeconds: CLOUD_STREAM_RETRY_DURATION_SECONDS,
      });
      expect(config["S3BackupMode"]).toBe("FailedDataOnly");
      expect(
        (resources[name]!["Properties"] as JSONObject)[
          "DeliveryStreamEncryptionConfigurationInput"
        ],
      ).toEqual({ KeyType: "AWS_OWNED_CMK" });
    }

    expect(CLOUD_STREAM_BUFFER_SIZE_MIB).toBe(1);
    expect(CLOUD_STREAM_BUFFER_INTERVAL_SECONDS).toBe(60);
    expect(CLOUD_STREAM_RETRY_DURATION_SECONDS).toBe(3600);
  });

  test("keep what they could not deliver in a private, encrypted bucket that empties itself", () => {
    const bucket: JSONObject = resources["FailedDeliveryBucket"]!;
    const properties: JSONObject = bucket["Properties"] as JSONObject;

    expect(bucket["DeletionPolicy"]).toBe("Retain");
    expect(bucket["UpdateReplacePolicy"]).toBe("Retain");
    expect(properties["PublicAccessBlockConfiguration"]).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(
      JSON.stringify(properties["BucketEncryption"]).includes("AES256"),
    ).toBe(true);
    expect(
      (
        (properties["LifecycleConfiguration"] as JSONObject)[
          "Rules"
        ] as Array<JSONObject>
      )[0]!["ExpirationInDays"],
    ).toBe(CLOUD_STREAM_FAILED_DELIVERY_DAYS);
  });

  test("an account-level subscription leaves Firehose's own log group out", () => {
    const policy: JSONObject = resources["LogsAccountSubscription"]![
      "Properties"
    ] as JSONObject;

    expect(policy["PolicyType"]).toBe("SUBSCRIPTION_FILTER_POLICY");
    expect(policy["Scope"]).toBe("ALL");
    expect(policy["SelectionCriteria"]).toBe(
      `LogGroupName NOT IN ["${getCloudStreamNames(CONNECTION).deliveryLogGroup}"]`,
    );
    expect(
      ((policy["PolicyDocument"] as JSONObject)["Fn::Sub"] as string).includes(
        '"FilterPattern":""',
      ),
    ).toBe(true);
  });

  test("the metric stream sends OpenTelemetry 1.0", () => {
    expect(
      (resources["MetricStream"]!["Properties"] as JSONObject)["OutputFormat"],
    ).toBe("opentelemetry1.0");
  });
});

describe("the metric stream's filters", () => {
  test("are the key metrics of every namespace, but S3's daily storage metrics", () => {
    const filters: Array<{ Namespace: string; MetricNames: Array<string> }> =
      getCloudStreamKeyMetricFilters();
    const expected: Map<string, Set<string>> = new Map();

    for (const namespace of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
      for (const metric of namespace.metrics) {
        if (metric.periodSeconds >= DAILY_PERIOD_SECONDS) {
          continue;
        }

        const names: Set<string> =
          expected.get(namespace.namespace) || new Set<string>();
        names.add(metric.metricName);
        expected.set(namespace.namespace, names);
      }
    }

    expect(
      filters.map((filter: { Namespace: string }) => {
        return filter.Namespace;
      }),
    ).toEqual(Array.from(expected.keys()));

    for (const filter of filters) {
      expect(new Set(filter.MetricNames)).toEqual(
        expected.get(filter.Namespace),
      );
    }

    expect(
      filters.some((filter: { Namespace: string }) => {
        return filter.Namespace === "AWS/S3";
      }),
    ).toBe(false);
  });

  test("are in the key template, and every metric is streamed without them", () => {
    const keyStream: JSONObject = resourcesOf(
      getAwsCloudStreamTemplate(options()),
    )["MetricStream"]!["Properties"] as JSONObject;
    const allStream: JSONObject = resourcesOf(
      getAwsCloudStreamTemplate(options({ metrics: CloudStreamMetricsMode.All })),
    )["MetricStream"]!["Properties"] as JSONObject;

    expect(keyStream["IncludeFilters"]).toEqual(
      getCloudStreamKeyMetricFilters(),
    );
    expect(allStream["IncludeFilters"]).toBeUndefined();
  });
});

describe("the stream key parameter", () => {
  const parameter: JSONObject = (
    getAwsCloudStreamTemplate(options())["Parameters"] as JSONObject
  )["StreamKey"] as JSONObject;

  test("takes the keys OneUptime makes, and nothing else", () => {
    const pattern: RegExp = new RegExp(parameter["AllowedPattern"] as string);
    const key: string = buildCloudStreamKey({
      connectionId: CONNECTION,
      secret: "0123456789abcdef".repeat(4),
    });

    expect(pattern.test(key)).toBe(true);
    expect(pattern.test(`${key}0`)).toBe(false);
    expect(pattern.test(key.toUpperCase())).toBe(false);
    expect(pattern.test("<YOUR_STREAM_KEY>")).toBe(false);
  });
});

describe("the template's size", () => {
  test("fits the body aws cloudformation deploy sends, with 50 of the longest log group names", () => {
    const longest: Array<string> = Array.from({
      length: CLOUD_STREAM_MAX_LOG_GROUPS,
    }).map((_value: unknown, index: number) => {
      return `/${String(index).padStart(2, "0")}${"x".repeat(509)}`;
    });

    for (const metrics of [
      CloudStreamMetricsMode.Key,
      CloudStreamMetricsMode.All,
    ]) {
      const body: string = getAwsCloudStreamTemplateBody(
        options({
          metrics,
          logs: CloudStreamLogsMode.Groups,
          logGroups: longest,
          logsRegion: "us-east-1",
        }),
      );

      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
        CLOUDFORMATION_TEMPLATE_BODY_MAX_BYTES,
      );
    }
  });
});

describe("the names in the account", () => {
  test("end in the connection's first eight hex characters", () => {
    expect(getCloudStreamSuffix(CONNECTION)).toBe("6f1c3a2e");
    expect(getCloudStreamNames(CONNECTION)).toEqual({
      stackName: "OneUptimeStream-6f1c3a2e",
      metricsDeliveryStream: "OneUptime-6f1c3a2e-metrics",
      logsDeliveryStream: "OneUptime-6f1c3a2e-logs",
      metricStream: "OneUptime-6f1c3a2e",
      deliveryLogGroup: "/aws/kinesisfirehose/OneUptime-6f1c3a2e",
      subscriptionFilter: "OneUptime-6f1c3a2e",
      accountPolicy: "OneUptime-6f1c3a2e",
    });
  });

  test("fit Firehose's 64 characters for a stream name", () => {
    expect(
      getCloudStreamNames(CONNECTION).metricsDeliveryStream.length,
    ).toBeLessThanOrEqual(64);
  });
});

describe("the command", () => {
  const KEY: string = buildCloudStreamKey({
    connectionId: CONNECTION,
    secret: "0123456789abcdef".repeat(4),
  });

  test("writes the template, then deploys it in each Region with the key", () => {
    const command: string = getAwsCloudStreamCommand({
      options: options(),
      regions: ["us-east-1", "EU-WEST-1", "us-east-1"],
      streamKey: KEY,
    });
    const lines: Array<string> = command.split("\n");

    expect(lines[0]).toBe(`cat > ${CLOUD_STREAM_TEMPLATE_FILE} <<'TEMPLATE'`);
    expect(JSON.parse(lines[1]!)).toEqual(getAwsCloudStreamTemplate(options()));
    expect(lines[2]).toBe("TEMPLATE");
    expect(lines[3]).toBe(`STREAM_KEY='${KEY}'`);
    expect(lines[4]).toBe("for REGION in us-east-1 eu-west-1; do");
    expect(lines[5]).toBe(
      `  aws cloudformation deploy --region "$REGION" --stack-name OneUptimeStream-6f1c3a2e --template-file ${CLOUD_STREAM_TEMPLATE_FILE} --capabilities CAPABILITY_IAM --parameter-overrides "StreamKey=$STREAM_KEY" --no-fail-on-empty-changeset`,
    );
    expect(lines[6]).toBe("done");
    expect(lines).toHaveLength(7);
  });

  test("deploys in CloudShell's own Region when none is known, and leaves the key to fill in when there is none", () => {
    const command: string = getAwsCloudStreamCommand({
      options: options(),
      regions: [],
      streamKey: null,
    });

    expect(command).toContain('for REGION in "${AWS_REGION:-us-east-1}"; do');
    expect(command).toContain("STREAM_KEY='<YOUR_STREAM_KEY>'");
  });

  test("named log groups without metrics deploy in their Region alone", () => {
    expect(
      getCloudStreamCommandRegions({
        regions: ["us-east-1", "eu-west-1"],
        metrics: CloudStreamMetricsMode.Off,
        logs: CloudStreamLogsMode.Groups,
        logsRegion: "ap-south-1",
      }),
    ).toEqual(["ap-south-1"]);

    // With metrics, the log groups' Region is one more.
    expect(
      getCloudStreamCommandRegions({
        regions: ["us-east-1"],
        metrics: CloudStreamMetricsMode.Key,
        logs: CloudStreamLogsMode.Groups,
        logsRegion: "ap-south-1",
      }),
    ).toEqual(["us-east-1", "ap-south-1"]);
  });

  test("leaves out what is not a Region, and at most 30", () => {
    const many: Array<string> = Array.from({ length: 40 }).map(
      (_value: unknown, index: number) => {
        return `us-test-${index}`;
      },
    );

    expect(
      getCloudStreamCommandRegions({
        regions: ["us-east-1", "; rm -rf /", "eu-west-1 "],
        metrics: CloudStreamMetricsMode.Key,
        logs: CloudStreamLogsMode.Off,
      }),
    ).toEqual(["us-east-1", "eu-west-1"]);
    expect(
      getCloudStreamCommandRegions({
        regions: many,
        metrics: CloudStreamMetricsMode.Key,
        logs: CloudStreamLogsMode.Off,
      }),
    ).toHaveLength(CLOUD_STREAM_MAX_REGIONS);
  });

  test("deletes the stack in each Region to stop for good", () => {
    expect(
      getAwsCloudStreamDeleteCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1", "eu-west-1", "bad region"],
      }),
    ).toBe(
      [
        "for REGION in us-east-1 eu-west-1; do",
        '  aws cloudformation delete-stack --region "$REGION" --stack-name OneUptimeStream-6f1c3a2e',
        "done",
      ].join("\n"),
    );
  });
});

describe("what the dialog takes", () => {
  test("log group names one a line or by commas, an ARN as its name, each once", () => {
    expect(
      splitCloudStreamNames(
        "/aws/lambda/checkout, /aws/lambda/cart\n\n arn:aws:logs:us-east-1:123456789012:log-group:/aws/rds/instance/orders/error:*\n/aws/lambda/checkout",
      ),
    ).toEqual([
      "/aws/lambda/checkout",
      "/aws/lambda/cart",
      "/aws/rds/instance/orders/error",
    ]);
  });

  test("a log group name as CloudWatch Logs takes it", () => {
    expect(isAwsLogGroupName("/aws/lambda/checkout-v2_prod.#1")).toBe(true);
    expect(isAwsLogGroupName("")).toBe(false);
    expect(isAwsLogGroupName("has space")).toBe(false);
    expect(isAwsLogGroupName("quote'")).toBe(false);
    expect(isAwsLogGroupName("x".repeat(513))).toBe(false);
  });

  test("says what is wrong with the choices, or nothing", () => {
    const base: {
      metrics: CloudStreamMetricsMode;
      logs: CloudStreamLogsMode;
      logGroups: Array<string>;
      regions: Array<string>;
    } = {
      metrics: CloudStreamMetricsMode.Key,
      logs: CloudStreamLogsMode.Off,
      logGroups: [],
      regions: ["us-east-1"],
    };

    expect(getCloudStreamOptionsProblem(base)).toBeNull();
    expect(
      getCloudStreamOptionsProblem({
        ...base,
        metrics: CloudStreamMetricsMode.Off,
      }),
    ).toBe("Choose metrics, logs or both to stream.");
    expect(
      getCloudStreamOptionsProblem({ ...base, regions: ["moon-1"] }),
    ).toContain("Regions");
    expect(
      getCloudStreamOptionsProblem({
        ...base,
        logs: CloudStreamLogsMode.Groups,
      }),
    ).toBe("Name at least one log group.");
    expect(
      getCloudStreamOptionsProblem({
        ...base,
        logs: CloudStreamLogsMode.Groups,
        logGroups: ["bad name"],
        logsRegion: "us-east-1",
      }),
    ).toContain("letters, digits");
    expect(
      getCloudStreamOptionsProblem({
        ...base,
        logs: CloudStreamLogsMode.Groups,
        logGroups: ["/aws/lambda/x"],
      }),
    ).toBe("Choose the Region the log groups are in.");
    expect(
      getCloudStreamOptionsProblem({
        ...base,
        logs: CloudStreamLogsMode.Groups,
        logGroups: Array.from({ length: 51 }).map(
          (_value: unknown, index: number) => {
            return `/aws/lambda/${index}`;
          },
        ),
        logsRegion: "us-east-1",
      }),
    ).toContain("at most 50");
  });
});

/*
 * cfn-lint, where it is installed: every variant, as CloudFormation's own
 * schemas read it.
 */
const cfnLint: SpawnSyncReturns<string> = spawnSync("cfn-lint", ["--version"], {
  encoding: "utf8",
});
const hasCfnLint: boolean = !cfnLint.error && cfnLint.status === 0;

describe("cfn-lint", () => {
  (hasCfnLint ? test : test.skip)("finds nothing in any variant", () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-stream-"),
    );

    try {
      const files: Array<string> = VARIANTS.map(
        (variant: { name: string; options: CloudStreamTemplateOptions }, index: number) => {
          const file: string = path.join(directory, `variant-${index}.json`);
          fs.writeFileSync(
            file,
            JSON.stringify(getAwsCloudStreamTemplate(variant.options), null, 2),
          );
          return file;
        },
      );

      const result: SpawnSyncReturns<string> = spawnSync("cfn-lint", files, {
        encoding: "utf8",
      });

      expect(`${result.stdout}${result.stderr}`).toBe("");
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
