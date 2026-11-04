import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Moved out of AddOpenStackHostLinkAndInstanceMetrics1808992930000. Host already exists and every
 * agent's heartbeat writes it, so the index on its new "openStackCloudId" column is built
 * online, and the foreign key to "OpenStackCloud" is added NOT VALID and then validated,
 * without blocking those writes. Every existing row's column is null, so the validation
 * finds nothing to refuse. Safe to run again after a stop part way.
 */
export class AddOpenStackHostLinkIndexAndKey1808992940000 implements MigrationInterface {
  public name: string = "AddOpenStackHostLinkIndexAndKey1808992940000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_04ec2ccb2408859337696d0e87" ON "Host" ("openStackCloudId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_04ec2ccb2408859337696d0e873" FOREIGN KEY ("openStackCloudId") REFERENCES "OpenStackCloud"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_04ec2ccb2408859337696d0e873"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04ec2ccb2408859337696d0e87"`,
    );
  }
}
