import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and given the backfill below.
 *
 * LlmProvider.hasAdditionalParams: whether a provider has Additional
 * Parameters saved, for the members who read the provider but not its
 * parameters (those are read by project owners and admins alone, like the
 * API key). LlmProviderService writes it from the parameters on every create
 * and every update that writes them; the backfill gives every existing
 * provider the same answer, by the same rule
 * (LlmProviderService.hasAdditionalParams): an object or a list with at least
 * one entry, or text that is not blank, is something to send; nothing, JSON
 * null and an empty object, list or text are not.
 *
 * The column is NOT NULL with a constant default, so the ALTER only touches
 * the catalog; the UPDATE writes the providers that have parameters, of which
 * there are few.
 */
export class AddLlmProviderHasAdditionalParams1801000000000
  implements MigrationInterface
{
  public name: string = "AddLlmProviderHasAdditionalParams1801000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" ADD "hasAdditionalParams" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `UPDATE "LlmProvider" SET "hasAdditionalParams" = true WHERE "additionalParams" IS NOT NULL AND CASE jsonb_typeof("additionalParams") WHEN 'null' THEN false WHEN 'object' THEN "additionalParams" <> '{}'::jsonb WHEN 'array' THEN jsonb_array_length("additionalParams") > 0 WHEN 'string' THEN ("additionalParams" #>> '{}') ~ '[^[:space:]]' ELSE true END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmProvider" DROP COLUMN "hasAdditionalParams"`,
    );
  }
}
