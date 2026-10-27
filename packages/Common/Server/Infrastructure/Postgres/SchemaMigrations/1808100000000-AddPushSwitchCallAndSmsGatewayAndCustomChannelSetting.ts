import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 *   - "GlobalConfig"."disablePushNotifications": push notifications turned
 *     off for the whole server (Types/PushNotification/
 *     PushNotificationsTurnedOff);
 *   - "GlobalConfig"."callAndSmsProvider", "callAndSmsGatewayUrl" and
 *     "callAndSmsGatewaySecret": what carries the server's SMS and calls -
 *     its Twilio account, as every installation's did, or its own gateway
 *     (Types/CallAndSMS/CallAndSmsProvider);
 *   - "UserNotificationSetting"."alertByCustomChannel": a person's
 *     notifications through the custom channels too, off for everyone.
 *
 * Every column has a constant default or none, which Postgres adds without
 * rewriting either table.
 */
export class AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000
  implements MigrationInterface
{
  public name: string =
    "AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "disablePushNotifications" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "callAndSmsProvider" character varying(100) NOT NULL DEFAULT 'Twilio'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "callAndSmsGatewayUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "callAndSmsGatewaySecret" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByCustomChannel" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByCustomChannel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "callAndSmsGatewaySecret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "callAndSmsGatewayUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "callAndSmsProvider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "disablePushNotifications"`,
    );
  }
}
