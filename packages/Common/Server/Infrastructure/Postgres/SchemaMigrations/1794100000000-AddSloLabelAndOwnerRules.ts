import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration. SLO label rules and SLO
 * owner rules: the two rule tables plus their label, owner user and owner team
 * join tables. New, empty tables only - nothing existing is touched.
 */
export class AddSloLabelAndOwnerRules1794100000000
  implements MigrationInterface
{
  public name: string = "AddSloLabelAndOwnerRules1794100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "serviceLevelObjectiveNamePattern" character varying(500), "serviceLevelObjectiveDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_fcca76effc951a34efbbac08262" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52a12c08da9cfed82a6d55ee2a" ON "ServiceLevelObjectiveOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_675d55cd050bae45ead9bc5a76" ON "ServiceLevelObjectiveOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_887a6293429f3079055ca2f593" ON "ServiceLevelObjectiveOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "serviceLevelObjectiveNamePattern" character varying(500), "serviceLevelObjectiveDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_243e193d772af6b2268c50bc546" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7bf2cb71d4eadd777dca39d2e5" ON "ServiceLevelObjectiveLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f590d00d3ce34582a752bd8dca" ON "ServiceLevelObjectiveLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bc184754b090db18209d325dc3" ON "ServiceLevelObjectiveLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" ("serviceLevelObjectiveOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_abc4ed3e95319b9eddda678fbf2" PRIMARY KEY ("serviceLevelObjectiveOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f61365ab62fb2cda9cabfba6a" ON "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" ("serviceLevelObjectiveOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a53d5afa239072fbbcd830ee1e" ON "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveOwnerRuleOwnerUser" ("serviceLevelObjectiveOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_815cbebe01771c4cb5391e6c746" PRIMARY KEY ("serviceLevelObjectiveOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb2984cb07f49c10c2b43a2a71" ON "ServiceLevelObjectiveOwnerRuleOwnerUser" ("serviceLevelObjectiveOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0151b4abffe8e16c9ebdd3b4cf" ON "ServiceLevelObjectiveOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveOwnerRuleOwnerTeam" ("serviceLevelObjectiveOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_beb34d84842d0daf68f77cfa1ae" PRIMARY KEY ("serviceLevelObjectiveOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12919a82600bbabd2ed7554526" ON "ServiceLevelObjectiveOwnerRuleOwnerTeam" ("serviceLevelObjectiveOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6082f2cc1e7d70c21314f8571b" ON "ServiceLevelObjectiveOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" ("serviceLevelObjectiveLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_7118b5b1431e0c11443c93b7ee0" PRIMARY KEY ("serviceLevelObjectiveLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a4fed4da4bd53243128e78ced" ON "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" ("serviceLevelObjectiveLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f97e9f9b0f0f138be034ecefe7" ON "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLevelObjectiveLabelRuleLabelToAdd" ("serviceLevelObjectiveLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8ed516417c4aabb76de7f4082f6" PRIMARY KEY ("serviceLevelObjectiveLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6511777681392a31b0d8e3ad1d" ON "ServiceLevelObjectiveLabelRuleLabelToAdd" ("serviceLevelObjectiveLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b41fe48b6a5df099dfe513717d" ON "ServiceLevelObjectiveLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" ADD CONSTRAINT "FK_52a12c08da9cfed82a6d55ee2a6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" ADD CONSTRAINT "FK_60f95ff7a6d32473e16dd7a9d96" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" ADD CONSTRAINT "FK_7a1bb4246c7029fb5eec8dfbc1c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" ADD CONSTRAINT "FK_7bf2cb71d4eadd777dca39d2e55" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" ADD CONSTRAINT "FK_1de61bef2e13d1e25394360ba2e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" ADD CONSTRAINT "FK_72ab545b8be48bcae655b1c83d2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" ADD CONSTRAINT "FK_8f61365ab62fb2cda9cabfba6a9" FOREIGN KEY ("serviceLevelObjectiveOwnerRuleId") REFERENCES "ServiceLevelObjectiveOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" ADD CONSTRAINT "FK_a53d5afa239072fbbcd830ee1eb" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerUser" ADD CONSTRAINT "FK_bb2984cb07f49c10c2b43a2a716" FOREIGN KEY ("serviceLevelObjectiveOwnerRuleId") REFERENCES "ServiceLevelObjectiveOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerUser" ADD CONSTRAINT "FK_0151b4abffe8e16c9ebdd3b4cf6" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_12919a82600bbabd2ed7554526e" FOREIGN KEY ("serviceLevelObjectiveOwnerRuleId") REFERENCES "ServiceLevelObjectiveOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_6082f2cc1e7d70c21314f8571b9" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" ADD CONSTRAINT "FK_5a4fed4da4bd53243128e78ced0" FOREIGN KEY ("serviceLevelObjectiveLabelRuleId") REFERENCES "ServiceLevelObjectiveLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" ADD CONSTRAINT "FK_f97e9f9b0f0f138be034ecefe7c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleLabelToAdd" ADD CONSTRAINT "FK_6511777681392a31b0d8e3ad1de" FOREIGN KEY ("serviceLevelObjectiveLabelRuleId") REFERENCES "ServiceLevelObjectiveLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleLabelToAdd" ADD CONSTRAINT "FK_b41fe48b6a5df099dfe513717d8" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleLabelToAdd" DROP CONSTRAINT "FK_b41fe48b6a5df099dfe513717d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleLabelToAdd" DROP CONSTRAINT "FK_6511777681392a31b0d8e3ad1de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" DROP CONSTRAINT "FK_f97e9f9b0f0f138be034ecefe7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel" DROP CONSTRAINT "FK_5a4fed4da4bd53243128e78ced0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_6082f2cc1e7d70c21314f8571b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_12919a82600bbabd2ed7554526e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerUser" DROP CONSTRAINT "FK_0151b4abffe8e16c9ebdd3b4cf6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleOwnerUser" DROP CONSTRAINT "FK_bb2984cb07f49c10c2b43a2a716"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" DROP CONSTRAINT "FK_a53d5afa239072fbbcd830ee1eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel" DROP CONSTRAINT "FK_8f61365ab62fb2cda9cabfba6a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" DROP CONSTRAINT "FK_72ab545b8be48bcae655b1c83d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" DROP CONSTRAINT "FK_1de61bef2e13d1e25394360ba2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveLabelRule" DROP CONSTRAINT "FK_7bf2cb71d4eadd777dca39d2e55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" DROP CONSTRAINT "FK_7a1bb4246c7029fb5eec8dfbc1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" DROP CONSTRAINT "FK_60f95ff7a6d32473e16dd7a9d96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveOwnerRule" DROP CONSTRAINT "FK_52a12c08da9cfed82a6d55ee2a6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b41fe48b6a5df099dfe513717d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6511777681392a31b0d8e3ad1d"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveLabelRuleLabelToAdd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f97e9f9b0f0f138be034ecefe7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a4fed4da4bd53243128e78ced"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6082f2cc1e7d70c21314f8571b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12919a82600bbabd2ed7554526"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveOwnerRuleOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0151b4abffe8e16c9ebdd3b4cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb2984cb07f49c10c2b43a2a71"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveOwnerRuleOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a53d5afa239072fbbcd830ee1e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f61365ab62fb2cda9cabfba6a"`,
    );
    await queryRunner.query(
      `DROP TABLE "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc184754b090db18209d325dc3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f590d00d3ce34582a752bd8dca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7bf2cb71d4eadd777dca39d2e5"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_887a6293429f3079055ca2f593"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_675d55cd050bae45ead9bc5a76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52a12c08da9cfed82a6d55ee2a"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLevelObjectiveOwnerRule"`);
  }
}
