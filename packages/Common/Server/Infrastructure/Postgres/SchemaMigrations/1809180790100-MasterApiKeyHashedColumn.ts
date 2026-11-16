import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the column's type in
 * place.
 *
 * The server's master API key (GlobalConfig.masterApiKey) is stored hashed
 * now (#7901): the SHA-256 of the key, 64 hex digits, where it was a uuid
 * column holding the key itself. So the column becomes a varchar, as every
 * HashedString column is.
 *
 *   - The generator emitted DROP COLUMN + ADD COLUMN, which would throw the
 *     stored key away - and with it every script and integration that uses
 *     it - before the HashMasterApiKey data migration can hash it. An ALTER
 *     COLUMN TYPE keeps it: a uuid is cast to its text, lower-case, which
 *     the lookup accepts until the data migration hashes it.
 *   - Its unique constraint stays, by the name every installation's
 *     migrations gave it: a hash of a unique key is unique too.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts the uuid column back. A hashed key
 * is no uuid, and the key cannot be worked out from its hash, so down()
 * clears it: after a rollback a master admin makes a new key. A key the
 * data migration has not hashed yet is kept.
 */
export class MasterApiKeyHashedColumn1809180790100
  implements MigrationInterface
{
  public name: string = "MasterApiKeyHashedColumn1809180790100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "masterApiKey" TYPE character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "masterApiKey" TYPE uuid USING (CASE WHEN "masterApiKey" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN "masterApiKey"::uuid ELSE NULL END)`,
    );
  }
}
