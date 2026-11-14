import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Grouping rules can group by connected services (issue #6798): an incident
 * or alert joins an open episode of the rule when one of its services is,
 * calls or is called by a service of one already in it, on the Service Map.
 *
 *   - IncidentGroupingRule.groupByConnectedServices and
 *     AlertGroupingRule.groupByConnectedServices - the rule's switch. It is
 *     off on every existing rule, which groups exactly as it did.
 *
 * Statements as npm run generate-postgres-migration writes them for a
 * boolean column with a constant default: each is added without rewriting
 * its table, and nothing is backfilled.
 */
export class AddGroupByConnectedServicesToGroupingRules1809124000000
  implements MigrationInterface
{
  public name: string =
    "AddGroupByConnectedServicesToGroupingRules1809124000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "groupByConnectedServices" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "groupByConnectedServices" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupByConnectedServices"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "groupByConnectedServices"`,
    );
  }
}
