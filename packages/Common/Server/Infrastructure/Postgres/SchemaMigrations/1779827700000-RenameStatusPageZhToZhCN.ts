import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data-only migration: the language code "zh" was renamed to "zh-CN" when
 * Traditional Chinese ("zh-TW") was added as a separate supported language.
 * Rewrite any persisted "zh" values on the StatusPage table so existing
 * tenants keep their Simplified Chinese setting.
 *
 * Written manually because typeorm's migration:generate only emits schema
 * diffs — it cannot detect that stored data needs rewriting.
 */
export class RenameStatusPageZhToZhCN1779827700000
  implements MigrationInterface
{
  public name: string = "RenameStatusPageZhToZhCN1779827700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // defaultLanguage is a varchar — straight UPDATE.
    await queryRunner.query(
      `UPDATE "StatusPage" SET "defaultLanguage" = 'zh-CN' WHERE "defaultLanguage" = 'zh'`,
    );

    /*
     * enabledLanguages is a jsonb array of strings. Replace every "zh"
     * element with "zh-CN" while leaving the rest of the array intact.
     * The WHERE clause uses jsonb containment so we only touch rows that
     * actually need rewriting.
     */
    await queryRunner.query(
      `UPDATE "StatusPage"
       SET "enabledLanguages" = (
         SELECT jsonb_agg(
           CASE WHEN elem = '"zh"'::jsonb THEN '"zh-CN"'::jsonb ELSE elem END
         )
         FROM jsonb_array_elements("enabledLanguages") AS elem
       )
       WHERE "enabledLanguages" @> '["zh"]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Best-effort reversal. "zh-CN" did not exist before this migration, so
     * any row containing it was originally "zh"; rows added after the
     * migration that legitimately use "zh-CN" will be reverted too, which is
     * the inherent limitation of rolling back data migrations.
     */
    await queryRunner.query(
      `UPDATE "StatusPage" SET "defaultLanguage" = 'zh' WHERE "defaultLanguage" = 'zh-CN'`,
    );
    await queryRunner.query(
      `UPDATE "StatusPage"
       SET "enabledLanguages" = (
         SELECT jsonb_agg(
           CASE WHEN elem = '"zh-CN"'::jsonb THEN '"zh"'::jsonb ELSE elem END
         )
         FROM jsonb_array_elements("enabledLanguages") AS elem
       )
       WHERE "enabledLanguages" @> '["zh-CN"]'::jsonb`,
    );
  }
}
