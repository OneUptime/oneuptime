import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A form's templates (Forms > a form > Templates): named sets of answers a
 * submission can start from, kept as a JSON list on the form the way its
 * questions are. Nullable with no default, so this statement only adds the
 * column: every existing form starts with no templates, and its public page
 * is exactly what it was.
 */
export class AddFormTemplates1799500000000 implements MigrationInterface {
  public name: string = "AddFormTemplates1799500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Form" ADD "templates" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Form" DROP COLUMN "templates"`);
  }
}
