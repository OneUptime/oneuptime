import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDetectionRuleAndGoogleSecOpsConnection1788000000000 implements MigrationInterface {
    name = "AddDetectionRuleAndGoogleSecOpsConnection1788000000000"

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "DetectionRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "sigmaRuleYaml" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "evaluationIntervalInMinutes" integer NOT NULL DEFAULT '1', "groupByField" character varying(100), "shouldCreateAlert" boolean NOT NULL DEFAULT true, "shouldWriteDetectionFinding" boolean NOT NULL DEFAULT true, "alertSeverityId" uuid, "lastEvaluatedAt" TIMESTAMP WITH TIME ZONE, "lastMatchAt" TIMESTAMP WITH TIME ZONE, "lastError" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4c12aeb76297c2c78a1e708ad6d" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_edcda59471223b272610e40e3b" ON "DetectionRule" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_861e04579580210cd030048d73" ON "DetectionRule" ("isEnabled") `);
        await queryRunner.query(`CREATE TABLE "GoogleSecOpsConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "region" character varying(100) NOT NULL, "instanceResourceName" character varying(500) NOT NULL, "serviceAccountJson" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "pollIntervalInMinutes" integer NOT NULL DEFAULT '5', "lastPolledAt" TIMESTAMP WITH TIME ZONE, "cursor" character varying(500), "lastError" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_fbdcd1f7453680c7f366cc80c07" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e59b999458abf1dea973d32fc5" ON "GoogleSecOpsConnection" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9fa67f61a03217dd86fab69fe7" ON "GoogleSecOpsConnection" ("isEnabled") `);
        await queryRunner.query(`ALTER TABLE "DetectionRule" ADD CONSTRAINT "FK_edcda59471223b272610e40e3b1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" ADD CONSTRAINT "FK_62fd7565adf068755445ef78509" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" ADD CONSTRAINT "FK_81bc91fe3e02553aad48fc2785f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" ADD CONSTRAINT "FK_30f12b8514cc8ebb336988ebf68" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "GoogleSecOpsConnection" ADD CONSTRAINT "FK_e59b999458abf1dea973d32fc53" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "GoogleSecOpsConnection" ADD CONSTRAINT "FK_7df7932fd07705129a78d75c39a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "GoogleSecOpsConnection" ADD CONSTRAINT "FK_1fff38e9cdc1d04b44dfdd9c1cc" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "GoogleSecOpsConnection" DROP CONSTRAINT "FK_1fff38e9cdc1d04b44dfdd9c1cc"`);
        await queryRunner.query(`ALTER TABLE "GoogleSecOpsConnection" DROP CONSTRAINT "FK_7df7932fd07705129a78d75c39a"`);
        await queryRunner.query(`ALTER TABLE "GoogleSecOpsConnection" DROP CONSTRAINT "FK_e59b999458abf1dea973d32fc53"`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" DROP CONSTRAINT "FK_30f12b8514cc8ebb336988ebf68"`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" DROP CONSTRAINT "FK_81bc91fe3e02553aad48fc2785f"`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" DROP CONSTRAINT "FK_62fd7565adf068755445ef78509"`);
        await queryRunner.query(`ALTER TABLE "DetectionRule" DROP CONSTRAINT "FK_edcda59471223b272610e40e3b1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9fa67f61a03217dd86fab69fe7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e59b999458abf1dea973d32fc5"`);
        await queryRunner.query(`DROP TABLE "GoogleSecOpsConnection"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_861e04579580210cd030048d73"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_edcda59471223b272610e40e3b"`);
        await queryRunner.query(`DROP TABLE "DetectionRule"`);
    }

}
