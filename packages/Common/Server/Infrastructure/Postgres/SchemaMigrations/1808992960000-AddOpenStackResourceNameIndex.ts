import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A list's default sort, on a table every scrape writes to, so it is built online.
 * Safe to run again after a stop part way.
 */
export class AddOpenStackResourceNameIndex1808992960000 implements MigrationInterface {
  public name: string = "AddOpenStackResourceNameIndex1808992960000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_277882a1b1d10290b1c4c6253b" ON "OpenStackResource" ("projectId", "openStackCloudId", "kind", "name") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_277882a1b1d10290b1c4c6253b"`,
    );
  }
}
