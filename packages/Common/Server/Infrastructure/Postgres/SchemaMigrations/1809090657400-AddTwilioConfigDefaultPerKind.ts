import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A project has a default Twilio config for SMS and one for calls (#6574):
 * ProjectCallSMSConfig.isProjectDefaultForSms and isProjectDefaultForCalls
 * say what a config is the project default for, and the senders read the
 * default for the kind of message they send (Types/CallAndSMS/
 * TwilioConfigDefaults). Until now a project had one default, which every
 * SMS and call went through - those it could not send went through
 * OneUptime's own account.
 *
 * Every project keeps exactly what it has: its default becomes the default
 * for what it is used for - SMS unless it is used for calls only, calls
 * unless it is used for SMS only - so each message goes where it went
 * before. A project with more than one default (two writes that made a
 * default at the same moment could leave it so) keeps the first one made;
 * the others are the default for nothing, so they are no default, as the
 * rule says.
 *
 * The two ALTERs were generated with npm run generate-postgres-migration: a
 * NOT NULL column with a constant default rewrites no row. The UPDATEs are
 * hand-written; they touch only a project's default configs, of which
 * there is one a project.
 */
export class AddTwilioConfigDefaultPerKind1809090657400
  implements MigrationInterface
{
  public name: string = "AddTwilioConfigDefaultPerKind1809090657400";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "isProjectDefaultForSms" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "isProjectDefaultForCalls" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "ProjectCallSMSConfig" AS "config" SET "isProjectDefaultForSms" = ("config"."usedFor" IS DISTINCT FROM 'Calls only'), "isProjectDefaultForCalls" = ("config"."usedFor" IS DISTINCT FROM 'SMS only') WHERE "config"."isProjectDefault" = true AND "config"."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "ProjectCallSMSConfig" AS "earlier" WHERE "earlier"."projectId" = "config"."projectId" AND "earlier"."isProjectDefault" = true AND "earlier"."deletedAt" IS NULL AND ("earlier"."createdAt", "earlier"."_id") < ("config"."createdAt", "config"."_id"))`,
    );
    await queryRunner.query(
      `UPDATE "ProjectCallSMSConfig" SET "isProjectDefault" = false WHERE "isProjectDefault" = true AND "deletedAt" IS NULL AND "isProjectDefaultForSms" = false AND "isProjectDefaultForCalls" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "isProjectDefaultForCalls"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "isProjectDefaultForSms"`,
    );
  }
}
