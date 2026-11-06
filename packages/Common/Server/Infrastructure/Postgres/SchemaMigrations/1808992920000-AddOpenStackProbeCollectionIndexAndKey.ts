import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Moved out of AddOpenStackProbeCollection1808992910000. OpenStackCloud already exists, and
 * ingest writes it on every scrape, so the index on what a probe collects next is
 * built online, and the foreign key to the probe is added NOT VALID and then validated,
 * without blocking those writes. Every existing row's column is null, so the validation
 * finds nothing to refuse. Safe to run again after a stop part way.
 */
export class AddOpenStackProbeCollectionIndexAndKey1808992920000
  implements MigrationInterface
{
  public name: string = "AddOpenStackProbeCollectionIndexAndKey1808992920000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_4b61066d95ca222b38b324e0c0" ON "OpenStackCloud" ("collectionProbeId", "nextCollectionAt") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "OpenStackCloud" ADD CONSTRAINT "FK_10130f0b04da8db29f45d688b6c" FOREIGN KEY ("collectionProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" DROP CONSTRAINT "FK_10130f0b04da8db29f45d688b6c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b61066d95ca222b38b324e0c0"`,
    );
  }
}
