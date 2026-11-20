import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCloudAppPlatformCloudResource1809187207600, and moved into a migration
 * of its own: the telemetry ingest writes "CloudApp" for every app of every
 * App Platforms environment, so the index on its new
 * "platformCloudResourceId" column is built online, and the foreign key to
 * "CloudResource" is added NOT VALID and then validated, without blocking
 * those writes meanwhile. Every existing app's column is null, so the
 * validation finds nothing to refuse. Index and key names are TypeORM's
 * own, so the schema drift check finds nothing to change.
 *
 * The key empties an app's link when its site's row is deleted (ON DELETE
 * SET NULL); the index keeps that delete from reading every app.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddCloudAppPlatformCloudResourceIndexAndKey1809187207610
  implements MigrationInterface
{
  public name: string =
    "AddCloudAppPlatformCloudResourceIndexAndKey1809187207610";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_1b04c802f1e89284dfeaf2bdfe" ON "CloudApp" ("platformCloudResourceId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CloudApp" ADD CONSTRAINT "FK_1b04c802f1e89284dfeaf2bdfe2" FOREIGN KEY ("platformCloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudApp" DROP CONSTRAINT "FK_1b04c802f1e89284dfeaf2bdfe2"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_1b04c802f1e89284dfeaf2bdfe"`,
    );
  }
}
