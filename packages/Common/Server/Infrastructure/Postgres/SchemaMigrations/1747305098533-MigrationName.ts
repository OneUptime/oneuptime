import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1747305098533 implements MigrationInterface {
  public name = "MigrationName1747305098533";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyTimeLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "onCallDutyPolicyId" uuid, "onCallDutyPolicyScheduleId" uuid, "onCallDutyPolicyEscalationRuleId" uuid, "teamId" uuid, "moreInfo" text, "createdByUserId" uuid, "userId" uuid NOT NULL, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE, "deletedByUserId" uuid, CONSTRAINT "PK_11ce033bf855cf2dd0b86daa681" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7eed77389b6085ae0065ab3705" ON "OnCallDutyPolicyTimeLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_523a7b776b41de5bb5405d6431" ON "OnCallDutyPolicyTimeLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86e4f4be85b87ff796fe84b90a" ON "OnCallDutyPolicyTimeLog" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0843b3b966754970c779f61b0a" ON "OnCallDutyPolicyTimeLog" ("onCallDutyPolicyEscalationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47ff7c8bdaf4e733077b3ceca7" ON "OnCallDutyPolicyTimeLog" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" ADD CONSTRAINT "FK_7eed77389b6085ae0065ab37059" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" ADD CONSTRAINT "FK_99c1e72b99f1fbedeb650357026" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" ADD CONSTRAINT "FK_43da7ffeee531e9452d36a89ba5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" ADD CONSTRAINT "FK_b6476633034478def5e6f435cc7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" DROP CONSTRAINT "FK_b6476633034478def5e6f435cc7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" DROP CONSTRAINT "FK_43da7ffeee531e9452d36a89ba5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" DROP CONSTRAINT "FK_99c1e72b99f1fbedeb650357026"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyTimeLog" DROP CONSTRAINT "FK_7eed77389b6085ae0065ab37059"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47ff7c8bdaf4e733077b3ceca7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0843b3b966754970c779f61b0a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86e4f4be85b87ff796fe84b90a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_523a7b776b41de5bb5405d6431"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7eed77389b6085ae0065ab3705"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyTimeLog"`);
  }
}
