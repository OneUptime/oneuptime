import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkDeviceLinkRule1786639512056
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceLinkRule1786639512056";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceLinkRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying, "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2ddb1aa4f3ebf1181c867001d93" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceLinkRuleChildLabel" ("networkDeviceLinkRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_0fe51b1818df74cdbb691b2d014" PRIMARY KEY ("networkDeviceLinkRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cd62497b9d2eacd85a15ce959" ON "NetworkDeviceLinkRuleChildLabel" ("networkDeviceLinkRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e708d3fe03877842995b20298" ON "NetworkDeviceLinkRuleChildLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "NetworkDeviceLinkRuleParentLabel" ("networkDeviceLinkRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9cd76252ff3e8b372eaa8ad8dc3" PRIMARY KEY ("networkDeviceLinkRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34a873cf2a83fb4b9b1d953246" ON "NetworkDeviceLinkRuleParentLabel" ("networkDeviceLinkRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_93befe63403330b0bca7d57019" ON "NetworkDeviceLinkRuleParentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" ADD CONSTRAINT "FK_ed9e718e957729564f332fed37c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" ADD CONSTRAINT "FK_3e743cfde6ab41d3231d87e2313" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" ADD CONSTRAINT "FK_e1309ec901d89b516e8d4289dab" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleChildLabel" ADD CONSTRAINT "FK_2cd62497b9d2eacd85a15ce959e" FOREIGN KEY ("networkDeviceLinkRuleId") REFERENCES "NetworkDeviceLinkRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleChildLabel" ADD CONSTRAINT "FK_3e708d3fe03877842995b202984" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleParentLabel" ADD CONSTRAINT "FK_34a873cf2a83fb4b9b1d953246a" FOREIGN KEY ("networkDeviceLinkRuleId") REFERENCES "NetworkDeviceLinkRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleParentLabel" ADD CONSTRAINT "FK_93befe63403330b0bca7d570195" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleParentLabel" DROP CONSTRAINT "FK_93befe63403330b0bca7d570195"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleParentLabel" DROP CONSTRAINT "FK_34a873cf2a83fb4b9b1d953246a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleChildLabel" DROP CONSTRAINT "FK_3e708d3fe03877842995b202984"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRuleChildLabel" DROP CONSTRAINT "FK_2cd62497b9d2eacd85a15ce959e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" DROP CONSTRAINT "FK_e1309ec901d89b516e8d4289dab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" DROP CONSTRAINT "FK_3e743cfde6ab41d3231d87e2313"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" DROP CONSTRAINT "FK_ed9e718e957729564f332fed37c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_93befe63403330b0bca7d57019"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34a873cf2a83fb4b9b1d953246"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceLinkRuleParentLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e708d3fe03877842995b20298"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cd62497b9d2eacd85a15ce959"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkDeviceLinkRuleChildLabel"`);
    await queryRunner.query(`DROP TABLE "NetworkDeviceLinkRule"`);
  }
}
