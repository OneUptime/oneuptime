import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Bucket A (RUM): label-rule + owner-rule tables that drive automatic label
 * attachment and owner assignment when a RumApplication is created.
 */
export class AddRumApplicationRuleTables1780940998002
  implements MigrationInterface
{
  public name = "AddRumApplicationRuleTables1780940998002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RumApplicationLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_RumAppLabelRule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLabelRule_projectId" ON "RumApplicationLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLabelRule_name" ON "RumApplicationLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLabelRule_enabled" ON "RumApplicationLabelRule" ("isEnabled") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumApplicationOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_RumAppOwnerRule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerRule_projectId" ON "RumApplicationOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerRule_name" ON "RumApplicationOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppOwnerRule_enabled" ON "RumApplicationOwnerRule" ("isEnabled") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumAppLabelRuleMatchLabel" ("rumApplicationLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_RumAppLabelRuleMatchLabel" PRIMARY KEY ("rumApplicationLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLRMatchLabel_rule" ON "RumAppLabelRuleMatchLabel" ("rumApplicationLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLRMatchLabel_label" ON "RumAppLabelRuleMatchLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumAppLabelRuleAddLabel" ("rumApplicationLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_RumAppLabelRuleAddLabel" PRIMARY KEY ("rumApplicationLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLRAddLabel_rule" ON "RumAppLabelRuleAddLabel" ("rumApplicationLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppLRAddLabel_label" ON "RumAppLabelRuleAddLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumAppOwnerRuleMatchLabel" ("rumApplicationOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_RumAppOwnerRuleMatchLabel" PRIMARY KEY ("rumApplicationOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppORMatchLabel_rule" ON "RumAppOwnerRuleMatchLabel" ("rumApplicationOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppORMatchLabel_label" ON "RumAppOwnerRuleMatchLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumAppOwnerRuleUser" ("rumApplicationOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_RumAppOwnerRuleUser" PRIMARY KEY ("rumApplicationOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppORUser_rule" ON "RumAppOwnerRuleUser" ("rumApplicationOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppORUser_user" ON "RumAppOwnerRuleUser" ("userId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "RumAppOwnerRuleTeam" ("rumApplicationOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_RumAppOwnerRuleTeam" PRIMARY KEY ("rumApplicationOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppORTeam_rule" ON "RumAppOwnerRuleTeam" ("rumApplicationOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RumAppORTeam_team" ON "RumAppOwnerRuleTeam" ("teamId") `,
    );

    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" ADD CONSTRAINT "FK_RumAppLabelRule_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" ADD CONSTRAINT "FK_RumAppLabelRule_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationLabelRule" ADD CONSTRAINT "FK_RumAppLabelRule_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" ADD CONSTRAINT "FK_RumAppOwnerRule_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" ADD CONSTRAINT "FK_RumAppOwnerRule_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplicationOwnerRule" ADD CONSTRAINT "FK_RumAppOwnerRule_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "RumAppLabelRuleMatchLabel" ADD CONSTRAINT "FK_RumAppLRMatchLabel_rule" FOREIGN KEY ("rumApplicationLabelRuleId") REFERENCES "RumApplicationLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppLabelRuleMatchLabel" ADD CONSTRAINT "FK_RumAppLRMatchLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppLabelRuleAddLabel" ADD CONSTRAINT "FK_RumAppLRAddLabel_rule" FOREIGN KEY ("rumApplicationLabelRuleId") REFERENCES "RumApplicationLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppLabelRuleAddLabel" ADD CONSTRAINT "FK_RumAppLRAddLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppOwnerRuleMatchLabel" ADD CONSTRAINT "FK_RumAppORMatchLabel_rule" FOREIGN KEY ("rumApplicationOwnerRuleId") REFERENCES "RumApplicationOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppOwnerRuleMatchLabel" ADD CONSTRAINT "FK_RumAppORMatchLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppOwnerRuleUser" ADD CONSTRAINT "FK_RumAppORUser_rule" FOREIGN KEY ("rumApplicationOwnerRuleId") REFERENCES "RumApplicationOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppOwnerRuleUser" ADD CONSTRAINT "FK_RumAppORUser_user" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppOwnerRuleTeam" ADD CONSTRAINT "FK_RumAppORTeam_rule" FOREIGN KEY ("rumApplicationOwnerRuleId") REFERENCES "RumApplicationOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumAppOwnerRuleTeam" ADD CONSTRAINT "FK_RumAppORTeam_team" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "RumAppOwnerRuleTeam"`);
    await queryRunner.query(`DROP TABLE "RumAppOwnerRuleUser"`);
    await queryRunner.query(`DROP TABLE "RumAppOwnerRuleMatchLabel"`);
    await queryRunner.query(`DROP TABLE "RumAppLabelRuleAddLabel"`);
    await queryRunner.query(`DROP TABLE "RumAppLabelRuleMatchLabel"`);
    await queryRunner.query(`DROP TABLE "RumApplicationOwnerRule"`);
    await queryRunner.query(`DROP TABLE "RumApplicationLabelRule"`);
  }
}
