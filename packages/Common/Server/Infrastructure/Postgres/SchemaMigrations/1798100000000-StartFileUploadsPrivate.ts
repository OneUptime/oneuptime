import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Every upload now starts private (File.isPublic, which FileService sets on
 * every upload whatever the request says): a file becomes public only when
 * a record that shows it to everyone is published - an image in a public
 * note, an announcement or a published postmortem, a probe's or an AI
 * agent's icon. The column default follows, so a row written without the
 * column starts private too.
 *
 * Only the column default changes. Existing files keep the visibility they
 * have: a public file may be an image a published note or a status page
 * shows, and nothing here can tell which, so making any of them private
 * would break a page that shows it. SET DEFAULT is a catalog change; it
 * rewrites no rows.
 */
export class StartFileUploadsPrivate1798100000000
  implements MigrationInterface
{
  public name: string = "StartFileUploadsPrivate1798100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" SET DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" SET DEFAULT true`,
    );
  }
}
