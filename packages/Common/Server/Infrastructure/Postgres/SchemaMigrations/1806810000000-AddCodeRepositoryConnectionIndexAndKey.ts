import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCodeRepositoryConnections1806800000000, and moved into a migration of
 * its own: "CodeRepository" already exists, so the index on its new
 * "codeRepositoryConnectionId" column is built online, and the foreign key
 * to "CodeRepositoryConnection" is added NOT VALID and then validated,
 * without blocking either table's writes. Every existing repository's
 * column is null, so the validation finds nothing to refuse. Safe to run
 * again after a stop part way: an index or key that is already there is
 * left as it is.
 */
export class AddCodeRepositoryConnectionIndexAndKey1806810000000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryConnectionIndexAndKey1806810000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_a90a9f5d82a6453e8ee5a7e8c9" ON "CodeRepository" ("codeRepositoryConnectionId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_a90a9f5d82a6453e8ee5a7e8c96" FOREIGN KEY ("codeRepositoryConnectionId") REFERENCES "CodeRepositoryConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_a90a9f5d82a6453e8ee5a7e8c96"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a90a9f5d82a6453e8ee5a7e8c9"`,
    );
  }
}
