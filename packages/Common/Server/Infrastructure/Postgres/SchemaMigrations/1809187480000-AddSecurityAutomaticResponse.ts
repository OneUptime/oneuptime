import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Automatic response (#10350): the policies that challenge or block the
 * address a security detection is about as the detection is made
 * ("SecurityAutomaticResponsePolicy"), and what each did about an address
 * ("SecurityAutomaticResponseAction"). Both tables are new, so their
 * indexes and keys are made here.
 *
 * On existing tables, only columns, each nullable or with a constant
 * default, so no row is rewritten:
 *
 *   - "SecurityBlock"."securityAutomaticResponsePolicyId": the policy that
 *     made a block, and "challengeFallsBackToBlock": a challenge held as a
 *     block where an edge cannot challenge (false for every block so far);
 *   - "SecurityPlaybookRun"."securityAutomaticResponsePolicyId": the policy
 *     that started a one-step run;
 *   - "SecurityCase"."blockedAt" and "timeToBlockInSeconds".
 *
 * The index and keys generated for the existing tables are built online,
 * in AddSecurityAutomaticResponseIndexesAndKeys1809187480010: the
 * blocklist's reconciler reads "SecurityBlock" every minute, and playbook
 * runs are written as cases open.
 */
export class AddSecurityAutomaticResponse1809187480000
  implements MigrationInterface
{
  public name: string = "AddSecurityAutomaticResponse1809187480000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityAutomaticResponsePolicy" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "kind" character varying(100) NOT NULL DEFAULT 'Custom', "name" character varying(100) NOT NULL, "description" character varying(500), "mode" character varying(100) NOT NULL DEFAULT 'Off', "blockAction" character varying(100) NOT NULL DEFAULT 'Block', "duration" character varying(100) NOT NULL DEFAULT 'OneHour', "matchConditions" jsonb, "trialStartedAt" TIMESTAMP WITH TIME ZONE, "trialEndsAt" TIMESTAMP WITH TIME ZONE, "trialFinishedAt" TIMESTAMP WITH TIME ZONE, "trialSkippedAt" TIMESTAMP WITH TIME ZONE, "trialSkippedByUserId" uuid, "turnedOnAt" TIMESTAMP WITH TIME ZONE, "turnedOnByUserId" uuid, "modeChangedAt" TIMESTAMP WITH TIME ZONE, "modeChangedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_08bc156b830e6ab29b4bd94f146" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4fd26741d888c83503d6ed05d1" ON "SecurityAutomaticResponsePolicy" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccf80beecc0a2f182522b0facc" ON "SecurityAutomaticResponsePolicy" ("mode") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4fcf1f7007a31515188e1267c4" ON "SecurityAutomaticResponsePolicy" ("projectId", "kind") WHERE "deletedAt" IS NULL AND "kind" <> 'Custom'`,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityAutomaticResponseAction" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "securityAutomaticResponsePolicyId" uuid NOT NULL, "policyName" character varying(100), "securityCaseId" uuid, "value" character varying(100) NOT NULL, "outcome" character varying(100) NOT NULL, "isTrialRun" boolean NOT NULL DEFAULT false, "blockAction" character varying(100), "duration" character varying(100), "priorBlockCount" integer, "detectionTitle" character varying(100), "firstRequestAt" TIMESTAMP WITH TIME ZONE, "blockedAt" TIMESTAMP WITH TIME ZONE, "appliedAt" TIMESTAMP WITH TIME ZONE, "timeToBlockInSeconds" integer, "enforcedAt" jsonb, "detail" text, "pagedAt" TIMESTAMP WITH TIME ZONE, "doubtSeenAt" TIMESTAMP WITH TIME ZONE, "doubtDetail" text, "securityBlockId" uuid, "securityPlaybookRunId" uuid, CONSTRAINT "PK_2032e7b0f17439c8f81a33e070c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0220ebb73c526d0a1925acda64" ON "SecurityAutomaticResponseAction" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f7c9edc6dae45d6f950355fc94" ON "SecurityAutomaticResponseAction" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a83607498a697d959a690cdfe" ON "SecurityAutomaticResponseAction" ("outcome") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_75801460fe9acda3bdb063a52e" ON "SecurityAutomaticResponseAction" ("securityBlockId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a56be3a611539d36f956d88ee" ON "SecurityAutomaticResponseAction" ("securityPlaybookRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a99292db6f17d3ac584d10698" ON "SecurityAutomaticResponseAction" ("securityAutomaticResponsePolicyId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7246fcee6e7cdd43a21c54dbca" ON "SecurityAutomaticResponseAction" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "blockedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "timeToBlockInSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" ADD "securityAutomaticResponsePolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD "securityAutomaticResponsePolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD "challengeFallsBackToBlock" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" ADD CONSTRAINT "FK_4fd26741d888c83503d6ed05d11" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" ADD CONSTRAINT "FK_711c913a8a02fc250290bb0f543" FOREIGN KEY ("trialSkippedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" ADD CONSTRAINT "FK_7965fdbe80f8d02c5192ded72a8" FOREIGN KEY ("turnedOnByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" ADD CONSTRAINT "FK_075c55be261c45bb363f98fc89a" FOREIGN KEY ("modeChangedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" ADD CONSTRAINT "FK_f03dca848a6cb67773d1d32d684" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" ADD CONSTRAINT "FK_0220ebb73c526d0a1925acda64c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" ADD CONSTRAINT "FK_39f7f0dc558cca9cf80f2b28eaa" FOREIGN KEY ("securityAutomaticResponsePolicyId") REFERENCES "SecurityAutomaticResponsePolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" ADD CONSTRAINT "FK_f7c9edc6dae45d6f950355fc943" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" ADD CONSTRAINT "FK_75801460fe9acda3bdb063a52e6" FOREIGN KEY ("securityBlockId") REFERENCES "SecurityBlock"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" ADD CONSTRAINT "FK_3a56be3a611539d36f956d88ee7" FOREIGN KEY ("securityPlaybookRunId") REFERENCES "SecurityPlaybookRun"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" DROP CONSTRAINT "FK_3a56be3a611539d36f956d88ee7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" DROP CONSTRAINT "FK_75801460fe9acda3bdb063a52e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" DROP CONSTRAINT "FK_f7c9edc6dae45d6f950355fc943"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" DROP CONSTRAINT "FK_39f7f0dc558cca9cf80f2b28eaa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponseAction" DROP CONSTRAINT "FK_0220ebb73c526d0a1925acda64c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" DROP CONSTRAINT "FK_f03dca848a6cb67773d1d32d684"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" DROP CONSTRAINT "FK_075c55be261c45bb363f98fc89a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" DROP CONSTRAINT "FK_7965fdbe80f8d02c5192ded72a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" DROP CONSTRAINT "FK_711c913a8a02fc250290bb0f543"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityAutomaticResponsePolicy" DROP CONSTRAINT "FK_4fd26741d888c83503d6ed05d11"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP COLUMN "challengeFallsBackToBlock"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP COLUMN "securityAutomaticResponsePolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP COLUMN "securityAutomaticResponsePolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "timeToBlockInSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "blockedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7246fcee6e7cdd43a21c54dbca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a99292db6f17d3ac584d10698"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a56be3a611539d36f956d88ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_75801460fe9acda3bdb063a52e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a83607498a697d959a690cdfe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f7c9edc6dae45d6f950355fc94"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0220ebb73c526d0a1925acda64"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityAutomaticResponseAction"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fcf1f7007a31515188e1267c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccf80beecc0a2f182522b0facc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fd26741d888c83503d6ed05d1"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityAutomaticResponsePolicy"`);
  }
}
