import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778791942334 implements MigrationInterface {
  public name: string = "MigrationName1778791942334";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkflowOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "workflowId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_26f4c5548852797fe240dd66f7f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_871882dbca524033a2396430e5" ON "WorkflowOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb7ac3ccfda519d0df5463dda4" ON "WorkflowOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2df87085cb6c05a5c1b85161e0" ON "WorkflowOwnerTeam" ("workflowId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_064b57caa633a318690aa2472d" ON "WorkflowOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23cb5a85c555d015abb14021bd" ON "WorkflowOwnerTeam" ("workflowId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "workflowId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_54aded0abb990d078dd9c02591e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_101c8b1584b592500f67d710cc" ON "WorkflowOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b3fdf6fb49abcd908876a2f7a" ON "WorkflowOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_921ac246c65ba87c849ca8a475" ON "WorkflowOwnerUser" ("workflowId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ddc135a660bd538dc47a7c9f0d" ON "WorkflowOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a2480665e9ab79bef464a8c57" ON "WorkflowOwnerUser" ("workflowId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "workflowNamePattern" character varying(500), "workflowDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e23eb5944107d522a0dba1aeb7b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b943913369b148f5e9e0145f" ON "WorkflowOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7402311b70a2ddac205e35c24" ON "WorkflowOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43f822b7a886407fc92d14adff" ON "WorkflowOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "workflowNamePattern" character varying(500), "workflowDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2e70814de97b92bd4cef72d0b9b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52f373ce99708b46c1f97a77e1" ON "WorkflowLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6de5755424a890b8696aebf3a2" ON "WorkflowLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7d7a56bbd9915faf1ae2926b18" ON "WorkflowLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "dashboardNamePattern" character varying(500), "dashboardDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c8a809a37f09b0c26cee8a63809" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea9c99497430ee2e7956bf0c77" ON "DashboardOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9797b37a248be24a2259de54e" ON "DashboardOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80addc7b91c742cb52c8b46a3d" ON "DashboardOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "dashboardNamePattern" character varying(500), "dashboardDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_eb1040b9ab44ec41d059a57d1df" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62bf3c97873ea1ad7edb7c9629" ON "DashboardLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c7de5cbf2fa965b0008af8692" ON "DashboardLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bc718602e1ff326830b1f057ea" ON "DashboardLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_15e29f0b3251d3ea378c3c6352f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ddbc5ca0f08593a7afa6a27be8" ON "DashboardOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cad95dd9b18509d562699d541" ON "DashboardOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53aece038f89715e4993a0b5cb" ON "DashboardOwnerTeam" ("dashboardId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_102eda151971dba13aa42d128d" ON "DashboardOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4fd29eeca8c655246fc86e6ba" ON "DashboardOwnerTeam" ("dashboardId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "dashboardId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a945cac0852fcb16d1ed4230724" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1262bccf00f26b3017f30fa579" ON "DashboardOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ec0ede4274fdba73f6875a164d" ON "DashboardOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c34de34210a7892aab888c4358" ON "DashboardOwnerUser" ("dashboardId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d23310c27f3e64d1f82bd7196" ON "DashboardOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a02ec21317c3701dbab53e43d" ON "DashboardOwnerUser" ("dashboardId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowOwnerRuleWorkflowLabel" ("workflowOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8d0cd7ec5afcc35864d1c30aa14" PRIMARY KEY ("workflowOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fecd531b175d7ae1c6ba8efbae" ON "WorkflowOwnerRuleWorkflowLabel" ("workflowOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e839ca656e4f0fcef89f0d23c" ON "WorkflowOwnerRuleWorkflowLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowOwnerRuleOwnerUser" ("workflowOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_01956fb5e95761d16b5ea2670d5" PRIMARY KEY ("workflowOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b828e74878f924763206954f8" ON "WorkflowOwnerRuleOwnerUser" ("workflowOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dbd5a34dce9b4827abec7ca5af" ON "WorkflowOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowOwnerRuleOwnerTeam" ("workflowOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_bb6a6434c58fa8a8f8622db5724" PRIMARY KEY ("workflowOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_743240fe68c8225948cc257f41" ON "WorkflowOwnerRuleOwnerTeam" ("workflowOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf0d139514008245c2514693a0" ON "WorkflowOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowLabelRuleWorkflowLabel" ("workflowLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8e333ccdc69e07c86de7e850a10" PRIMARY KEY ("workflowLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca547aeba41e13cf39f5860313" ON "WorkflowLabelRuleWorkflowLabel" ("workflowLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fb339e964339949134b9fd748a" ON "WorkflowLabelRuleWorkflowLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "WorkflowLabelRuleLabelToAdd" ("workflowLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_83dff229d052e2068f8833df5bf" PRIMARY KEY ("workflowLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1ab375c84961c618a3956791a" ON "WorkflowLabelRuleLabelToAdd" ("workflowLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b40681b9a72ed641ae81d9c60" ON "WorkflowLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOwnerRuleDashboardLabel" ("dashboardOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_29d820ce21dffd5b2f307fe1a74" PRIMARY KEY ("dashboardOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6fada943f6f58da540dead8cc" ON "DashboardOwnerRuleDashboardLabel" ("dashboardOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f1e0ad062ae884d77ccd114c9" ON "DashboardOwnerRuleDashboardLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOwnerRuleOwnerUser" ("dashboardOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_dbe21ff7bd3a22b3a9ec7d90c03" PRIMARY KEY ("dashboardOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16c565bf35c5ea335c732d4113" ON "DashboardOwnerRuleOwnerUser" ("dashboardOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_535c2a96c6cdb3e502327cabbd" ON "DashboardOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardOwnerRuleOwnerTeam" ("dashboardOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_a49c3fbfd08f27a828c19cffebc" PRIMARY KEY ("dashboardOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09ae257842df65933371722b92" ON "DashboardOwnerRuleOwnerTeam" ("dashboardOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c60c1154a8bf2c91cf1e25e47" ON "DashboardOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardLabelRuleDashboardLabel" ("dashboardLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fb1fbe60cd1319f41a39dbd8c3c" PRIMARY KEY ("dashboardLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7d83b51bb0b57b839a35f4a31e" ON "DashboardLabelRuleDashboardLabel" ("dashboardLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_024be613483bf9f4fded55239d" ON "DashboardLabelRuleDashboardLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DashboardLabelRuleLabelToAdd" ("dashboardLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_a47e4cfc20062e55f786550b141" PRIMARY KEY ("dashboardLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eed4236756106080de1efe6282" ON "DashboardLabelRuleLabelToAdd" ("dashboardLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_11afe33ebc81ffed8f90f53578" ON "DashboardLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" ADD CONSTRAINT "FK_871882dbca524033a2396430e52" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" ADD CONSTRAINT "FK_eb7ac3ccfda519d0df5463dda43" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" ADD CONSTRAINT "FK_2df87085cb6c05a5c1b85161e06" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" ADD CONSTRAINT "FK_f8615cb68c46e2a90d633e0b368" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" ADD CONSTRAINT "FK_6588722ba3dda9854e9ae0bd4f4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" ADD CONSTRAINT "FK_101c8b1584b592500f67d710ccd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" ADD CONSTRAINT "FK_4b3fdf6fb49abcd908876a2f7ac" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" ADD CONSTRAINT "FK_921ac246c65ba87c849ca8a4758" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" ADD CONSTRAINT "FK_df6b7ef9ddbd17ac95caaeacaf9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" ADD CONSTRAINT "FK_045276dc23bdd65baeeda958cd0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" ADD CONSTRAINT "FK_d6b943913369b148f5e9e0145f0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" ADD CONSTRAINT "FK_c02b0d7a2ff0a6d687e1520d004" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" ADD CONSTRAINT "FK_6dacbb20e65a8a0377a30e083ba" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" ADD CONSTRAINT "FK_52f373ce99708b46c1f97a77e10" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" ADD CONSTRAINT "FK_f182edbed7ba5948936aeece8ee" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" ADD CONSTRAINT "FK_ee907a85eff5856d4ad7e30bd46" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" ADD CONSTRAINT "FK_ea9c99497430ee2e7956bf0c773" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" ADD CONSTRAINT "FK_e5fdc2ca4c8c58a6485c6cef792" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" ADD CONSTRAINT "FK_3f73b652811cc2aa06817c3db0f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" ADD CONSTRAINT "FK_62bf3c97873ea1ad7edb7c96293" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" ADD CONSTRAINT "FK_1075c742fa21007a25047f5c7d2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" ADD CONSTRAINT "FK_386981e97b72208e1cff3bdcc81" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" ADD CONSTRAINT "FK_ddbc5ca0f08593a7afa6a27be83" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" ADD CONSTRAINT "FK_4cad95dd9b18509d562699d5414" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" ADD CONSTRAINT "FK_53aece038f89715e4993a0b5cb9" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" ADD CONSTRAINT "FK_04b6ec69101372e104d920baeef" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" ADD CONSTRAINT "FK_49f6e71620ab5ab9cf138ae25a7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" ADD CONSTRAINT "FK_1262bccf00f26b3017f30fa579c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" ADD CONSTRAINT "FK_ec0ede4274fdba73f6875a164d9" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" ADD CONSTRAINT "FK_c34de34210a7892aab888c43585" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" ADD CONSTRAINT "FK_41b50e7dfa7c5c243d882361619" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" ADD CONSTRAINT "FK_1ec547ff8399c042df80305cb10" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleWorkflowLabel" ADD CONSTRAINT "FK_fecd531b175d7ae1c6ba8efbae2" FOREIGN KEY ("workflowOwnerRuleId") REFERENCES "WorkflowOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleWorkflowLabel" ADD CONSTRAINT "FK_1e839ca656e4f0fcef89f0d23cf" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerUser" ADD CONSTRAINT "FK_5b828e74878f924763206954f8e" FOREIGN KEY ("workflowOwnerRuleId") REFERENCES "WorkflowOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerUser" ADD CONSTRAINT "FK_dbd5a34dce9b4827abec7ca5af5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_743240fe68c8225948cc257f419" FOREIGN KEY ("workflowOwnerRuleId") REFERENCES "WorkflowOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_bf0d139514008245c2514693a0a" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleWorkflowLabel" ADD CONSTRAINT "FK_ca547aeba41e13cf39f58603139" FOREIGN KEY ("workflowLabelRuleId") REFERENCES "WorkflowLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleWorkflowLabel" ADD CONSTRAINT "FK_fb339e964339949134b9fd748a3" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleLabelToAdd" ADD CONSTRAINT "FK_c1ab375c84961c618a3956791ad" FOREIGN KEY ("workflowLabelRuleId") REFERENCES "WorkflowLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleLabelToAdd" ADD CONSTRAINT "FK_8b40681b9a72ed641ae81d9c609" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleDashboardLabel" ADD CONSTRAINT "FK_a6fada943f6f58da540dead8cce" FOREIGN KEY ("dashboardOwnerRuleId") REFERENCES "DashboardOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleDashboardLabel" ADD CONSTRAINT "FK_2f1e0ad062ae884d77ccd114c96" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerUser" ADD CONSTRAINT "FK_16c565bf35c5ea335c732d41133" FOREIGN KEY ("dashboardOwnerRuleId") REFERENCES "DashboardOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerUser" ADD CONSTRAINT "FK_535c2a96c6cdb3e502327cabbd7" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_09ae257842df65933371722b92d" FOREIGN KEY ("dashboardOwnerRuleId") REFERENCES "DashboardOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_6c60c1154a8bf2c91cf1e25e475" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleDashboardLabel" ADD CONSTRAINT "FK_7d83b51bb0b57b839a35f4a31eb" FOREIGN KEY ("dashboardLabelRuleId") REFERENCES "DashboardLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleDashboardLabel" ADD CONSTRAINT "FK_024be613483bf9f4fded55239dd" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleLabelToAdd" ADD CONSTRAINT "FK_eed4236756106080de1efe6282f" FOREIGN KEY ("dashboardLabelRuleId") REFERENCES "DashboardLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleLabelToAdd" ADD CONSTRAINT "FK_11afe33ebc81ffed8f90f535788" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleLabelToAdd" DROP CONSTRAINT "FK_11afe33ebc81ffed8f90f535788"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleLabelToAdd" DROP CONSTRAINT "FK_eed4236756106080de1efe6282f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleDashboardLabel" DROP CONSTRAINT "FK_024be613483bf9f4fded55239dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRuleDashboardLabel" DROP CONSTRAINT "FK_7d83b51bb0b57b839a35f4a31eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_6c60c1154a8bf2c91cf1e25e475"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_09ae257842df65933371722b92d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerUser" DROP CONSTRAINT "FK_535c2a96c6cdb3e502327cabbd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleOwnerUser" DROP CONSTRAINT "FK_16c565bf35c5ea335c732d41133"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleDashboardLabel" DROP CONSTRAINT "FK_2f1e0ad062ae884d77ccd114c96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRuleDashboardLabel" DROP CONSTRAINT "FK_a6fada943f6f58da540dead8cce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleLabelToAdd" DROP CONSTRAINT "FK_8b40681b9a72ed641ae81d9c609"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleLabelToAdd" DROP CONSTRAINT "FK_c1ab375c84961c618a3956791ad"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleWorkflowLabel" DROP CONSTRAINT "FK_fb339e964339949134b9fd748a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRuleWorkflowLabel" DROP CONSTRAINT "FK_ca547aeba41e13cf39f58603139"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_bf0d139514008245c2514693a0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_743240fe68c8225948cc257f419"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerUser" DROP CONSTRAINT "FK_dbd5a34dce9b4827abec7ca5af5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleOwnerUser" DROP CONSTRAINT "FK_5b828e74878f924763206954f8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleWorkflowLabel" DROP CONSTRAINT "FK_1e839ca656e4f0fcef89f0d23cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRuleWorkflowLabel" DROP CONSTRAINT "FK_fecd531b175d7ae1c6ba8efbae2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" DROP CONSTRAINT "FK_1ec547ff8399c042df80305cb10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" DROP CONSTRAINT "FK_41b50e7dfa7c5c243d882361619"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" DROP CONSTRAINT "FK_c34de34210a7892aab888c43585"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" DROP CONSTRAINT "FK_ec0ede4274fdba73f6875a164d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerUser" DROP CONSTRAINT "FK_1262bccf00f26b3017f30fa579c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" DROP CONSTRAINT "FK_49f6e71620ab5ab9cf138ae25a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" DROP CONSTRAINT "FK_04b6ec69101372e104d920baeef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" DROP CONSTRAINT "FK_53aece038f89715e4993a0b5cb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" DROP CONSTRAINT "FK_4cad95dd9b18509d562699d5414"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerTeam" DROP CONSTRAINT "FK_ddbc5ca0f08593a7afa6a27be83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" DROP CONSTRAINT "FK_386981e97b72208e1cff3bdcc81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" DROP CONSTRAINT "FK_1075c742fa21007a25047f5c7d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardLabelRule" DROP CONSTRAINT "FK_62bf3c97873ea1ad7edb7c96293"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" DROP CONSTRAINT "FK_3f73b652811cc2aa06817c3db0f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" DROP CONSTRAINT "FK_e5fdc2ca4c8c58a6485c6cef792"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DashboardOwnerRule" DROP CONSTRAINT "FK_ea9c99497430ee2e7956bf0c773"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" DROP CONSTRAINT "FK_ee907a85eff5856d4ad7e30bd46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" DROP CONSTRAINT "FK_f182edbed7ba5948936aeece8ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowLabelRule" DROP CONSTRAINT "FK_52f373ce99708b46c1f97a77e10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" DROP CONSTRAINT "FK_6dacbb20e65a8a0377a30e083ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" DROP CONSTRAINT "FK_c02b0d7a2ff0a6d687e1520d004"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerRule" DROP CONSTRAINT "FK_d6b943913369b148f5e9e0145f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" DROP CONSTRAINT "FK_045276dc23bdd65baeeda958cd0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" DROP CONSTRAINT "FK_df6b7ef9ddbd17ac95caaeacaf9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" DROP CONSTRAINT "FK_921ac246c65ba87c849ca8a4758"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" DROP CONSTRAINT "FK_4b3fdf6fb49abcd908876a2f7ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerUser" DROP CONSTRAINT "FK_101c8b1584b592500f67d710ccd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" DROP CONSTRAINT "FK_6588722ba3dda9854e9ae0bd4f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" DROP CONSTRAINT "FK_f8615cb68c46e2a90d633e0b368"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" DROP CONSTRAINT "FK_2df87085cb6c05a5c1b85161e06"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" DROP CONSTRAINT "FK_eb7ac3ccfda519d0df5463dda43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowOwnerTeam" DROP CONSTRAINT "FK_871882dbca524033a2396430e52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11afe33ebc81ffed8f90f53578"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eed4236756106080de1efe6282"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_024be613483bf9f4fded55239d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d83b51bb0b57b839a35f4a31e"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardLabelRuleDashboardLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c60c1154a8bf2c91cf1e25e47"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09ae257842df65933371722b92"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_535c2a96c6cdb3e502327cabbd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16c565bf35c5ea335c732d4113"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f1e0ad062ae884d77ccd114c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6fada943f6f58da540dead8cc"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOwnerRuleDashboardLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b40681b9a72ed641ae81d9c60"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1ab375c84961c618a3956791a"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb339e964339949134b9fd748a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca547aeba41e13cf39f5860313"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowLabelRuleWorkflowLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf0d139514008245c2514693a0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_743240fe68c8225948cc257f41"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dbd5a34dce9b4827abec7ca5af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b828e74878f924763206954f8"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e839ca656e4f0fcef89f0d23c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fecd531b175d7ae1c6ba8efbae"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowOwnerRuleWorkflowLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a02ec21317c3701dbab53e43d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d23310c27f3e64d1f82bd7196"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c34de34210a7892aab888c4358"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ec0ede4274fdba73f6875a164d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1262bccf00f26b3017f30fa579"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4fd29eeca8c655246fc86e6ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_102eda151971dba13aa42d128d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53aece038f89715e4993a0b5cb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cad95dd9b18509d562699d541"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ddbc5ca0f08593a7afa6a27be8"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc718602e1ff326830b1f057ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c7de5cbf2fa965b0008af8692"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62bf3c97873ea1ad7edb7c9629"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80addc7b91c742cb52c8b46a3d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9797b37a248be24a2259de54e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea9c99497430ee2e7956bf0c77"`,
    );
    await queryRunner.query(`DROP TABLE "DashboardOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d7a56bbd9915faf1ae2926b18"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6de5755424a890b8696aebf3a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52f373ce99708b46c1f97a77e1"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43f822b7a886407fc92d14adff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7402311b70a2ddac205e35c24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6b943913369b148f5e9e0145f"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a2480665e9ab79bef464a8c57"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ddc135a660bd538dc47a7c9f0d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_921ac246c65ba87c849ca8a475"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b3fdf6fb49abcd908876a2f7a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_101c8b1584b592500f67d710cc"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23cb5a85c555d015abb14021bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_064b57caa633a318690aa2472d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2df87085cb6c05a5c1b85161e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb7ac3ccfda519d0df5463dda4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_871882dbca524033a2396430e5"`,
    );
    await queryRunner.query(`DROP TABLE "WorkflowOwnerTeam"`);
  }
}
