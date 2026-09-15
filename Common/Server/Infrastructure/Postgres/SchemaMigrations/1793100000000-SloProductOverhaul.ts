import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Schema for the SLO product overhaul. Generated against the models with
 * `migration:generate`, then renamed to its round stamp.
 *
 *   - ServiceLevelObjectiveMonitorRule, plus its label join table
 *     ServiceLevelObjectiveMonitorRuleMonitorLabel: rules that attach matching
 *     monitors to an SLO, superseding the per-SLO label list. A brand-new
 *     rule table, so unlike the tables in
 *     AddConfigurableRuleCriteria1792500000000 it needs no legacy-shadow
 *     trigger - no older worker has ever read it.
 *
 *   - ServiceLevelObjectiveFeed: the append-only activity feed of an SLO,
 *     indexed on (serviceLevelObjectiveId, postedAt) for the feed page.
 *
 *   - ServiceLevelObjective archive columns: isArchived NOT NULL DEFAULT false
 *     (so every existing SLO stays live and `isArchived: false` still selects
 *     it), archivedAt, archivedByUserId (SET NULL, so deleting the archiving
 *     user keeps the SLO), and the (projectId, isArchived) list index.
 *
 *   - ServiceLevelObjectiveBurnRateRule alert and incident output options:
 *     title / description templates and remediation notes (nullable - blank
 *     means the built-in text), private flags (DEFAULT false), auto-resolve
 *     (DEFAULT true, which is what every rule has always done),
 *     addSloOwnersAsOwners (DEFAULT false), and six label / owner-team /
 *     owner-user join tables whose CASCADE foreign keys let a deleted label,
 *     team or user simply drop out of a rule.
 *
 *   - IncidentServiceLevelObjective / AlertServiceLevelObjective: the SLO as
 *     an affected resource of the incidents and alerts it raises.
 *
 * Every new column is nullable or defaulted, so existing rows, the burn rate
 * rules seeded on SLO create, and API pods of the previous release keep
 * working unchanged. The deprecated ServiceLevelObjectiveMonitorLabel table
 * is deliberately left in place for that rolling-deploy window. Existing data
 * is moved by BackfillSloMonitorRulesAndAffectedResources1793200000000.
 *
 * down() drops the new tables, which destroys monitor rules, feed history and
 * burn rate output configuration - a last resort.
 */
