import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * On-call calendar feeds and shift reminders.
 *
 * Five new tables: the per-(project, user) personal feed
 * (UserOnCallCalendarFeed), the project-owned shared feed of one schedule
 * (OnCallDutyPolicyScheduleCalendarFeed), the project-wide shared feed
 * (ProjectOnCallCalendarFeed), the user's reminder lead times
 * (UserOnCallShiftReminder) and the reminder worker's send-once ledger
 * (UserOnCallShiftReminderLog). Plus OnCallDutyPolicySchedule.shiftConfigVersion,
 * the monotone counter that becomes every VEVENT's SEQUENCE.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name and this comment are
 * hand-written.
 */

export class AddOnCallCalendarFeeds1790300000000 implements MigrationInterface {
  public name: string = "AddOnCallCalendarFeeds1790300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserOnCallCalendarFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "tokenHash" character varying(100) NOT NULL, "token" text, "previousTokenHash" character varying(100), "previousTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "tokenHint" character varying(100), "isEnabled" boolean NOT NULL DEFAULT true, "includeCoveringShifts" boolean NOT NULL DEFAULT true, "pastDays" integer NOT NULL DEFAULT '2', "futureDays" integer NOT NULL DEFAULT '90', "rotatedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedClient" character varying(100), "fetchCount" integer NOT NULL DEFAULT '0', "lastRenderTruncated" boolean NOT NULL DEFAULT false, "deletedByUserId" uuid, CONSTRAINT "UQ_16c445ee083e70ec64797ef2f0a" UNIQUE ("tokenHash"), CONSTRAINT "PK_a8b529d537040bc3a50ff70722d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_939eb20c04210645d0efe1201e" ON "UserOnCallCalendarFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15ba76443fb33f1a8c65ffd330" ON "UserOnCallCalendarFeed" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3b8a2c138c2b39130faead186" ON "UserOnCallCalendarFeed" ("previousTokenHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8245f3713e73a2bc30854fe73e" ON "UserOnCallCalendarFeed" ("projectId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyScheduleCalendarFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "onCallDutyPolicyScheduleId" uuid NOT NULL, "tokenHash" character varying(100) NOT NULL, "token" text, "previousTokenHash" character varying(100), "previousTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "tokenHint" character varying(100), "isEnabled" boolean NOT NULL DEFAULT true, "includeCoverageGaps" boolean NOT NULL DEFAULT false, "minimumGapMinutes" integer NOT NULL DEFAULT '60', "pastDays" integer NOT NULL DEFAULT '2', "futureDays" integer NOT NULL DEFAULT '90', "rotateWhenMemberLeaves" boolean NOT NULL DEFAULT false, "rotatedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedClient" character varying(100), "fetchCount" integer NOT NULL DEFAULT '0', "lastRenderTruncated" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_e681d4bd248f23ab3ff5b5df761" UNIQUE ("tokenHash"), CONSTRAINT "PK_64e88a4bd7d68f79438e6ff3f23" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f95fd30f3ae55408f9c10c80f3" ON "OnCallDutyPolicyScheduleCalendarFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69d7cebef3fe577f9a90f91dd6" ON "OnCallDutyPolicyScheduleCalendarFeed" ("previousTokenHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a65bc8d41edf8c5d3fff7974ab" ON "OnCallDutyPolicyScheduleCalendarFeed" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProjectOnCallCalendarFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "tokenHash" character varying(100) NOT NULL, "token" text, "previousTokenHash" character varying(100), "previousTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "tokenHint" character varying(100), "isEnabled" boolean NOT NULL DEFAULT true, "includeCoverageGaps" boolean NOT NULL DEFAULT false, "minimumGapMinutes" integer NOT NULL DEFAULT '60', "pastDays" integer NOT NULL DEFAULT '2', "futureDays" integer NOT NULL DEFAULT '90', "rotateWhenMemberLeaves" boolean NOT NULL DEFAULT false, "rotatedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedClient" character varying(100), "fetchCount" integer NOT NULL DEFAULT '0', "lastRenderTruncated" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_e0b42a0e413f341a898ecd25bf6" UNIQUE ("tokenHash"), CONSTRAINT "PK_8b353a212b2cee1c6716b0ca937" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e087b8cdd09846619e3794353" ON "ProjectOnCallCalendarFeed" ("previousTokenHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bfe63e832a43d0b8f77fd888de" ON "ProjectOnCallCalendarFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "UserOnCallShiftReminder" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "minutesBeforeShift" integer NOT NULL, "deletedByUserId" uuid, CONSTRAINT "PK_b0334a8ddcc1336ea024ff1765b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c718041c4ce139655e1247255" ON "UserOnCallShiftReminder" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d25b5c70fb5655334bc19d5a77" ON "UserOnCallShiftReminder" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1fdf15a348943840be5be63d2a" ON "UserOnCallShiftReminder" ("projectId", "userId", "minutesBeforeShift") `,
    );
    await queryRunner.query(
      `CREATE TABLE "UserOnCallShiftReminderLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "onCallDutyPolicyScheduleId" uuid NOT NULL, "shiftStartsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "minutesBeforeShift" integer NOT NULL DEFAULT '0', "kind" character varying(100) NOT NULL, "claimedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "sentAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_78ab60521e153e901016dc06806" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5edd7a35eda0fc7a336cbbc6a4" ON "UserOnCallShiftReminderLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cd0448bd761614d9fa16bc672" ON "UserOnCallShiftReminderLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08e28521376926a2d73d896b94" ON "UserOnCallShiftReminderLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da7b9a10e948a8b2f490867896" ON "UserOnCallShiftReminderLog" ("claimedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_25a67c0a636e2a714bb364e68b" ON "UserOnCallShiftReminderLog" ("userId", "onCallDutyPolicyScheduleId", "shiftStartsAt", "minutesBeforeShift", "kind") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "shiftConfigVersion" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallCalendarFeed" ADD CONSTRAINT "FK_939eb20c04210645d0efe1201e5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallCalendarFeed" ADD CONSTRAINT "FK_15ba76443fb33f1a8c65ffd3309" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallCalendarFeed" ADD CONSTRAINT "FK_c86499821f995e2848d50587734" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" ADD CONSTRAINT "FK_f95fd30f3ae55408f9c10c80f3b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" ADD CONSTRAINT "FK_a65bc8d41edf8c5d3fff7974ab6" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" ADD CONSTRAINT "FK_134727b2768b63de3c85408399c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" ADD CONSTRAINT "FK_98e071d8d4878b32cd13785541e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOnCallCalendarFeed" ADD CONSTRAINT "FK_bfe63e832a43d0b8f77fd888de3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOnCallCalendarFeed" ADD CONSTRAINT "FK_2ac5d726e5e78bd43628d3bcb32" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOnCallCalendarFeed" ADD CONSTRAINT "FK_c116c4230da31bc39fb26ae9ba1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminder" ADD CONSTRAINT "FK_3c718041c4ce139655e12472550" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminder" ADD CONSTRAINT "FK_d25b5c70fb5655334bc19d5a777" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminder" ADD CONSTRAINT "FK_02694a9354a70b887beccabec7f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminderLog" ADD CONSTRAINT "FK_5edd7a35eda0fc7a336cbbc6a46" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminderLog" ADD CONSTRAINT "FK_2cd0448bd761614d9fa16bc672d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminderLog" ADD CONSTRAINT "FK_08e28521376926a2d73d896b940" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminderLog" DROP CONSTRAINT "FK_08e28521376926a2d73d896b940"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminderLog" DROP CONSTRAINT "FK_2cd0448bd761614d9fa16bc672d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminderLog" DROP CONSTRAINT "FK_5edd7a35eda0fc7a336cbbc6a46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminder" DROP CONSTRAINT "FK_02694a9354a70b887beccabec7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminder" DROP CONSTRAINT "FK_d25b5c70fb5655334bc19d5a777"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallShiftReminder" DROP CONSTRAINT "FK_3c718041c4ce139655e12472550"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOnCallCalendarFeed" DROP CONSTRAINT "FK_c116c4230da31bc39fb26ae9ba1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOnCallCalendarFeed" DROP CONSTRAINT "FK_2ac5d726e5e78bd43628d3bcb32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOnCallCalendarFeed" DROP CONSTRAINT "FK_bfe63e832a43d0b8f77fd888de3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" DROP CONSTRAINT "FK_98e071d8d4878b32cd13785541e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" DROP CONSTRAINT "FK_134727b2768b63de3c85408399c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" DROP CONSTRAINT "FK_a65bc8d41edf8c5d3fff7974ab6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleCalendarFeed" DROP CONSTRAINT "FK_f95fd30f3ae55408f9c10c80f3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallCalendarFeed" DROP CONSTRAINT "FK_c86499821f995e2848d50587734"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallCalendarFeed" DROP CONSTRAINT "FK_15ba76443fb33f1a8c65ffd3309"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallCalendarFeed" DROP CONSTRAINT "FK_939eb20c04210645d0efe1201e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "shiftConfigVersion"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25a67c0a636e2a714bb364e68b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da7b9a10e948a8b2f490867896"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08e28521376926a2d73d896b94"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cd0448bd761614d9fa16bc672"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5edd7a35eda0fc7a336cbbc6a4"`,
    );
    await queryRunner.query(`DROP TABLE "UserOnCallShiftReminderLog"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fdf15a348943840be5be63d2a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d25b5c70fb5655334bc19d5a77"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c718041c4ce139655e1247255"`,
    );
    await queryRunner.query(`DROP TABLE "UserOnCallShiftReminder"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bfe63e832a43d0b8f77fd888de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e087b8cdd09846619e3794353"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectOnCallCalendarFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a65bc8d41edf8c5d3fff7974ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_69d7cebef3fe577f9a90f91dd6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f95fd30f3ae55408f9c10c80f3"`,
    );
    await queryRunner.query(
      `DROP TABLE "OnCallDutyPolicyScheduleCalendarFeed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8245f3713e73a2bc30854fe73e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3b8a2c138c2b39130faead186"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15ba76443fb33f1a8c65ffd330"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_939eb20c04210645d0efe1201e"`,
    );
    await queryRunner.query(`DROP TABLE "UserOnCallCalendarFeed"`);
  }
}
