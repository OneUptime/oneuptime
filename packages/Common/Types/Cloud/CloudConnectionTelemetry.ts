/*
 * TELEMETRY A CLOUD CONNECTION DELIVERS ITSELF.
 *
 * A cloud connection (Cloud > Connect) writes telemetry into OneUptime's
 * own ingest in two ways: what its reads of the cloud's monitoring API
 * find, on their schedule (CloudMetricPayload), and what the cloud streams
 * to it (CloudStream: CloudWatch metrics and logs, through Amazon Data
 * Firehose). Every OTel resource of either carries the connection's id as
 * this attribute and the connection's telemetry service as its
 * service.name. Telemetry a workload sends of its own never carries it.
 */
export const CLOUD_CONNECTION_ID_ATTRIBUTE: string =
  "oneuptime.cloud.connection.id";

export type CloudConnectionAttributeGetter = (
  key: string,
) => string | null | undefined;

/*
 * Whether a cloud connection delivered a resource, rather than a workload
 * sending it: it carries a connection's id. Discovery reads it so that what
 * a connection delivers is filed only where it names something the way the
 * thing's own telemetry names it (CloudAppIdentity): an App Platforms
 * environment by its platform, account and Region - never an app, whose
 * name a connection's service.name is not, nor an instance.
 */
export function isCloudConnectionDeliveredResource(
  getAttribute: CloudConnectionAttributeGetter,
): boolean {
  const value: string | null | undefined = getAttribute(
    CLOUD_CONNECTION_ID_ATTRIBUTE,
  );

  return typeof value === "string" && value.trim().length > 0;
}
