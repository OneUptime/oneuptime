import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778779608191 implements MigrationInterface {
  name = "MigrationName1778779608191";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookAgent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "slug" character varying(100) NOT NULL, "key" character varying NOT NULL, "tags" jsonb, "agentVersion" character varying(30), "lastAlive" TIMESTAMP WITH TIME ZONE, "connectionStatus" character varying, "hostInfo" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_1a6a22ecd4fe6f3989d39a0face" UNIQUE ("key"), CONSTRAINT "PK_e5b49f5335fd83b87c84bd905be" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e18db257015a927b10be53cf3" ON "RunbookAgent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookAgentJob" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "runbookExecutionId" uuid NOT NULL, "stepId" character varying(100) NOT NULL, "requiredTag" character varying(100) NOT NULL, "assignedAgentId" uuid, "status" character varying(100) NOT NULL, "script" text NOT NULL, "timeoutInMs" integer NOT NULL, "output" text, "exitCode" integer, "errorMessage" text, "claimDeadlineAt" TIMESTAMP WITH TIME ZONE NOT NULL, "claimedAt" TIMESTAMP WITH TIME ZONE, "leaseExpiresAt" TIMESTAMP WITH TIME ZONE, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8bc7501a2b1b6ed5f6ad19d46f6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e13e6bd687869dfd16ddcc7900" ON "RunbookAgentJob" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccc385027b89b731641a3cabd4" ON "RunbookAgentJob" ("runbookExecutionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6791164943615abf539651d14e" ON "RunbookAgentJob" ("requiredTag") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b95313deeb5e7debf39b9e6791" ON "RunbookAgentJob" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" ADD CONSTRAINT "FK_8e18db257015a927b10be53cf30" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" ADD CONSTRAINT "FK_936a55c9ef76c806615a869de57" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" ADD CONSTRAINT "FK_7c2ccd1de68f9f805ef8fe26e0d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD CONSTRAINT "FK_e13e6bd687869dfd16ddcc7900c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD CONSTRAINT "FK_ccc385027b89b731641a3cabd48" FOREIGN KEY ("runbookExecutionId") REFERENCES "RunbookExecution"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD CONSTRAINT "FK_eec146ac21d97c2731c73ae9410" FOREIGN KEY ("assignedAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP CONSTRAINT "FK_eec146ac21d97c2731c73ae9410"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP CONSTRAINT "FK_ccc385027b89b731641a3cabd48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP CONSTRAINT "FK_e13e6bd687869dfd16ddcc7900c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP CONSTRAINT "FK_7c2ccd1de68f9f805ef8fe26e0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP CONSTRAINT "FK_936a55c9ef76c806615a869de57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgent" DROP CONSTRAINT "FK_8e18db257015a927b10be53cf30"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b95313deeb5e7debf39b9e6791"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6791164943615abf539651d14e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccc385027b89b731641a3cabd4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e13e6bd687869dfd16ddcc7900"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookAgentJob"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e18db257015a927b10be53cf3"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookAgent"`);
  }
}
