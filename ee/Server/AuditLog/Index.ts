import type { AuditLogRecorder as AuditLogRecorderContract } from "Common/Server/Enterprise/EnterpriseServerModule";
import EnterpriseArea from "../Types/EnterpriseArea";
import AuditLogRecorder from "./AuditLogRecorder";

/*
 * Audit-log recording. Core's AuditLogService keeps its public record* methods
 * as thin delegates to the recorder returned here (through
 * EnterpriseEdition.getAuditLogRecorder()); without the enterprise module there
 * is no recorder and nothing is recorded.
 *
 * One recorder per process, created on first use: its project-settings and
 * user caches must be shared by every caller, and ProjectService's
 * invalidation has to reach the same cache the writes read.
 *
 * Its one worker job ends the sessions that have run out, so their timeouts
 * reach the audit log within minutes (Jobs/EndSessionsThatRanOut).
 */
let recorder: AuditLogRecorder | null = null;

export const getAuditLogRecorder: () => AuditLogRecorderContract | null =
  (): AuditLogRecorderContract | null => {
    if (!recorder) {
      recorder = new AuditLogRecorder();
    }

    return recorder;
  };

const AuditLogArea: EnterpriseArea = {
  name: "AuditLog",
  registerWorkerJobs: async (): Promise<void> => {
    await import("./Jobs/EndSessionsThatRanOut");
  },
};

export default AuditLogArea;
