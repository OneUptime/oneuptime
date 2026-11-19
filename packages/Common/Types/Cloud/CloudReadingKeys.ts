import { getCloudAlertTemplateReadingKeys } from "../Monitor/CloudAlertTemplates";
import {
  getCloudReadingKey,
  getCloudReadingKeysForType,
} from "./CloudResourceHealth";

/*
 * WHICH METRICS A RESOURCE KEEPS AS ITS READINGS.
 *
 * A read keeps, on each resource, the newest value of the metrics its type
 * is judged by (its health rules), leads its page with (its headlines), or
 * a recommended monitor of its type reads under the name its reading
 * keeps (CloudResourceReadings). The AWS read reads those from CloudWatch
 * even when a stream writes them (AwsCloudConnector), so a resource's
 * health reads the same whether its account streams or not.
 */

// By the reading's key (getCloudReadingKey): "aws/ec2/statuscheckfailed".
export function isCloudReadingKeyOfType(data: {
  provider: string;
  resourceType: string;
  key: string;
}): boolean {
  return (
    getCloudReadingKeysForType(data.provider, data.resourceType).has(
      data.key,
    ) ||
    getCloudAlertTemplateReadingKeys({
      provider: data.provider,
      resourceType: data.resourceType,
    }).has(data.key)
  );
}

// By the name the metric is stored with (CloudKeyMetrics).
export function isCloudReadingOfType(data: {
  provider: string;
  resourceType: string;
  storedMetricName: string;
}): boolean {
  const key: string | null = getCloudReadingKey(
    data.provider,
    data.storedMetricName,
  );

  return Boolean(
    key &&
      isCloudReadingKeyOfType({
        provider: data.provider,
        resourceType: data.resourceType,
        key,
      }),
  );
}
