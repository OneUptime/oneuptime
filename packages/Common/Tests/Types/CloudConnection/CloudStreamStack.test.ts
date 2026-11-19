import {
  AWS_STREAM_TEMPLATE_VERSION,
  AwsKeyMetric,
  countAwsKeyMetricsAddedSince,
  getAwsKeyMetric,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_STREAM_ACTIVE_WINDOW_MS,
  CLOUD_STREAM_MAX_TEMPLATE_VERSION,
  CloudStreamMetricSource,
  CloudStreamSummary,
} from "../../../Types/CloudConnection/CloudStream";
import {
  AwsStreamCoverage,
  AwsStreamStack,
  CLOUD_STREAM_MAX_COMMON_ATTRIBUTES_LENGTH,
  CLOUD_STREAM_METRICS_ATTRIBUTE,
  CLOUD_STREAM_TEMPLATE_ATTRIBUTE,
  UNVERSIONED_AWS_STREAM_STACK,
  doesAwsStreamStackCarry,
  getAwsStreamCoverage,
  getAwsStreamStackOfSource,
  getOlderAwsStreamStacks,
  isAwsKeyMetricLeftToStream,
  isAwsStreamStackOlder,
  readAwsStreamStack,
} from "../../../Types/CloudConnection/CloudStreamStack";
import { describe, expect, test } from "@jest/globals";

/*
 * What an AWS stream's stack carries, as its template says with every
 * delivery (X-Amz-Firehose-Common-Attributes), and what the reads leave to
 * it. A stack that says nothing is held to template 1: what every stack
 * has carried since streams began - never more, so nothing it may not
 * carry is left to it.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const ACCOUNT: string = "123456789012";

function header(attributes: Record<string, unknown>): string {
  return JSON.stringify({ commonAttributes: attributes });
}

function metric(namespace: string, name: string): AwsKeyMetric {
  const found: AwsKeyMetric | undefined = getAwsKeyMetric(namespace, name);

  expect({ namespace, name, found: Boolean(found) }).toEqual({
    namespace,
    name,
    found: true,
  });

  return found!;
}

const CPU: AwsKeyMetric = metric("AWS/EC2", "CPUUtilization");
const CREDITS: AwsKeyMetric = metric("AWS/EC2", "CPUCreditBalance");
const WAF: AwsKeyMetric = metric("AWS/WAFV2", "AllowedRequests");
const S3_SIZE: AwsKeyMetric = metric("AWS/S3", "BucketSizeBytes");
const DAYS: AwsKeyMetric = metric("AWS/CertificateManager", "DaysToExpiry");

function summary(
  sources: Array<Partial<CloudStreamMetricSource>>,
): CloudStreamSummary {
  return {
    metricSources: sources.map(
      (source: Partial<CloudStreamMetricSource>): CloudStreamMetricSource => {
        return {
          accountId: ACCOUNT,
          region: "us-east-1",
          namespaces: ["AWS/EC2"],
          lastAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
          ...source,
        };
      },
    ),
    logSources: [],
  };
}

describe("the stack a delivery came from, by its common attributes", () => {
  test("a stack of the template written today says its version and that it streams the key metrics", () => {
    expect(
      readAwsStreamStack(
        header({
          [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: String(
            AWS_STREAM_TEMPLATE_VERSION,
          ),
          [CLOUD_STREAM_METRICS_ATTRIBUTE]: "key",
        }),
      ),
    ).toEqual({
      templateVersion: AWS_STREAM_TEMPLATE_VERSION,
      everyMetric: false,
    });
  });

  test("a stack of every metric says so, whatever the case", () => {
    expect(
      readAwsStreamStack(
        header({
          [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "2",
          [CLOUD_STREAM_METRICS_ATTRIBUTE]: " ALL ",
        }),
      ),
    ).toEqual({ templateVersion: 2, everyMetric: true });
  });

  test("the first of several headers is read", () => {
    expect(
      readAwsStreamStack([
        header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "2" }),
        header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "7" }),
      ]),
    ).toEqual({ templateVersion: 2, everyMetric: false });
  });

  /*
   * No header, or one that says no version: a stack made before templates
   * said theirs, or set up another way, whose filters OneUptime cannot
   * know - held to template 1. Never "every metric" without a version.
   */
  test("one that says nothing of itself is held to template 1", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      42,
      {},
      "not json",
      "[]",
      JSON.stringify({}),
      JSON.stringify({ commonAttributes: [] }),
      header({}),
      header({ [CLOUD_STREAM_METRICS_ATTRIBUTE]: "all" }),
      header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "" }),
      header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "two" }),
      header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "1.5" }),
      header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "0" }),
      header({ [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "-2" }),
      header({
        [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: String(
          CLOUD_STREAM_MAX_TEMPLATE_VERSION + 1,
        ),
      }),
    ]) {
      expect(readAwsStreamStack(value)).toEqual(UNVERSIONED_AWS_STREAM_STACK);
    }

    expect(UNVERSIONED_AWS_STREAM_STACK).toEqual({
      templateVersion: 1,
      everyMetric: false,
    });
  });

  test("a header longer than Firehose sends is not read at all", () => {
    const long: string = header({
      [CLOUD_STREAM_TEMPLATE_ATTRIBUTE]: "2",
      padding: "x".repeat(CLOUD_STREAM_MAX_COMMON_ATTRIBUTES_LENGTH),
    });

    expect(readAwsStreamStack(long)).toEqual(UNVERSIONED_AWS_STREAM_STACK);
  });

  test("the unversioned stack handed back is a copy: no caller can change it", () => {
    const stack: AwsStreamStack = readAwsStreamStack(undefined);

    stack.templateVersion = 9;

    expect(UNVERSIONED_AWS_STREAM_STACK.templateVersion).toBe(1);
  });
});

