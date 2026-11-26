import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityCaseService from "Common/Server/Services/SecurityCaseService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import AuditRecordNameCopies from "Common/Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNameCopies";
import AuditRecordNamesRepair from "Common/Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNamesRepair";

/**
 * Says the security events the audit log's scan stored before #10663, and
 * what was made of them, without the names of records their readers may not
 * read.
 *
 * An event about a change in OneUptime - an API key created, a custom role
 * changed, a team deleted - named its record ("alice created the API key
 * "terraform""), and was read by every reader of security events: a
 * Security Viewer read the name of a key they could not read on the key.
 * New events name a record only where every reader of security events
 * reads it (none of the types today). This brings what is stored in line:
 *
 *   1. In Postgres, what was made of those events and outlives them: a
 *      detection's sample and the events it kept, the case it opened, the
 *      alert or incident it raised and their "Created" feed items, a case's
 *      evidence (AuditRecordNameCopies). Written with SQL of its own, so the
 *      audit log does not record the replaced text again.
 *   2. In ClickHouse, the events themselves: one mutation, against the local
 *      storage table ON CLUSTER, queued asynchronously like every data
 *      mutation (AuditRecordNamesRepair says why one, and what it costs).
 *
 * Postgres first: the mutation cannot take from it anything it needs. Safe
 * to run twice, and concurrently: what is reworded names no record, so
 * nothing matches it again. A table missing in ClickHouse means nothing was
 * ever stored; it is skipped rather than halting the chain.
 */
export default class WithholdAuditRecordNamesInSecurityEvents extends DataMigrationBase {
  public constructor() {
    super("WithholdAuditRecordNamesInSecurityEvents");
  }

  public static getRepairStatement(tableName: string): string {
    return AuditRecordNamesRepair.repairStatement({
      storageTable: getStorageTableName(tableName),
      onCluster: onClusterClause(),
    });
  }

  public override async migrate(): Promise<void> {
    const reworded: number = await AuditRecordNameCopies.rewordEveryProject({
      manager: SecurityCaseService.getRepository().manager,
    });

    logger.info(
      `WithholdAuditRecordNamesInSecurityEvents: reworded ${reworded} detections, cases, alerts, incidents, feed items and evidence that quoted an audit log event`,
    );

    const model: SecurityEvent = new SecurityEvent();
    const storageTableName: string = getStorageTableName(model.tableName);

    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `WithholdAuditRecordNamesInSecurityEvents: ${storageTableName} does not exist; no security event to reword.`,
      );
      return;
    }

    await SecurityEventService.execute(
      WithholdAuditRecordNamesInSecurityEvents.getRepairStatement(
        model.tableName,
      ),
      MigrationExecuteOptions,
    );

    logger.info(
      `WithholdAuditRecordNamesInSecurityEvents: queued the rewording of the audit log's events in ${storageTableName}`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op: putting the names back would give them again to
     * the readers they were taken from.
     */
    return;
  }
}
