import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Required tags (#11012): the tags a project's cloud resources must carry
 * (CloudRequiredTag), how the project is told about a new resource without
 * one (CloudTagSetting, and the on-call policies its alerts page), the new
 * resources found (CloudTagFinding) and each account's daily count of the
 * resources carrying them (CloudTagCoverageDay). New tables only: each is
 * empty when its indexes and foreign keys are made.
 */
export class AddCloudRequiredTags1809187711012 implements MigrationInterface {
  public name = "AddCloudRequiredTags1809187711012";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudRequiredTag" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "tagKey" character varying(500) NOT NULL, "allowedValues" jsonb, "cloudAccountId" uuid, "description" character varying(500), "createdByUserId" uuid, CONSTRAINT "PK_0148382c8c75c99ab2c5a401f29" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_683a336b0c04ddfd9f233844d3" ON "CloudRequiredTag" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7b14dddd0afe4436e79210190" ON "CloudRequiredTag" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudTagCoverageDay" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "cloudAccountId" uuid NOT NULL, "day" TIMESTAMP WITH TIME ZONE NOT NULL, "resourceCount" integer NOT NULL DEFAULT '0', "coveredCount" integer NOT NULL DEFAULT '0', "keyCounts" jsonb, CONSTRAINT "PK_4414b76ef3943b3dd82e159e61b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2531bc5a5b5767394fa73a9c93" ON "CloudTagCoverageDay" ("projectId", "day") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_172848b26648c5d583ee1afb59" ON "CloudTagCoverageDay" ("cloudAccountId", "day") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudTagFinding" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, "cloudAccountId" uuid, "missingTags" jsonb, "creatorActor" character varying(500), "creatorUserId" uuid, "foundAt" TIMESTAMP WITH TIME ZONE NOT NULL, "notifiedAt" TIMESTAMP WITH TIME ZONE, "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_818b87ed3a3abd61ed61aa4e985" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_902a621ef1760445751bdcecbc" ON "CloudTagFinding" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8b86539bdfbb205d8ec91a605b" ON "CloudTagFinding" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0cfa9ea2d42d42dfcd10b26bc5" ON "CloudTagFinding" ("cloudAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5261bebfa78945a0a59c3ee204" ON "CloudTagFinding" ("projectId", "resolvedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudTagSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "notifyPeople" boolean NOT NULL DEFAULT true, "emailEachResource" boolean NOT NULL DEFAULT false, "raiseAlert" boolean NOT NULL DEFAULT false, "alertSeverityId" uuid, "watchState" jsonb, CONSTRAINT "PK_8088807c3474b494346a70e77df" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a4720a41ea2960a5bf515c439" ON "CloudTagSetting" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bcc180dd5daf6e1787269fd917" ON "CloudTagSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "CloudTagSettingOnCallDutyPolicy" ("cloudTagSettingId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_c2c5bc94c30669bd1825377e920" PRIMARY KEY ("cloudTagSettingId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80443ff511d7afd7a58cbef4c6" ON "CloudTagSettingOnCallDutyPolicy" ("cloudTagSettingId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18e2de8f32ee418a33539242b8" ON "CloudTagSettingOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudRequiredTag" ADD CONSTRAINT "FK_683a336b0c04ddfd9f233844d33" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudRequiredTag" ADD CONSTRAINT "FK_a7b14dddd0afe4436e792101902" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudRequiredTag" ADD CONSTRAINT "FK_4023634e8c360c80859c41b8f42" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagCoverageDay" ADD CONSTRAINT "FK_3e8cfd7c53c83d9f6459f4b6ed5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagCoverageDay" ADD CONSTRAINT "FK_c4ae139bc2201e1fdb8aab1f56b" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" ADD CONSTRAINT "FK_902a621ef1760445751bdcecbc4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" ADD CONSTRAINT "FK_8b86539bdfbb205d8ec91a605b6" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" ADD CONSTRAINT "FK_0cfa9ea2d42d42dfcd10b26bc52" FOREIGN KEY ("cloudAccountId") REFERENCES "CloudAccount"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" ADD CONSTRAINT "FK_163a4ede57ab455b3fdb1a71f0b" FOREIGN KEY ("creatorUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSetting" ADD CONSTRAINT "FK_bcc180dd5daf6e1787269fd9179" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSetting" ADD CONSTRAINT "FK_6a4720a41ea2960a5bf515c4398" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSettingOnCallDutyPolicy" ADD CONSTRAINT "FK_80443ff511d7afd7a58cbef4c6f" FOREIGN KEY ("cloudTagSettingId") REFERENCES "CloudTagSetting"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSettingOnCallDutyPolicy" ADD CONSTRAINT "FK_18e2de8f32ee418a33539242b8c" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudTagSettingOnCallDutyPolicy" DROP CONSTRAINT "FK_18e2de8f32ee418a33539242b8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSettingOnCallDutyPolicy" DROP CONSTRAINT "FK_80443ff511d7afd7a58cbef4c6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSetting" DROP CONSTRAINT "FK_6a4720a41ea2960a5bf515c4398"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagSetting" DROP CONSTRAINT "FK_bcc180dd5daf6e1787269fd9179"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" DROP CONSTRAINT "FK_163a4ede57ab455b3fdb1a71f0b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" DROP CONSTRAINT "FK_0cfa9ea2d42d42dfcd10b26bc52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" DROP CONSTRAINT "FK_8b86539bdfbb205d8ec91a605b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagFinding" DROP CONSTRAINT "FK_902a621ef1760445751bdcecbc4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagCoverageDay" DROP CONSTRAINT "FK_c4ae139bc2201e1fdb8aab1f56b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudTagCoverageDay" DROP CONSTRAINT "FK_3e8cfd7c53c83d9f6459f4b6ed5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudRequiredTag" DROP CONSTRAINT "FK_4023634e8c360c80859c41b8f42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudRequiredTag" DROP CONSTRAINT "FK_a7b14dddd0afe4436e792101902"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudRequiredTag" DROP CONSTRAINT "FK_683a336b0c04ddfd9f233844d33"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18e2de8f32ee418a33539242b8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80443ff511d7afd7a58cbef4c6"`,
    );
    await queryRunner.query(`DROP TABLE "CloudTagSettingOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bcc180dd5daf6e1787269fd917"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a4720a41ea2960a5bf515c439"`,
    );
    await queryRunner.query(`DROP TABLE "CloudTagSetting"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5261bebfa78945a0a59c3ee204"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0cfa9ea2d42d42dfcd10b26bc5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b86539bdfbb205d8ec91a605b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_902a621ef1760445751bdcecbc"`,
    );
    await queryRunner.query(`DROP TABLE "CloudTagFinding"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_172848b26648c5d583ee1afb59"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2531bc5a5b5767394fa73a9c93"`,
    );
    await queryRunner.query(`DROP TABLE "CloudTagCoverageDay"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7b14dddd0afe4436e79210190"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_683a336b0c04ddfd9f233844d3"`,
    );
    await queryRunner.query(`DROP TABLE "CloudRequiredTag"`);
  }
}
