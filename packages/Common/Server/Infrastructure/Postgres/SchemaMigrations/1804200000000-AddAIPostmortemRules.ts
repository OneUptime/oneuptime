import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Postmortem rules (AIPostmortemRule): which resolved incidents OneUptime AI
 * drafts a postmortem for, and the postmortem templates each draft may
 * follow. A new table, in the order people drag rules into ("order"), with
 * the conditions every incident AI rule has - monitors, severities, labels,
 * monitor labels, title and description patterns, and the versioned
 * "criteria" - and the rule's templates, each in a join table of its own.
 *
 * Only new tables, created empty: their indexes and foreign keys are built
 * at once and block nothing. No row is written, so every project keeps
 * drafting as before - with no rule, every resolved incident gets a draft,
 * in OneUptime AI's standard outline.
 */
export class AddAIPostmortemRules1804200000000 implements MigrationInterface {
  public name: string = "AddAIPostmortemRules1804200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIPostmortemRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "order" integer NOT NULL DEFAULT '1', "titlePattern" character varying(500), "descriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a67c16af27f68b8c731bd8b9bd7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d01f86f1bffc772e2c7cb8721" ON "AIPostmortemRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_815acb5a90a8b38e8f5d5faee9" ON "AIPostmortemRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a577ad779489b818d12a21cd8d" ON "AIPostmortemRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77cdc37f46f22469923c794173" ON "AIPostmortemRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIPostmortemRuleMonitor" ("aiPostmortemRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_4c7dc13c98496c27be8d19e21a5" PRIMARY KEY ("aiPostmortemRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b41cfcca5ab8cb58f16a40cdc6" ON "AIPostmortemRuleMonitor" ("aiPostmortemRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_63d454b83b4a9e507aa6375369" ON "AIPostmortemRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIPostmortemRuleIncidentSeverity" ("aiPostmortemRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_500b040158bea9c81ffe182713c" PRIMARY KEY ("aiPostmortemRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ebc9154f8023545cfe068a587" ON "AIPostmortemRuleIncidentSeverity" ("aiPostmortemRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c8a6c7c847f8925d4acf0d66e" ON "AIPostmortemRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIPostmortemRuleLabel" ("aiPostmortemRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_a3ecf257f1bcf6a3fbc26aee7d0" PRIMARY KEY ("aiPostmortemRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb3c0802b1b155ba5c85fa80b2" ON "AIPostmortemRuleLabel" ("aiPostmortemRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b86fac06a1e580cdc32769fb5" ON "AIPostmortemRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIPostmortemRuleMonitorLabel" ("aiPostmortemRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_497efe737cab8be4df38ec8bed1" PRIMARY KEY ("aiPostmortemRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_371ecd937dbab0b6322a681a77" ON "AIPostmortemRuleMonitorLabel" ("aiPostmortemRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13b939b82f342159fbddf47a2f" ON "AIPostmortemRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIPostmortemRuleIncidentPostmortemTemplate" ("aiPostmortemRuleId" uuid NOT NULL, "incidentPostmortemTemplateId" uuid NOT NULL, CONSTRAINT "PK_973b1e99fe7df3bbfcf60898b82" PRIMARY KEY ("aiPostmortemRuleId", "incidentPostmortemTemplateId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4ecd63c6f77864d3a1d1ba994" ON "AIPostmortemRuleIncidentPostmortemTemplate" ("aiPostmortemRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ea52c88d39ef262899d5eb960" ON "AIPostmortemRuleIncidentPostmortemTemplate" ("incidentPostmortemTemplateId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" ADD CONSTRAINT "FK_8d01f86f1bffc772e2c7cb8721d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" ADD CONSTRAINT "FK_49d37b628cc1eadc303bdad963e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" ADD CONSTRAINT "FK_03f1a3c5cb6493bf12262e95b98" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitor" ADD CONSTRAINT "FK_b41cfcca5ab8cb58f16a40cdc6c" FOREIGN KEY ("aiPostmortemRuleId") REFERENCES "AIPostmortemRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitor" ADD CONSTRAINT "FK_63d454b83b4a9e507aa6375369b" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentSeverity" ADD CONSTRAINT "FK_7ebc9154f8023545cfe068a587e" FOREIGN KEY ("aiPostmortemRuleId") REFERENCES "AIPostmortemRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentSeverity" ADD CONSTRAINT "FK_5c8a6c7c847f8925d4acf0d66eb" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleLabel" ADD CONSTRAINT "FK_eb3c0802b1b155ba5c85fa80b2c" FOREIGN KEY ("aiPostmortemRuleId") REFERENCES "AIPostmortemRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleLabel" ADD CONSTRAINT "FK_3b86fac06a1e580cdc32769fb56" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitorLabel" ADD CONSTRAINT "FK_371ecd937dbab0b6322a681a77d" FOREIGN KEY ("aiPostmortemRuleId") REFERENCES "AIPostmortemRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitorLabel" ADD CONSTRAINT "FK_13b939b82f342159fbddf47a2f4" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentPostmortemTemplate" ADD CONSTRAINT "FK_a4ecd63c6f77864d3a1d1ba9945" FOREIGN KEY ("aiPostmortemRuleId") REFERENCES "AIPostmortemRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentPostmortemTemplate" ADD CONSTRAINT "FK_0ea52c88d39ef262899d5eb9604" FOREIGN KEY ("incidentPostmortemTemplateId") REFERENCES "IncidentPostmortemTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentPostmortemTemplate" DROP CONSTRAINT "FK_0ea52c88d39ef262899d5eb9604"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentPostmortemTemplate" DROP CONSTRAINT "FK_a4ecd63c6f77864d3a1d1ba9945"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitorLabel" DROP CONSTRAINT "FK_13b939b82f342159fbddf47a2f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitorLabel" DROP CONSTRAINT "FK_371ecd937dbab0b6322a681a77d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleLabel" DROP CONSTRAINT "FK_3b86fac06a1e580cdc32769fb56"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleLabel" DROP CONSTRAINT "FK_eb3c0802b1b155ba5c85fa80b2c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentSeverity" DROP CONSTRAINT "FK_5c8a6c7c847f8925d4acf0d66eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleIncidentSeverity" DROP CONSTRAINT "FK_7ebc9154f8023545cfe068a587e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitor" DROP CONSTRAINT "FK_63d454b83b4a9e507aa6375369b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRuleMonitor" DROP CONSTRAINT "FK_b41cfcca5ab8cb58f16a40cdc6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" DROP CONSTRAINT "FK_03f1a3c5cb6493bf12262e95b98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" DROP CONSTRAINT "FK_49d37b628cc1eadc303bdad963e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" DROP CONSTRAINT "FK_8d01f86f1bffc772e2c7cb8721d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ea52c88d39ef262899d5eb960"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4ecd63c6f77864d3a1d1ba994"`,
    );
    await queryRunner.query(
      `DROP TABLE "AIPostmortemRuleIncidentPostmortemTemplate"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13b939b82f342159fbddf47a2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_371ecd937dbab0b6322a681a77"`,
    );
    await queryRunner.query(`DROP TABLE "AIPostmortemRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b86fac06a1e580cdc32769fb5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb3c0802b1b155ba5c85fa80b2"`,
    );
    await queryRunner.query(`DROP TABLE "AIPostmortemRuleLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c8a6c7c847f8925d4acf0d66e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ebc9154f8023545cfe068a587"`,
    );
    await queryRunner.query(`DROP TABLE "AIPostmortemRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_63d454b83b4a9e507aa6375369"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b41cfcca5ab8cb58f16a40cdc6"`,
    );
    await queryRunner.query(`DROP TABLE "AIPostmortemRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77cdc37f46f22469923c794173"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a577ad779489b818d12a21cd8d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_815acb5a90a8b38e8f5d5faee9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d01f86f1bffc772e2c7cb8721"`,
    );
    await queryRunner.query(`DROP TABLE "AIPostmortemRule"`);
  }
}
