import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778269764550 implements MigrationInterface {
  public name: string = "MigrationName1778269764550";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8d4e2a1c9f7e6d5b4a3c2f1"`,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "alertTitlePattern" character varying(500), "alertDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6c9dbd6137229235b9b1af252a5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4a4b131dd18bbc76a803e83c5" ON "AlertOnCallRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2265d50ab33f31b340dbd7e1c5" ON "AlertOnCallRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f7533fc56ab92a9f0b5adf42b" ON "AlertOnCallRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOnCallRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_274dfb8d3fd4f07e522e2d48d50" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee8c813abc47fa33d9ec2d324d" ON "IncidentOnCallRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89f9d7fb1ef687748941555da6" ON "IncidentOnCallRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ae7693f2cc42c4b800e56afc9" ON "IncidentOnCallRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallRuleMonitor" ("alertOnCallRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_595377de326048a43d794dd3c9b" PRIMARY KEY ("alertOnCallRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74773015ee78b13860cdf311ef" ON "AlertOnCallRuleMonitor" ("alertOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_934002446e1188ffacbc7099d0" ON "AlertOnCallRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallRuleAlertSeverity" ("alertOnCallRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_8529868a06397fbba2b9c5b0e73" PRIMARY KEY ("alertOnCallRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d335d45bf081c0b71378cdef7" ON "AlertOnCallRuleAlertSeverity" ("alertOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f3d68b20d26d530202656ca21" ON "AlertOnCallRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallRuleAlertLabel" ("alertOnCallRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_de3bc36c0cb2afd10709a3efa7b" PRIMARY KEY ("alertOnCallRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9e575bf173c4023a6e9a87566" ON "AlertOnCallRuleAlertLabel" ("alertOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4e21e529a12070c363e224afd" ON "AlertOnCallRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallRuleMonitorLabel" ("alertOnCallRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_de62f66cd174565d7e0b6b75733" PRIMARY KEY ("alertOnCallRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c61d19e6904fd53ffbc520d0b8" ON "AlertOnCallRuleMonitorLabel" ("alertOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ba281a0a9b75c2d4e4d87d6b6" ON "AlertOnCallRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOnCallRuleOnCallDutyPolicy" ("alertOnCallRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_7d3e574ec683c9d1a28ddad7b36" PRIMARY KEY ("alertOnCallRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3fd6fc7b70b0769cd9c1a01224" ON "AlertOnCallRuleOnCallDutyPolicy" ("alertOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30709b61cf660b91f1d1e7bf63" ON "AlertOnCallRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOnCallRuleMonitor" ("incidentOnCallRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_2696d6c4f74b064f790ac022f30" PRIMARY KEY ("incidentOnCallRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6aedd891592ba2e85336d7c5b" ON "IncidentOnCallRuleMonitor" ("incidentOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a52b1b67f7fc7b67b4f8a49bbb" ON "IncidentOnCallRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOnCallRuleIncidentSeverity" ("incidentOnCallRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_74f4b0cb422eb4f4965b1a8541f" PRIMARY KEY ("incidentOnCallRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e85d73514d380d015bc9807f0" ON "IncidentOnCallRuleIncidentSeverity" ("incidentOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0a6fd4101bcca37c27eb6b23d" ON "IncidentOnCallRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOnCallRuleIncidentLabel" ("incidentOnCallRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_1dfbc216c252d7b152ab63878ef" PRIMARY KEY ("incidentOnCallRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd7329905e711c0f1970bf81dc" ON "IncidentOnCallRuleIncidentLabel" ("incidentOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_873cbe2867e60047155ccd4884" ON "IncidentOnCallRuleIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOnCallRuleMonitorLabel" ("incidentOnCallRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_84272791db64d908291b12d6fc7" PRIMARY KEY ("incidentOnCallRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2abc579d157114fab68e2142b6" ON "IncidentOnCallRuleMonitorLabel" ("incidentOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e08475b2bded8ce999714b5bae" ON "IncidentOnCallRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOnCallRuleOnCallDutyPolicy" ("incidentOnCallRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_be2d1c0e23497656b6326d405c3" PRIMARY KEY ("incidentOnCallRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd60df040584d6a92897aca297" ON "IncidentOnCallRuleOnCallDutyPolicy" ("incidentOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a90c429e1668437593c96c99e" ON "IncidentOnCallRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_80cd6d06b0ab8fbce9fea6d3bc" ON "Service" ("projectId", "name") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD CONSTRAINT "FK_e4a4b131dd18bbc76a803e83c5c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD CONSTRAINT "FK_7fd55b457fc60d29b3e8734090b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD CONSTRAINT "FK_1f1fd464c9fc3223ea9fc70c63e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD CONSTRAINT "FK_ee8c813abc47fa33d9ec2d324d5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD CONSTRAINT "FK_25b13fbc8d2de7d884281035c73" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD CONSTRAINT "FK_d467e48bf1bcbfb721dd2a93eba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitor" ADD CONSTRAINT "FK_74773015ee78b13860cdf311ef6" FOREIGN KEY ("alertOnCallRuleId") REFERENCES "AlertOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitor" ADD CONSTRAINT "FK_934002446e1188ffacbc7099d00" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertSeverity" ADD CONSTRAINT "FK_8d335d45bf081c0b71378cdef7b" FOREIGN KEY ("alertOnCallRuleId") REFERENCES "AlertOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertSeverity" ADD CONSTRAINT "FK_8f3d68b20d26d530202656ca21d" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertLabel" ADD CONSTRAINT "FK_c9e575bf173c4023a6e9a87566b" FOREIGN KEY ("alertOnCallRuleId") REFERENCES "AlertOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertLabel" ADD CONSTRAINT "FK_c4e21e529a12070c363e224afd7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitorLabel" ADD CONSTRAINT "FK_c61d19e6904fd53ffbc520d0b87" FOREIGN KEY ("alertOnCallRuleId") REFERENCES "AlertOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitorLabel" ADD CONSTRAINT "FK_5ba281a0a9b75c2d4e4d87d6b68" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_3fd6fc7b70b0769cd9c1a01224e" FOREIGN KEY ("alertOnCallRuleId") REFERENCES "AlertOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_30709b61cf660b91f1d1e7bf637" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitor" ADD CONSTRAINT "FK_a6aedd891592ba2e85336d7c5b8" FOREIGN KEY ("incidentOnCallRuleId") REFERENCES "IncidentOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitor" ADD CONSTRAINT "FK_a52b1b67f7fc7b67b4f8a49bbbc" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentSeverity" ADD CONSTRAINT "FK_5e85d73514d380d015bc9807f0c" FOREIGN KEY ("incidentOnCallRuleId") REFERENCES "IncidentOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentSeverity" ADD CONSTRAINT "FK_c0a6fd4101bcca37c27eb6b23d8" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentLabel" ADD CONSTRAINT "FK_dd7329905e711c0f1970bf81dcb" FOREIGN KEY ("incidentOnCallRuleId") REFERENCES "IncidentOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentLabel" ADD CONSTRAINT "FK_873cbe2867e60047155ccd4884e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitorLabel" ADD CONSTRAINT "FK_2abc579d157114fab68e2142b6c" FOREIGN KEY ("incidentOnCallRuleId") REFERENCES "IncidentOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitorLabel" ADD CONSTRAINT "FK_e08475b2bded8ce999714b5bae6" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_cd60df040584d6a92897aca2970" FOREIGN KEY ("incidentOnCallRuleId") REFERENCES "IncidentOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_9a90c429e1668437593c96c99ee" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_9a90c429e1668437593c96c99ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_cd60df040584d6a92897aca2970"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitorLabel" DROP CONSTRAINT "FK_e08475b2bded8ce999714b5bae6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitorLabel" DROP CONSTRAINT "FK_2abc579d157114fab68e2142b6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentLabel" DROP CONSTRAINT "FK_873cbe2867e60047155ccd4884e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentLabel" DROP CONSTRAINT "FK_dd7329905e711c0f1970bf81dcb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentSeverity" DROP CONSTRAINT "FK_c0a6fd4101bcca37c27eb6b23d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleIncidentSeverity" DROP CONSTRAINT "FK_5e85d73514d380d015bc9807f0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitor" DROP CONSTRAINT "FK_a52b1b67f7fc7b67b4f8a49bbbc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRuleMonitor" DROP CONSTRAINT "FK_a6aedd891592ba2e85336d7c5b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_30709b61cf660b91f1d1e7bf637"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_3fd6fc7b70b0769cd9c1a01224e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitorLabel" DROP CONSTRAINT "FK_5ba281a0a9b75c2d4e4d87d6b68"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitorLabel" DROP CONSTRAINT "FK_c61d19e6904fd53ffbc520d0b87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertLabel" DROP CONSTRAINT "FK_c4e21e529a12070c363e224afd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertLabel" DROP CONSTRAINT "FK_c9e575bf173c4023a6e9a87566b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertSeverity" DROP CONSTRAINT "FK_8f3d68b20d26d530202656ca21d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleAlertSeverity" DROP CONSTRAINT "FK_8d335d45bf081c0b71378cdef7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitor" DROP CONSTRAINT "FK_934002446e1188ffacbc7099d00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRuleMonitor" DROP CONSTRAINT "FK_74773015ee78b13860cdf311ef6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP CONSTRAINT "FK_d467e48bf1bcbfb721dd2a93eba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP CONSTRAINT "FK_25b13fbc8d2de7d884281035c73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP CONSTRAINT "FK_ee8c813abc47fa33d9ec2d324d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP CONSTRAINT "FK_1f1fd464c9fc3223ea9fc70c63e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP CONSTRAINT "FK_7fd55b457fc60d29b3e8734090b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP CONSTRAINT "FK_e4a4b131dd18bbc76a803e83c5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80cd6d06b0ab8fbce9fea6d3bc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a90c429e1668437593c96c99e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd60df040584d6a92897aca297"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOnCallRuleOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e08475b2bded8ce999714b5bae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2abc579d157114fab68e2142b6"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOnCallRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_873cbe2867e60047155ccd4884"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd7329905e711c0f1970bf81dc"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOnCallRuleIncidentLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0a6fd4101bcca37c27eb6b23d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e85d73514d380d015bc9807f0"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOnCallRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a52b1b67f7fc7b67b4f8a49bbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6aedd891592ba2e85336d7c5b"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOnCallRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30709b61cf660b91f1d1e7bf63"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fd6fc7b70b0769cd9c1a01224"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallRuleOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ba281a0a9b75c2d4e4d87d6b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c61d19e6904fd53ffbc520d0b8"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c4e21e529a12070c363e224afd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9e575bf173c4023a6e9a87566"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallRuleAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f3d68b20d26d530202656ca21"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d335d45bf081c0b71378cdef7"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_934002446e1188ffacbc7099d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74773015ee78b13860cdf311ef"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ae7693f2cc42c4b800e56afc9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89f9d7fb1ef687748941555da6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee8c813abc47fa33d9ec2d324d"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOnCallRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f7533fc56ab92a9f0b5adf42b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2265d50ab33f31b340dbd7e1c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4a4b131dd18bbc76a803e83c5"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOnCallRule"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b8d4e2a1c9f7e6d5b4a3c2f1" ON "Service" ("projectId", "name") `,
    );
  }
}
