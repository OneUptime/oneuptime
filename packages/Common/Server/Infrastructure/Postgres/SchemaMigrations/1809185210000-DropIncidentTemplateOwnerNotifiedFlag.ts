import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An incident template's owner rows lose their "told yet" flag (#9758).
 *
 * Nobody is told they were made an owner of a template: its owners hear of
 * each incident declared from it, as that incident's owners. But an owner
 * added on a template's Owners card was written not told yet
 * (isOwnerNotified false), and no job ever read those rows, so the table
 * collected rows waiting for nothing. The column goes, with its index, as a
 * scheduled maintenance template's owner rows never had one.
 *
 * Generated. The plain DROP INDEX is the generator's, before the ALTER
 * TABLE that drops the index's column and takes the same lock in the same
 * transaction (Docs/migrations/README.md). down() puts the column back not
 * told, and its index.
 */
export class DropIncidentTemplateOwnerNotifiedFlag1809185210000
  implements MigrationInterface
{
  public name: string = "DropIncidentTemplateOwnerNotifiedFlag1809185210000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cb2fc022da183b99cf06f0043"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38583ea60d2df4a525098065f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" DROP COLUMN "isOwnerNotified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" DROP COLUMN "isOwnerNotified"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerUser" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateOwnerTeam" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38583ea60d2df4a525098065f3" ON "IncidentTemplateOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cb2fc022da183b99cf06f0043" ON "IncidentTemplateOwnerTeam" ("isOwnerNotified") `,
    );
  }
}
