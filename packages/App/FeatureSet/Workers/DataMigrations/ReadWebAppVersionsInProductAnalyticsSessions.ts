import DataMigrationBase from "./DataMigrationBase";
import { replaceProductAnalyticsSessionViewQuery } from "./ProductAnalyticsSessionViewQuery";

/*
 * Issue #6625: a web app had no app version in Product Analytics, so the
 * Sessions page's breakdown by version showed one empty row. The browser
 * recorder now takes an appVersion option and sends it with the session's
 * metadata, the replay ingest keeps it in RumSessionV1.appVersion, and
 * RumProductAnalyticsSessionV1_mv reads it there before a mobile app's
 * browser version (PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL).
 *
 * Boot's schema-sync adds the new column to RumSessionV1, but does not see
 * a change to an expression inside a view: this puts the model's query on
 * the view an install already has, in place and atomically
 * (ProductAnalyticsSessionViewQuery). Every session header written from
 * then on files the version its page set; a session recorded before has
 * none, as no recorder sent one.
 *
 * Safe to run twice, at once too: the same query is written each time.
 */
export default class ReadWebAppVersionsInProductAnalyticsSessions extends DataMigrationBase {
  public constructor() {
    super("ReadWebAppVersionsInProductAnalyticsSessions");
  }

  public override async migrate(): Promise<void> {
    await replaceProductAnalyticsSessionViewQuery({
      migrationName: this.name,
      outcome: "now files a web page's own app version.",
    });
  }

  public override async rollback(): Promise<void> {
    // The query before read no web app version; nothing to restore.
    return;
  }
}
