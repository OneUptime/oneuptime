import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Bucket A (Serverless): label-rule + owner-rule tables that drive automatic
 * label attachment and owner assignment when a ServerlessFunction is created.
 * Mirrors the Host*Rule shape (match criteria via labels + name/description
 * regex; actions via labelsToAdd / ownerUsers / ownerTeams).
 */
export class AddServerlessFunctionRuleTables1780938407319
  implements MigrationInterface
{
  public name = "AddServerlessFunctionRuleTables1780938407319";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Label rule table
    await queryRunner.query(
      `CREATE TABLE "ServerlessFunctionLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_SrvlessFnLabelRule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLabelRule_projectId" ON "ServerlessFunctionLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLabelRule_name" ON "ServerlessFunctionLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLabelRule_enabled" ON "ServerlessFunctionLabelRule" ("isEnabled") `,
    );

    // Owner rule table
    await queryRunner.query(
      `CREATE TABLE "ServerlessFunctionOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "nameRegexPattern" character varying(500), "descriptionRegexPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_SrvlessFnOwnerRule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerRule_projectId" ON "ServerlessFunctionOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerRule_name" ON "ServerlessFunctionOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnOwnerRule_enabled" ON "ServerlessFunctionOwnerRule" ("isEnabled") `,
    );

    // Join tables
    await queryRunner.query(
      `CREATE TABLE "SrvlessFnLabelRuleMatchLabel" ("serverlessFunctionLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_SrvlessFnLabelRuleMatchLabel" PRIMARY KEY ("serverlessFunctionLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLRMatchLabel_rule" ON "SrvlessFnLabelRuleMatchLabel" ("serverlessFunctionLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLRMatchLabel_label" ON "SrvlessFnLabelRuleMatchLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "SrvlessFnLabelRuleAddLabel" ("serverlessFunctionLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_SrvlessFnLabelRuleAddLabel" PRIMARY KEY ("serverlessFunctionLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLRAddLabel_rule" ON "SrvlessFnLabelRuleAddLabel" ("serverlessFunctionLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnLRAddLabel_label" ON "SrvlessFnLabelRuleAddLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "SrvlessFnOwnerRuleMatchLabel" ("serverlessFunctionOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_SrvlessFnOwnerRuleMatchLabel" PRIMARY KEY ("serverlessFunctionOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnORMatchLabel_rule" ON "SrvlessFnOwnerRuleMatchLabel" ("serverlessFunctionOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnORMatchLabel_label" ON "SrvlessFnOwnerRuleMatchLabel" ("labelId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "SrvlessFnOwnerRuleUser" ("serverlessFunctionOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_SrvlessFnOwnerRuleUser" PRIMARY KEY ("serverlessFunctionOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnORUser_rule" ON "SrvlessFnOwnerRuleUser" ("serverlessFunctionOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnORUser_user" ON "SrvlessFnOwnerRuleUser" ("userId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "SrvlessFnOwnerRuleTeam" ("serverlessFunctionOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_SrvlessFnOwnerRuleTeam" PRIMARY KEY ("serverlessFunctionOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnORTeam_rule" ON "SrvlessFnOwnerRuleTeam" ("serverlessFunctionOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SrvlessFnORTeam_team" ON "SrvlessFnOwnerRuleTeam" ("teamId") `,
    );

    // Foreign keys: rule tables -> Project / User
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" ADD CONSTRAINT "FK_SrvlessFnLabelRule_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" ADD CONSTRAINT "FK_SrvlessFnLabelRule_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionLabelRule" ADD CONSTRAINT "FK_SrvlessFnLabelRule_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" ADD CONSTRAINT "FK_SrvlessFnOwnerRule_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" ADD CONSTRAINT "FK_SrvlessFnOwnerRule_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunctionOwnerRule" ADD CONSTRAINT "FK_SrvlessFnOwnerRule_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Foreign keys: join tables
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnLabelRuleMatchLabel" ADD CONSTRAINT "FK_SrvlessFnLRMatchLabel_rule" FOREIGN KEY ("serverlessFunctionLabelRuleId") REFERENCES "ServerlessFunctionLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnLabelRuleMatchLabel" ADD CONSTRAINT "FK_SrvlessFnLRMatchLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnLabelRuleAddLabel" ADD CONSTRAINT "FK_SrvlessFnLRAddLabel_rule" FOREIGN KEY ("serverlessFunctionLabelRuleId") REFERENCES "ServerlessFunctionLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnLabelRuleAddLabel" ADD CONSTRAINT "FK_SrvlessFnLRAddLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnOwnerRuleMatchLabel" ADD CONSTRAINT "FK_SrvlessFnORMatchLabel_rule" FOREIGN KEY ("serverlessFunctionOwnerRuleId") REFERENCES "ServerlessFunctionOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnOwnerRuleMatchLabel" ADD CONSTRAINT "FK_SrvlessFnORMatchLabel_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnOwnerRuleUser" ADD CONSTRAINT "FK_SrvlessFnORUser_rule" FOREIGN KEY ("serverlessFunctionOwnerRuleId") REFERENCES "ServerlessFunctionOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnOwnerRuleUser" ADD CONSTRAINT "FK_SrvlessFnORUser_user" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnOwnerRuleTeam" ADD CONSTRAINT "FK_SrvlessFnORTeam_rule" FOREIGN KEY ("serverlessFunctionOwnerRuleId") REFERENCES "ServerlessFunctionOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SrvlessFnOwnerRuleTeam" ADD CONSTRAINT "FK_SrvlessFnORTeam_team" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "SrvlessFnOwnerRuleTeam"`);
    await queryRunner.query(`DROP TABLE "SrvlessFnOwnerRuleUser"`);
    await queryRunner.query(`DROP TABLE "SrvlessFnOwnerRuleMatchLabel"`);
    await queryRunner.query(`DROP TABLE "SrvlessFnLabelRuleAddLabel"`);
    await queryRunner.query(`DROP TABLE "SrvlessFnLabelRuleMatchLabel"`);
    await queryRunner.query(`DROP TABLE "ServerlessFunctionOwnerRule"`);
    await queryRunner.query(`DROP TABLE "ServerlessFunctionLabelRule"`);
  }
}
