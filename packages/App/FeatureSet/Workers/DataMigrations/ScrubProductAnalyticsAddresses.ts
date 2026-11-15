import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import { MaterializeInBackgroundOptions } from "./MaterializeAttributeValuesIndex";
import Metric from "Common/Models/AnalyticsModels/Metric";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  addressHasIdentifierSql,
  hasIdentifierSegmentSql,
  mapHasUnscrubbedAddressSql,
  redactedPathSql,
  scrubbedAddressSql,
  scrubbedMapSql,
} from "Common/Server/Utils/AnalyticsDatabase/UrlScrubberSql";
import logger from "Common/Server/Utils/Logger";
import { ProductAnalyticsEventKind } from "Common/Types/Rum/ProductAnalyticsEvents";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * What product analytics stored before the scrubber caught it, scrubbed as
 * it is stored now (#8385, #8386). Each statement is a ClickHouse mutation
 * queued in the background (MaterializeInBackgroundOptions), on the local
 * storage table, ON CLUSTER; the rule is UrlScrubber's, in SQL
 * (Common/Server/Utils/AnalyticsDatabase/UrlScrubberSql), which never takes
 * for an identifier what the scrubber keeps.
 *
 * In the events (RumProductAnalyticsEventV1, kept 13 months and shown to
 * everyone who reads the application's analytics):
 *
 *   1. Page views named by a page the scrubber redacts are deleted: a JSON
 *      Web Token, an address escaped twice ("someone%2540example.com") -
 *      which the scrubber kept until #8385 - and an email with letters beyond
 *      ASCII, which RedactPersonalDataInProductAnalyticsPages (#8197) left.
 *      The page is the event's name, in the table's sort key, which
 *      ClickHouse never updates; a copy could not be written in its place
 *      either without a second copy when two processes run this at once.
 *   2. Those segments are redacted in every other event's page, which keeps
 *      the event.
 *   3. A track() property or a user property whose value is an address is
 *      scrubbed as the ingest scrubs one since #8197
 *      (toProductAnalyticsPropertyValue): its query and fragment dropped
 *      (but a hash router's route), its identifiers "[redacted]". Values
 *      that are not addresses are kept as they are.
 *
 * In the sessions (RumProductAnalyticsSessionV1, also 13 months): a session's
 * pages are its routes, and its entry page, as Session Replay scrubbed them -
 * with the gaps #8385 closed. Their identifiers are redacted the same way.
 *
 * In the metric store: the attributes of the points a RUM application's
 * pages send with metric(), scrubbed as the properties are. A RUM
 * application's metrics from an OpenTelemetry SDK share the entity type;
 * they carry the SDK's resource attributes ("resource.service.name") and
 * are never scrubbed at ingest, so they are left as they were sent. The
 * metric store keeps a point for its service's telemetry retention, so this
 * is the shortest-lived of the three.
 *
 * Safe to run twice, at once too: what it deletes or rewrites no longer
 * matches. A row an ingest worker from before the upgrade still writes
 * during a rolling upgrade, after this ran, is not caught. A table that does
 * not exist has nothing to scrub, and is skipped.
 */
export default class ScrubProductAnalyticsAddresses extends DataMigrationBase {
  public constructor() {
    super("ScrubProductAnalyticsAddresses");
  }

  public static getEventStorageTable(): string {
    return getStorageTableName(new RumProductAnalyticsEvent().tableName);
  }

  public static getSessionStorageTable(): string {
    return getStorageTableName(new RumProductAnalyticsSession().tableName);
  }

  public static getMetricStorageTable(): string {
    return getStorageTableName(new Metric().tableName);
  }

  public static getDeletePageViewsStatement(): string {
    return `ALTER TABLE ${ScrubProductAnalyticsAddresses.getEventStorageTable()}${onClusterClause()} DELETE WHERE kind = '${ProductAnalyticsEventKind.Page}' AND ${hasIdentifierSegmentSql("name")}`;
  }

  public static getRedactPagesStatement(): string {
    return `ALTER TABLE ${ScrubProductAnalyticsAddresses.getEventStorageTable()}${onClusterClause()} UPDATE page = ${redactedPathSql("page")} WHERE kind != '${ProductAnalyticsEventKind.Page}' AND ${hasIdentifierSegmentSql("page")}`;
  }

  public static getScrubPropertiesStatement(): string {
    return `ALTER TABLE ${ScrubProductAnalyticsAddresses.getEventStorageTable()}${onClusterClause()} UPDATE properties = ${scrubbedMapSql("properties")}, userProperties = ${scrubbedMapSql("userProperties")} WHERE ${mapHasUnscrubbedAddressSql("properties")} OR ${mapHasUnscrubbedAddressSql("userProperties")}`;
  }

  public static getScrubSessionPagesStatement(): string {
    return `ALTER TABLE ${ScrubProductAnalyticsAddresses.getSessionStorageTable()}${onClusterClause()} UPDATE entryPage = ${redactedPathSql("entryPage")}, pages = arrayMap(paUrl -> if(${addressHasIdentifierSql("paUrl")}, ${scrubbedAddressSql("paUrl")}, paUrl), pages) WHERE ${hasIdentifierSegmentSql("entryPage")} OR arrayExists(paUrl -> ${addressHasIdentifierSql("paUrl")}, pages)`;
  }

  public static getScrubMetricAttributesStatement(): string {
    return `ALTER TABLE ${ScrubProductAnalyticsAddresses.getMetricStorageTable()}${onClusterClause()} UPDATE attributes = ${scrubbedMapSql("attributes")} WHERE primaryEntityType = '${ServiceType.RealUserMonitor}' AND NOT arrayExists(paKey -> startsWith(paKey, 'resource.'), mapKeys(attributes)) AND ${mapHasUnscrubbedAddressSql("attributes")}`;
  }

  // Each table, and what is queued on it, in the order they run.
  public static getSteps(): Array<{
    table: string;
    statements: Array<string>;
  }> {
    return [
      {
        table: ScrubProductAnalyticsAddresses.getEventStorageTable(),
        statements: [
          ScrubProductAnalyticsAddresses.getDeletePageViewsStatement(),
          ScrubProductAnalyticsAddresses.getRedactPagesStatement(),
          ScrubProductAnalyticsAddresses.getScrubPropertiesStatement(),
        ],
      },
      {
        table: ScrubProductAnalyticsAddresses.getSessionStorageTable(),
        statements: [
          ScrubProductAnalyticsAddresses.getScrubSessionPagesStatement(),
        ],
      },
      {
        table: ScrubProductAnalyticsAddresses.getMetricStorageTable(),
        statements: [
          ScrubProductAnalyticsAddresses.getScrubMetricAttributesStatement(),
        ],
      },
    ];
  }

  public override async migrate(): Promise<void> {
    for (const step of ScrubProductAnalyticsAddresses.getSteps()) {
      /*
       * Boot and the migrate Job create the analytics tables before data
       * migrations run, so a table that does not exist has no rows.
       */
      if (!(await ClickHouseMigrationUtil.tableExists(step.table))) {
        logger.info(
          `ScrubProductAnalyticsAddresses: ${step.table} does not exist; nothing to scrub.`,
        );
        continue;
      }

      /*
       * Not caught: a mutation that could not be queued fails the migration,
       * so the runner tries it again on the next boot rather than record as
       * done a table that still holds what it was meant to scrub.
       */
      for (const statement of step.statements) {
        await MetricService.execute(statement, MaterializeInBackgroundOptions);
      }

      logger.info(
        `ScrubProductAnalyticsAddresses: queued the scrubbing of ${step.table}; it runs in the background (system.mutations).`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    // Nothing to give back: what was scrubbed named a person or held a secret.
    return;
  }
}
