import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCloudApps1808783000000, and moved into a migration of its own:
 * CloudResourceInstance already exists and the telemetry ingest writes it
 * all the time, so the index on its new "cloudAppId" column is built online,
 * and the foreign key to "CloudApp" is added NOT VALID and then validated,
 * without blocking either table's writes. Every existing instance's column
 * is null, so the validation finds nothing to refuse. Safe to run again
 * after a stop part way: an index or key that is already there is left as
 * it is.
 */
export class AddCloudResourceInstanceAppIndexAndKey1808784000000
  implements MigrationInterface
{
  public name: string = "AddCloudResourceInstanceAppIndexAndKey1808784000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_542c171de724257b0ed0cd073b" ON "CloudResourceInstance" ("cloudAppId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CloudResourceInstance" ADD CONSTRAINT "FK_542c171de724257b0ed0cd073ba" FOREIGN KEY ("cloudAppId") REFERENCES "CloudApp"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudResourceInstance" DROP CONSTRAINT "FK_542c171de724257b0ed0cd073ba"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_542c171de724257b0ed0cd073b"`,
    );
  }
}
