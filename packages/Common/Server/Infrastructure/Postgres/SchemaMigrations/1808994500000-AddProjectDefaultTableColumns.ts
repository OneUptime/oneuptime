import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The columns each of a project's lists shows everyone who has not chosen
 * their own (Project.defaultTableColumns, Types/Table/DefaultTableColumns):
 * a list's key to the ids of its columns in order and the ones switched off,
 * set by a Project Owner or Admin from the list's Customize Columns.
 *
 * Nullable, with no default and no row written: every project has set none,
 * so every list shows its own columns, or each person's own, as it did
 * before. Adding it is a catalogue change, not a rewrite.
 */
export class AddProjectDefaultTableColumns1808994500000
  implements MigrationInterface
{
  public name = "AddProjectDefaultTableColumns1808994500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultTableColumns" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultTableColumns"`,
    );
  }
}
