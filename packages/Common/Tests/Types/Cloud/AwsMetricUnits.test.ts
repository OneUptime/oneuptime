import { describe, expect, test } from "@jest/globals";
import { AWS_CLOUDWATCH_UNITS } from "../../../Server/Utils/CloudConnection/Aws/AwsCloudWatch";
import {
  AWS_DOCUMENTED_METRIC_UNITS,
  AWS_DOCUMENTED_METRIC_UNITS_READ_ON,
  AwsDocumentedNamespaceUnits,
} from "../../../Types/Cloud/AwsDocumentedMetricUnits";
import { getAwsDocumentedMetricUnit } from "../../../Types/Cloud/AwsMetricUnits";
import {
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
} from "../../../Types/Cloud/CloudKeyMetrics";

/*
 * #9809: the unit an AWS metric is shown with before its datapoints say
 * one - in a resource's More Metrics, and for an addition whose datapoints
 * said none - is the one AWS documents: the key metrics' catalog's, every
 * other's from each service's CloudWatch metrics page.
 */
describe("the units AWS documents", () => {
  test("cover every namespace a connection reads, each read from AWS's own pages", () => {
    expect(AWS_DOCUMENTED_METRIC_UNITS_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    for (const entry of AWS_KEY_METRICS) {
      const documented: AwsDocumentedNamespaceUnits | undefined =
        AWS_DOCUMENTED_METRIC_UNITS[entry.namespace];

      expect(documented).toBeDefined();
      expect(documented!.pages.length).toBeGreaterThan(0);

      for (const page of documented!.pages) {
        expect(page).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
      }
    }
  });

  test("each is a unit CloudWatch's datapoints carry, spelled as they spell it", () => {
    let count: number = 0;

    for (const documented of Object.values(AWS_DOCUMENTED_METRIC_UNITS)) {
      for (const [name, unit] of Object.entries(documented.units)) {
        expect(name.trim()).toBe(name);
        expect(name).not.toBe("");
        expect(AWS_CLOUDWATCH_UNITS).toContain(unit);
        count++;
      }
    }

    // Far beyond the key metrics: what More Metrics lists besides them.
    expect(count).toBeGreaterThan(1000);
  });

  test("where the catalog and AWS's pages both give a key metric's unit, they agree", () => {
    const disagree: Array<string> = [];

    for (const entry of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
      for (const metric of entry.metrics as ReadonlyArray<AwsKeyMetric>) {
        const documented: string | undefined =
          AWS_DOCUMENTED_METRIC_UNITS[entry.namespace]?.units[
            metric.metricName
          ];

        if (documented && documented !== metric.unit) {
          disagree.push(
            `${entry.namespace} ${metric.metricName}: ${metric.unit} / ${documented}`,
          );
        }
      }
    }

    expect(disagree).toEqual([]);
  });
});

describe("a metric's documented unit", () => {
  test("a key metric's is the catalog's", () => {
    expect(getAwsDocumentedMetricUnit("AWS/EC2", "CPUUtilization")).toBe(
      "Percent",
    );
  });

  test("any other's is its service page's", () => {
    expect(getAwsDocumentedMetricUnit("AWS/RDS", "SwapUsage")).toBe("Bytes");
    expect(getAwsDocumentedMetricUnit("AWS/RDS", "ReplicaLag")).toBe("Seconds");
    expect(getAwsDocumentedMetricUnit("AWS/Lambda", "IteratorAge")).toBe(
      "Milliseconds",
    );
    expect(getAwsDocumentedMetricUnit("AWS/EC2", "MetadataNoToken")).toBe(
      "Count",
    );
  });

  test("none for a metric no page gives one, a namespace it does not know, or a name CloudWatch would not match", () => {
    expect(getAwsDocumentedMetricUnit("AWS/RDS", "NoSuchMetric")).toBe("");
    expect(getAwsDocumentedMetricUnit("Custom/App", "Latency")).toBe("");
    expect(getAwsDocumentedMetricUnit("AWS/RDS", "swapusage")).toBe("");
    expect(getAwsDocumentedMetricUnit("AWS/RDS", "constructor")).toBe("");
    expect(getAwsDocumentedMetricUnit("__proto__", "SwapUsage")).toBe("");
  });
});
