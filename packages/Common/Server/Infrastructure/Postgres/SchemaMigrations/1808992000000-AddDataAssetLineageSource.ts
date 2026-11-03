import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Where each edge of lineage was seen (DataAssetLineageSource): a
 * pipeline's run, the database's query history, or a view's definition;
 * and, for an edge from query history, a login whose queries moved the
 * data.
 *
 * Nullable, with no default and no row written: an edge kept before reads
 * as a pipeline's, which every one was. Adding them is a catalogue change,
 * not a rewrite.
 */
export class AddDataAssetLineageSource1808992000000
  implements MigrationInterface
{
  public name: string = "AddDataAssetLineageSource1808992000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD "source" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" ADD "seenBy" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP COLUMN "seenBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAssetLineage" DROP COLUMN "source"`,
    );
  }
}
