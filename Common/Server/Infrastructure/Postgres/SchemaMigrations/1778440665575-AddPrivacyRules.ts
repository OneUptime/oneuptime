import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrivacyRules1778440665575 implements MigrationInterface {
  public name: string = "AddPrivacyRules1778440665575";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertPrivacyRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "alertTitlePattern" character varying(500), "alertDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6a882302ca23d47fd6330266b88" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3fab38fad1d51e8c7ca2928993" ON "AlertPrivacyRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fb048b6950381b971ec09b5e7e" ON "AlertPrivacyRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5acf6859c9b2bf1d8929027c9" ON "AlertPrivacyRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentPrivacyRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2ee75984f02948f1ff6a22cfc14" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79d52079f643c206b271d6a0ae" ON "IncidentPrivacyRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0494ec1b680dda1f07d281d372" ON "IncidentPrivacyRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_168d05134b196841177d641464" ON "IncidentPrivacyRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertPrivacyRuleMonitor" ("alertPrivacyRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_780a44bbe27400a2ff6fada8535" PRIMARY KEY ("alertPrivacyRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9e25f24facf04c286541c31b5c" ON "AlertPrivacyRuleMonitor" ("alertPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da57f3bcd68ad8aeeeb37deb54" ON "AlertPrivacyRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertPrivacyRuleAlertSeverity" ("alertPrivacyRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_0cd25f9483c02649faf6d0909f2" PRIMARY KEY ("alertPrivacyRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3bd51e32c9abc8d8175e11f6f8" ON "AlertPrivacyRuleAlertSeverity" ("alertPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d48ca6f0d36bc1530ce10b4d5" ON "AlertPrivacyRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertPrivacyRuleAlertLabel" ("alertPrivacyRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_175118dc3588e4bc7f35564749e" PRIMARY KEY ("alertPrivacyRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7cd6b095286ab88baebeadae71" ON "AlertPrivacyRuleAlertLabel" ("alertPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8faf53c02aad0fe876abc32108" ON "AlertPrivacyRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertPrivacyRuleMonitorLabel" ("alertPrivacyRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_25e11edfbc20c7cc67ac39845a3" PRIMARY KEY ("alertPrivacyRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28f2746d6e08f4f1642028c768" ON "AlertPrivacyRuleMonitorLabel" ("alertPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d19cf281609dc65c80113755a" ON "AlertPrivacyRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentPrivacyRuleMonitor" ("incidentPrivacyRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_f29ee8a7bf5bbadc0a42e6d002b" PRIMARY KEY ("incidentPrivacyRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d2b629c61361f5ec5440bffe2" ON "IncidentPrivacyRuleMonitor" ("incidentPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f3ea7ed64bc37afa6a5efdf29" ON "IncidentPrivacyRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentPrivacyRuleIncidentSeverity" ("incidentPrivacyRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_b1d5d3ba44c913b2b7b67ed26df" PRIMARY KEY ("incidentPrivacyRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c9f6c2f971c92c76f04c112e6" ON "IncidentPrivacyRuleIncidentSeverity" ("incidentPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12ff59b7725c80ad0d21140b22" ON "IncidentPrivacyRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentPrivacyRuleIncidentLabel" ("incidentPrivacyRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2511699545f0bda16ad7f52561f" PRIMARY KEY ("incidentPrivacyRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f36169800d7b3a51faaacf24c" ON "IncidentPrivacyRuleIncidentLabel" ("incidentPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3023265394e2c14e00b3866e7" ON "IncidentPrivacyRuleIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentPrivacyRuleMonitorLabel" ("incidentPrivacyRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2864ac977b2aa7bde68e87b67a2" PRIMARY KEY ("incidentPrivacyRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ef6ca6dded4725e1b1caacd8e" ON "IncidentPrivacyRuleMonitorLabel" ("incidentPrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_26a3d68d712e704818abc379a4" ON "IncidentPrivacyRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" ADD CONSTRAINT "FK_3fab38fad1d51e8c7ca2928993d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" ADD CONSTRAINT "FK_c3a5320711003dc5c33bdfbe6ca" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" ADD CONSTRAINT "FK_84b77456084fe3c36b647056a09" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" ADD CONSTRAINT "FK_79d52079f643c206b271d6a0ae8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" ADD CONSTRAINT "FK_a71a16eb749305c4aca3b9712cd" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" ADD CONSTRAINT "FK_e84fdea7af14190ce99db4127b6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitor" ADD CONSTRAINT "FK_9e25f24facf04c286541c31b5c6" FOREIGN KEY ("alertPrivacyRuleId") REFERENCES "AlertPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitor" ADD CONSTRAINT "FK_da57f3bcd68ad8aeeeb37deb54d" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertSeverity" ADD CONSTRAINT "FK_3bd51e32c9abc8d8175e11f6f8a" FOREIGN KEY ("alertPrivacyRuleId") REFERENCES "AlertPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertSeverity" ADD CONSTRAINT "FK_1d48ca6f0d36bc1530ce10b4d5b" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertLabel" ADD CONSTRAINT "FK_7cd6b095286ab88baebeadae71f" FOREIGN KEY ("alertPrivacyRuleId") REFERENCES "AlertPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertLabel" ADD CONSTRAINT "FK_8faf53c02aad0fe876abc321082" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitorLabel" ADD CONSTRAINT "FK_28f2746d6e08f4f1642028c7683" FOREIGN KEY ("alertPrivacyRuleId") REFERENCES "AlertPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitorLabel" ADD CONSTRAINT "FK_2d19cf281609dc65c80113755af" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitor" ADD CONSTRAINT "FK_6d2b629c61361f5ec5440bffe2a" FOREIGN KEY ("incidentPrivacyRuleId") REFERENCES "IncidentPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitor" ADD CONSTRAINT "FK_3f3ea7ed64bc37afa6a5efdf297" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentSeverity" ADD CONSTRAINT "FK_5c9f6c2f971c92c76f04c112e6b" FOREIGN KEY ("incidentPrivacyRuleId") REFERENCES "IncidentPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentSeverity" ADD CONSTRAINT "FK_12ff59b7725c80ad0d21140b228" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentLabel" ADD CONSTRAINT "FK_4f36169800d7b3a51faaacf24c5" FOREIGN KEY ("incidentPrivacyRuleId") REFERENCES "IncidentPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentLabel" ADD CONSTRAINT "FK_f3023265394e2c14e00b3866e7b" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitorLabel" ADD CONSTRAINT "FK_1ef6ca6dded4725e1b1caacd8e6" FOREIGN KEY ("incidentPrivacyRuleId") REFERENCES "IncidentPrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitorLabel" ADD CONSTRAINT "FK_26a3d68d712e704818abc379a4f" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitorLabel" DROP CONSTRAINT "FK_26a3d68d712e704818abc379a4f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitorLabel" DROP CONSTRAINT "FK_1ef6ca6dded4725e1b1caacd8e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentLabel" DROP CONSTRAINT "FK_f3023265394e2c14e00b3866e7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentLabel" DROP CONSTRAINT "FK_4f36169800d7b3a51faaacf24c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentSeverity" DROP CONSTRAINT "FK_12ff59b7725c80ad0d21140b228"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleIncidentSeverity" DROP CONSTRAINT "FK_5c9f6c2f971c92c76f04c112e6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitor" DROP CONSTRAINT "FK_3f3ea7ed64bc37afa6a5efdf297"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRuleMonitor" DROP CONSTRAINT "FK_6d2b629c61361f5ec5440bffe2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitorLabel" DROP CONSTRAINT "FK_2d19cf281609dc65c80113755af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitorLabel" DROP CONSTRAINT "FK_28f2746d6e08f4f1642028c7683"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertLabel" DROP CONSTRAINT "FK_8faf53c02aad0fe876abc321082"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertLabel" DROP CONSTRAINT "FK_7cd6b095286ab88baebeadae71f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertSeverity" DROP CONSTRAINT "FK_1d48ca6f0d36bc1530ce10b4d5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleAlertSeverity" DROP CONSTRAINT "FK_3bd51e32c9abc8d8175e11f6f8a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitor" DROP CONSTRAINT "FK_da57f3bcd68ad8aeeeb37deb54d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRuleMonitor" DROP CONSTRAINT "FK_9e25f24facf04c286541c31b5c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" DROP CONSTRAINT "FK_e84fdea7af14190ce99db4127b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" DROP CONSTRAINT "FK_a71a16eb749305c4aca3b9712cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPrivacyRule" DROP CONSTRAINT "FK_79d52079f643c206b271d6a0ae8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" DROP CONSTRAINT "FK_84b77456084fe3c36b647056a09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" DROP CONSTRAINT "FK_c3a5320711003dc5c33bdfbe6ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPrivacyRule" DROP CONSTRAINT "FK_3fab38fad1d51e8c7ca2928993d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_26a3d68d712e704818abc379a4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ef6ca6dded4725e1b1caacd8e"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPrivacyRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3023265394e2c14e00b3866e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f36169800d7b3a51faaacf24c"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPrivacyRuleIncidentLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12ff59b7725c80ad0d21140b22"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c9f6c2f971c92c76f04c112e6"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPrivacyRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f3ea7ed64bc37afa6a5efdf29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d2b629c61361f5ec5440bffe2"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPrivacyRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d19cf281609dc65c80113755a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28f2746d6e08f4f1642028c768"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPrivacyRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8faf53c02aad0fe876abc32108"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7cd6b095286ab88baebeadae71"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPrivacyRuleAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d48ca6f0d36bc1530ce10b4d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3bd51e32c9abc8d8175e11f6f8"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPrivacyRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da57f3bcd68ad8aeeeb37deb54"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e25f24facf04c286541c31b5c"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPrivacyRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_168d05134b196841177d641464"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0494ec1b680dda1f07d281d372"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79d52079f643c206b271d6a0ae"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPrivacyRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5acf6859c9b2bf1d8929027c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb048b6950381b971ec09b5e7e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fab38fad1d51e8c7ca2928993"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPrivacyRule"`);
  }
}
