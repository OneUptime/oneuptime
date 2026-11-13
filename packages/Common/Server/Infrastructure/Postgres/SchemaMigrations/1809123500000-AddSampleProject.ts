import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated for the models (TypeORM's migration:generate statements), and
 * numbered after the last registered migration.
 *
 * A sample project to look around in (issue #6808):
 *
 *   - Project.isSampleProject: false for every project there is, and set
 *     only when OneUptime makes a sample. A boolean with a constant default
 *     is added without rewriting the table (PostgreSQL 11 and later).
 *   - User.sampleProjectId: the sample a made-up person belongs to, null for
 *     everyone real. A nullable column with no default rewrites nothing.
 *
 * Its index and its foreign key (ON DELETE CASCADE: the sample's people go
 * with it) are built online, in the migration after this one
 * (AddSampleProjectUserIndex): "User" is a table every sign-in writes.
 */
export class AddSampleProject1809123500000 implements MigrationInterface {
  public name: string = "AddSampleProject1809123500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "isSampleProject" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "User" ADD "sampleProjectId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "sampleProjectId"`);
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "isSampleProject"`,
    );
  }
}
