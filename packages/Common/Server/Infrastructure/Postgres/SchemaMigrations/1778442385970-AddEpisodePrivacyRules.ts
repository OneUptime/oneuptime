import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEpisodePrivacyRules1778442385970 implements MigrationInterface {
  public name: string = "AddEpisodePrivacyRules1778442385970";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodePrivacyRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_7fea3247136ba6d222278f674e0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_305ec53f390b53d8e9de5654bd" ON "AlertEpisodePrivacyRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0665b93291eb23b3d461e0f197" ON "AlertEpisodePrivacyRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a10755ea6c719fbb4d08591c5c" ON "AlertEpisodePrivacyRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodePrivacyRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a11145f03879f17591c7dd45805" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5ddc5a32f73f6afe9deb1fb52" ON "IncidentEpisodePrivacyRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_774b4eec13436d5b27e94d11be" ON "IncidentEpisodePrivacyRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_745b52a50a3a27b7322c9b7169" ON "IncidentEpisodePrivacyRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodePrivacyRuleAlertSeverity" ("alertEpisodePrivacyRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_a131a94469aa8ea96b9fd869954" PRIMARY KEY ("alertEpisodePrivacyRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6373e739913d314ccd3dce64e2" ON "AlertEpisodePrivacyRuleAlertSeverity" ("alertEpisodePrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c39c2dbc6919e7920aeeb5a209" ON "AlertEpisodePrivacyRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodePrivacyRuleEpisodeLabel" ("alertEpisodePrivacyRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_15db0dcec30c2b7685850f30761" PRIMARY KEY ("alertEpisodePrivacyRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a0cab8cdda5b9877879bf99bb8" ON "AlertEpisodePrivacyRuleEpisodeLabel" ("alertEpisodePrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_985854d3e2329688c2804039b0" ON "AlertEpisodePrivacyRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodePrivacyRuleIncidentSeverity" ("incidentEpisodePrivacyRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_42a8204d082e6fd40d561c396e4" PRIMARY KEY ("incidentEpisodePrivacyRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96c73dd14b369aff51efa1eb0e" ON "IncidentEpisodePrivacyRuleIncidentSeverity" ("incidentEpisodePrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9efda33ac350de604c0f591c26" ON "IncidentEpisodePrivacyRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodePrivacyRuleEpisodeLabel" ("incidentEpisodePrivacyRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_255521782c9604eceada84d8a3e" PRIMARY KEY ("incidentEpisodePrivacyRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca54d75adbe21e2827691b2092" ON "IncidentEpisodePrivacyRuleEpisodeLabel" ("incidentEpisodePrivacyRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7bf1f6774b513575bde7164e9" ON "IncidentEpisodePrivacyRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "isPrivate" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD "isPrivate" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_731a5075634379b361d4023f3c" ON "IncidentEpisode" ("isPrivate") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9043091ddf180653bcfd23ca9" ON "AlertEpisode" ("isPrivate") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" ADD CONSTRAINT "FK_305ec53f390b53d8e9de5654bd8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" ADD CONSTRAINT "FK_03b9e9e18c8ad864583a7da40ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" ADD CONSTRAINT "FK_b6a94d2cdb67992b1fee23a1c6f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" ADD CONSTRAINT "FK_c5ddc5a32f73f6afe9deb1fb52f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" ADD CONSTRAINT "FK_b9ec874395b9ba8b2ba16d73203" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" ADD CONSTRAINT "FK_ab2d204a044ad51ddc51da818bf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleAlertSeverity" ADD CONSTRAINT "FK_6373e739913d314ccd3dce64e2e" FOREIGN KEY ("alertEpisodePrivacyRuleId") REFERENCES "AlertEpisodePrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleAlertSeverity" ADD CONSTRAINT "FK_c39c2dbc6919e7920aeeb5a2093" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleEpisodeLabel" ADD CONSTRAINT "FK_a0cab8cdda5b9877879bf99bb86" FOREIGN KEY ("alertEpisodePrivacyRuleId") REFERENCES "AlertEpisodePrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleEpisodeLabel" ADD CONSTRAINT "FK_985854d3e2329688c2804039b01" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleIncidentSeverity" ADD CONSTRAINT "FK_96c73dd14b369aff51efa1eb0e4" FOREIGN KEY ("incidentEpisodePrivacyRuleId") REFERENCES "IncidentEpisodePrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleIncidentSeverity" ADD CONSTRAINT "FK_9efda33ac350de604c0f591c26d" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleEpisodeLabel" ADD CONSTRAINT "FK_ca54d75adbe21e2827691b2092f" FOREIGN KEY ("incidentEpisodePrivacyRuleId") REFERENCES "IncidentEpisodePrivacyRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleEpisodeLabel" ADD CONSTRAINT "FK_c7bf1f6774b513575bde7164e93" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleEpisodeLabel" DROP CONSTRAINT "FK_c7bf1f6774b513575bde7164e93"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleEpisodeLabel" DROP CONSTRAINT "FK_ca54d75adbe21e2827691b2092f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleIncidentSeverity" DROP CONSTRAINT "FK_9efda33ac350de604c0f591c26d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRuleIncidentSeverity" DROP CONSTRAINT "FK_96c73dd14b369aff51efa1eb0e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleEpisodeLabel" DROP CONSTRAINT "FK_985854d3e2329688c2804039b01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleEpisodeLabel" DROP CONSTRAINT "FK_a0cab8cdda5b9877879bf99bb86"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleAlertSeverity" DROP CONSTRAINT "FK_c39c2dbc6919e7920aeeb5a2093"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRuleAlertSeverity" DROP CONSTRAINT "FK_6373e739913d314ccd3dce64e2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" DROP CONSTRAINT "FK_ab2d204a044ad51ddc51da818bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" DROP CONSTRAINT "FK_b9ec874395b9ba8b2ba16d73203"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePrivacyRule" DROP CONSTRAINT "FK_c5ddc5a32f73f6afe9deb1fb52f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" DROP CONSTRAINT "FK_b6a94d2cdb67992b1fee23a1c6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" DROP CONSTRAINT "FK_03b9e9e18c8ad864583a7da40ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodePrivacyRule" DROP CONSTRAINT "FK_305ec53f390b53d8e9de5654bd8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9043091ddf180653bcfd23ca9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_731a5075634379b361d4023f3c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP COLUMN "isPrivate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "isPrivate"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7bf1f6774b513575bde7164e9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca54d75adbe21e2827691b2092"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodePrivacyRuleEpisodeLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9efda33ac350de604c0f591c26"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96c73dd14b369aff51efa1eb0e"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodePrivacyRuleIncidentSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_985854d3e2329688c2804039b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a0cab8cdda5b9877879bf99bb8"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodePrivacyRuleEpisodeLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c39c2dbc6919e7920aeeb5a209"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6373e739913d314ccd3dce64e2"`,
    );
    await queryRunner.query(
      `DROP TABLE "AlertEpisodePrivacyRuleAlertSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_745b52a50a3a27b7322c9b7169"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_774b4eec13436d5b27e94d11be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5ddc5a32f73f6afe9deb1fb52"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodePrivacyRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a10755ea6c719fbb4d08591c5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0665b93291eb23b3d461e0f197"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_305ec53f390b53d8e9de5654bd"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodePrivacyRule"`);
  }
}
