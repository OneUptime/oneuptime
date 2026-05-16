import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778785741500 implements MigrationInterface {
  public name = "MigrationName1778785741500";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "runbookNamePattern" character varying(500), "runbookDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_17a8c429e39ff035165203fe954" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b222251da7b6b3d0a694b8ef3e" ON "RunbookOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0902e1ebf075a2eae4d8bbb2ca" ON "RunbookOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c76ceee1d7fcdbe0f662c5f26" ON "RunbookOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "runbookNamePattern" character varying(500), "runbookDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_800227f93985e811ee937358a0f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2fd3b3282ec1eb78e2d8d10063" ON "RunbookLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4537b5254f584a46e11c13a4e7" ON "RunbookLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bbefdde0326743687957bc9ece" ON "RunbookLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookOwnerRuleRunbookLabel" ("runbookOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_875699e0ad43c5ed368ac386e49" PRIMARY KEY ("runbookOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8468d610506c520a9fcd703789" ON "RunbookOwnerRuleRunbookLabel" ("runbookOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d0efb0a959bfca1f3f4d13ebb" ON "RunbookOwnerRuleRunbookLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookOwnerRuleOwnerUser" ("runbookOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_02e63893b2c4a22a7d75e0e5ea2" PRIMARY KEY ("runbookOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8fa6acf1eda12dd457baaabcf" ON "RunbookOwnerRuleOwnerUser" ("runbookOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1cf097335b05aacdb19e739ae" ON "RunbookOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookOwnerRuleOwnerTeam" ("runbookOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_2b499f9dc92bc146eb82cf063f2" PRIMARY KEY ("runbookOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_218d4a7e39a8cbfb9f9b708bf2" ON "RunbookOwnerRuleOwnerTeam" ("runbookOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cdd04b8aa846904624f01a179" ON "RunbookOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookLabelRuleRunbookLabel" ("runbookLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_57e452775c818690ea4f024b8b9" PRIMARY KEY ("runbookLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_93d5c0fee379a53dae706240bf" ON "RunbookLabelRuleRunbookLabel" ("runbookLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97380f7e13caba849f56cd9a8f" ON "RunbookLabelRuleRunbookLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookLabelRuleLabelToAdd" ("runbookLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ef3503b71e34bd176a2dcbb54be" PRIMARY KEY ("runbookLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_511ee1cd845ffc899daa4cf348" ON "RunbookLabelRuleLabelToAdd" ("runbookLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3db3c3488fb99126bcaf644b77" ON "RunbookLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" ADD CONSTRAINT "FK_b222251da7b6b3d0a694b8ef3e5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" ADD CONSTRAINT "FK_eeec96e31f268f8aa9f50a4cb82" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" ADD CONSTRAINT "FK_cc6d4030c1303b22802622dfd75" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" ADD CONSTRAINT "FK_2fd3b3282ec1eb78e2d8d100635" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" ADD CONSTRAINT "FK_b8d39ddfdf0984c4b28178b682e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" ADD CONSTRAINT "FK_dc16a29e697796e15011b88af9c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleRunbookLabel" ADD CONSTRAINT "FK_8468d610506c520a9fcd7037892" FOREIGN KEY ("runbookOwnerRuleId") REFERENCES "RunbookOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleRunbookLabel" ADD CONSTRAINT "FK_6d0efb0a959bfca1f3f4d13ebb0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerUser" ADD CONSTRAINT "FK_d8fa6acf1eda12dd457baaabcfb" FOREIGN KEY ("runbookOwnerRuleId") REFERENCES "RunbookOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerUser" ADD CONSTRAINT "FK_c1cf097335b05aacdb19e739aec" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_218d4a7e39a8cbfb9f9b708bf28" FOREIGN KEY ("runbookOwnerRuleId") REFERENCES "RunbookOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_2cdd04b8aa846904624f01a1797" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleRunbookLabel" ADD CONSTRAINT "FK_93d5c0fee379a53dae706240bfa" FOREIGN KEY ("runbookLabelRuleId") REFERENCES "RunbookLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleRunbookLabel" ADD CONSTRAINT "FK_97380f7e13caba849f56cd9a8f1" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleLabelToAdd" ADD CONSTRAINT "FK_511ee1cd845ffc899daa4cf3480" FOREIGN KEY ("runbookLabelRuleId") REFERENCES "RunbookLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleLabelToAdd" ADD CONSTRAINT "FK_3db3c3488fb99126bcaf644b77f" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleLabelToAdd" DROP CONSTRAINT "FK_3db3c3488fb99126bcaf644b77f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleLabelToAdd" DROP CONSTRAINT "FK_511ee1cd845ffc899daa4cf3480"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleRunbookLabel" DROP CONSTRAINT "FK_97380f7e13caba849f56cd9a8f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRuleRunbookLabel" DROP CONSTRAINT "FK_93d5c0fee379a53dae706240bfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_2cdd04b8aa846904624f01a1797"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_218d4a7e39a8cbfb9f9b708bf28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerUser" DROP CONSTRAINT "FK_c1cf097335b05aacdb19e739aec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleOwnerUser" DROP CONSTRAINT "FK_d8fa6acf1eda12dd457baaabcfb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleRunbookLabel" DROP CONSTRAINT "FK_6d0efb0a959bfca1f3f4d13ebb0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRuleRunbookLabel" DROP CONSTRAINT "FK_8468d610506c520a9fcd7037892"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" DROP CONSTRAINT "FK_dc16a29e697796e15011b88af9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" DROP CONSTRAINT "FK_b8d39ddfdf0984c4b28178b682e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabelRule" DROP CONSTRAINT "FK_2fd3b3282ec1eb78e2d8d100635"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" DROP CONSTRAINT "FK_cc6d4030c1303b22802622dfd75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" DROP CONSTRAINT "FK_eeec96e31f268f8aa9f50a4cb82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookOwnerRule" DROP CONSTRAINT "FK_b222251da7b6b3d0a694b8ef3e5"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookLabelRuleLabelToAdd"`);
    await queryRunner.query(`DROP TABLE "RunbookLabelRuleRunbookLabel"`);
    await queryRunner.query(`DROP TABLE "RunbookOwnerRuleOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "RunbookOwnerRuleOwnerUser"`);
    await queryRunner.query(`DROP TABLE "RunbookOwnerRuleRunbookLabel"`);
    await queryRunner.query(`DROP TABLE "RunbookLabelRule"`);
    await queryRunner.query(`DROP TABLE "RunbookOwnerRule"`);
  }
}
