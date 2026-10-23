import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * An incident or alert owner rule can list teams under Creator's Team
 * (IncidentOwnerRule.creatorTeams, AlertOwnerRule.creatorTeams): when the
 * person who creates a matching incident or alert is a member of one of
 * them, that team becomes an owner too (Server/Utils/Rules/CreatorTeams).
 * Each list is a join table of its own, like the rule's Owner Teams.
 *
 * Nothing to backfill: every rule there is lists none, and adds what it
 * added before. Both tables are new, so their indexes and foreign keys are
 * built here, on empty tables, without blocking anything.
 */
export class AddOwnerRuleCreatorTeams1806200000000
  implements MigrationInterface
{
  public name: string = "AddOwnerRuleCreatorTeams1806200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleCreatorTeam" ("alertOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_fcd8ae769ca4c88336933751c16" PRIMARY KEY ("alertOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e707ca754acb94356a2b01f2f4" ON "AlertOwnerRuleCreatorTeam" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e7201ca95df6bce71d5ed3cfb" ON "AlertOwnerRuleCreatorTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleCreatorTeam" ("incidentOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_5a5e7bd52c2788f6cd47e12b8fe" PRIMARY KEY ("incidentOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_11e4d26601a6b257010e6b5122" ON "IncidentOwnerRuleCreatorTeam" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7caca171a47016cc82de604fa2" ON "IncidentOwnerRuleCreatorTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleCreatorTeam" ADD CONSTRAINT "FK_e707ca754acb94356a2b01f2f42" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleCreatorTeam" ADD CONSTRAINT "FK_7e7201ca95df6bce71d5ed3cfbf" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleCreatorTeam" ADD CONSTRAINT "FK_11e4d26601a6b257010e6b5122d" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleCreatorTeam" ADD CONSTRAINT "FK_7caca171a47016cc82de604fa29" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleCreatorTeam" DROP CONSTRAINT "FK_7caca171a47016cc82de604fa29"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleCreatorTeam" DROP CONSTRAINT "FK_11e4d26601a6b257010e6b5122d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleCreatorTeam" DROP CONSTRAINT "FK_7e7201ca95df6bce71d5ed3cfbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleCreatorTeam" DROP CONSTRAINT "FK_e707ca754acb94356a2b01f2f42"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7caca171a47016cc82de604fa2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11e4d26601a6b257010e6b5122"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleCreatorTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e7201ca95df6bce71d5ed3cfb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e707ca754acb94356a2b01f2f4"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleCreatorTeam"`);
  }
}
