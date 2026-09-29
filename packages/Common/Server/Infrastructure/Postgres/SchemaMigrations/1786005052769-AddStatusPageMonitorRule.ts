import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageMonitorRule1786005052769
  implements MigrationInterface
{
  public name = "AddStatusPageMonitorRule1786005052769";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "StatusPageMonitorRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "statusPageGroupId" uuid, "showCurrentStatus" boolean NOT NULL DEFAULT true, "showUptimePercent" boolean NOT NULL DEFAULT true, "uptimePercentPrecision" character varying, "showStatusHistoryChart" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f8d44792805d19b9a80921b6aa6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1dfd95ad32f7b687ef4d7ba591" ON "StatusPageMonitorRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_473317deaa55a8305a047e4098" ON "StatusPageMonitorRule" ("statusPageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_61196848685b7e7f5a6a54278b" ON "StatusPageMonitorRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_71d1869039530178fd5f7e6faa" ON "StatusPageMonitorRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e6d0bc4d444371aaa13a1c14c" ON "StatusPageMonitorRule" ("statusPageGroupId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageMonitorRuleMonitorLabel" ("statusPageMonitorRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_59234d33b435d8e771cd3728ea4" PRIMARY KEY ("statusPageMonitorRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eb2b2a3601ea9813b8e162bd3" ON "StatusPageMonitorRuleMonitorLabel" ("statusPageMonitorRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bc08b888a870ecc9167516230a" ON "StatusPageMonitorRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD "statusPageMonitorRuleId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e1ed45d9506da817dc7811601" ON "StatusPageResource" ("statusPageMonitorRuleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD CONSTRAINT "FK_1dfd95ad32f7b687ef4d7ba5910" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD CONSTRAINT "FK_473317deaa55a8305a047e4098b" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD CONSTRAINT "FK_3e6d0bc4d444371aaa13a1c14cc" FOREIGN KEY ("statusPageGroupId") REFERENCES "StatusPageGroup"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD CONSTRAINT "FK_60d22031be1695cbd1405376cbf" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" ADD CONSTRAINT "FK_3416ec12899c9dde670d8dea290" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD CONSTRAINT "FK_4e1ed45d9506da817dc78116010" FOREIGN KEY ("statusPageMonitorRuleId") REFERENCES "StatusPageMonitorRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRuleMonitorLabel" ADD CONSTRAINT "FK_0eb2b2a3601ea9813b8e162bd3b" FOREIGN KEY ("statusPageMonitorRuleId") REFERENCES "StatusPageMonitorRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRuleMonitorLabel" ADD CONSTRAINT "FK_bc08b888a870ecc9167516230ad" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRuleMonitorLabel" DROP CONSTRAINT "FK_bc08b888a870ecc9167516230ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRuleMonitorLabel" DROP CONSTRAINT "FK_0eb2b2a3601ea9813b8e162bd3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP CONSTRAINT "FK_4e1ed45d9506da817dc78116010"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP CONSTRAINT "FK_3416ec12899c9dde670d8dea290"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP CONSTRAINT "FK_60d22031be1695cbd1405376cbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP CONSTRAINT "FK_3e6d0bc4d444371aaa13a1c14cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP CONSTRAINT "FK_473317deaa55a8305a047e4098b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageMonitorRule" DROP CONSTRAINT "FK_1dfd95ad32f7b687ef4d7ba5910"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e1ed45d9506da817dc7811601"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP COLUMN "statusPageMonitorRuleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc08b888a870ecc9167516230a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eb2b2a3601ea9813b8e162bd3"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageMonitorRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e6d0bc4d444371aaa13a1c14c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71d1869039530178fd5f7e6faa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_61196848685b7e7f5a6a54278b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_473317deaa55a8305a047e4098"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1dfd95ad32f7b687ef4d7ba591"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageMonitorRule"`);
  }
}
