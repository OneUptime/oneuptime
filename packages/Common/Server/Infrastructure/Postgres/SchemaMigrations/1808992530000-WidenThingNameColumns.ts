import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A thing's name is text, not a person's name.
 *
 * Thirty-one display names - a cloud connection's, a probe's, an LLM
 * provider's, a log pipeline's, a saved view's and the rest - and a probe's
 * description were typed TableColumnType.Name, the person's-name type: 50
 * characters, and the API's schema (OpenAPI, the MCP tools) asked for an
 * object, {"_type":"Name","value":"..."}, where everyone sends text. They
 * are ShortText now, as 208 other names are (a probe's description
 * LongText, as 200 other descriptions are): varchar(100) and varchar(500).
 * A person's name - a user's, and the names a project and a deleted
 * project keep of the people who made and removed them - stays the Name
 * type (NameColumnsArePeoplesNames holds the rule).
 *
 * Generated with npm run generate-postgres-migration, which wrote each
 * change as DROP COLUMN + ADD: that drops every name, and the ADD of a NOT
 * NULL column with no default fails outright on a table holding a row.
 * ALTER COLUMN ... TYPE reaches the same schema and keeps every value - the
 * stored text is the same shape either way, so no value is migrated.
 * Widening a varchar is binary-coercible: Postgres rewrites no row, and
 * none of these columns is in an index, so nothing is rebuilt - each table
 * is locked only for its catalog change. Same shape as
 * WidenDetectionRuleName1806400000000.
 */
export class WidenThingNameColumns1808992530000 implements MigrationInterface {
  public name: string = "WidenThingNameColumns1808992530000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ALTER COLUMN "description" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ALTER COLUMN "playbookName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgent" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ALTER COLUMN "name" TYPE character varying(100)`,
    );
  }

  /*
   * Narrowing back to the 50 characters they had fails on any value written
   * longer since, so those are cut to fit first: a pipeline keeps running
   * under the first 50 characters of its name.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "VideoCallConnection" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "ExternalMcpServer" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExternalMcpServer" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LlmProvider" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "AIAgent" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgent" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LogRecordingRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "TraceRecordingRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceRecordingRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "TraceScrubRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "TraceDropFilter" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "TracePipelineProcessor" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipelineProcessor" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "TracePipeline" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "TracePipeline" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "MetricRecordingRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LlmObservabilityConnection" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LlmCostBudget" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "MetricPipelineRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LogScrubRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "AuditLogExport" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "SecurityEventDestination" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "SecurityPlaybookRun" SET "playbookName" = LEFT("playbookName", 50) WHERE LENGTH("playbookName") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ALTER COLUMN "playbookName" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "SecurityPlaybook" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "ThreatIntelFeed" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "SecurityEventConnection" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LogDropFilter" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LogPipelineProcessor" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipelineProcessor" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LogPipeline" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogPipeline" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "ExceptionSavedView" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExceptionSavedView" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "TraceSavedView" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceSavedView" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "MetricSavedView" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "LogSavedView" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "NetworkControllerConnection" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "CloudConnection" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ALTER COLUMN "name" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "Probe" SET "description" = LEFT("description", 50) WHERE LENGTH("description") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ALTER COLUMN "description" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `UPDATE "Probe" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ALTER COLUMN "name" TYPE character varying(50)`,
    );
  }
}
