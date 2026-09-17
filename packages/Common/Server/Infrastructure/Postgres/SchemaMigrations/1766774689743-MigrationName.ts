import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1766774689743 implements MigrationInterface {
  public name = "MigrationName1766774689743";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIAgentTaskLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiAgentTaskId" uuid NOT NULL, "aiAgentId" uuid NOT NULL, "logs" jsonb, "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_6883beca78addf297b711463b3d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a74c32eee408ff2517f208acc" ON "AIAgentTaskLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6fa29ac43b038b3772c9d7f024" ON "AIAgentTaskLog" ("aiAgentTaskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a24492f586255644821d31b4d9" ON "AIAgentTaskLog" ("aiAgentId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIAgentTaskPullRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiAgentTaskId" uuid NOT NULL, "aiAgentId" uuid NOT NULL, "codeRepositoryId" uuid, "title" character varying(100) NOT NULL, "description" character varying, "pullRequestUrl" text, "pullRequestId" integer, "pullRequestNumber" integer, "pullRequestState" character varying(100) NOT NULL DEFAULT 'open', "headRefName" character varying(100), "baseRefName" character varying(100), "repoOrganizationName" character varying(100), "repoName" character varying(100), "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_1e9cb323017ff5a3025c414a456" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f1d3e9b87b2ed8c13b29c9304" ON "AIAgentTaskPullRequest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1de7edf3e00ae0d0061708606" ON "AIAgentTaskPullRequest" ("aiAgentTaskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1e01ecfe9eecfb55542847107" ON "AIAgentTaskPullRequest" ("aiAgentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12f52550d56f6b1feced077c17" ON "AIAgentTaskPullRequest" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab947ccdac955be166aa2c5a27" ON "AIAgentTaskPullRequest" ("pullRequestId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48868aa1b27d71935245ca0a5d" ON "AIAgentTaskPullRequest" ("pullRequestNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8332635ecdf728ee8b07568f93" ON "AIAgentTaskPullRequest" ("pullRequestState") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD CONSTRAINT "FK_0a74c32eee408ff2517f208acc9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD CONSTRAINT "FK_6fa29ac43b038b3772c9d7f0247" FOREIGN KEY ("aiAgentTaskId") REFERENCES "AIAgentTask"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD CONSTRAINT "FK_a24492f586255644821d31b4d9a" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD CONSTRAINT "FK_f527924c3e936ad2202fa2a4d74" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD CONSTRAINT "FK_de7bbddc38691ce3db0cb544f26" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_7f1d3e9b87b2ed8c13b29c9304b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_e1de7edf3e00ae0d00617086063" FOREIGN KEY ("aiAgentTaskId") REFERENCES "AIAgentTask"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_b1e01ecfe9eecfb555428471073" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_12f52550d56f6b1feced077c176" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_4d45ffb4c369fa8092d1744850d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD CONSTRAINT "FK_3e4f087b88bb1127540d01df8f6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_3e4f087b88bb1127540d01df8f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_4d45ffb4c369fa8092d1744850d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_12f52550d56f6b1feced077c176"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_b1e01ecfe9eecfb555428471073"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_e1de7edf3e00ae0d00617086063"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP CONSTRAINT "FK_7f1d3e9b87b2ed8c13b29c9304b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" DROP CONSTRAINT "FK_de7bbddc38691ce3db0cb544f26"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" DROP CONSTRAINT "FK_f527924c3e936ad2202fa2a4d74"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" DROP CONSTRAINT "FK_a24492f586255644821d31b4d9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" DROP CONSTRAINT "FK_6fa29ac43b038b3772c9d7f0247"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" DROP CONSTRAINT "FK_0a74c32eee408ff2517f208acc9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8332635ecdf728ee8b07568f93"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48868aa1b27d71935245ca0a5d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab947ccdac955be166aa2c5a27"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12f52550d56f6b1feced077c17"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1e01ecfe9eecfb55542847107"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1de7edf3e00ae0d0061708606"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f1d3e9b87b2ed8c13b29c9304"`,
    );
    await queryRunner.query(`DROP TABLE "AIAgentTaskPullRequest"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a24492f586255644821d31b4d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6fa29ac43b038b3772c9d7f024"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a74c32eee408ff2517f208acc"`,
    );
    await queryRunner.query(`DROP TABLE "AIAgentTaskLog"`);
  }
}
