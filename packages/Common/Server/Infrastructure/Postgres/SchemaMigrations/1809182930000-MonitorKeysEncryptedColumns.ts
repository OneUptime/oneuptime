import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * PresentedKeysEncryptedColumns1809182900000, and moved into a migration of
 * its own: every probe result, heartbeat and server report writes "Monitor",
 * so its lock is taken in a migration that waits for no other table, and in
 * ONE statement.
 *
 * A monitor's three keys are kept encrypted now (#9012): the key a server's
 * agent reports with, the key in an incoming request monitor's heartbeat
 * URL, and the key in an incoming email monitor's address. A ciphertext is
 * no uuid, so each column becomes text, and each gets a lookup hash column
 * beside it, which a request presenting the key finds the monitor by
 * (TableColumnMetadata.lookupHashColumn). Their indexes are built online,
 * in PresentedKeyLookupHashIndexes1809182940000.
 *
 * The generator emitted a DROP COLUMN + ADD COLUMN for each key, which
 * would throw every key away - and every heartbeat URL, inbound address and
 * server agent with it. An ALTER COLUMN TYPE keeps them: a uuid is cast to
 * its text, in lower case, and a key stays as it was written until the
 * PresentedKeys:ProtectAtRest job encrypts it, a day after the upgrade. A
 * server of the release before compares the text with the key it is sent,
 * as it compared the uuid, so heartbeats keep counting meanwhile, whichever
 * server takes them. Each key's index is rebuilt under its own name: it is
 * what such a server, and the lookup of a key not encrypted yet, still find
 * a key by.
 *
 * From a uuid to text rewrites the table, once, under its lock, with all
 * three changes and the three new columns in one statement: 1.2 seconds
 * for 60,000 monitors with their steps (Postgres 15). The server-side
 * statement_timeout is raised for it, as the repairs of large tables do
 * (1785240000000), so a loaded database does not fail the upgrade; the
 * client-side DATABASE_QUERY_TIMEOUT_MS still bounds it.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts back the uuid columns. An encrypted
 * key is no uuid, so down() gives each one a new random key, as a reset
 * would: whatever used the key needs the new one. A key not encrypted yet
 * is kept.
 */

// A uuid as Postgres writes it, which no ciphertext ever is.
const UUID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// The key back as a uuid: as it was, or a new random one for a ciphertext.
const toUuid: (column: string) => string = (column: string): string => {
  return `(CASE WHEN "${column}" IS NULL THEN NULL WHEN "${column}" ~* '${UUID_PATTERN}' THEN "${column}"::uuid ELSE gen_random_uuid() END)`;
};

export class MonitorKeysEncryptedColumns1809182930000
  implements MigrationInterface
{
  public name: string = "MonitorKeysEncryptedColumns1809182930000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL statement_timeout = '600s'`);

    await queryRunner.query(
      `ALTER TABLE "Monitor" ALTER COLUMN "serverMonitorSecretKey" TYPE text USING "serverMonitorSecretKey"::text, ALTER COLUMN "incomingRequestSecretKey" TYPE text USING "incomingRequestSecretKey"::text, ALTER COLUMN "incomingEmailSecretKey" TYPE text USING "incomingEmailSecretKey"::text, ADD "serverMonitorSecretKeyHash" character varying(255), ADD "incomingRequestSecretKeyHash" character varying(255), ADD "incomingEmailSecretKeyHash" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL statement_timeout = '600s'`);

    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailSecretKeyHash", DROP COLUMN "incomingRequestSecretKeyHash", DROP COLUMN "serverMonitorSecretKeyHash", ALTER COLUMN "incomingEmailSecretKey" TYPE uuid USING ${toUuid("incomingEmailSecretKey")}, ALTER COLUMN "incomingRequestSecretKey" TYPE uuid USING ${toUuid("incomingRequestSecretKey")}, ALTER COLUMN "serverMonitorSecretKey" TYPE uuid USING ${toUuid("serverMonitorSecretKey")}`,
    );
  }
}
