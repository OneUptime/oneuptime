import BackupRunService from "Common/Server/Services/BackupRunService";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import logger from "Common/Server/Utils/Logger";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import {
  BackupManifest,
  isBackupName,
  parseBackupManifest,
} from "Common/Types/Backup/BackupManifest";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupRunTrigger,
} from "Common/Types/Backup/BackupRunTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  BACKUP_MANIFEST_MAX_BYTES,
  getBackupFolderKey,
  getBackupManifestKey,
} from "./BackupLayout";
import { errorText } from "./Storage/BackupHttp";
import { BackupListing, BackupStorage } from "./Storage/BackupStorage";

/*
 * Find backups: the backups at the destination, read from their manifests,
 * made the rows of the Backups page.
 *
 *   - A backup the table does not know (made by the installation this one
 *     replaces, or after the backup a restore went back to) becomes a row,
 *     found at the destination, ready to restore.
 *   - A row the table does know is brought up to its manifest: a restore
 *     takes the table back to the moment of its backup, when that very
 *     backup was still running.
 *   - A succeeded row at this destination whose backup is no longer there
 *     (deleted by hand, or by the retention after the backup a restore went
 *     back to) goes.
 *
 * Run when backups are set up, when the destination changes, after every
 * restore, and from Find backups.
 */

export interface BackupCatalogSyncResult {
  found: number;
  added: number;
  updated: number;
  removed: number;
  // Folders with a manifest this release could not read.
  unreadable: Array<string>;
}

function toRunFields(data: {
  manifest: BackupManifest;
  settings: BackupDestinationSettings;
  storage: BackupStorage;
  folderKey: string;
}): Partial<BackupRun> {
  const manifest: BackupManifest = data.manifest;

  return {
    kind: BackupRunKind.Backup,
    status: BackupRunStatus.Succeeded,
    includesPostgres: Boolean(manifest.postgres),
    includesClickhouse: Boolean(manifest.clickhouse),
    name: manifest.name,
    location: data.storage.describeKey(data.folderKey),
    destinationType: data.settings.type,
    destinationFingerprint: BackupSettingsUtil.getDestinationFingerprint(
      data.settings,
    ),
    startedAt: new Date(manifest.startedAt),
    finishedAt: new Date(manifest.finishedAt),
    postgresSizeInBytes: manifest.postgres?.sizeInBytes ?? (null as never),
    clickhouseSizeInBytes: manifest.clickhouse?.sizeInBytes ?? (null as never),
    manifest: manifest as unknown as JSONObject,
    error: null as never,
  };
}

export default class BackupCatalogSync {
  public static async sync(data: {
    settings: BackupDestinationSettings;
    storage: BackupStorage;
  }): Promise<BackupCatalogSyncResult> {
    const folder: string = BackupSettingsUtil.getFolder(data.settings);
    const fingerprint: string = BackupSettingsUtil.getDestinationFingerprint(
      data.settings,
    );
    const listing: BackupListing = await data.storage.list({
      prefix: folder,
      delimiter: "/",
    });

    const names: Array<string> = listing.prefixes
      .map((prefix: string): string => {
        let name: string = prefix.slice(folder.length);

        while (name.endsWith("/")) {
          name = name.slice(0, -1);
        }

        return name;
      })
      .filter((name: string): boolean => {
        return isBackupName(name);
      });

    const result: BackupCatalogSyncResult = {
      found: 0,
      added: 0,
      updated: 0,
      removed: 0,
      unreadable: [],
    };

    const runs: Array<BackupRun> = await BackupRunService.findAllBy({
      query: { kind: BackupRunKind.Backup },
      select: {
        _id: true,
        name: true,
        status: true,
        destinationFingerprint: true,
      },
      props: { isRoot: true },
    });

    const seenNames: Set<string> = new Set<string>();

    for (const name of names) {
      let manifest: BackupManifest;

      try {
        const bytes: Buffer | null = await data.storage.readSmallObject(
          getBackupManifestKey(folder, name),
          BACKUP_MANIFEST_MAX_BYTES,
        );

        if (!bytes) {
          // A backup still being written, or one that failed before its manifest.
          continue;
        }

        manifest = parseBackupManifest(bytes.toString("utf8"));
      } catch (error) {
        logger.warn(
          `Backups: could not read the manifest of ${name}: ${errorText(error)}`,
        );
        result.unreadable.push(name);
        continue;
      }

      result.found++;
      seenNames.add(name);

      const fields: Partial<BackupRun> = toRunFields({
        manifest,
        settings: data.settings,
        storage: data.storage,
        folderKey: getBackupFolderKey(folder, name),
      });

      const known: BackupRun | undefined = runs.find(
        (run: BackupRun): boolean => {
          return (
            run.name === name ||
            run.id?.toString() === manifest.backupId.toLowerCase()
          );
        },
      );

      if (known?.id) {
        if (
          known.status !== BackupRunStatus.Succeeded ||
          known.destinationFingerprint !== fingerprint
        ) {
          await BackupRunService.updateOneById({
            id: known.id,
            data: fields as never,
            props: { isRoot: true },
          });
          result.updated++;
        }

        continue;
      }

      const row: BackupRun = new BackupRun();
      const manifestId: string = manifest.backupId.toLowerCase();

      // The backup's own id when it is one and free: the row reads the same on every installation.
      if (
        ObjectID.isValidUUID(manifestId) &&
        !runs.some((run: BackupRun): boolean => {
          return run.id?.toString() === manifestId;
        })
      ) {
        row.id = new ObjectID(manifestId);
      }

      Object.assign(row, fields);
      row.trigger =
        manifest.trigger === BackupRunTrigger.Scheduled ||
        manifest.trigger === BackupRunTrigger.Manual ||
        manifest.trigger === BackupRunTrigger.BeforeRestore
          ? manifest.trigger
          : BackupRunTrigger.FoundAtDestination;

      await BackupRunService.create({ data: row, props: { isRoot: true } });
      result.added++;
    }

    // Succeeded rows at this destination whose backup is gone from it.
    for (const run of runs) {
      if (
        run.id &&
        run.name &&
        run.status === BackupRunStatus.Succeeded &&
        run.destinationFingerprint === fingerprint &&
        !seenNames.has(run.name) &&
        !result.unreadable.includes(run.name)
      ) {
        await BackupRunService.deleteOneById({
          id: run.id,
          props: { isRoot: true },
        });
        result.removed++;
      }
    }

    return result;
  }
}
