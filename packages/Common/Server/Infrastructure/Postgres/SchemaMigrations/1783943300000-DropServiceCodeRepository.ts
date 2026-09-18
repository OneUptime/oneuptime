import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The ServiceCodeRepository mapping table is removed: service → repository
 * resolution now happens at runtime (stack-trace path matching over the
 * project's connected repositories, with name-match and only-repository
 * fallbacks — see Common/Server/Utils/CodeRepository/StackTraceRepoResolver).
 * Hand-written because typeorm migration:generate does not emit drops for
 * tables whose entity was deleted.
 */
export class DropServiceCodeRepository1783943300000
  implements MigrationInterface
{
  public name = "DropServiceCodeRepository1783943300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ServiceCodeRepository"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    /*
     * Intentionally irreversible: the feature this table served (manual
     * service → repository links) no longer exists in the application.
     */
  }
}
