import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCodeRepositoryRunner1804300000000, and moved into a migration of its
 * own: projects already have repositories in "CodeRepository", so the index
 * on its new "runnerId" column is built online, and the foreign key to
 * "Runner" is added NOT VALID and then validated, without blocking the
 * writes a repository gets while AI works in it. The backfill gave a
 * repository only a Runner of its own project that exists, so the
 * validation finds nothing to refuse. Safe to run again after a stop part
 * way.
 */
export class AddCodeRepositoryRunnerIndexAndKey1804350000000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryRunnerIndexAndKey1804350000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_119124a9f13918c61c08e91ec9" ON "CodeRepository" ("runnerId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_119124a9f13918c61c08e91ec96" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_119124a9f13918c61c08e91ec96"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_119124a9f13918c61c08e91ec9"`,
    );
  }
}
