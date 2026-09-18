import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776504277320 implements MigrationInterface {
  public name = "MigrationName1776504277320";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_5dbe44378bc1480e79b47933f08" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1edddbc2265ebc59e28012a241" ON "KubernetesClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4121a7fd3ed06b3acb3ba3e67d" ON "KubernetesClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf4e9cce4fbc4f0ecafd55ff16" ON "KubernetesClusterOwnerTeam" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0a0c2dedd022deb9b1d98e551" ON "KubernetesClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_77899aed977334e06e9eb9191f2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a028624594c3af19fd357f63d9" ON "KubernetesClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f0f41ec22c5cba97ae683bcea" ON "KubernetesClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55b86a79c8d0a83f0f5310af10" ON "KubernetesClusterOwnerUser" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8c195454312acaade0e6eb317" ON "KubernetesClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "namespaceKey" character varying(100) NOT NULL DEFAULT '', "name" character varying(100) NOT NULL, "uid" character varying(100), "phase" character varying(100), "isReady" boolean, "hasMemoryPressure" boolean, "hasDiskPressure" boolean, "hasPidPressure" boolean, "labels" jsonb, "annotations" jsonb, "ownerReferences" jsonb, "spec" jsonb, "status" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resourceCreationTimestamp" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_3df82592f51fae6527786e97361" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ba6ae746a1497c4206e0fe43e" ON "KubernetesResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f34bd01ec1d8fa16df1965ba1" ON "KubernetesResource" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ceb398a4e953c4686f96ca5220c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dffee2c443b46371e3776d1a22" ON "DockerHostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92de0bd17ce0ed78667f75850a" ON "DockerHostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6b3b8eb0f50b6b75084d6a847" ON "DockerHostOwnerTeam" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_055ca044d2cede9047f5b37f95" ON "DockerHostOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ae757ff50d71971accedc9000ab" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d48394c7e4cc190543d244b3bb" ON "DockerHostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_085f1c777c88f27c799a17fd05" ON "DockerHostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1a1ba85edda82690ecc0119e3" ON "DockerHostOwnerUser" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0d5bdf7ff4dbc2fb24dada34d" ON "DockerHostOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MetricPipelineRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceId" uuid, "name" character varying(50) NOT NULL, "description" character varying(500), "ruleType" character varying(100) NOT NULL, "matchMetricNameRegex" character varying(500), "matchAttributeKey" character varying(100), "matchAttributeValueRegex" character varying(500), "renameFromKey" character varying(100), "renameToKey" character varying(100), "addAttributeKey" character varying(100), "addAttributeValue" character varying(500), "redactReplacement" character varying(100) NOT NULL DEFAULT '[REDACTED]', "samplePercentage" integer NOT NULL DEFAULT '100', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8095847bfd8645395b017b4caa2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a998093e4ce311de800b097a8" ON "MetricPipelineRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f721c65f32d1adf2c95f8e9f68" ON "MetricPipelineRule" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d40cdea3189290e196073c7c8b" ON "MetricPipelineRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MetricRecordingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "outputMetricName" character varying(100) NOT NULL, "definition" jsonb NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_630db247e0db8ff27fe7c564dd8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_686e0d0602b42fd0ac3461c36f" ON "MetricRecordingRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9df0d13c3421159ebd323ed60a" ON "MetricRecordingRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultMetricCardinalityBudget" integer NOT NULL DEFAULT '10000'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultMetricDownsamplingRetentionDays" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "metricCardinalityBudget" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "metricDownsamplingRetentionDays" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_1edddbc2265ebc59e28012a241f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_4121a7fd3ed06b3acb3ba3e67d5" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_bf4e9cce4fbc4f0ecafd55ff16c" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_ae592ae3b0955a7eaf2ce74cc9e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" ADD CONSTRAINT "FK_47ccc73fd46b91032858e89f9c0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_a028624594c3af19fd357f63d97" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_0f0f41ec22c5cba97ae683bcead" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_55b86a79c8d0a83f0f5310af107" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_a0f521334eb132e3d85a44cbc57" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" ADD CONSTRAINT "FK_abf04cdd9bfc085448061c1249f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_0ba6ae746a1497c4206e0fe43e1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_3f34bd01ec1d8fa16df1965ba1c" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_648fa46113b326f1a5b97f773fc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_1c837345d0112e50866c0b4773e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_dffee2c443b46371e3776d1a227" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_92de0bd17ce0ed78667f75850ab" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_c6b3b8eb0f50b6b75084d6a8476" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_5071986b436142416ba3123dd3c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" ADD CONSTRAINT "FK_6d66a84d603aaff4b5ac2c64cc1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_d48394c7e4cc190543d244b3bbf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_085f1c777c88f27c799a17fd055" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_e1a1ba85edda82690ecc0119e34" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_62a4b021f9a6282b95f4a6065a0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" ADD CONSTRAINT "FK_090e1ea6d6de6945d97e6c104b0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_6a998093e4ce311de800b097a83" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_f721c65f32d1adf2c95f8e9f68b" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_8818020752998f385dab57f33d0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_5a45d3f3917790440570168084b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ADD CONSTRAINT "FK_686e0d0602b42fd0ac3461c36f6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ADD CONSTRAINT "FK_3bb94b2180cac96e239b4fd00d6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ADD CONSTRAINT "FK_889e2b5640ac7ac63d19d511f9d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" DROP CONSTRAINT "FK_889e2b5640ac7ac63d19d511f9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" DROP CONSTRAINT "FK_3bb94b2180cac96e239b4fd00d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" DROP CONSTRAINT "FK_686e0d0602b42fd0ac3461c36f6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_5a45d3f3917790440570168084b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_8818020752998f385dab57f33d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_f721c65f32d1adf2c95f8e9f68b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_6a998093e4ce311de800b097a83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_090e1ea6d6de6945d97e6c104b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_62a4b021f9a6282b95f4a6065a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_e1a1ba85edda82690ecc0119e34"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_085f1c777c88f27c799a17fd055"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerUser" DROP CONSTRAINT "FK_d48394c7e4cc190543d244b3bbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_6d66a84d603aaff4b5ac2c64cc1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_5071986b436142416ba3123dd3c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_c6b3b8eb0f50b6b75084d6a8476"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_92de0bd17ce0ed78667f75850ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerTeam" DROP CONSTRAINT "FK_dffee2c443b46371e3776d1a227"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_1c837345d0112e50866c0b4773e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_648fa46113b326f1a5b97f773fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_3f34bd01ec1d8fa16df1965ba1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_0ba6ae746a1497c4206e0fe43e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_abf04cdd9bfc085448061c1249f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_a0f521334eb132e3d85a44cbc57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_55b86a79c8d0a83f0f5310af107"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_0f0f41ec22c5cba97ae683bcead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerUser" DROP CONSTRAINT "FK_a028624594c3af19fd357f63d97"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_47ccc73fd46b91032858e89f9c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_ae592ae3b0955a7eaf2ce74cc9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_bf4e9cce4fbc4f0ecafd55ff16c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_4121a7fd3ed06b3acb3ba3e67d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerTeam" DROP CONSTRAINT "FK_1edddbc2265ebc59e28012a241f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "metricDownsamplingRetentionDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "metricCardinalityBudget"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultMetricDownsamplingRetentionDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultMetricCardinalityBudget"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9df0d13c3421159ebd323ed60a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_686e0d0602b42fd0ac3461c36f"`,
    );
    await queryRunner.query(`DROP TABLE "MetricRecordingRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d40cdea3189290e196073c7c8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f721c65f32d1adf2c95f8e9f68"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a998093e4ce311de800b097a8"`,
    );
    await queryRunner.query(`DROP TABLE "MetricPipelineRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0d5bdf7ff4dbc2fb24dada34d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1a1ba85edda82690ecc0119e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_085f1c777c88f27c799a17fd05"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d48394c7e4cc190543d244b3bb"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_055ca044d2cede9047f5b37f95"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6b3b8eb0f50b6b75084d6a847"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92de0bd17ce0ed78667f75850a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dffee2c443b46371e3776d1a22"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f34bd01ec1d8fa16df1965ba1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ba6ae746a1497c4206e0fe43e"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8c195454312acaade0e6eb317"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55b86a79c8d0a83f0f5310af10"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f0f41ec22c5cba97ae683bcea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a028624594c3af19fd357f63d9"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0a0c2dedd022deb9b1d98e551"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf4e9cce4fbc4f0ecafd55ff16"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4121a7fd3ed06b3acb3ba3e67d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1edddbc2265ebc59e28012a241"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerTeam"`);
  }
}
