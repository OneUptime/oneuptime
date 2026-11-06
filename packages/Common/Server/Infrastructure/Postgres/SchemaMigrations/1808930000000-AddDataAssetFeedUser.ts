import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration. A data asset's
 * timeline names the person an entry is about or was done by, as every
 * other resource feed does, so the shared timeline (ResourceFeed) reads it
 * the same way. "DataAssetFeed" already exists and the table-health
 * collections write it, so the foreign key to "User" is added NOT VALID and
 * then validated, without blocking those writes; every existing entry's
 * column is null, so the validation finds nothing to refuse. Safe to run
 * again after a stop part way: a column or key that is already there is
 * left as it is.
 */
export class AddDataAssetFeedUser1808930000000 implements MigrationInterface {
  public name: string = "AddDataAssetFeedUser1808930000000";

  // The validation runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" ADD COLUMN IF NOT EXISTS "userId" uuid`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "DataAssetFeed" ADD CONSTRAINT "FK_05c1e1c0d8fc1a7862a1d03eeea" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAssetFeed" DROP CONSTRAINT "FK_05c1e1c0d8fc1a7862a1d03eeea"`,
    );
    await queryRunner.query(`ALTER TABLE "DataAssetFeed" DROP COLUMN "userId"`);
  }
}
