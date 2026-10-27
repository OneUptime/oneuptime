import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * Custom channels: ways to reach people that the installation's admin adds,
 * each a URL every page is POSTed to (Models/DatabaseModels/
 * CustomNotificationChannel).
 *
 *   - "CustomNotificationChannel": the channels;
 *   - "UserNotificationRule"."customNotificationChannelId": the channel an
 *     on-call rule pages through;
 *   - "UserOnCallLogTimeline"."customNotificationChannelId": the channel a
 *     notification went out on.
 *
 * The new table is empty, so its foreign keys are built here. The two
 * columns are nullable with no default, which Postgres adds without
 * rewriting or scanning "UserNotificationRule" or "UserOnCallLogTimeline";
 * their indexes and foreign keys are built online in
 * AddCustomNotificationChannelIndexesAndKeys1808010000000.
 */
export class AddCustomNotificationChannels1808000000000
  implements MigrationInterface
{
  public name: string = "AddCustomNotificationChannels1808000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CustomNotificationChannel" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "name" character varying(100) NOT NULL, "webhookUrl" character varying(500) NOT NULL, "secret" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "pageEveryoneByDefault" boolean NOT NULL DEFAULT true, "addedToEveryonesRulesAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b054b02c401d578cff33b7e470d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "customNotificationChannelId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "customNotificationChannelId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" ADD CONSTRAINT "FK_17be525e87e2a97f6967aab6443" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" ADD CONSTRAINT "FK_2efee67bb3c3dd9c982f10dd984" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" DROP CONSTRAINT "FK_2efee67bb3c3dd9c982f10dd984"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CustomNotificationChannel" DROP CONSTRAINT "FK_17be525e87e2a97f6967aab6443"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "customNotificationChannelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "customNotificationChannelId"`,
    );
    await queryRunner.query(`DROP TABLE "CustomNotificationChannel"`);
  }
}
