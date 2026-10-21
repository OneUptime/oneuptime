import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddVMwareProbeCollection1801300000000, and moved into a migration of its
 * own: VMwareVCenter already exists, so its new index - the probe's claim,
 * "my vCenters whose next collection is due" - and the foreign key of
 * collectionProbeId are built online, without blocking the table's writers
 * (ingest updates every vCenter on every collection). Safe to run again
 * after a stop part way.
 */
export class AddVMwareProbeCollectionIndexes1801350000000
  implements MigrationInterface
{
  public name: string = "AddVMwareProbeCollectionIndexes1801350000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_eb35f5979d3377a4e13f2fd0ae" ON "VMwareVCenter" ("collectionProbeId", "nextCollectionAt") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "VMwareVCenter" ADD CONSTRAINT "FK_7a678e233358c38ed96a92dafdc" FOREIGN KEY ("collectionProbeId") REFERENCES "Probe"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP CONSTRAINT "FK_7a678e233358c38ed96a92dafdc"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_eb35f5979d3377a4e13f2fd0ae"`,
    );
  }
}
