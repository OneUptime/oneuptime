import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * DataStoreFinding.isFoundByContext (#11502): whether some of a finding's
 * values were found only beside the words that name their type, or under
 * a location whose name names it. Null for the findings written before: not
 * known, which coverage reads as found so where the type can be.
 */
export class AddDataStoreFindingIsFoundByContext1809187821502
  implements MigrationInterface
{
  public name = "AddDataStoreFindingIsFoundByContext1809187821502";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "isFoundByContext" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "isFoundByContext"`,
    );
  }
}
