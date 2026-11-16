import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the key column's type
 * in place.
 *
 * A project's API keys (ApiKey.apiKey) are stored hashed now (#8902): the
 * SHA-256 of the key, 64 hex digits, where the column was a uuid holding
 * the key itself. So the column becomes a varchar, as every HashedString
 * column is, and each key's hint - its last four characters, which the
 * key's pages show in place of the key - gets a column of its own.
 *
 *   - The generator emitted DROP COLUMN + ADD COLUMN, which would throw
 *     every key away - and with it every script, integration and Terraform
 *     configuration that uses one - before the HashProjectApiKeys data
 *     migration can hash them. An ALTER COLUMN TYPE keeps them: a uuid is
 *     cast to its text, lower-case, which the lookup accepts until the data
 *     migration hashes it.
 *   - Its index stays, by the name every installation's migrations gave it:
 *     a key is looked up by its hash through it.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts the uuid column back. A hashed key
 * is no uuid, and the key cannot be worked out from its hash, so down()
 * gives each hashed key a new random one, as a reset would: the release
 * before shows it on the key's page, and what used the key before needs
 * the new one. A key the data migration has not hashed yet is kept.
 */
export class ApiKeyHashedColumn1809180790200 implements MigrationInterface {
  public name: string = "ApiKeyHashedColumn1809180790200";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ALTER COLUMN "apiKey" TYPE character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ADD "apiKeyHint" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ApiKey" DROP COLUMN "apiKeyHint"`);
    await queryRunner.query(
      `ALTER TABLE "ApiKey" ALTER COLUMN "apiKey" TYPE uuid USING (CASE WHEN "apiKey" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN "apiKey"::uuid ELSE uuid_generate_v4() END)`,
    );
  }
}