describe("what a stack carries", () => {
  test("template 1 carries what every stack has, never a metric added since", () => {
    const stack: AwsStreamStack = { templateVersion: 1, everyMetric: false };

    expect(doesAwsStreamStackCarry(stack, CPU)).toBe(true);
    expect(doesAwsStreamStackCarry(stack, CREDITS)).toBe(false);
    expect(doesAwsStreamStackCarry(stack, WAF)).toBe(false);
  });

  test("template 2 carries every key metric read every five minutes", () => {
    const stack: AwsStreamStack = { templateVersion: 2, everyMetric: false };

    expect(doesAwsStreamStackCarry(stack, CPU)).toBe(true);
    expect(doesAwsStreamStackCarry(stack, CREDITS)).toBe(true);
    expect(doesAwsStreamStackCarry(stack, WAF)).toBe(true);
  });

  test("a stack of every metric carries each a stream can, whatever its template", () => {
    const stack: AwsStreamStack = { templateVersion: 2, everyMetric: true };

    expect(doesAwsStreamStackCarry(stack, CREDITS)).toBe(true);
    expect(doesAwsStreamStackCarry(stack, WAF)).toBe(true);
  });

  test("no stack carries a daily or hourly metric: the read writes those", () => {
    for (const stack of [
      { templateVersion: 1, everyMetric: false },
      { templateVersion: 2, everyMetric: false },
      { templateVersion: 2, everyMetric: true },
    ]) {
      expect(doesAwsStreamStackCarry(stack, S3_SIZE)).toBe(false);
      expect(doesAwsStreamStackCarry(stack, DAYS)).toBe(false);
    }
  });

  test("only a key-metric stack of an older template is older: one of every metric carries all of them", () => {
    expect(
      isAwsStreamStackOlder({ templateVersion: 1, everyMetric: false }),
    ).toBe(true);
    expect(
      isAwsStreamStackOlder({ templateVersion: 2, everyMetric: false }),
    ).toBe(false);
    expect(
      isAwsStreamStackOlder({ templateVersion: 2, everyMetric: true }),
    ).toBe(false);
  });

  test("a summary's source says its stack, or is held to template 1", () => {
    expect(getAwsStreamStackOfSource({})).toEqual(UNVERSIONED_AWS_STREAM_STACK);
    expect(
      getAwsStreamStackOfSource({ templateVersion: 2, everyMetric: true }),
    ).toEqual({ templateVersion: 2, everyMetric: true });
    // A stack that says every metric with no version is not believed.
    expect(getAwsStreamStackOfSource({ everyMetric: true })).toEqual(
      UNVERSIONED_AWS_STREAM_STACK,
    );
  });
});

