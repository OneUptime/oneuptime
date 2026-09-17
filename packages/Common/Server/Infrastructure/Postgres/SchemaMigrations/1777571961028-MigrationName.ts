import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1777571961028 implements MigrationInterface {
  public name: string = "MigrationName1777571961028";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesContainer" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "podNamespaceKey" character varying(100) NOT NULL DEFAULT '', "podName" character varying(100) NOT NULL, "name" character varying(100) NOT NULL, "image" character varying(500), "state" character varying(100), "reason" character varying(100), "isReady" boolean, "restartCount" integer, "memoryLimitBytes" bigint, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_7e19b5140bc3005a6ea2f8f7aee" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fcc7f4bc83564a8c7885233f6e" ON "KubernetesContainer" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5303bcae1a72f9830bd7d15e2c" ON "KubernetesContainer" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1dcb8fed322a9bddfabb60cbc7" ON "KubernetesContainer" ("projectId", "kubernetesClusterId", "podNamespaceKey", "podName", "name") `,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "controllerDeploymentName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "controllerCronJobName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestCpuPercent" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestMemoryBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD CONSTRAINT "FK_fcc7f4bc83564a8c7885233f6e3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD CONSTRAINT "FK_5303bcae1a72f9830bd7d15e2cd" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD CONSTRAINT "FK_d0f740eb8fc87c2426d78babf6b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD CONSTRAINT "FK_eadbc98e53bc5788d8313e52c67" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP CONSTRAINT "FK_eadbc98e53bc5788d8313e52c67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP CONSTRAINT "FK_d0f740eb8fc87c2426d78babf6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP CONSTRAINT "FK_5303bcae1a72f9830bd7d15e2cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP CONSTRAINT "FK_fcc7f4bc83564a8c7885233f6e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "metricsUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestMemoryBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestCpuPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "controllerCronJobName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "controllerDeploymentName"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1dcb8fed322a9bddfabb60cbc7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5303bcae1a72f9830bd7d15e2c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fcc7f4bc83564a8c7885233f6e"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesContainer"`);
  }
}