export class SloProductOverhaul1793100000000 implements MigrationInterface {
  public name: string = "SloProductOverhaul1793100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveMonitorRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b7c552187285c463ec07a8f191f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cce44581df9a28439a4d139bae" ON "ServiceLevelObjectiveMonitorRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdf3665dcafdb47aeb0693821f" ON "ServiceLevelObjectiveMonitorRule" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c13637f08932b128230dd94f02" ON "ServiceLevelObjectiveMonitorRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96a13bf73eb5dc34c8964974b0" ON "ServiceLevelObjectiveMonitorRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "serviceLevelObjectiveFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7d23da1a549d9f6c6077ea00277" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01c46e1082108f2f2628dd8f9b" ON "ServiceLevelObjectiveFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2a5462cfe73f58878b40ad586" ON "ServiceLevelObjectiveFeed" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d341661c8253950891d74b28f" ON "ServiceLevelObjectiveFeed" ("serviceLevelObjectiveId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentServiceLevelObjective" ("incidentId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, CONSTRAINT "PK_f480e9d35c6719f707a5b268394" PRIMARY KEY ("incidentId", "serviceLevelObjectiveId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76400f2f9b72cf93b48e6a0f4d" ON "IncidentServiceLevelObjective" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_347de6d20848f909c671ce8047" ON "IncidentServiceLevelObjective" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertServiceLevelObjective" ("alertId" uuid NOT NULL, "serviceLevelObjectiveId" uuid NOT NULL, CONSTRAINT "PK_ff60ef629700a1d524d0591d3bd" PRIMARY KEY ("alertId", "serviceLevelObjectiveId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f7248d4d1690ead1310fd7180" ON "AlertServiceLevelObjective" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a881e4a77d1b82993db3ccba3" ON "AlertServiceLevelObjective" ("serviceLevelObjectiveId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleAlertLabel" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8175ec2540583f8dbcaac0518be" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_139f0af5194ce028d6d59af5b8" ON "ServiceLevelObjectiveBurnRateRuleAlertLabel" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07d742907fc6ba3356616f0c4a" ON "ServiceLevelObjectiveBurnRateRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_423e0e40ad27d17054e4f5b2bfb" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f4e3b75748725989bf2abb7e76" ON "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e5f77451f0ae4af7ffde17031" ON "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_6d34aa50cb3df8c4da78be84897" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5ff9fc2a9b85d9b98ab500515" ON "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_324dd22ac03ad268bc4210ea0d" ON "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleIncidentLabel" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ec5a1c10a7c830aaa9508f398ca" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abdad9904dc46629e5cf73ca84" ON "ServiceLevelObjectiveBurnRateRuleIncidentLabel" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_665c0371722248ce2534062b38" ON "ServiceLevelObjectiveBurnRateRuleIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_6568fd16f17b2117999a1d0205f" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_54c28e68e28f15aeb6ddcc9ac7" ON "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdcbfb5b0b00816f97012fcf77" ON "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" ("serviceLevelObjectiveBurnRateRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_df4d0575167627759f5bfb9eb89" PRIMARY KEY ("serviceLevelObjectiveBurnRateRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c95b977b01ef5359125604e1ea" ON "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" ("serviceLevelObjectiveBurnRateRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ac739adb30c2428aaf37c0b4c" ON "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9b77a42ae703f13dcc0c9ec3250" PRIMARY KEY ("serviceLevelObjectiveMonitorRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fb16c7341a45f84f1b071f560" ON "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62b5fe5ad1e97a405ed3254d72" ON "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "alertTitleTemplate" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "alertDescriptionTemplate" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "alertRemediationNotes" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "isAlertPrivate" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "autoResolveAlert" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "incidentTitleTemplate" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "incidentDescriptionTemplate" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "incidentRemediationNotes" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "isIncidentPrivate" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "autoResolveIncident" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" ADD "addSloOwnersAsOwners" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bdf8df0961417c55c4e3e60e18" ON "ServiceLevelObjective" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD CONSTRAINT "FK_21dc2a9bdc09c1583b064e56da9" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD CONSTRAINT "FK_cce44581df9a28439a4d139baea" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD CONSTRAINT "FK_fdf3665dcafdb47aeb0693821fb" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD CONSTRAINT "FK_52790d16b2ad4cad8ab5fcf09e8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD CONSTRAINT "FK_eb0531401161a4c0bef96c707d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" ADD CONSTRAINT "FK_01c46e1082108f2f2628dd8f9b0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" ADD CONSTRAINT "FK_f2a5462cfe73f58878b40ad586a" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" ADD CONSTRAINT "FK_f525798ae3bb505e1fda7d41373" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" ADD CONSTRAINT "FK_1ada39b3bbe17bfbabdd0dc76e2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" ADD CONSTRAINT "FK_d435e17714b61fc91c9dcd921b7" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentServiceLevelObjective" ADD CONSTRAINT "FK_76400f2f9b72cf93b48e6a0f4db" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentServiceLevelObjective" ADD CONSTRAINT "FK_347de6d20848f909c671ce8047b" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertServiceLevelObjective" ADD CONSTRAINT "FK_8f7248d4d1690ead1310fd71800" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertServiceLevelObjective" ADD CONSTRAINT "FK_9a881e4a77d1b82993db3ccba3e" FOREIGN KEY ("serviceLevelObjectiveId") REFERENCES "ServiceLevelObjective"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertLabel" ADD CONSTRAINT "FK_139f0af5194ce028d6d59af5b85" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertLabel" ADD CONSTRAINT "FK_07d742907fc6ba3356616f0c4a3" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" ADD CONSTRAINT "FK_f4e3b75748725989bf2abb7e763" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" ADD CONSTRAINT "FK_8e5f77451f0ae4af7ffde170317" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" ADD CONSTRAINT "FK_e5ff9fc2a9b85d9b98ab500515d" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" ADD CONSTRAINT "FK_324dd22ac03ad268bc4210ea0d1" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentLabel" ADD CONSTRAINT "FK_abdad9904dc46629e5cf73ca84a" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentLabel" ADD CONSTRAINT "FK_665c0371722248ce2534062b38b" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" ADD CONSTRAINT "FK_54c28e68e28f15aeb6ddcc9ac71" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" ADD CONSTRAINT "FK_bdcbfb5b0b00816f97012fcf77d" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" ADD CONSTRAINT "FK_c95b977b01ef5359125604e1ead" FOREIGN KEY ("serviceLevelObjectiveBurnRateRuleId") REFERENCES "ServiceLevelObjectiveBurnRateRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" ADD CONSTRAINT "FK_2ac739adb30c2428aaf37c0b4ce" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel" ADD CONSTRAINT "FK_1fb16c7341a45f84f1b071f5603" FOREIGN KEY ("serviceLevelObjectiveMonitorRuleId") REFERENCES "ServiceLevelObjectiveMonitorRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel" ADD CONSTRAINT "FK_62b5fe5ad1e97a405ed3254d728" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel" DROP CONSTRAINT "FK_62b5fe5ad1e97a405ed3254d728"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel" DROP CONSTRAINT "FK_1fb16c7341a45f84f1b071f5603"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" DROP CONSTRAINT "FK_2ac739adb30c2428aaf37c0b4ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser" DROP CONSTRAINT "FK_c95b977b01ef5359125604e1ead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" DROP CONSTRAINT "FK_bdcbfb5b0b00816f97012fcf77d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam" DROP CONSTRAINT "FK_54c28e68e28f15aeb6ddcc9ac71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentLabel" DROP CONSTRAINT "FK_665c0371722248ce2534062b38b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleIncidentLabel" DROP CONSTRAINT "FK_abdad9904dc46629e5cf73ca84a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" DROP CONSTRAINT "FK_324dd22ac03ad268bc4210ea0d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser" DROP CONSTRAINT "FK_e5ff9fc2a9b85d9b98ab500515d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" DROP CONSTRAINT "FK_8e5f77451f0ae4af7ffde170317"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam" DROP CONSTRAINT "FK_f4e3b75748725989bf2abb7e763"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertLabel" DROP CONSTRAINT "FK_07d742907fc6ba3356616f0c4a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRuleAlertLabel" DROP CONSTRAINT "FK_139f0af5194ce028d6d59af5b85"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertServiceLevelObjective" DROP CONSTRAINT "FK_9a881e4a77d1b82993db3ccba3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertServiceLevelObjective" DROP CONSTRAINT "FK_8f7248d4d1690ead1310fd71800"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentServiceLevelObjective" DROP CONSTRAINT "FK_347de6d20848f909c671ce8047b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentServiceLevelObjective" DROP CONSTRAINT "FK_76400f2f9b72cf93b48e6a0f4db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" DROP CONSTRAINT "FK_d435e17714b61fc91c9dcd921b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" DROP CONSTRAINT "FK_1ada39b3bbe17bfbabdd0dc76e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" DROP CONSTRAINT "FK_f525798ae3bb505e1fda7d41373"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" DROP CONSTRAINT "FK_f2a5462cfe73f58878b40ad586a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveFeed" DROP CONSTRAINT "FK_01c46e1082108f2f2628dd8f9b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP CONSTRAINT "FK_eb0531401161a4c0bef96c707d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP CONSTRAINT "FK_52790d16b2ad4cad8ab5fcf09e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP CONSTRAINT "FK_fdf3665dcafdb47aeb0693821fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP CONSTRAINT "FK_cce44581df9a28439a4d139baea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP CONSTRAINT "FK_21dc2a9bdc09c1583b064e56da9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdf8df0961417c55c4e3e60e18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "addSloOwnersAsOwners"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "autoResolveIncident"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "isIncidentPrivate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "incidentRemediationNotes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "incidentDescriptionTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "incidentTitleTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "autoResolveAlert"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "isAlertPrivate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "alertRemediationNotes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "alertDescriptionTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveBurnRateRule" DROP COLUMN "alertTitleTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62b5fe5ad1e97a405ed3254d72"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fb16c7341a45f84f1b071f560"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveMonitorRuleMonitorLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ac739adb30c2428aaf37c0b4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c95b977b01ef5359125604e1ea"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bdcbfb5b0b00816f97012fcf77"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_54c28e68e28f15aeb6ddcc9ac7"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleIncidentOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_665c0371722248ce2534062b38"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abdad9904dc46629e5cf73ca84"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleIncidentLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_324dd22ac03ad268bc4210ea0d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5ff9fc2a9b85d9b98ab500515"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e5f77451f0ae4af7ffde17031"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f4e3b75748725989bf2abb7e76"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleAlertOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07d742907fc6ba3356616f0c4a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_139f0af5194ce028d6d59af5b8"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveBurnRateRuleAlertLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a881e4a77d1b82993db3ccba3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f7248d4d1690ead1310fd7180"`,
    );
    await queryRunner.query(`DROP TABLE "AlertServiceLevelObjective"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_347de6d20848f909c671ce8047"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76400f2f9b72cf93b48e6a0f4d"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentServiceLevelObjective"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d341661c8253950891d74b28f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2a5462cfe73f58878b40ad586"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01c46e1082108f2f2628dd8f9b"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96a13bf73eb5dc34c8964974b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c13637f08932b128230dd94f02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fdf3665dcafdb47aeb0693821f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cce44581df9a28439a4d139bae"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveMonitorRule"`);
  }
}
