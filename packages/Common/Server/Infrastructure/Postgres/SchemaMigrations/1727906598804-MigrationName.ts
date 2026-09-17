import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1727906598804 implements MigrationInterface {
  public name = "MigrationName1727906598804";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertSeverity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "color" character varying(7) NOT NULL, "order" smallint NOT NULL, CONSTRAINT "PK_6ed0de1b0a2ea665f42e3599b0e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9282bdc00276db13fd8598f91b" ON "AlertSeverity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertState" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "color" character varying(7) NOT NULL, "isCreatedState" boolean NOT NULL DEFAULT false, "isAcknowledgedState" boolean NOT NULL DEFAULT false, "isResolvedState" boolean NOT NULL DEFAULT false, "order" smallint NOT NULL, CONSTRAINT "PK_1528832ec6759d219df5993a5a3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_57304bde1da0266fc24f840768" ON "AlertState" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "Alert" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "title" character varying(500) NOT NULL, "description" text, "createdByUserId" uuid, "deletedByUserId" uuid, "monitorId" uuid, "currentAlertStateId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, "monitorStatusWhenThisAlertWasCreatedId" uuid, "customFields" jsonb, "isOwnerNotifiedOfAlertCreation" boolean NOT NULL DEFAULT false, "rootCause" text, "createdStateLog" jsonb, "createdCriteriaId" character varying, "createdByProbeId" uuid, "isCreatedAutomatically" boolean NOT NULL DEFAULT false, "remediationNotes" text, "telemetryQuery" jsonb, CONSTRAINT "PK_7e054682f5fe26a28bfc5aa2c12" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e36243cde1e1a428f6849b04a" ON "Alert" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_866d739479c4e601de0dbc188b" ON "Alert" ("title") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_677264df22b80ae07ec5dcc58d" ON "Alert" ("currentAlertStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_531522bec85f8979124a6933c0" ON "Alert" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6c0e4f6713391fea9dba60f0d" ON "Alert" ("monitorStatusWhenThisAlertWasCreatedId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2c672ed402faa9398c77c812c" ON "Alert" ("isOwnerNotifiedOfAlertCreation") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc40ea6a9ad55f29bca4f4a15d" ON "Alert" ("rootCause") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f145da4b9636cb503cc92a60b2" ON "Alert" ("createdCriteriaId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a8075521492cc168e9fb20f1f" ON "Alert" ("createdByProbeId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertCustomField" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "type" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_fa936db1d883a68866604b2825a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1cda5dc3d011f1440dae232555" ON "AlertCustomField" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertStateTimeline" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "alertStateId" uuid NOT NULL, "isOwnerNotified" boolean NOT NULL DEFAULT false, "stateChangeLog" jsonb, "rootCause" text, "endsAt" TIMESTAMP WITH TIME ZONE, "startsAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_54fbded96ccc49e72a611c923b4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e1683045d3529f17c8513c3aa" ON "AlertStateTimeline" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f241a1bd90518432352e8fa16" ON "AlertStateTimeline" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dbf0191a98672bcb73f65febac" ON "AlertStateTimeline" ("alertStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a79e63f3551c714f68cf74697" ON "AlertStateTimeline" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3ec412714adf41d1c4e2f8953" ON "AlertStateTimeline" ("rootCause") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b373fde634db572b38010711c" ON "AlertStateTimeline" ("endsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_551162036adb80d1fc656f36f4" ON "AlertStateTimeline" ("startsAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertInternalNote" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "note" text NOT NULL, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_8c4bd0d9933bdb8d56774f4281b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c17364695141773034905d18b3" ON "AlertInternalNote" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e9db01b4edbf4334fe7e16977" ON "AlertInternalNote" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51d2371a3486316187d867b633" ON "AlertInternalNote" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_191d3751f2bfe744f8f25882bca" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80246f033af28239e28b127db7" ON "AlertOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b397c3a2cecf8e9e6d912ad918" ON "AlertOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30e45da79b4fbdc37c1024dd1c" ON "AlertOwnerTeam" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d646dd6af109328bd4d6c50e0" ON "AlertOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "alertId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_1669ffac6383d5c90034cb3cdd3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96d7a6732b594035999ae417c3" ON "AlertOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a8efa9f26e3d4ed34d8b61d0e0" ON "AlertOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4645cc7f80367417846c0e7b3f" ON "AlertOwnerUser" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_056ca186eec3d557bf8f17a82b" ON "AlertOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertNoteTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "note" text NOT NULL, "templateName" character varying(100) NOT NULL, "templateDescription" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_774a57b039546a74edc6210db5d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10e46b1072581d7cef2ec65429" ON "AlertNoteTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77f48204935c346470fde06b81" ON "AlertNoteTemplate" ("note") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallDutyPolicy" ("onCallDutyPolicyId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_adaff6d89a87bbe9c3cfb8f70fc" PRIMARY KEY ("onCallDutyPolicyId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eca13d28cf4d2349406ddebc5" ON "AlertOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ef6702995a8406630f75f06e2" ON "AlertOnCallDutyPolicy" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertLabel" ("alertId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fa2364f55ffe0e9077add397989" PRIMARY KEY ("alertId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af62b88e73f56e8fcaffbbd965" ON "AlertLabel" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_507fd32e297f0287df932d7550" ON "AlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "triggeredByAlertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" ADD CONSTRAINT "FK_9282bdc00276db13fd8598f91bf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" ADD CONSTRAINT "FK_c9e714da15a75b6fdfdeaf1d0ec" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" ADD CONSTRAINT "FK_9b75d7937e702dee283256ad975" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" ADD CONSTRAINT "FK_57304bde1da0266fc24f8407682" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" ADD CONSTRAINT "FK_fa9909aa59e53665dae7273462c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" ADD CONSTRAINT "FK_570b9cc5f95f8a70d0b80ef5739" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_3e36243cde1e1a428f6849b04ac" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_b15c80ee3b9d22bc675c6c5caf0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_6efa9972d8181f4ea785c0eec47" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_b57071fc2f1e27430e651382ee2" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_677264df22b80ae07ec5dcc58de" FOREIGN KEY ("currentAlertStateId") REFERENCES "AlertState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_531522bec85f8979124a6933c0c" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_f6c0e4f6713391fea9dba60f0d7" FOREIGN KEY ("monitorStatusWhenThisAlertWasCreatedId") REFERENCES "MonitorStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_1a8075521492cc168e9fb20f1f6" FOREIGN KEY ("createdByProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_b495684ae5b9c2a5b8dba6c1d4b" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ADD CONSTRAINT "FK_1cda5dc3d011f1440dae232555f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ADD CONSTRAINT "FK_19ea4088de9a1b73a50ea819c75" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" ADD CONSTRAINT "FK_8e723a6fa604c897191370f826f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" ADD CONSTRAINT "FK_8e1683045d3529f17c8513c3aa3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" ADD CONSTRAINT "FK_8f241a1bd90518432352e8fa166" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" ADD CONSTRAINT "FK_e5c618f2c34dab1b89411cfd293" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" ADD CONSTRAINT "FK_37d090181ab909ec9c07907eddc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" ADD CONSTRAINT "FK_dbf0191a98672bcb73f65febac5" FOREIGN KEY ("alertStateId") REFERENCES "AlertState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD CONSTRAINT "FK_c17364695141773034905d18b39" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD CONSTRAINT "FK_9e9db01b4edbf4334fe7e169774" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD CONSTRAINT "FK_b1aa4299b8f1544197ac8b77c1a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD CONSTRAINT "FK_6aaff72bf94da7e28c6d4a8f415" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" ADD CONSTRAINT "FK_80246f033af28239e28b127db75" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" ADD CONSTRAINT "FK_b397c3a2cecf8e9e6d912ad9183" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" ADD CONSTRAINT "FK_30e45da79b4fbdc37c1024dd1c6" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" ADD CONSTRAINT "FK_19a1e046b8e057579ccbcbee35b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" ADD CONSTRAINT "FK_c43d8b8fde990031819baf85fb5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" ADD CONSTRAINT "FK_96d7a6732b594035999ae417c31" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" ADD CONSTRAINT "FK_a8efa9f26e3d4ed34d8b61d0e06" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" ADD CONSTRAINT "FK_4645cc7f80367417846c0e7b3f7" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" ADD CONSTRAINT "FK_f94f0f3993386069d0fb91b3f91" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" ADD CONSTRAINT "FK_bc0d78ab13b336f5dbe1e678009" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNoteTemplate" ADD CONSTRAINT "FK_10e46b1072581d7cef2ec654295" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNoteTemplate" ADD CONSTRAINT "FK_d1be4ede264845aea13ed630d54" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNoteTemplate" ADD CONSTRAINT "FK_d3be3bbe53d9fa76ca5cf12cc0f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" ADD CONSTRAINT "FK_1ef6702995a8406630f75f06e28" FOREIGN KEY ("monitorId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabel" ADD CONSTRAINT "FK_af62b88e73f56e8fcaffbbd965e" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabel" ADD CONSTRAINT "FK_507fd32e297f0287df932d7550d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertLabel" DROP CONSTRAINT "FK_507fd32e297f0287df932d7550d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabel" DROP CONSTRAINT "FK_af62b88e73f56e8fcaffbbd965e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_1ef6702995a8406630f75f06e28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallDutyPolicy" DROP CONSTRAINT "FK_0eca13d28cf4d2349406ddebc5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNoteTemplate" DROP CONSTRAINT "FK_d3be3bbe53d9fa76ca5cf12cc0f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNoteTemplate" DROP CONSTRAINT "FK_d1be4ede264845aea13ed630d54"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertNoteTemplate" DROP CONSTRAINT "FK_10e46b1072581d7cef2ec654295"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" DROP CONSTRAINT "FK_bc0d78ab13b336f5dbe1e678009"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" DROP CONSTRAINT "FK_f94f0f3993386069d0fb91b3f91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" DROP CONSTRAINT "FK_4645cc7f80367417846c0e7b3f7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" DROP CONSTRAINT "FK_a8efa9f26e3d4ed34d8b61d0e06"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerUser" DROP CONSTRAINT "FK_96d7a6732b594035999ae417c31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" DROP CONSTRAINT "FK_c43d8b8fde990031819baf85fb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" DROP CONSTRAINT "FK_19a1e046b8e057579ccbcbee35b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" DROP CONSTRAINT "FK_30e45da79b4fbdc37c1024dd1c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" DROP CONSTRAINT "FK_b397c3a2cecf8e9e6d912ad9183"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerTeam" DROP CONSTRAINT "FK_80246f033af28239e28b127db75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP CONSTRAINT "FK_6aaff72bf94da7e28c6d4a8f415"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP CONSTRAINT "FK_b1aa4299b8f1544197ac8b77c1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP CONSTRAINT "FK_9e9db01b4edbf4334fe7e169774"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP CONSTRAINT "FK_c17364695141773034905d18b39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" DROP CONSTRAINT "FK_dbf0191a98672bcb73f65febac5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" DROP CONSTRAINT "FK_37d090181ab909ec9c07907eddc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" DROP CONSTRAINT "FK_e5c618f2c34dab1b89411cfd293"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" DROP CONSTRAINT "FK_8f241a1bd90518432352e8fa166"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertStateTimeline" DROP CONSTRAINT "FK_8e1683045d3529f17c8513c3aa3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" DROP CONSTRAINT "FK_8e723a6fa604c897191370f826f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" DROP CONSTRAINT "FK_19ea4088de9a1b73a50ea819c75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" DROP CONSTRAINT "FK_1cda5dc3d011f1440dae232555f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_b495684ae5b9c2a5b8dba6c1d4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_1a8075521492cc168e9fb20f1f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_f6c0e4f6713391fea9dba60f0d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_531522bec85f8979124a6933c0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_677264df22b80ae07ec5dcc58de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_b57071fc2f1e27430e651382ee2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_6efa9972d8181f4ea785c0eec47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_b15c80ee3b9d22bc675c6c5caf0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_3e36243cde1e1a428f6849b04ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP CONSTRAINT "FK_570b9cc5f95f8a70d0b80ef5739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP CONSTRAINT "FK_fa9909aa59e53665dae7273462c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP CONSTRAINT "FK_57304bde1da0266fc24f8407682"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP CONSTRAINT "FK_9b75d7937e702dee283256ad975"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP CONSTRAINT "FK_c9e714da15a75b6fdfdeaf1d0ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP CONSTRAINT "FK_9282bdc00276db13fd8598f91bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "triggeredByAlertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_507fd32e297f0287df932d7550"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af62b88e73f56e8fcaffbbd965"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ef6702995a8406630f75f06e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eca13d28cf4d2349406ddebc5"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77f48204935c346470fde06b81"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10e46b1072581d7cef2ec65429"`,
    );
    await queryRunner.query(`DROP TABLE "AlertNoteTemplate"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_056ca186eec3d557bf8f17a82b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4645cc7f80367417846c0e7b3f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a8efa9f26e3d4ed34d8b61d0e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96d7a6732b594035999ae417c3"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d646dd6af109328bd4d6c50e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30e45da79b4fbdc37c1024dd1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b397c3a2cecf8e9e6d912ad918"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80246f033af28239e28b127db7"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51d2371a3486316187d867b633"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e9db01b4edbf4334fe7e16977"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c17364695141773034905d18b3"`,
    );
    await queryRunner.query(`DROP TABLE "AlertInternalNote"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_551162036adb80d1fc656f36f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b373fde634db572b38010711c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3ec412714adf41d1c4e2f8953"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a79e63f3551c714f68cf74697"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dbf0191a98672bcb73f65febac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f241a1bd90518432352e8fa16"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e1683045d3529f17c8513c3aa"`,
    );
    await queryRunner.query(`DROP TABLE "AlertStateTimeline"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1cda5dc3d011f1440dae232555"`,
    );
    await queryRunner.query(`DROP TABLE "AlertCustomField"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a8075521492cc168e9fb20f1f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f145da4b9636cb503cc92a60b2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc40ea6a9ad55f29bca4f4a15d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2c672ed402faa9398c77c812c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6c0e4f6713391fea9dba60f0d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_531522bec85f8979124a6933c0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_677264df22b80ae07ec5dcc58d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_866d739479c4e601de0dbc188b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e36243cde1e1a428f6849b04a"`,
    );
    await queryRunner.query(`DROP TABLE "Alert"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_57304bde1da0266fc24f840768"`,
    );
    await queryRunner.query(`DROP TABLE "AlertState"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9282bdc00276db13fd8598f91b"`,
    );
    await queryRunner.query(`DROP TABLE "AlertSeverity"`);
  }
}
