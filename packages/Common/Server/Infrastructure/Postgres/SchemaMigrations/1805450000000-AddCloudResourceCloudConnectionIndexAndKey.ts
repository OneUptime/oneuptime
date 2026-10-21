import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCloudConnection1805400000000, and moved into a migration of its own:
 * projects already have resources in "CloudResource", which ingest writes
 * all the time, so the index on its new "cloudConnectionId" column is
 * built online, and the foreign key to "CloudConnection" is added NOT
 * VALID and then validated, without blocking those writes. Every existing
 * row's column is null, so the validation finds nothing to refuse. Safe to
 * run again after a stop part way.
 */
export class AddCloudResourceCloudConnectionIndexAndKey1805450000000
  implements MigrationInterface
{
  public name: string =
    "AddCloudResourceCloudConnectionIndexAndKey1805450000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e8eacdbd89826e4ceb6f25d91c" ON "CloudResource" ("cloudConnectionId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CloudResource" ADD CONSTRAINT "FK_e8eacdbd89826e4ceb6f25d91c8" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP CONSTRAINT "FK_e8eacdbd89826e4ceb6f25d91c8"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e8eacdbd89826e4ceb6f25d91c"`,
    );
  }
}
