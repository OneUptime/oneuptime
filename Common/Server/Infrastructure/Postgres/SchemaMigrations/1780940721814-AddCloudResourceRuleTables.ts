import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Bucket A (Cloud): label-rule + owner-rule tables that drive automatic label
 * attachment and owner assignment when a CloudResource is created.
 */
export class AddCloudResourceRuleTables1780940721814
  implements MigrationInterface
{
  public name = "AddCloudResourceRuleTables1780940721814";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudResourceLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_CloudResLabelRule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLabelRule_projectId" ON "CloudResourceLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLabelRule_name" ON "CloudResourceLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLabelRule_enabled" ON "CloudResourceLabelRule" ("isEnabled") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResourceOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_CloudResOwnerRule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerRule_projectId" ON "CloudResourceOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerRule_name" ON "CloudResourceOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResOwnerRule_enabled" ON "CloudResourceOwnerRule" ("isEnabled") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResLabelRuleMatchLabel" ("cloudResourceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_CloudResLabelRuleMatchLabel" PRIMARY KEY ("cloudResourceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLRMatchLabel_rule" ON "CloudResLabelRuleMatchLabel" ("cloudResourceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLRMatchLabel_label" ON "CloudResLabelRuleMatchLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResLabelRuleAddLabel" ("cloudResourceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_CloudResLabelRuleAddLabel" PRIMARY KEY ("cloudResourceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLRAddLabel_rule" ON "CloudResLabelRuleAddLabel" ("cloudResourceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResLRAddLabel_label" ON "CloudResLabelRuleAddLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResOwnerRuleMatchLabel" ("cloudResourceOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_CloudResOwnerRuleMatchLabel" PRIMARY KEY ("cloudResourceOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResORMatchLabel_rule" ON "CloudResOwnerRuleMatchLabel" ("cloudResourceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResORMatchLabel_label" ON "CloudResOwnerRuleMatchLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResOwnerRuleUser" ("cloudResourceOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_CloudResOwnerRuleUser" PRIMARY KEY ("cloudResourceOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResORUser_rule" ON "CloudResOwnerRuleUser" ("cloudResourceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResORUser_user" ON "CloudResOwnerRuleUser" ("userId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "CloudResOwnerRuleTeam" ("cloudResourceOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_CloudResOwnerRuleTeam" PRIMARY KEY ("cloudResourceOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResORTeam_rule" ON "CloudResOwnerRuleTeam" ("cloudResourceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_CloudResORTeam_team" ON "CloudResOwnerRuleTeam" ("teamId") `,
    );

    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD CONSTRAINT "FK_CloudResLabelRule_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD CONSTRAINT "FK_CloudResLabelRule_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceLabelRule" ADD CONSTRAINT "FK_CloudResLabelRule_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD CONSTRAINT "FK_CloudResOwnerRule_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD CONSTRAINT "FK_CloudResOwnerRule_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResourceOwnerRule" ADD CONSTRAINT "FK_CloudResOwnerRule_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "CloudResLabelRuleMatchLabel" ADD CONSTRAINT "FK_CloudResLRMatchLabel_rule" FOREIGN KEY ("cloudResourceLabelRuleId") REFERENCES "CloudResourceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResLabelRuleMatchLabel" ADD CONSTRAINT "FK_CloudResLRMatchLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResLabelRuleAddLabel" ADD CONSTRAINT "FK_CloudResLRAddLabel_rule" FOREIGN KEY ("cloudResourceLabelRuleId") REFERENCES "CloudResourceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResLabelRuleAddLabel" ADD CONSTRAINT "FK_CloudResLRAddLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResOwnerRuleMatchLabel" ADD CONSTRAINT "FK_CloudResORMatchLabel_rule" FOREIGN KEY ("cloudResourceOwnerRuleId") REFERENCES "CloudResourceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResOwnerRuleMatchLabel" ADD CONSTRAINT "FK_CloudResORMatchLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResOwnerRuleUser" ADD CONSTRAINT "FK_CloudResORUser_rule" FOREIGN KEY ("cloudResourceOwnerRuleId") REFERENCES "CloudResourceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResOwnerRuleUser" ADD CONSTRAINT "FK_CloudResORUser_user" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResOwnerRuleTeam" ADD CONSTRAINT "FK_CloudResORTeam_rule" FOREIGN KEY ("cloudResourceOwnerRuleId") REFERENCES "CloudResourceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResOwnerRuleTeam" ADD CONSTRAINT "FK_CloudResORTeam_team" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "CloudResOwnerRuleTeam"`);
    await queryRunner.query(`DROP TABLE "CloudResOwnerRuleUser"`);
    await queryRunner.query(`DROP TABLE "CloudResOwnerRuleMatchLabel"`);
    await queryRunner.query(`DROP TABLE "CloudResLabelRuleAddLabel"`);
    await queryRunner.query(`DROP TABLE "CloudResLabelRuleMatchLabel"`);
    await queryRunner.query(`DROP TABLE "CloudResourceOwnerRule"`);
    await queryRunner.query(`DROP TABLE "CloudResourceLabelRule"`);
  }
}
