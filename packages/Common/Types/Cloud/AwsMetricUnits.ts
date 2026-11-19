import {
  AWS_DOCUMENTED_METRIC_UNITS,
  AwsDocumentedNamespaceUnits,
} from "./AwsDocumentedMetricUnits";
import { getAwsKeyMetric } from "./CloudKeyMetrics";

/*
 * THE UNIT OF AN AWS METRIC, AS AWS DOCUMENTS IT (#9809).
 *
 * CloudWatch's ListMetrics names no unit, so a metric a resource's More
 * Metrics lists has none until its datapoints say it (findAwsMetricUnit,
 * when it is added). Until then, and for a metric with no data lately, its
 * unit is the one its service's CloudWatch metrics page on
 * docs.aws.amazon.com states - a key metric's from the catalog, every
 * other's from AWS_DOCUMENTED_METRIC_UNITS - so the list shows it before
 * anything is read. A metric no page states one for has none: a unit is
 * never guessed from a name.
 *
 * Each unit is spelled as CloudWatch's datapoints carry it (StandardUnit).
 */

/*
 * The unit AWS documents for a metric of a namespace: the catalog's for a
 * key metric, else its service page's; "" when neither says. A name as
 * CloudWatch matches it: exactly.
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

  const documented: AwsDocumentedNamespaceUnits | undefined =
    Object.prototype.hasOwnProperty.call(AWS_DOCUMENTED_METRIC_UNITS, namespace)
      ? AWS_DOCUMENTED_METRIC_UNITS[namespace]
      : undefined;

  return documented &&
    Object.prototype.hasOwnProperty.call(documented.units, metricName)
    ? documented.units[metricName] || ""
    : "";
}
