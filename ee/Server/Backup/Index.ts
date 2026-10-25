import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import BackupAPI from "./API/BackupAPI";

/*
 * Backups of the instance (Admin Dashboard > Settings > Backups):
 * PostgreSQL with pg_dump and ClickHouse with its own BACKUP, to Amazon S3,
 * S3-compatible storage (Cloudflare R2, Backblaze B2, Wasabi, MinIO...),
 * Google Cloud Storage or Azure Blob Storage, on a schedule, kept for the
 * days the settings say; restored on demand, with a backup of the current
 * data first.
 *
 * The settings and the runs are core configuration with a core CRUD API
 * (BackupSetting, BackupRun); making, keeping and restoring backups is
 * behaviour, and lives here, so the Community Edition has none of it.
 */
const BackupArea: EnterpriseArea = {
  name: "Backup",
  getApiRouters: (): Array<ExpressRouter> => {
    return [BackupAPI];
  },
  registerWorkerJobs: async (): Promise<void> => {
    await import("./Jobs/RunBackups");
  },
};

export default BackupArea;
