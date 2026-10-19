import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCodeTasks1804050000000, and moved into a migration of its own: "AIRun"
 * holds every chat turn, investigation and code-fix run, so the indexes on
 * its new "codeRepositoryId" and "codeTaskId" columns are built online, and
 * the foreign key to "CodeRepository" is added NOT VALID and then validated,
 * without blocking the writes runs make while they work. The backfill gave a
 * run only a repository that exists in its project, so the validation finds
 * nothing to refuse. Safe to run again after a stop part way.
 */
export class AddCodeTaskIndexesAndKey1804100000000
  implements MigrationInterface
{
  public name: string = "AddCodeTaskIndexesAndKey1804100000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_fa2f2ed227f46283753c04de74" ON "AIRun" ("codeRepositoryId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f77e615edd01ea057a25209683" ON "AIRun" ("codeTaskId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AIRun" ADD CONSTRAINT "FK_fa2f2ed227f46283753c04de74f" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP CONSTRAINT "FK_fa2f2ed227f46283753c04de74f"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f77e615edd01ea057a25209683"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_fa2f2ed227f46283753c04de74"`,
    );
  }
}
