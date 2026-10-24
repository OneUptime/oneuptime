import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseArea from "../Types/EnterpriseArea";
import AuditLogExportAPI from "./API/AuditLogExportAPI";

/*
 * Audit log export: every enabled export (Common/Models/DatabaseModels/
 * AuditLogExport - a project's, or the whole instance's) is sent the
 * entries recorded since its cursor, every minute, to the destination it
 * names: S3 or S3-compatible storage, Google Cloud Storage, Azure Blob
 * Storage, a webhook or syslog (AuditLogExporter, Destinations/).
 *
 * The exports are core configuration with a core CRUD API; creating or
 * changing one is gated on the license by EditionPermission. The exporter,
 * the destinations and the test route are behaviour, and live here, so the
 * Community Edition exports nothing.
 */
const AuditLogExportArea: EnterpriseArea = {
  name: "AuditLogExport",
  getApiRouters: (): Array<ExpressRouter> => {
    return [AuditLogExportAPI];
  },
  registerWorkerJobs: async (): Promise<void> => {
    await import("./Jobs/ExportAuditLogs");
  },
};

export default AuditLogExportArea;
