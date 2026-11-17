import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration, split by table (the Monitor's and the
 * status pages' columns have migrations of their own, and the new indexes
 * are built online in PresentedKeyLookupHashIndexes1809182940000), and
 * rewritten to ALTER the columns' types in place.
 *
 * The keys and tokens presented to OneUptime are kept encrypted now (#9012:
 * TableColumnMetadata.presentedKey). A ciphertext is longer than the key it
 * holds and is no uuid, so the columns that were a uuid or a varchar(100)
 * become text, as every encrypted column is:
 *
 *   - TelemetryIngestionKey.secretKey: uuid;
 *   - IoTDeviceCredential.secretKey: uuid;
 *   - Workflow.incomingEmailSecretKey: uuid (its unique constraint stays);
 *   - Runbook.webhookSecretKey: varchar(100);
 *   - DataProduct.badgeToken: varchar(100).
 *
 * And a key a request names its record by alone - an ingestion key, a
 * workflow's webhook and email keys - gets a lookup hash column beside it,
 * which the record is found by (TableColumnMetadata.lookupHashColumn).
 *
 * The generator emitted a DROP COLUMN + ADD COLUMN for each type, which
 * would throw every key away - and with it every collector, device and
 * webhook that uses one. An ALTER COLUMN TYPE keeps them: a uuid is cast to
 * its text, in lower case, and a key stays as it was written until the
 * PresentedKeys:ProtectAtRest job encrypts it, a day after the upgrade. A
 * server of the release before compares the text with the key it is sent,
 * as it compared the uuid, so it keeps checking every key meanwhile. A uuid
 * column is rewritten by the change, and these tables are small; the index
 * on each is rebuilt under its own name.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts back the types. An encrypted key is
 * no uuid, and no key fits the varchar(100) as its ciphertext, so down()
 * gives each encrypted key a new random one, as a reset would (whatever used
 * the key needs the new one), and clears an encrypted token, which the
 * release before makes again (a runbook's webhook key, a badge's token). A
 * key not encrypted yet is kept.
 */

// A uuid as Postgres writes it, which no ciphertext ever is.
const UUID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// How every ciphertext OneUptime writes begins (Encryption.CIPHERTEXT_PREFIX).
const CIPHERTEXT_LIKE: string = "U2FsdGVkX1%";

export class PresentedKeysEncryptedColumns1809182900000
  implements MigrationInterface
{
  public name: string = "PresentedKeysEncryptedColumns1809182900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ALTER COLUMN "secretKey" TYPE text USING "secretKey"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "secretKeyHash" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ALTER COLUMN "secretKey" TYPE text USING "secretKey"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ALTER COLUMN "incomingEmailSecretKey" TYPE text USING "incomingEmailSecretKey"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "webhookSecretKeyHash" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "incomingEmailSecretKeyHash" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ALTER COLUMN "webhookSecretKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ALTER COLUMN "badgeToken" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataProduct" ALTER COLUMN "badgeToken" TYPE character varying(100) USING (CASE WHEN "badgeToken" LIKE '${CIPHERTEXT_LIKE}' THEN NULL ELSE "badgeToken" END)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ALTER COLUMN "webhookSecretKey" TYPE character varying(100) USING (CASE WHEN "webhookSecretKey" LIKE '${CIPHERTEXT_LIKE}' THEN NULL ELSE "webhookSecretKey" END)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "incomingEmailSecretKeyHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "webhookSecretKeyHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" ALTER COLUMN "incomingEmailSecretKey" TYPE uuid USING (CASE WHEN "incomingEmailSecretKey" IS NULL THEN NULL WHEN "incomingEmailSecretKey" ~* '${UUID_PATTERN}' THEN "incomingEmailSecretKey"::uuid ELSE gen_random_uuid() END)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDeviceCredential" ALTER COLUMN "secretKey" TYPE uuid USING (CASE WHEN "secretKey" ~* '${UUID_PATTERN}' THEN "secretKey"::uuid ELSE gen_random_uuid() END)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "secretKeyHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ALTER COLUMN "secretKey" TYPE uuid USING (CASE WHEN "secretKey" ~* '${UUID_PATTERN}' THEN "secretKey"::uuid ELSE gen_random_uuid() END)`,
    );
  }
}
