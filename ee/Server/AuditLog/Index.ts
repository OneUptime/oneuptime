import type { AuditLogRecorder } from "Common/Server/Enterprise/EnterpriseServerModule";
import EnterpriseArea from "../Types/EnterpriseArea";

/*
 * Audit-log recording. Core's AuditLogService keeps its public record* methods
 * as thin delegates to the recorder returned here; with no recorder, nothing
 * is recorded.
 *
 * Skeleton: no recorder yet. The recording half of AuditLogService moves here
 * as AuditLogRecorder.
 */
export const getAuditLogRecorder: () => AuditLogRecorder | null =
  (): AuditLogRecorder | null => {
    return null;
  };

const AuditLogArea: EnterpriseArea = {
  name: "AuditLog",
};

export default AuditLogArea;
