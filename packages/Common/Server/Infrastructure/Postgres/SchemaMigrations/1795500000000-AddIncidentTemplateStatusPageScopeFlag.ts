import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * IncidentTemplate.isScopedToStatusPages: whether a template limits the
 * incidents declared from it to status pages, kept apart from its list of
 * pages so that a template whose every page was deleted (the join rows
 * cascade away) does not start declaring incidents that reach every status
 * page (see the column in IncidentTemplate).
 *
 * Templates that already list status pages are scoped, so the flag is set for
 * them. Nothing else changes: a template with no pages stays unscoped.
 */
export class AddIncidentTemplateStatusPageScopeFlag1795500000000
  implements MigrationInterface
{
  public name: string = "AddIncidentTemplateStatusPageScopeFlag1795500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ADD "isScopedToStatusPages" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `UPDATE "IncidentTemplate" SET "isScopedToStatusPages" = true WHERE "_id" IN (SELECT "incidentTemplateId" FROM "IncidentTemplateStatusPage")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" DROP COLUMN "isScopedToStatusPages"`,
    );
  }
}
