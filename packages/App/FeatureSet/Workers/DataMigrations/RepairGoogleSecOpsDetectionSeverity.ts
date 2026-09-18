import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import GoogleSecOpsSeverityRepair from "Common/Server/Utils/SecurityEvent/GoogleSecOpsSeverityRepair";

/**
 * Re-grades the Google SecOps detections that were imported as Unknown
 * before the normalizer read a custom rule's severity.
 *
 * Google grades its curated rules in detection[].severity, but returns a
 * custom YARA-L rule's `meta: severity` only as detection[].ruleLabels. The
 * normalizer read the first and not the second, so every custom-rule
 * detection landed as Unknown beside graded curated ones. A re-import
 * cannot fix those rows (the poller skips event ids it already holds), but
 * each row keeps its source payload in `attributes`, so the grade the fixed
 * normalizer would give it can be computed from the row itself - see
 * GoogleSecOpsSeverityRepair, which generates the expression from the
 * normalizer's own tables.
 *
 * Safe to run twice, and concurrently (the runner does not serialize): the
 * mutation only touches Google SecOps detection findings still at severity
 * Unknown whose attributes now grade, so a re-run - or a row the fixed code
 * imported - is left alone, and a grade is never overridden.
 *
 * The mutation targets the local storage table ON CLUSTER, like every data
 * mutation on the clustered analytics schema, and is queued asynchronously
 * (ClickHouse's default mutations_sync = 0): this migration returns once the
 * mutation is registered, and parts are rewritten in the background.
 */
export default class RepairGoogleSecOpsDetectionSeverity extends DataMigrationBase {
  public constructor() {
    super("RepairGoogleSecOpsDetectionSeverity");
  }

  public static getRepairStatement(tableName: string): string {
    return GoogleSecOpsSeverityRepair.repairStatement({
      storageTable: getStorageTableName(tableName),
      onCluster: onClusterClause(),
    });
  }

  public override async migrate(): Promise<void> {
    const model: SecurityEvent = new SecurityEvent();
    const storageTableName: string = getStorageTableName(model.tableName);

    /*
     * Boot and the migrate Job both create the analytics tables before data
     * migrations run, so a missing table means nothing was ever imported.
     * Skip rather than throw - the runner halts the whole chain at the first
     * failure.
     */
    if (!(await ClickHouseMigrationUtil.tableExists(storageTableName))) {
      logger.info(
        `RepairGoogleSecOpsDetectionSeverity: ${storageTableName} does not exist; nothing to repair.`,
      );
      return;
    }

    await SecurityEventService.execute(
      RepairGoogleSecOpsDetectionSeverity.getRepairStatement(model.tableName),
      MigrationExecuteOptions,
    );

    logger.info(
      `RepairGoogleSecOpsDetectionSeverity: queued the Google SecOps severity repair of ${storageTableName}`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Deliberately a no-op. The grades it wrote are exactly what current
     * code writes for the same detections, and putting Unknown back would
     * only hide them again.
     */
    return;
  }
}
