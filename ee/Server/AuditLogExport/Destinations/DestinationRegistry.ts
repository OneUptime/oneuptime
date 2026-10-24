import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import AzureBlobStorageDestination from "./AzureBlobStorageDestination";
import GoogleCloudStorageDestination from "./GoogleCloudStorageDestination";
import S3Destination from "./S3Destination";
import SyslogDestination from "./SyslogDestination";
import { AuditLogExportDestination } from "./Types";
import WebhookDestination from "./WebhookDestination";

/*
 * One destination per type. Destinations are stateless (the Google one
 * keeps sign-in tokens, keyed by the key's hash), so one instance serves
 * every export. Tests swap one for a destination with a fake endpoint
 * (setDestination) and put the real one back (reset).
 */
const buildDestinations: () => Map<
  AuditLogExportDestinationType,
  AuditLogExportDestination
> = (): Map<AuditLogExportDestinationType, AuditLogExportDestination> => {
  const s3: S3Destination = new S3Destination();

  return new Map<AuditLogExportDestinationType, AuditLogExportDestination>([
    [AuditLogExportDestinationType.AmazonS3, s3],
    [AuditLogExportDestinationType.S3Compatible, s3],
    [
      AuditLogExportDestinationType.GoogleCloudStorage,
      new GoogleCloudStorageDestination(),
    ],
    [
      AuditLogExportDestinationType.AzureBlobStorage,
      new AzureBlobStorageDestination(),
    ],
    [AuditLogExportDestinationType.Webhook, new WebhookDestination()],
    [AuditLogExportDestinationType.Syslog, new SyslogDestination()],
  ]);
};

let destinations: Map<
  AuditLogExportDestinationType,
  AuditLogExportDestination
> = buildDestinations();

export default class AuditLogExportDestinationRegistry {
  public static getDestination(
    type: AuditLogExportDestinationType | string | undefined,
  ): AuditLogExportDestination {
    const destination: AuditLogExportDestination | undefined =
      destinations.get(type as AuditLogExportDestinationType);

    if (!destination) {
      throw new BadDataException(
        "Destination must be one of the supported audit log destinations.",
      );
    }

    return destination;
  }

  public static setDestination(
    type: AuditLogExportDestinationType,
    destination: AuditLogExportDestination,
  ): void {
    destinations.set(type, destination);
  }

  public static reset(): void {
    destinations = buildDestinations();
  }
}
