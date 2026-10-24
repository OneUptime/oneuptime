import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AuditLogExporter, {
  AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS,
} from "../AuditLogExporter";

/*
 * Every minute: each enabled audit log export is sent what was recorded
 * since its cursor (AuditLogExporter). The name is part of the contract
 * with core's EnterpriseLoader, which gives a placeholder to any
 * enterprise job ee does not register: it must never change.
 *
 * The run stops starting new batches after four minutes and the job times
 * out a minute after that, so a slow destination never holds the worker.
 * The license is asked on every run (AuditLogExporter.isExportingActive),
 * so a lapse stops exporting and a renewal resumes it, from where it
 * stopped, without a restart.
 */
export const EXPORT_AUDIT_LOGS_JOB_NAME: string =
  "AuditLogExport:ExportAuditLogs";

export const EXPORT_AUDIT_LOGS_JOB_TIMEOUT_IN_MS: number =
  AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS +
  OneUptimeDate.convertMinutesToMilliseconds(1);

RunCron(
  EXPORT_AUDIT_LOGS_JOB_NAME,
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: EXPORT_AUDIT_LOGS_JOB_TIMEOUT_IN_MS,
  },
  async (): Promise<void> => {
    try {
      await new AuditLogExporter().exportAll();
    } catch (error) {
      logger.error(`${EXPORT_AUDIT_LOGS_JOB_NAME}: the run failed:`);
      logger.error(error);
    }
  },
);
