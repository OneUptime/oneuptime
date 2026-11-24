import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * THE LOOKUP OF A NAME A PROJECT REQUIRES TO BE ONE OF ITS KIND, INDEXED
 * (#10761).
 *
 * While a project requires unique names (Project "requireUniqueNames",
 * 1809187640000-AddProjectRequireUniqueNames), every create and rename of a
 * kind a model marks @UniqueNameWhenRequired looks for another record of the
 * kind in the project with the name as it reads: case and spacing aside
 * (Types/Database/UniqueName, QueryHelper.findWithSameName):
 *
 *   WHERE "projectId" = $1
 *     AND LOWER(BTRIM(REGEXP_REPLACE("name", $2, ' ', 'g')))
 *       = LOWER(BTRIM(REGEXP_REPLACE(CAST($3 AS TEXT), $2, ' ', 'g')))
 *     AND "deletedAt" IS NULL
 *
 * Each of these indexes holds exactly that: the project, then the name as
 * Postgres reads it - every run of white space one space, none around it, in
 * lower case - of the records in service. Postgres plans each of those
 * statements with its values (node-postgres sends them unnamed), folds the
 * bound pattern into the expression, and matches it to the index, so the
 * lookup is one index probe however many records the project holds
 * (RequiredUniqueNamesPostgres reads the plan). The list of the names a
 * project holds twice (Project Settings > Project) reads the project's part
 * of it too.
 *
 * Hand-written, as 1786100000000-RestoreServiceLowerNameIndex is: @Index()
 * cannot express an expression, so the generator can neither write nor
 * round-trip these. Each entity declares its index by name with
 * UNSYNCHRONIZED_INDEX, so the schema builder never drops it, and the drift
 * check finds nothing to make again.
 *
 * NOT UNIQUE, DELIBERATELY: a project that existed before may hold a name
 * twice, and whether names repeat is the project's to switch on and off. The
 * rule is the service's, under a lock (RequiredUniqueNames); the index only
 * makes its lookup fast.
 *
 * The pattern is written into the migration as it was when it ran: a later
 * change to NAME_WHITE_SPACE_RUN_PATTERN needs a migration that builds the
 * indexes again, or the planner stops matching them
 * (RequiredUniqueNamesMigration compares the two). Built online, one table at
 * a time - Monitor is written by every probe result - and safe to run again
 * after a stop part way: an index already valid is left as it is
 * (OnlineDdl.createIndex).
 */

/*
 * The white space a name can hold, as a bracket expression of a regular
 * expression: tab, line feed, vertical tab, form feed, carriage return,
 * space, no-break space, Ogham space mark, line and paragraph separators,
 * narrow no-break and medium mathematical spaces, ideographic space and the
 * byte order mark, then the en quad to the hair space.
 */
const NAME_WHITE_SPACE_RUN: string = `[${String.fromCharCode(
  0x09,
  0x0a,
  0x0b,
  0x0c,
  0x0d,
  0x20,
  0xa0,
  0x1680,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
)}${String.fromCharCode(0x2000)}-${String.fromCharCode(0x200a)}]+`;

export class AddUniqueNameIndexes1809187640010 implements MigrationInterface {
  public name: string = "AddUniqueNameIndexes1809187640010";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_MONITOR_PROJECT_NAME_KEY" ON "Monitor" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_MONITORGROUP_PROJECT_NAME_KEY" ON "MonitorGroup" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_PROBE_PROJECT_NAME_KEY" ON "Probe" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SERVICELEVELOBJECTIVE_PROJECT_NAME_KEY" ON "ServiceLevelObjective" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_INCOMINGCALLPOLICY_PROJECT_NAME_KEY" ON "IncomingCallPolicy" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_WORKSPACENOTIFICATIONSUMMARY_PROJECT_NAME_KEY" ON "WorkspaceNotificationSummary" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_VIDEOCALLCONNECTION_PROJECT_NAME_KEY" ON "VideoCallConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_CUSTOMROLE_PROJECT_NAME_KEY" ON "CustomRole" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_APIKEY_PROJECT_NAME_KEY" ON "ApiKey" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_TELEMETRYINGESTIONKEY_PROJECT_NAME_KEY" ON "TelemetryIngestionKey" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_LOGPIPELINE_PROJECT_NAME_KEY" ON "LogPipeline" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_TRACEPIPELINE_PROJECT_NAME_KEY" ON "TracePipeline" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_CLOUDCONNECTION_PROJECT_NAME_KEY" ON "CloudConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_CLOUDBUDGET_PROJECT_NAME_KEY" ON "CloudBudget" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_OPENSTACKBUDGET_PROJECT_NAME_KEY" ON "OpenStackBudget" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_DATABICONNECTION_PROJECT_NAME_KEY" ON "DataBiConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_DATAPRODUCT_PROJECT_NAME_KEY" ON "DataProduct" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_DATARECONCILIATION_PROJECT_NAME_KEY" ON "DataReconciliation" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_DATASECURITYCUSTOMDATATYPE_PROJECT_NAME_KEY" ON "DataSecurityCustomDataType" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYAUTOMATICRESPONSEPOLICY_PROJECT_NAME_KEY" ON "SecurityAutomaticResponsePolicy" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYBLOCKLISTFEED_PROJECT_NAME_KEY" ON "SecurityBlocklistFeed" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYEVENTCONNECTION_PROJECT_NAME_KEY" ON "SecurityEventConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYEVENTDESTINATION_PROJECT_NAME_KEY" ON "SecurityEventDestination" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYHUNT_PROJECT_NAME_KEY" ON "SecurityHunt" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYPLAYBOOK_PROJECT_NAME_KEY" ON "SecurityPlaybook" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_THREATINTELFEED_PROJECT_NAME_KEY" ON "ThreatIntelFeed" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_NETWORKCONTROLLERCONNECTION_PROJECT_NAME_KEY" ON "NetworkControllerConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_NETWORKDEVICEDISCOVERYSCAN_PROJECT_NAME_KEY" ON "NetworkDeviceDiscoveryScan" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_DEVICEMANAGEMENTCONNECTION_PROJECT_NAME_KEY" ON "DeviceManagementConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SCHEDULEDMAINTENANCEEXTERNALCALENDAR_PROJECT_NAME_KEY" ON "ScheduledMaintenanceExternalCalendar" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_AIAGENT_PROJECT_NAME_KEY" ON "AIAgent" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_EXTERNALMCPSERVER_PROJECT_NAME_KEY" ON "ExternalMcpServer" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_LLMPROVIDER_PROJECT_NAME_KEY" ON "LlmProvider" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_LLMCOSTBUDGET_PROJECT_NAME_KEY" ON "LlmCostBudget" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_LLMOBSERVABILITYCONNECTION_PROJECT_NAME_KEY" ON "LlmObservabilityConnection" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_AUDITLOGEXPORT_PROJECT_NAME_KEY" ON "AuditLogExport" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("name", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_ALERTNOTETEMPLATE_PROJECT_NAME_KEY" ON "AlertNoteTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_INCIDENTTEMPLATE_PROJECT_NAME_KEY" ON "IncidentTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_INCIDENTPOSTMORTEMTEMPLATE_PROJECT_NAME_KEY" ON "IncidentPostmortemTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_INCIDENTNOTETEMPLATE_PROJECT_NAME_KEY" ON "IncidentNoteTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_MONITORTEMPLATE_PROJECT_NAME_KEY" ON "MonitorTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SCHEDULEDMAINTENANCENOTETEMPLATE_PROJECT_NAME_KEY" ON "ScheduledMaintenanceNoteTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SECURITYCASENOTETEMPLATE_PROJECT_NAME_KEY" ON "SecurityCaseNoteTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_SCHEDULEDMAINTENANCETEMPLATE_PROJECT_NAME_KEY" ON "ScheduledMaintenanceTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_STATUSPAGEANNOUNCEMENTTEMPLATE_PROJECT_NAME_KEY" ON "StatusPageAnnouncementTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_STATUSPAGESUBSCRIBERNOTIFICATIONTEMPLATE_PROJECT_NAME_KEY" ON "StatusPageSubscriberNotificationTemplate" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("templateName", '${NAME_WHITE_SPACE_RUN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_STATUSPAGESUBSCRIBERNOTIFICATIONTEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_STATUSPAGEANNOUNCEMENTTEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SCHEDULEDMAINTENANCETEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYCASENOTETEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SCHEDULEDMAINTENANCENOTETEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_MONITORTEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_INCIDENTNOTETEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_INCIDENTPOSTMORTEMTEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_INCIDENTTEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_ALERTNOTETEMPLATE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_AUDITLOGEXPORT_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_LLMOBSERVABILITYCONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_LLMCOSTBUDGET_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_LLMPROVIDER_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_EXTERNALMCPSERVER_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_AIAGENT_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SCHEDULEDMAINTENANCEEXTERNALCALENDAR_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_DEVICEMANAGEMENTCONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_NETWORKDEVICEDISCOVERYSCAN_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_NETWORKCONTROLLERCONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_THREATINTELFEED_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYPLAYBOOK_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYHUNT_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYEVENTDESTINATION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYEVENTCONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYBLOCKLISTFEED_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SECURITYAUTOMATICRESPONSEPOLICY_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_DATASECURITYCUSTOMDATATYPE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_DATARECONCILIATION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_DATAPRODUCT_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_DATABICONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_OPENSTACKBUDGET_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_CLOUDBUDGET_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_CLOUDCONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_TRACEPIPELINE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_LOGPIPELINE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_TELEMETRYINGESTIONKEY_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_APIKEY_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_CUSTOMROLE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_VIDEOCALLCONNECTION_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_WORKSPACENOTIFICATIONSUMMARY_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_INCOMINGCALLPOLICY_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_SERVICELEVELOBJECTIVE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_PROBE_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_MONITORGROUP_PROJECT_NAME_KEY"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_MONITOR_PROJECT_NAME_KEY"`,
    );
  }
}
