import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778274719786 implements MigrationInterface {
  public name: string = "MigrationName1778274719786";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "alertTitlePattern" character varying(500), "alertDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "inheritLabelsFromMonitors" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b7920ab8aa4eaee2be36c6d4e98" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3054b05e3fdb2e4d258efbb763" ON "AlertLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_735aef36f7cfdff4cb98d53b54" ON "AlertLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dac491a26da1131a5ada7e4747" ON "AlertLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f7a0ee1f6805e300bfcb833d765" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_561cae895a9fd07755871a6e70" ON "AlertEpisodeLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0822595feff5dfc3fcfa54ec71" ON "AlertEpisodeLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_203ffa44b271c07d7de93b0f83" ON "AlertEpisodeLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "inheritLabelsFromMonitors" boolean NOT NULL DEFAULT false, "inheritLabelsFromHosts" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_05fad8db3507a90f135e102a197" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b03a8f03bc470c8f4796cce75" ON "IncidentLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c21e91eb93005a34d7894a79c3" ON "IncidentLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a5dfbe31ce52b55301e5922fb" ON "IncidentLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6173e62f062b2d49e29c0dd0864" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1bf1459c92c8ebe4a891452e41" ON "IncidentEpisodeLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56fd1390d0ac1029f4f9ee909a" ON "IncidentEpisodeLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b36a7b700034a68f618a6e60f0" ON "IncidentEpisodeLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertLabelRuleMonitor" ("alertLabelRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_3dda1e10935d7bd9062c47f8415" PRIMARY KEY ("alertLabelRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_824f83e2927548b1b92de75243" ON "AlertLabelRuleMonitor" ("alertLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7cc7e8b15d6d978a5e2731cd92" ON "AlertLabelRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertLabelRuleAlertSeverity" ("alertLabelRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_aa6af65fa0522a28159c9a0ced6" PRIMARY KEY ("alertLabelRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92fe13465f9cfb91ae0aca0c70" ON "AlertLabelRuleAlertSeverity" ("alertLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd1decde928c4fc4ae9fe1831f" ON "AlertLabelRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertLabelRuleAlertLabel" ("alertLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_d25d7db789de9235e45c5e035fb" PRIMARY KEY ("alertLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd2307536c150e2ccdb50447dc" ON "AlertLabelRuleAlertLabel" ("alertLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed763881cc68e96f68e477620e" ON "AlertLabelRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertLabelRuleMonitorLabel" ("alertLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_910e7d66ddaa5ffd6432f21413c" PRIMARY KEY ("alertLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_169d584f753773404ae3ce83ff" ON "AlertLabelRuleMonitorLabel" ("alertLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b3ef5379efdadbbc25574a3f6" ON "AlertLabelRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertLabelRuleLabelToAdd" ("alertLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_76b29e23ad04c25ce3199535022" PRIMARY KEY ("alertLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28113d24c49e5216cd06d4e4e0" ON "AlertLabelRuleLabelToAdd" ("alertLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6aa2d478fa6941ad2861256c1b" ON "AlertLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeLabelRuleAlertSeverity" ("alertEpisodeLabelRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_8a562aa2e997f43aa27fbe41796" PRIMARY KEY ("alertEpisodeLabelRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cd2f77822496a07e0496beadeb" ON "AlertEpisodeLabelRuleAlertSeverity" ("alertEpisodeLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd0b3cdc223ae81061961c7337" ON "AlertEpisodeLabelRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeLabelRuleEpisodeLabel" ("alertEpisodeLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_6d572c1298767911fcbefebf7b7" PRIMARY KEY ("alertEpisodeLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c80f869437a89287f77f96c9f" ON "AlertEpisodeLabelRuleEpisodeLabel" ("alertEpisodeLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1c559c3bcb93882dcd8a6b5e7" ON "AlertEpisodeLabelRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeLabelRuleLabelToAdd" ("alertEpisodeLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9b795631544fd77bb247e2c2773" PRIMARY KEY ("alertEpisodeLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_104d13482d7e15094635b1dadd" ON "AlertEpisodeLabelRuleLabelToAdd" ("alertEpisodeLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e6a8968282be3d70f14e3e862" ON "AlertEpisodeLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentLabelRuleMonitor" ("incidentLabelRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_7621383d4b596bc75993d5627e3" PRIMARY KEY ("incidentLabelRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2af39d175af6b8e5723e7be7d4" ON "IncidentLabelRuleMonitor" ("incidentLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed8ce83d43c16523a53cfb77f5" ON "IncidentLabelRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentLabelRuleIncidentSeverity" ("incidentLabelRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_7a4e67632751ae2ed9dc5f0b2ee" PRIMARY KEY ("incidentLabelRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_395b0396d786d38b5669cd5f10" ON "IncidentLabelRuleIncidentSeverity" ("incidentLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2e6bfc3228458aba82d592205" ON "IncidentLabelRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentLabelRuleIncidentLabel" ("incidentLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2087faa21ac82cb23b25223c97f" PRIMARY KEY ("incidentLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e273eddb7c82c8b77de33ca3e0" ON "IncidentLabelRuleIncidentLabel" ("incidentLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4df2baecdc8bc86dc0edc886b4" ON "IncidentLabelRuleIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentLabelRuleMonitorLabel" ("incidentLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2cff07ae9d4e573ec10a330bbd5" PRIMARY KEY ("incidentLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_477b8c930fa0bf2778ea9758d5" ON "IncidentLabelRuleMonitorLabel" ("incidentLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c01394d42a18187e98ae3ee08" ON "IncidentLabelRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentLabelRuleLabelToAdd" ("incidentLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_68063b84c02f9590af2f77ad524" PRIMARY KEY ("incidentLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b753a38a6803b8606d4589f152" ON "IncidentLabelRuleLabelToAdd" ("incidentLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac2bae0a7a5781bf2f6d673a4f" ON "IncidentLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeLabelRuleIncidentSeverity" ("incidentEpisodeLabelRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_83eaadd352cf6fc17c6c947ab0a" PRIMARY KEY ("incidentEpisodeLabelRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2393e5440553a16ca30e758646" ON "IncidentEpisodeLabelRuleIncidentSeverity" ("incidentEpisodeLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9cec2f4d26c78b5dce0ecce4a1" ON "IncidentEpisodeLabelRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeLabelRuleEpisodeLabel" ("incidentEpisodeLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_56375ee2800f6dbe7ae64311a73" PRIMARY KEY ("incidentEpisodeLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47a5453ffe3aef254d5fc5554e" ON "IncidentEpisodeLabelRuleEpisodeLabel" ("incidentEpisodeLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fc2dce87a7ac3bd83bb2e6ffc" ON "IncidentEpisodeLabelRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeLabelRuleLabelToAdd" ("incidentEpisodeLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_89bee61956daf8ba8a6000bb3e2" PRIMARY KEY ("incidentEpisodeLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e8f4a88bb2d33eb9c57e19f8b" ON "IncidentEpisodeLabelRuleLabelToAdd" ("incidentEpisodeLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74ceb1cdf00627eac21ed69803" ON "IncidentEpisodeLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD CONSTRAINT "FK_3054b05e3fdb2e4d258efbb763f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD CONSTRAINT "FK_bb6a1f91d50555fac166a65efe9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD CONSTRAINT "FK_fe01c0ab41cfccc9f2d05fd79ba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" ADD CONSTRAINT "FK_561cae895a9fd07755871a6e70f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" ADD CONSTRAINT "FK_cfce6d114b405b2c0482506bd2c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" ADD CONSTRAINT "FK_32c04380aa74253882e1fc7cac0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD CONSTRAINT "FK_0b03a8f03bc470c8f4796cce751" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD CONSTRAINT "FK_2219fd8e5e77e2cf8827a1525d6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD CONSTRAINT "FK_e185259bdb5621eda2fe8c5b5a8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" ADD CONSTRAINT "FK_1bf1459c92c8ebe4a891452e411" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" ADD CONSTRAINT "FK_6241e909357c13b9f4222f35824" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" ADD CONSTRAINT "FK_950d6f2124429bdd63e45627d6a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitor" ADD CONSTRAINT "FK_824f83e2927548b1b92de75243e" FOREIGN KEY ("alertLabelRuleId") REFERENCES "AlertLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitor" ADD CONSTRAINT "FK_7cc7e8b15d6d978a5e2731cd92d" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertSeverity" ADD CONSTRAINT "FK_92fe13465f9cfb91ae0aca0c702" FOREIGN KEY ("alertLabelRuleId") REFERENCES "AlertLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertSeverity" ADD CONSTRAINT "FK_cd1decde928c4fc4ae9fe1831fd" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertLabel" ADD CONSTRAINT "FK_dd2307536c150e2ccdb50447dce" FOREIGN KEY ("alertLabelRuleId") REFERENCES "AlertLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertLabel" ADD CONSTRAINT "FK_ed763881cc68e96f68e477620ed" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitorLabel" ADD CONSTRAINT "FK_169d584f753773404ae3ce83ff3" FOREIGN KEY ("alertLabelRuleId") REFERENCES "AlertLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitorLabel" ADD CONSTRAINT "FK_0b3ef5379efdadbbc25574a3f66" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleLabelToAdd" ADD CONSTRAINT "FK_28113d24c49e5216cd06d4e4e09" FOREIGN KEY ("alertLabelRuleId") REFERENCES "AlertLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleLabelToAdd" ADD CONSTRAINT "FK_6aa2d478fa6941ad2861256c1be" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleAlertSeverity" ADD CONSTRAINT "FK_cd2f77822496a07e0496beadeb6" FOREIGN KEY ("alertEpisodeLabelRuleId") REFERENCES "AlertEpisodeLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleAlertSeverity" ADD CONSTRAINT "FK_fd0b3cdc223ae81061961c7337a" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleEpisodeLabel" ADD CONSTRAINT "FK_4c80f869437a89287f77f96c9f0" FOREIGN KEY ("alertEpisodeLabelRuleId") REFERENCES "AlertEpisodeLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleEpisodeLabel" ADD CONSTRAINT "FK_c1c559c3bcb93882dcd8a6b5e77" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleLabelToAdd" ADD CONSTRAINT "FK_104d13482d7e15094635b1dadd8" FOREIGN KEY ("alertEpisodeLabelRuleId") REFERENCES "AlertEpisodeLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleLabelToAdd" ADD CONSTRAINT "FK_5e6a8968282be3d70f14e3e862e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitor" ADD CONSTRAINT "FK_2af39d175af6b8e5723e7be7d44" FOREIGN KEY ("incidentLabelRuleId") REFERENCES "IncidentLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitor" ADD CONSTRAINT "FK_ed8ce83d43c16523a53cfb77f59" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentSeverity" ADD CONSTRAINT "FK_395b0396d786d38b5669cd5f10b" FOREIGN KEY ("incidentLabelRuleId") REFERENCES "IncidentLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentSeverity" ADD CONSTRAINT "FK_b2e6bfc3228458aba82d5922055" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentLabel" ADD CONSTRAINT "FK_e273eddb7c82c8b77de33ca3e08" FOREIGN KEY ("incidentLabelRuleId") REFERENCES "IncidentLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentLabel" ADD CONSTRAINT "FK_4df2baecdc8bc86dc0edc886b4e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitorLabel" ADD CONSTRAINT "FK_477b8c930fa0bf2778ea9758d50" FOREIGN KEY ("incidentLabelRuleId") REFERENCES "IncidentLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitorLabel" ADD CONSTRAINT "FK_7c01394d42a18187e98ae3ee082" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleLabelToAdd" ADD CONSTRAINT "FK_b753a38a6803b8606d4589f1527" FOREIGN KEY ("incidentLabelRuleId") REFERENCES "IncidentLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleLabelToAdd" ADD CONSTRAINT "FK_ac2bae0a7a5781bf2f6d673a4ff" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleIncidentSeverity" ADD CONSTRAINT "FK_2393e5440553a16ca30e758646f" FOREIGN KEY ("incidentEpisodeLabelRuleId") REFERENCES "IncidentEpisodeLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleIncidentSeverity" ADD CONSTRAINT "FK_9cec2f4d26c78b5dce0ecce4a12" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleEpisodeLabel" ADD CONSTRAINT "FK_47a5453ffe3aef254d5fc5554e0" FOREIGN KEY ("incidentEpisodeLabelRuleId") REFERENCES "IncidentEpisodeLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleEpisodeLabel" ADD CONSTRAINT "FK_1fc2dce87a7ac3bd83bb2e6ffc7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleLabelToAdd" ADD CONSTRAINT "FK_4e8f4a88bb2d33eb9c57e19f8b4" FOREIGN KEY ("incidentEpisodeLabelRuleId") REFERENCES "IncidentEpisodeLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleLabelToAdd" ADD CONSTRAINT "FK_74ceb1cdf00627eac21ed698032" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleLabelToAdd" DROP CONSTRAINT "FK_74ceb1cdf00627eac21ed698032"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleLabelToAdd" DROP CONSTRAINT "FK_4e8f4a88bb2d33eb9c57e19f8b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleEpisodeLabel" DROP CONSTRAINT "FK_1fc2dce87a7ac3bd83bb2e6ffc7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleEpisodeLabel" DROP CONSTRAINT "FK_47a5453ffe3aef254d5fc5554e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleIncidentSeverity" DROP CONSTRAINT "FK_9cec2f4d26c78b5dce0ecce4a12"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRuleIncidentSeverity" DROP CONSTRAINT "FK_2393e5440553a16ca30e758646f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleLabelToAdd" DROP CONSTRAINT "FK_ac2bae0a7a5781bf2f6d673a4ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleLabelToAdd" DROP CONSTRAINT "FK_b753a38a6803b8606d4589f1527"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitorLabel" DROP CONSTRAINT "FK_7c01394d42a18187e98ae3ee082"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitorLabel" DROP CONSTRAINT "FK_477b8c930fa0bf2778ea9758d50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentLabel" DROP CONSTRAINT "FK_4df2baecdc8bc86dc0edc886b4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentLabel" DROP CONSTRAINT "FK_e273eddb7c82c8b77de33ca3e08"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentSeverity" DROP CONSTRAINT "FK_b2e6bfc3228458aba82d5922055"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleIncidentSeverity" DROP CONSTRAINT "FK_395b0396d786d38b5669cd5f10b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitor" DROP CONSTRAINT "FK_ed8ce83d43c16523a53cfb77f59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRuleMonitor" DROP CONSTRAINT "FK_2af39d175af6b8e5723e7be7d44"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleLabelToAdd" DROP CONSTRAINT "FK_5e6a8968282be3d70f14e3e862e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleLabelToAdd" DROP CONSTRAINT "FK_104d13482d7e15094635b1dadd8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleEpisodeLabel" DROP CONSTRAINT "FK_c1c559c3bcb93882dcd8a6b5e77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleEpisodeLabel" DROP CONSTRAINT "FK_4c80f869437a89287f77f96c9f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleAlertSeverity" DROP CONSTRAINT "FK_fd0b3cdc223ae81061961c7337a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRuleAlertSeverity" DROP CONSTRAINT "FK_cd2f77822496a07e0496beadeb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleLabelToAdd" DROP CONSTRAINT "FK_6aa2d478fa6941ad2861256c1be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleLabelToAdd" DROP CONSTRAINT "FK_28113d24c49e5216cd06d4e4e09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitorLabel" DROP CONSTRAINT "FK_0b3ef5379efdadbbc25574a3f66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitorLabel" DROP CONSTRAINT "FK_169d584f753773404ae3ce83ff3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertLabel" DROP CONSTRAINT "FK_ed763881cc68e96f68e477620ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertLabel" DROP CONSTRAINT "FK_dd2307536c150e2ccdb50447dce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertSeverity" DROP CONSTRAINT "FK_cd1decde928c4fc4ae9fe1831fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleAlertSeverity" DROP CONSTRAINT "FK_92fe13465f9cfb91ae0aca0c702"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitor" DROP CONSTRAINT "FK_7cc7e8b15d6d978a5e2731cd92d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRuleMonitor" DROP CONSTRAINT "FK_824f83e2927548b1b92de75243e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" DROP CONSTRAINT "FK_950d6f2124429bdd63e45627d6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" DROP CONSTRAINT "FK_6241e909357c13b9f4222f35824"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeLabelRule" DROP CONSTRAINT "FK_1bf1459c92c8ebe4a891452e411"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP CONSTRAINT "FK_e185259bdb5621eda2fe8c5b5a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP CONSTRAINT "FK_2219fd8e5e77e2cf8827a1525d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP CONSTRAINT "FK_0b03a8f03bc470c8f4796cce751"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" DROP CONSTRAINT "FK_32c04380aa74253882e1fc7cac0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" DROP CONSTRAINT "FK_cfce6d114b405b2c0482506bd2c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabelRule" DROP CONSTRAINT "FK_561cae895a9fd07755871a6e70f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP CONSTRAINT "FK_fe01c0ab41cfccc9f2d05fd79ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP CONSTRAINT "FK_bb6a1f91d50555fac166a65efe9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP CONSTRAINT "FK_3054b05e3fdb2e4d258efbb763f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74ceb1cdf00627eac21ed69803"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e8f4a88bb2d33eb9c57e19f8b"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodeLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fc2dce87a7ac3bd83bb2e6ffc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47a5453ffe3aef254d5fc5554e"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeLabelRuleEpisodeLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9cec2f4d26c78b5dce0ecce4a1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2393e5440553a16ca30e758646"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeLabelRuleIncidentSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac2bae0a7a5781bf2f6d673a4f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b753a38a6803b8606d4589f152"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c01394d42a18187e98ae3ee08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_477b8c930fa0bf2778ea9758d5"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLabelRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4df2baecdc8bc86dc0edc886b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e273eddb7c82c8b77de33ca3e0"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLabelRuleIncidentLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b2e6bfc3228458aba82d592205"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_395b0396d786d38b5669cd5f10"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLabelRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed8ce83d43c16523a53cfb77f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2af39d175af6b8e5723e7be7d4"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLabelRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e6a8968282be3d70f14e3e862"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_104d13482d7e15094635b1dadd"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1c559c3bcb93882dcd8a6b5e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c80f869437a89287f77f96c9f"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeLabelRuleEpisodeLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd0b3cdc223ae81061961c7337"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd2f77822496a07e0496beadeb"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeLabelRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6aa2d478fa6941ad2861256c1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28113d24c49e5216cd06d4e4e0"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b3ef5379efdadbbc25574a3f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_169d584f753773404ae3ce83ff"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabelRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed763881cc68e96f68e477620e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd2307536c150e2ccdb50447dc"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabelRuleAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cd1decde928c4fc4ae9fe1831f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92fe13465f9cfb91ae0aca0c70"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabelRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7cc7e8b15d6d978a5e2731cd92"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_824f83e2927548b1b92de75243"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabelRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b36a7b700034a68f618a6e60f0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_56fd1390d0ac1029f4f9ee909a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1bf1459c92c8ebe4a891452e41"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodeLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a5dfbe31ce52b55301e5922fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c21e91eb93005a34d7894a79c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b03a8f03bc470c8f4796cce75"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_203ffa44b271c07d7de93b0f83"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0822595feff5dfc3fcfa54ec71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_561cae895a9fd07755871a6e70"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dac491a26da1131a5ada7e4747"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_735aef36f7cfdff4cb98d53b54"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3054b05e3fdb2e4d258efbb763"`,
    );
    await queryRunner.query(`DROP TABLE "AlertLabelRule"`);
  }
}
