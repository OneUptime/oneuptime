import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778784396629 implements MigrationInterface {
  public name = "MigrationName1778784396629";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "HostOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "hostNamePattern" character varying(500), "hostDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f2bc753b45a6400604830670fba" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ddf77cffd408e5cf3dd075d88" ON "HostOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8cf4395c89b8c9b096093626d" ON "HostOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e68ea2ee999ed92ede1120d24" ON "HostOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "hostNamePattern" character varying(500), "hostDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_923623a35da6d2e59609e052b26" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4e8c2c8a029c79620061bc657" ON "HostLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ee068fc50ab9db7788d45e1a8" ON "HostLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c1fdede72776e87852bb67320" ON "HostLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "serviceNamePattern" character varying(500), "serviceDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_af9ffbe09e96c0daa9d247b14d1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_136b4913014340427c9d307484" ON "ServiceOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_75feb470cb3d542e362a9bfbb2" ON "ServiceOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5df98f1eb3f63850a37b69cf1b" ON "ServiceOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "serviceNamePattern" character varying(500), "serviceDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2616a719ba732fd11830fab211f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d76924916f0a66bd2195b8211" ON "ServiceLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_99d57667bbb13e17f958a7e430" ON "ServiceLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2764301e6741d3f64a0a88a72e" ON "ServiceLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "dockerHostNamePattern" character varying(500), "dockerHostDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a8e9287c63d5e95b2b01085a248" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd7a1f1d911ea4e1b972d3a907" ON "DockerHostOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a73a4553bb25a55d0946917e9" ON "DockerHostOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f3f9bcd5ac5eb6e195c46c9e2" ON "DockerHostOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "dockerHostNamePattern" character varying(500), "dockerHostDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_05739d932ccaf11893b8cf5de4a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1941ebdf804c3a46a6ffae6b1e" ON "DockerHostLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_282078c57206d00e7ad7dedf7c" ON "DockerHostLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42054f0ae7c3e75fa68e60ad5c" ON "DockerHostLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "kubernetesClusterNamePattern" character varying(500), "kubernetesClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_d58ba272abba50174a5dd53fa07" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7094ecd0cbfdc9f1de971faada" ON "KubernetesClusterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b3fbbc7333c668d0ac79f2e9a" ON "KubernetesClusterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dc9e6bce3e59c9a943e966cddb" ON "KubernetesClusterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "kubernetesClusterNamePattern" character varying(500), "kubernetesClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a6a945559d0a8a72c341cc667fd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a5c8dd5543038b439b37075bb" ON "KubernetesClusterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3034edb153d248b57eb215b60" ON "KubernetesClusterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e076c156811280d12e170bf05e" ON "KubernetesClusterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostOwnerRuleHostLabel" ("hostOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_871faff5d6ed0a45d079dafee4d" PRIMARY KEY ("hostOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0fb32fbfa99d282ec74e49307" ON "HostOwnerRuleHostLabel" ("hostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b4c8e32acea6bb30d35a98d1a" ON "HostOwnerRuleHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostOwnerRuleOwnerUser" ("hostOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_550b5561b20e72b0d2b0f3c369b" PRIMARY KEY ("hostOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bce5e7efc757d63e01ad4f9351" ON "HostOwnerRuleOwnerUser" ("hostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ef316a38f424aeec929274b31" ON "HostOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostOwnerRuleOwnerTeam" ("hostOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_4ca9cfef73fe93787dec2cd2357" PRIMARY KEY ("hostOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_358d08dbf98130e4fcc481c2fa" ON "HostOwnerRuleOwnerTeam" ("hostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7b6356ff0952e9c2d0905c9bc" ON "HostOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostLabelRuleHostLabel" ("hostLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_cf8bb6eed0aff4221d5132ebb6d" PRIMARY KEY ("hostLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4d526f7d9137a43b668f025dc" ON "HostLabelRuleHostLabel" ("hostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b15ef5783d453418b20f19a925" ON "HostLabelRuleHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "HostLabelRuleLabelToAdd" ("hostLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_07650a54464820c6d0455a17036" PRIMARY KEY ("hostLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58abd613de04a58bba2a4eee08" ON "HostLabelRuleLabelToAdd" ("hostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7146226b016674bd70a083112c" ON "HostLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceOwnerRuleServiceLabel" ("serviceOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8ff4d06056e474e6c12605cddbb" PRIMARY KEY ("serviceOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f3b86dc0e8bd33fc4f3497c57b" ON "ServiceOwnerRuleServiceLabel" ("serviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_51401030f094b49b2244af3a70" ON "ServiceOwnerRuleServiceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceOwnerRuleOwnerUser" ("serviceOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_81886bbf784b31d02ff4fa940c3" PRIMARY KEY ("serviceOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7604d79495171e93de9892ed10" ON "ServiceOwnerRuleOwnerUser" ("serviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d77bbb53e4ae9cf2c7b4be28b" ON "ServiceOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceOwnerRuleOwnerTeam" ("serviceOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_448fee67abee05271571a8b496c" PRIMARY KEY ("serviceOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e3cec55ac11c0e91447c4f267" ON "ServiceOwnerRuleOwnerTeam" ("serviceOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48b37cb9c8932e9b92761b420e" ON "ServiceOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLabelRuleServiceLabel" ("serviceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_f5294700d7870670e04eaa07741" PRIMARY KEY ("serviceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5f975ab2d4c6811bd5256a260" ON "ServiceLabelRuleServiceLabel" ("serviceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9585bb54df9341ad80ae80ff5a" ON "ServiceLabelRuleServiceLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ServiceLabelRuleLabelToAdd" ("serviceLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_6a234c63169d740bf0bcf329743" PRIMARY KEY ("serviceLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea13ea6ce9933a648c6c232bf3" ON "ServiceLabelRuleLabelToAdd" ("serviceLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d58bbdf38a1845bed5cf1d2b17" ON "ServiceLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerRuleDockerHostLabel" ("dockerHostOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_d92397e9c7c649072aab69de6ea" PRIMARY KEY ("dockerHostOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d4b003bbdc41e6dab08248535" ON "DockerHostOwnerRuleDockerHostLabel" ("dockerHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_37663ed281af9e3672ad27c558" ON "DockerHostOwnerRuleDockerHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerRuleOwnerUser" ("dockerHostOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_cc451673cf7a35ad4eff370f7cc" PRIMARY KEY ("dockerHostOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7c90b2718976026ce7058e03c" ON "DockerHostOwnerRuleOwnerUser" ("dockerHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fb4f43869184be98b91000baad" ON "DockerHostOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostOwnerRuleOwnerTeam" ("dockerHostOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_19903bba9d2e0b4fc6101bb8d22" PRIMARY KEY ("dockerHostOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07194172e1fe06ae8a84277643" ON "DockerHostOwnerRuleOwnerTeam" ("dockerHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0deabcd56e3ec8a3f80618a44d" ON "DockerHostOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostLabelRuleDockerHostLabel" ("dockerHostLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_67cfa127f61fae5741bd190893b" PRIMARY KEY ("dockerHostLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5cfd97b332e4c5dcfb319b5782" ON "DockerHostLabelRuleDockerHostLabel" ("dockerHostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f11562b50370c214a4f21d5c9" ON "DockerHostLabelRuleDockerHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerHostLabelRuleLabelToAdd" ("dockerHostLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_be1ad95aa42d8e6b468e4348da7" PRIMARY KEY ("dockerHostLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2bbc4498416a644b164f500b6b" ON "DockerHostLabelRuleLabelToAdd" ("dockerHostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1dc0d15f3c2ea11bcfb7ab371f" ON "DockerHostLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerRuleKubernetesClusterLabel" ("kubernetesClusterOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9d0e3bd3cd47defe3b00e619546" PRIMARY KEY ("kubernetesClusterOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ed97619e30bdc478a4ef902f0" ON "KubernetesClusterOwnerRuleKubernetesClusterLabel" ("kubernetesClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aee998294f823b54aee68d14ff" ON "KubernetesClusterOwnerRuleKubernetesClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerRuleOwnerUser" ("kubernetesClusterOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_e1c459fab7743c3fceff10a8757" PRIMARY KEY ("kubernetesClusterOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fe9ebc9a6452c84d8048a437d6" ON "KubernetesClusterOwnerRuleOwnerUser" ("kubernetesClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_462affe0df3c77998a0d76e0d7" ON "KubernetesClusterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterOwnerRuleOwnerTeam" ("kubernetesClusterOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_df580a69c41c0fe058cdde53513" PRIMARY KEY ("kubernetesClusterOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0f64ff16ee31bd4ef0e9e4a95" ON "KubernetesClusterOwnerRuleOwnerTeam" ("kubernetesClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f65ab2bf31b1db505636bd17d" ON "KubernetesClusterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterLabelRuleKubernetesClusterLabel" ("kubernetesClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_99c5611ee183467c7cb14bb598d" PRIMARY KEY ("kubernetesClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6013498ef6e6b20f4728d37fee" ON "KubernetesClusterLabelRuleKubernetesClusterLabel" ("kubernetesClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_292164f0e3d90f8a466cfaac27" ON "KubernetesClusterLabelRuleKubernetesClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterLabelRuleLabelToAdd" ("kubernetesClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ef132eb30cc36402cc3d4831faf" PRIMARY KEY ("kubernetesClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab815d5b181a4d4f0e197fe107" ON "KubernetesClusterLabelRuleLabelToAdd" ("kubernetesClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5f173eb0a315f0a13802f72ff" ON "KubernetesClusterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" ADD CONSTRAINT "FK_6ddf77cffd408e5cf3dd075d88a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" ADD CONSTRAINT "FK_14b9d14ebf8f34cf419c394d283" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" ADD CONSTRAINT "FK_2db1d1a338fd3147f62184eb1c1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" ADD CONSTRAINT "FK_d4e8c2c8a029c79620061bc657d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" ADD CONSTRAINT "FK_0fed764ec045ad3bfccbb070ef3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" ADD CONSTRAINT "FK_81217cc96df2e1491ff9acd39c3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" ADD CONSTRAINT "FK_136b4913014340427c9d3074846" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" ADD CONSTRAINT "FK_9aed11debecc4f7415ba447174e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" ADD CONSTRAINT "FK_b4898c18c90b8870a5a9fa645b6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" ADD CONSTRAINT "FK_8d76924916f0a66bd2195b8211e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" ADD CONSTRAINT "FK_774e8a8db75bc30c4d78d1293ee" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" ADD CONSTRAINT "FK_aaac69cf7c94b0ccb1bf73e7376" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" ADD CONSTRAINT "FK_dd7a1f1d911ea4e1b972d3a9072" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" ADD CONSTRAINT "FK_d2e6c043c4833fa3f42e46142ab" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" ADD CONSTRAINT "FK_676e5fbc60ab5ab52dc849f1dc6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" ADD CONSTRAINT "FK_1941ebdf804c3a46a6ffae6b1ea" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" ADD CONSTRAINT "FK_a886855f09a236ddbf86d806320" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" ADD CONSTRAINT "FK_011be34abf76530014ab3a2f0f1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" ADD CONSTRAINT "FK_7094ecd0cbfdc9f1de971faada8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" ADD CONSTRAINT "FK_39ec2004a9e7cbf6e90ec02694e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" ADD CONSTRAINT "FK_c38097838464fe522aae423b8fb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" ADD CONSTRAINT "FK_8a5c8dd5543038b439b37075bb0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" ADD CONSTRAINT "FK_6ab49a828e2202e5eb47b359236" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" ADD CONSTRAINT "FK_91b9d26fb5388ac6db3be48bd6c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleHostLabel" ADD CONSTRAINT "FK_c0fb32fbfa99d282ec74e493075" FOREIGN KEY ("hostOwnerRuleId") REFERENCES "HostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleHostLabel" ADD CONSTRAINT "FK_8b4c8e32acea6bb30d35a98d1a1" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_bce5e7efc757d63e01ad4f93510" FOREIGN KEY ("hostOwnerRuleId") REFERENCES "HostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_8ef316a38f424aeec929274b31b" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_358d08dbf98130e4fcc481c2fa5" FOREIGN KEY ("hostOwnerRuleId") REFERENCES "HostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_d7b6356ff0952e9c2d0905c9bcd" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleHostLabel" ADD CONSTRAINT "FK_e4d526f7d9137a43b668f025dc4" FOREIGN KEY ("hostLabelRuleId") REFERENCES "HostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleHostLabel" ADD CONSTRAINT "FK_b15ef5783d453418b20f19a9251" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_58abd613de04a58bba2a4eee089" FOREIGN KEY ("hostLabelRuleId") REFERENCES "HostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_7146226b016674bd70a083112cf" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleServiceLabel" ADD CONSTRAINT "FK_f3b86dc0e8bd33fc4f3497c57b5" FOREIGN KEY ("serviceOwnerRuleId") REFERENCES "ServiceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleServiceLabel" ADD CONSTRAINT "FK_51401030f094b49b2244af3a705" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_7604d79495171e93de9892ed10d" FOREIGN KEY ("serviceOwnerRuleId") REFERENCES "ServiceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerUser" ADD CONSTRAINT "FK_5d77bbb53e4ae9cf2c7b4be28bb" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_3e3cec55ac11c0e91447c4f267c" FOREIGN KEY ("serviceOwnerRuleId") REFERENCES "ServiceOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_48b37cb9c8932e9b92761b420ea" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleServiceLabel" ADD CONSTRAINT "FK_d5f975ab2d4c6811bd5256a260a" FOREIGN KEY ("serviceLabelRuleId") REFERENCES "ServiceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleServiceLabel" ADD CONSTRAINT "FK_9585bb54df9341ad80ae80ff5a8" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_ea13ea6ce9933a648c6c232bf39" FOREIGN KEY ("serviceLabelRuleId") REFERENCES "ServiceLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleLabelToAdd" ADD CONSTRAINT "FK_d58bbdf38a1845bed5cf1d2b17d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleDockerHostLabel" ADD CONSTRAINT "FK_1d4b003bbdc41e6dab082485355" FOREIGN KEY ("dockerHostOwnerRuleId") REFERENCES "DockerHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleDockerHostLabel" ADD CONSTRAINT "FK_37663ed281af9e3672ad27c558d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_b7c90b2718976026ce7058e03c1" FOREIGN KEY ("dockerHostOwnerRuleId") REFERENCES "DockerHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_fb4f43869184be98b91000baadb" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_07194172e1fe06ae8a84277643a" FOREIGN KEY ("dockerHostOwnerRuleId") REFERENCES "DockerHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_0deabcd56e3ec8a3f80618a44d0" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleDockerHostLabel" ADD CONSTRAINT "FK_5cfd97b332e4c5dcfb319b57824" FOREIGN KEY ("dockerHostLabelRuleId") REFERENCES "DockerHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleDockerHostLabel" ADD CONSTRAINT "FK_4f11562b50370c214a4f21d5c91" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_2bbc4498416a644b164f500b6bd" FOREIGN KEY ("dockerHostLabelRuleId") REFERENCES "DockerHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_1dc0d15f3c2ea11bcfb7ab371f1" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleKubernetesClusterLabel" ADD CONSTRAINT "FK_5ed97619e30bdc478a4ef902f0e" FOREIGN KEY ("kubernetesClusterOwnerRuleId") REFERENCES "KubernetesClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleKubernetesClusterLabel" ADD CONSTRAINT "FK_aee998294f823b54aee68d14ff0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_fe9ebc9a6452c84d8048a437d6f" FOREIGN KEY ("kubernetesClusterOwnerRuleId") REFERENCES "KubernetesClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_462affe0df3c77998a0d76e0d7f" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_b0f64ff16ee31bd4ef0e9e4a95a" FOREIGN KEY ("kubernetesClusterOwnerRuleId") REFERENCES "KubernetesClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_3f65ab2bf31b1db505636bd17da" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleKubernetesClusterLabel" ADD CONSTRAINT "FK_6013498ef6e6b20f4728d37fee4" FOREIGN KEY ("kubernetesClusterLabelRuleId") REFERENCES "KubernetesClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleKubernetesClusterLabel" ADD CONSTRAINT "FK_292164f0e3d90f8a466cfaac271" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_ab815d5b181a4d4f0e197fe1077" FOREIGN KEY ("kubernetesClusterLabelRuleId") REFERENCES "KubernetesClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_c5f173eb0a315f0a13802f72ff9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_c5f173eb0a315f0a13802f72ff9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_ab815d5b181a4d4f0e197fe1077"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleKubernetesClusterLabel" DROP CONSTRAINT "FK_292164f0e3d90f8a466cfaac271"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRuleKubernetesClusterLabel" DROP CONSTRAINT "FK_6013498ef6e6b20f4728d37fee4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_3f65ab2bf31b1db505636bd17da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_b0f64ff16ee31bd4ef0e9e4a95a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_462affe0df3c77998a0d76e0d7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_fe9ebc9a6452c84d8048a437d6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleKubernetesClusterLabel" DROP CONSTRAINT "FK_aee998294f823b54aee68d14ff0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRuleKubernetesClusterLabel" DROP CONSTRAINT "FK_5ed97619e30bdc478a4ef902f0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_1dc0d15f3c2ea11bcfb7ab371f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_2bbc4498416a644b164f500b6bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleDockerHostLabel" DROP CONSTRAINT "FK_4f11562b50370c214a4f21d5c91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRuleDockerHostLabel" DROP CONSTRAINT "FK_5cfd97b332e4c5dcfb319b57824"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_0deabcd56e3ec8a3f80618a44d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_07194172e1fe06ae8a84277643a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_fb4f43869184be98b91000baadb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_b7c90b2718976026ce7058e03c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleDockerHostLabel" DROP CONSTRAINT "FK_37663ed281af9e3672ad27c558d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRuleDockerHostLabel" DROP CONSTRAINT "FK_1d4b003bbdc41e6dab082485355"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_d58bbdf38a1845bed5cf1d2b17d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleLabelToAdd" DROP CONSTRAINT "FK_ea13ea6ce9933a648c6c232bf39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleServiceLabel" DROP CONSTRAINT "FK_9585bb54df9341ad80ae80ff5a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRuleServiceLabel" DROP CONSTRAINT "FK_d5f975ab2d4c6811bd5256a260a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_48b37cb9c8932e9b92761b420ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_3e3cec55ac11c0e91447c4f267c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_5d77bbb53e4ae9cf2c7b4be28bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleOwnerUser" DROP CONSTRAINT "FK_7604d79495171e93de9892ed10d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleServiceLabel" DROP CONSTRAINT "FK_51401030f094b49b2244af3a705"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRuleServiceLabel" DROP CONSTRAINT "FK_f3b86dc0e8bd33fc4f3497c57b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_7146226b016674bd70a083112cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_58abd613de04a58bba2a4eee089"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleHostLabel" DROP CONSTRAINT "FK_b15ef5783d453418b20f19a9251"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRuleHostLabel" DROP CONSTRAINT "FK_e4d526f7d9137a43b668f025dc4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_d7b6356ff0952e9c2d0905c9bcd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_358d08dbf98130e4fcc481c2fa5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_8ef316a38f424aeec929274b31b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_bce5e7efc757d63e01ad4f93510"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleHostLabel" DROP CONSTRAINT "FK_8b4c8e32acea6bb30d35a98d1a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRuleHostLabel" DROP CONSTRAINT "FK_c0fb32fbfa99d282ec74e493075"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" DROP CONSTRAINT "FK_91b9d26fb5388ac6db3be48bd6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" DROP CONSTRAINT "FK_6ab49a828e2202e5eb47b359236"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabelRule" DROP CONSTRAINT "FK_8a5c8dd5543038b439b37075bb0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" DROP CONSTRAINT "FK_c38097838464fe522aae423b8fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" DROP CONSTRAINT "FK_39ec2004a9e7cbf6e90ec02694e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterOwnerRule" DROP CONSTRAINT "FK_7094ecd0cbfdc9f1de971faada8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" DROP CONSTRAINT "FK_011be34abf76530014ab3a2f0f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" DROP CONSTRAINT "FK_a886855f09a236ddbf86d806320"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostLabelRule" DROP CONSTRAINT "FK_1941ebdf804c3a46a6ffae6b1ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" DROP CONSTRAINT "FK_676e5fbc60ab5ab52dc849f1dc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" DROP CONSTRAINT "FK_d2e6c043c4833fa3f42e46142ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHostOwnerRule" DROP CONSTRAINT "FK_dd7a1f1d911ea4e1b972d3a9072"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" DROP CONSTRAINT "FK_aaac69cf7c94b0ccb1bf73e7376"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" DROP CONSTRAINT "FK_774e8a8db75bc30c4d78d1293ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLabelRule" DROP CONSTRAINT "FK_8d76924916f0a66bd2195b8211e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" DROP CONSTRAINT "FK_b4898c18c90b8870a5a9fa645b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" DROP CONSTRAINT "FK_9aed11debecc4f7415ba447174e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceOwnerRule" DROP CONSTRAINT "FK_136b4913014340427c9d3074846"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" DROP CONSTRAINT "FK_81217cc96df2e1491ff9acd39c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" DROP CONSTRAINT "FK_0fed764ec045ad3bfccbb070ef3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostLabelRule" DROP CONSTRAINT "FK_d4e8c2c8a029c79620061bc657d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" DROP CONSTRAINT "FK_2db1d1a338fd3147f62184eb1c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" DROP CONSTRAINT "FK_14b9d14ebf8f34cf419c394d283"`,
    );
    await queryRunner.query(
      `ALTER TABLE "HostOwnerRule" DROP CONSTRAINT "FK_6ddf77cffd408e5cf3dd075d88a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5f173eb0a315f0a13802f72ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab815d5b181a4d4f0e197fe107"`,
    );
    await queryRunner.query(
      `DROP TABLE "KubernetesClusterLabelRuleLabelToAdd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_292164f0e3d90f8a466cfaac27"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6013498ef6e6b20f4728d37fee"`,
    );
    await queryRunner.query(
      `DROP TABLE "KubernetesClusterLabelRuleKubernetesClusterLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f65ab2bf31b1db505636bd17d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0f64ff16ee31bd4ef0e9e4a95"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_462affe0df3c77998a0d76e0d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe9ebc9a6452c84d8048a437d6"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aee998294f823b54aee68d14ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ed97619e30bdc478a4ef902f0"`,
    );
    await queryRunner.query(
      `DROP TABLE "KubernetesClusterOwnerRuleKubernetesClusterLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1dc0d15f3c2ea11bcfb7ab371f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2bbc4498416a644b164f500b6b"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f11562b50370c214a4f21d5c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5cfd97b332e4c5dcfb319b5782"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostLabelRuleDockerHostLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0deabcd56e3ec8a3f80618a44d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07194172e1fe06ae8a84277643"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb4f43869184be98b91000baad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7c90b2718976026ce7058e03c"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_37663ed281af9e3672ad27c558"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d4b003bbdc41e6dab08248535"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerRuleDockerHostLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d58bbdf38a1845bed5cf1d2b17"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea13ea6ce9933a648c6c232bf3"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9585bb54df9341ad80ae80ff5a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5f975ab2d4c6811bd5256a260"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLabelRuleServiceLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_48b37cb9c8932e9b92761b420e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e3cec55ac11c0e91447c4f267"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d77bbb53e4ae9cf2c7b4be28b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7604d79495171e93de9892ed10"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_51401030f094b49b2244af3a70"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f3b86dc0e8bd33fc4f3497c57b"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceOwnerRuleServiceLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7146226b016674bd70a083112c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58abd613de04a58bba2a4eee08"`,
    );
    await queryRunner.query(`DROP TABLE "HostLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b15ef5783d453418b20f19a925"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4d526f7d9137a43b668f025dc"`,
    );
    await queryRunner.query(`DROP TABLE "HostLabelRuleHostLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7b6356ff0952e9c2d0905c9bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_358d08dbf98130e4fcc481c2fa"`,
    );
    await queryRunner.query(`DROP TABLE "HostOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ef316a38f424aeec929274b31"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bce5e7efc757d63e01ad4f9351"`,
    );
    await queryRunner.query(`DROP TABLE "HostOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b4c8e32acea6bb30d35a98d1a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0fb32fbfa99d282ec74e49307"`,
    );
    await queryRunner.query(`DROP TABLE "HostOwnerRuleHostLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e076c156811280d12e170bf05e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3034edb153d248b57eb215b60"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a5c8dd5543038b439b37075bb"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dc9e6bce3e59c9a943e966cddb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b3fbbc7333c668d0ac79f2e9a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7094ecd0cbfdc9f1de971faada"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42054f0ae7c3e75fa68e60ad5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_282078c57206d00e7ad7dedf7c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1941ebdf804c3a46a6ffae6b1e"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f3f9bcd5ac5eb6e195c46c9e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a73a4553bb25a55d0946917e9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd7a1f1d911ea4e1b972d3a907"`,
    );
    await queryRunner.query(`DROP TABLE "DockerHostOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2764301e6741d3f64a0a88a72e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99d57667bbb13e17f958a7e430"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d76924916f0a66bd2195b8211"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5df98f1eb3f63850a37b69cf1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_75feb470cb3d542e362a9bfbb2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_136b4913014340427c9d307484"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c1fdede72776e87852bb67320"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ee068fc50ab9db7788d45e1a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4e8c2c8a029c79620061bc657"`,
    );
    await queryRunner.query(`DROP TABLE "HostLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e68ea2ee999ed92ede1120d24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8cf4395c89b8c9b096093626d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ddf77cffd408e5cf3dd075d88"`,
    );
    await queryRunner.query(`DROP TABLE "HostOwnerRule"`);
  }
}
