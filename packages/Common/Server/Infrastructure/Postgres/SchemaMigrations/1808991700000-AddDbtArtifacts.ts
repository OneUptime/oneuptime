import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a dbt project's uploaded artifacts say of the tables Data
 * Observability watches (DbtIngest): the dbt node each table is, and, for a
 * check that is a dbt test, the test's unique id in the project, which each
 * upload is matched by.
 *
 * Nullable, with no default and no row written: each is written by the next
 * upload. Adding them is a catalogue change, not a rewrite.
 */
export class AddDbtArtifacts1808991700000 implements MigrationInterface {
  public name = "AddDbtArtifacts1808991700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DataAsset" ADD "dbtNode" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD "externalId" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DataCheck" DROP COLUMN "externalId"`);
    await queryRunner.query(`ALTER TABLE "DataAsset" DROP COLUMN "dbtNode"`);
  }
}
