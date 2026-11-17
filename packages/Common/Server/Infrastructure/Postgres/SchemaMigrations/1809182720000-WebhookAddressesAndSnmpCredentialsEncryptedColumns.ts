import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the columns' types in
 * place.
 *
 * The webhook addresses a project stores (#9013) and network devices' and
 * discovery scans' SNMP credentials (#9014) are now stored encrypted. A
 * ciphertext is longer than the value it holds - a 100-character community
 * string is stored as 172 characters - so every such column that was a
 * varchar becomes text, as the other encrypted columns are:
 *
 *   - StatusPageSubscriber.subscriberWebhook and .slackIncomingWebhookUrl:
 *     varchar (.microsoftTeamsIncomingWebhookUrl is text already);
 *   - UserWebhook.webhookUrl: varchar(500);
 *   - OpenStackProjectNotice.webhookUrl: varchar, and .previewedRecipient,
 *     which holds a copy of the address: varchar(100);
 *   - CustomNotificationChannel.webhookUrl: varchar(500), and its signing
 *     secret: varchar(100);
 *   - NetworkDevice and NetworkDeviceDiscoveryScan: snmpCommunityString,
 *     varchar(100), and snmpV3AuthKey and snmpV3PrivKey, varchar.
 *
 * The generator emitted a DROP COLUMN + ADD COLUMN for each, which would
 * throw every stored value away before the EncryptWebhookAddresses and
 * EncryptSnmpCredentials data migrations can encrypt it; an ALTER COLUMN
 * TYPE keeps it, and from a varchar to text rewrites no row and scans none:
 * each holds its table's lock for an instant. None of the columns is unique
 * or indexed.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts back the types as they were, which
 * holds only values that fit them, as before this ran.
 */
export class WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182720000
  implements MigrationInterface
{
  public name: string =
    "WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182720000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "subscriberWebhook" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "slackIncomingWebhookUrl" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ALTER COLUMN "webhookUrl" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ALTER COLUMN "webhookUrl" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ALTER COLUMN "previewedRecipient" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" ALTER COLUMN "webhookUrl" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" ALTER COLUMN "secret" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpCommunityString" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpV3AuthKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpV3PrivKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpCommunityString" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3AuthKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3PrivKey" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3PrivKey" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3AuthKey" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpCommunityString" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpV3PrivKey" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpV3AuthKey" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "snmpCommunityString" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" ALTER COLUMN "secret" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" ALTER COLUMN "webhookUrl" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ALTER COLUMN "previewedRecipient" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackProjectNotice" ALTER COLUMN "webhookUrl" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ALTER COLUMN "webhookUrl" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "slackIncomingWebhookUrl" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "subscriberWebhook" TYPE character varying`,
    );
  }
}