describe("what the reads leave to the streams", () => {
  test("a key metric a stack carries, of a namespace it delivered lately, in its own account and Region", () => {
    const coverage: AwsStreamCoverage = getAwsStreamCoverage({
      summary: summary([
        { namespaces: ["AWS/EC2", "AWS/WAFV2"], templateVersion: 2 },
      ]),
      now: NOW,
    });
    const leftToStream: (data: {
      metric: AwsKeyMetric;
      namespace: string;
      accountId?: string;
      region?: string;
    }) => boolean = (data: {
      metric: AwsKeyMetric;
      namespace: string;
      accountId?: string;
      region?: string;
    }): boolean => {
      return isAwsKeyMetricLeftToStream({
        coverage,
        accountId: data.accountId || ACCOUNT,
        region: data.region || "us-east-1",
        namespace: data.namespace,
        metric: data.metric,
      });
    };

    expect(leftToStream({ metric: CPU, namespace: "AWS/EC2" })).toBe(true);
    expect(leftToStream({ metric: CREDITS, namespace: "aws/ec2" })).toBe(true);
    expect(leftToStream({ metric: WAF, namespace: "AWS/WAFV2" })).toBe(true);
    // Another Region, another account, a namespace it did not deliver.
    expect(
      leftToStream({ metric: CPU, namespace: "AWS/EC2", region: "eu-west-1" }),
    ).toBe(false);
    expect(
      leftToStream({
        metric: CPU,
        namespace: "AWS/EC2",
        accountId: "210987654321",
      }),
    ).toBe(false);
    expect(
      leftToStream({
        metric: metric("AWS/RDS", "CPUUtilization"),
        namespace: "AWS/RDS",
      }),
    ).toBe(false);
  });

  test("nothing of a stream that went quiet: the read reads and writes it again", () => {
    const coverage: AwsStreamCoverage = getAwsStreamCoverage({
      summary: summary([
        {
          templateVersion: 2,
          lastAt: new Date(
            NOW.getTime() - CLOUD_STREAM_ACTIVE_WINDOW_MS - 1,
          ).toISOString(),
        },
      ]),
      now: NOW,
    });

    expect(coverage.size).toBe(0);
    expect(
      isAwsKeyMetricLeftToStream({
        coverage,
        accountId: ACCOUNT,
        region: "us-east-1",
        namespace: "AWS/EC2",
        metric: CPU,
      }),
    ).toBe(false);
  });

  test("a place is found whatever the case of its account and Region", () => {
    const coverage: AwsStreamCoverage = getAwsStreamCoverage({
      summary: summary([{ region: "US-EAST-1", templateVersion: 1 }]),
      now: NOW,
    });

    expect(
      isAwsKeyMetricLeftToStream({
        coverage,
        accountId: ACCOUNT,
        region: "us-east-1",
        namespace: "AWS/EC2",
        metric: CPU,
      }),
    ).toBe(true);
  });
});

describe("the stacks to update", () => {
  test("each place streaming lately from an older key-metric stack, with the metrics running the command again streams there", () => {
    const older: Array<{
      accountId: string;
      region: string;
      metricsToStream: number;
    }> = getOlderAwsStreamStacks({
      summary: summary([
        { region: "us-east-1" },
        { region: "eu-west-1", templateVersion: 2 },
        { region: "ap-south-1", templateVersion: 1, everyMetric: false },
        { region: "us-west-2", templateVersion: 1, everyMetric: true },
        {
          region: "sa-east-1",
          lastAt: new Date(
            NOW.getTime() - CLOUD_STREAM_ACTIVE_WINDOW_MS - 1,
          ).toISOString(),
        },
      ]),
      now: NOW,
    });

    expect(older).toEqual([
      {
        accountId: ACCOUNT,
        region: "us-east-1",
        metricsToStream: countAwsKeyMetricsAddedSince(1),
      },
      {
        accountId: ACCOUNT,
        region: "ap-south-1",
        metricsToStream: countAwsKeyMetricsAddedSince(1),
      },
    ]);
    expect(countAwsKeyMetricsAddedSince(1)).toBeGreaterThan(100);
  });

  test("none once every stack is of the current template", () => {
    expect(
      getOlderAwsStreamStacks({
        summary: summary([{ templateVersion: AWS_STREAM_TEMPLATE_VERSION }]),
        now: NOW,
      }),
    ).toEqual([]);
  });
});
