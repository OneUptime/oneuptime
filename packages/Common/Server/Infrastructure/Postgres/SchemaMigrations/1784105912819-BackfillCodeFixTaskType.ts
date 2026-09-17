import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillCodeFixTaskType1784105912819
  implements MigrationInterface
{
  public name = "BackfillCodeFixTaskType1784105912819";

  /*
   * A null AIRun.codeFixTaskType on a CodeFix run has always MEANT
   * FixException: every code-fix run created before task recipes existed was
   * an exception fix, and both the server's read path
   * (CodeFixTaskTypeHelper.fromDatabaseValue) and the dashboard normalize the
   * null to FixException so nobody ever sees it.
   *
   * That normalization only covers reads. Now that the AI Tasks list filters
   * through the standard CRUD, a "Fix Exception" filter compiles to
   * `codeFixTaskType IN ('FixException')`, which NULL never matches — the
   * oldest runs would silently vanish from the filtered list. The bespoke
   * endpoint papered over this with an equalToOrNull query it built itself;
   * that endpoint is gone, so the meaning gets written into the data instead.
   *
   * Scoped to runType = 'CodeFix': codeFixTaskType is meaningless on chat and
   * investigation runs and must stay null there.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "AIRun" SET "codeFixTaskType" = 'FixException' WHERE "runType" = 'CodeFix' AND "codeFixTaskType" IS NULL`,
    );
  }

  /*
   * Deliberately a no-op. The rows this set are indistinguishable from rows
   * that already said FixException, so nulling them back would corrupt data
   * this migration never touched. Reverting is also unnecessary: the read path
   * still normalizes null to FixException, so an older build reads these rows
   * exactly as it did before.
   */
  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
