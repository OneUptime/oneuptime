import { getAwsKeyMetric } from "./CloudKeyMetrics";

/*
 * THE UNITS AWS DOCUMENTS FOR ITS CLOUDWATCH METRICS (#9809).
 *
 * CloudWatch's ListMetrics names no unit, so a metric a resource's More
 * Metrics lists has none until its datapoints say it (findAwsMetricUnit,
 * when it is added). Until then, and for a metric with no data lately, its
 * unit is the one its service's CloudWatch metrics page on
 * docs.aws.amazon.com states - the key metrics' from the catalog, every
 * other's from AWS_DOCUMENTED_METRIC_UNITS - so the list shows it before
 * anything is read. A metric no page states one for has none: a unit is
 * never guessed from a name.
 *
 * Each unit is spelled as CloudWatch's datapoints carry it (StandardUnit).
 */

export interface AwsDocumentedNamespaceUnits {
  // The pages the units were read from.
  pages: Array<string>;
  // Each metric's unit, by its name as AWS spells it.
  units: Record<string, string>;
}

export const AWS_DOCUMENTED_METRIC_UNITS_READ_ON: string = "2026-11-19";

export const AWS_DOCUMENTED_METRIC_UNITS: Readonly<
  Record<string, AwsDocumentedNamespaceUnits>
> = {};

/*
 * The unit AWS documents for a metric of a namespace: the catalog's for a
 * key metric, else its service page's; "" when neither says.
 */
export function getAwsDocumentedMetricUnit(
  namespace: string,
  metricName: string,
): string {
  const keyMetricUnit: string =
    getAwsKeyMetric(namespace, metricName)?.unit || "";

  if (keyMetricUnit) {
    return keyMetricUnit;
  }

  const units: Record<string, string> | undefined =
    Object.prototype.hasOwnProperty.call(AWS_DOCUMENTED_METRIC_UNITS, namespace)
      ? AWS_DOCUMENTED_METRIC_UNITS[namespace]!.units
      : undefined;

  // A metric's name as CloudWatch matches it: exactly.
  return units && Object.prototype.hasOwnProperty.call(units, metricName)
    ? units[metricName] || ""
    : "";
}
