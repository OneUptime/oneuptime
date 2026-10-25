import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import AzureBackupStorage from "./AzureBackupStorage";
import {
  BackupHttpTransport,
  createGuardedBackupTransport,
} from "./BackupHttp";
import { BackupStorage } from "./BackupStorage";
import S3BackupStorage from "./S3BackupStorage";

/*
 * The storage client for a destination's settings. Production clients
 * reach the storage through the egress guard; tests swap the transport
 * (and, for an Azure emulator, the blob service's address) with
 * setOverrides, and put the real ones back with reset.
 */

export interface BackupStorageOverrides {
  transport?: BackupHttpTransport | undefined;
  azureBlobEndpoint?: string | undefined;
  now?: (() => Date) | undefined;
}

let overrides: BackupStorageOverrides = {};

export default class BackupStorageFactory {
  public static create(settings: BackupDestinationSettings): BackupStorage {
    const transport: BackupHttpTransport =
      overrides.transport ||
      createGuardedBackupTransport(
        BackupSettingsUtil.getEgressOptions("Backup destination"),
      );

    if (settings.type === BackupDestinationType.AzureBlobStorage) {
      return new AzureBackupStorage({
        settings,
        transport,
        now: overrides.now,
        blobEndpoint: overrides.azureBlobEndpoint,
      });
    }

    return new S3BackupStorage({ settings, transport, now: overrides.now });
  }

  // The Azure blob service's address in place of Azure's (a test's emulator).
  public static getAzureBlobEndpointOverride(): string | undefined {
    return overrides.azureBlobEndpoint;
  }

  public static setOverrides(next: BackupStorageOverrides): void {
    overrides = { ...next };
  }

  public static reset(): void {
    overrides = {};
  }
}
