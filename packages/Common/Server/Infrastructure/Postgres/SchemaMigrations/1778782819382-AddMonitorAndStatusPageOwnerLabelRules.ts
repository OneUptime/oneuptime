import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778782819382 implements MigrationInterface {
  public name = "MigrationName1778782819382";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_d3ac225503fd5c6285fb7421462" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ad4d22a03eafb53fe6cfef125" ON "MonitorOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7124d1f0d8835e3416bf03f3ae" ON "MonitorOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d383f48937863423640937f386" ON "MonitorOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_42cb885fc9817b28c9ec8fc3800" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ca780e039b82a0c942688233e" ON "MonitorLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78da6142a4115152abaa9c5828" ON "MonitorLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d75ec1a787580a74aadacd0429" ON "MonitorLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "statusPageNamePattern" character varying(500), "statusPageDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_43ee65ded9e9282d5de6c011414" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0025e7fe1f9de6e86818bf8f7" ON "StatusPageOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a1d6e5108a7d16f941e271c31" ON "StatusPageOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9283721b39d0401bd033cc200" ON "StatusPageOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "statusPageNamePattern" character varying(500), "statusPageDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cc82c8144285944d28407d1a060" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6c900d7dcead2d3041e8eef85" ON "StatusPageLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e40f65dfb5b6e50cdc47dc4ba" ON "StatusPageLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1123215b3e46da3c2537aa8de9" ON "StatusPageLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorOwnerRuleMonitorLabel" ("monitorOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_0bc521c514fff822cede41b937d" PRIMARY KEY ("monitorOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2dc623cd66e54c84eba1b2621" ON "MonitorOwnerRuleMonitorLabel" ("monitorOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de3242932121580ecd7c90c447" ON "MonitorOwnerRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorOwnerRuleOwnerUser" ("monitorOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_ff2f90e551d7d7f2172d8d42bee" PRIMARY KEY ("monitorOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d2e540ac44ccbfd30fe54ebf9" ON "MonitorOwnerRuleOwnerUser" ("monitorOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bee1b327cb0255e00e6c28c27" ON "MonitorOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorOwnerRuleOwnerTeam" ("monitorOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_f7307f98969dbbe4108d7671ec1" PRIMARY KEY ("monitorOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e310644b2fe97b4d8bc95cdc82" ON "MonitorOwnerRuleOwnerTeam" ("monitorOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98f96a844f7c7d84e6c59d82b7" ON "MonitorOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorLabelRuleMonitorLabel" ("monitorLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8c8039e372757a3f34fe8c2b0b3" PRIMARY KEY ("monitorLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_359fee069a5cb9f4403dc3f6ac" ON "MonitorLabelRuleMonitorLabel" ("monitorLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c7287fb7c0a95beac247898b1" ON "MonitorLabelRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorLabelRuleLabelToAdd" ("monitorLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_4d6dcf0bd188b879a3184043e65" PRIMARY KEY ("monitorLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9b7b840ff2902874a480391ee" ON "MonitorLabelRuleLabelToAdd" ("monitorLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b80230822e1de0857170731b5" ON "MonitorLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageOwnerRuleStatusPageLabel" ("statusPageOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_30b86e410bdb22a4360726cb6c8" PRIMARY KEY ("statusPageOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f1f5be18dd08f9e37a8fc68c5" ON "StatusPageOwnerRuleStatusPageLabel" ("statusPageOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b79f3bea87eb215b7da64711dd" ON "StatusPageOwnerRuleStatusPageLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageOwnerRuleOwnerUser" ("statusPageOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_d7f66070546ef193e3b61e6e6d4" PRIMARY KEY ("statusPageOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a28e99ce8b7a718a2b0e6937cc" ON "StatusPageOwnerRuleOwnerUser" ("statusPageOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c18835950cb2291123311fab8f" ON "StatusPageOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageOwnerRuleOwnerTeam" ("statusPageOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_e0a48488dbab5410f4a481001f5" PRIMARY KEY ("statusPageOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f36413c4792e409c9dd8be8561" ON "StatusPageOwnerRuleOwnerTeam" ("statusPageOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7481d288a59e1729dfd46afcff" ON "StatusPageOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageLabelRuleStatusPageLabel" ("statusPageLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_0b152fa4100d0a6e1b32f800ada" PRIMARY KEY ("statusPageLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a381ddffaf60a6ecd85fad0a0" ON "StatusPageLabelRuleStatusPageLabel" ("statusPageLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01a4489de5facafe92f75f02df" ON "StatusPageLabelRuleStatusPageLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "StatusPageLabelRuleLabelToAdd" ("statusPageLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_a6081ee4be40e6d4811a24640d4" PRIMARY KEY ("statusPageLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42ce3973a7dc95a5748677fae5" ON "StatusPageLabelRuleLabelToAdd" ("statusPageLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_04c36315f5f084f52e72a1e395" ON "StatusPageLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" ADD CONSTRAINT "FK_6ad4d22a03eafb53fe6cfef1254" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" ADD CONSTRAINT "FK_5572b5b7bf3ed17470c8e1497d9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" ADD CONSTRAINT "FK_ccccfaf700bd0cd58325aa336df" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" ADD CONSTRAINT "FK_7ca780e039b82a0c942688233eb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" ADD CONSTRAINT "FK_f5942a435d751907f1522068196" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" ADD CONSTRAINT "FK_37eabfde6982f76314740467bb1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" ADD CONSTRAINT "FK_c0025e7fe1f9de6e86818bf8f7b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" ADD CONSTRAINT "FK_e677abbcb0bf0fd54f967946cce" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" ADD CONSTRAINT "FK_81dd3412c65361ac120b41f3452" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" ADD CONSTRAINT "FK_f6c900d7dcead2d3041e8eef853" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" ADD CONSTRAINT "FK_299aeed4113dc1a66ba02892096" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" ADD CONSTRAINT "FK_98c467998c2183b72e3dd804b8f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_f2dc623cd66e54c84eba1b2621a" FOREIGN KEY ("monitorOwnerRuleId") REFERENCES "MonitorOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_de3242932121580ecd7c90c4471" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerUser" ADD CONSTRAINT "FK_9d2e540ac44ccbfd30fe54ebf9a" FOREIGN KEY ("monitorOwnerRuleId") REFERENCES "MonitorOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerUser" ADD CONSTRAINT "FK_8bee1b327cb0255e00e6c28c273" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_e310644b2fe97b4d8bc95cdc825" FOREIGN KEY ("monitorOwnerRuleId") REFERENCES "MonitorOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_98f96a844f7c7d84e6c59d82b7b" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleMonitorLabel" ADD CONSTRAINT "FK_359fee069a5cb9f4403dc3f6aca" FOREIGN KEY ("monitorLabelRuleId") REFERENCES "MonitorLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleMonitorLabel" ADD CONSTRAINT "FK_6c7287fb7c0a95beac247898b16" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleLabelToAdd" ADD CONSTRAINT "FK_d9b7b840ff2902874a480391ee5" FOREIGN KEY ("monitorLabelRuleId") REFERENCES "MonitorLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleLabelToAdd" ADD CONSTRAINT "FK_8b80230822e1de0857170731b53" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleStatusPageLabel" ADD CONSTRAINT "FK_9f1f5be18dd08f9e37a8fc68c53" FOREIGN KEY ("statusPageOwnerRuleId") REFERENCES "StatusPageOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleStatusPageLabel" ADD CONSTRAINT "FK_b79f3bea87eb215b7da64711dd7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerUser" ADD CONSTRAINT "FK_a28e99ce8b7a718a2b0e6937cc1" FOREIGN KEY ("statusPageOwnerRuleId") REFERENCES "StatusPageOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerUser" ADD CONSTRAINT "FK_c18835950cb2291123311fab8f0" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_f36413c4792e409c9dd8be85610" FOREIGN KEY ("statusPageOwnerRuleId") REFERENCES "StatusPageOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_7481d288a59e1729dfd46afcff4" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleStatusPageLabel" ADD CONSTRAINT "FK_9a381ddffaf60a6ecd85fad0a02" FOREIGN KEY ("statusPageLabelRuleId") REFERENCES "StatusPageLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleStatusPageLabel" ADD CONSTRAINT "FK_01a4489de5facafe92f75f02df9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleLabelToAdd" ADD CONSTRAINT "FK_42ce3973a7dc95a5748677fae55" FOREIGN KEY ("statusPageLabelRuleId") REFERENCES "StatusPageLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleLabelToAdd" ADD CONSTRAINT "FK_04c36315f5f084f52e72a1e3957" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleLabelToAdd" DROP CONSTRAINT "FK_04c36315f5f084f52e72a1e3957"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleLabelToAdd" DROP CONSTRAINT "FK_42ce3973a7dc95a5748677fae55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleStatusPageLabel" DROP CONSTRAINT "FK_01a4489de5facafe92f75f02df9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRuleStatusPageLabel" DROP CONSTRAINT "FK_9a381ddffaf60a6ecd85fad0a02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_7481d288a59e1729dfd46afcff4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_f36413c4792e409c9dd8be85610"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerUser" DROP CONSTRAINT "FK_c18835950cb2291123311fab8f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleOwnerUser" DROP CONSTRAINT "FK_a28e99ce8b7a718a2b0e6937cc1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleStatusPageLabel" DROP CONSTRAINT "FK_b79f3bea87eb215b7da64711dd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRuleStatusPageLabel" DROP CONSTRAINT "FK_9f1f5be18dd08f9e37a8fc68c53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleLabelToAdd" DROP CONSTRAINT "FK_8b80230822e1de0857170731b53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleLabelToAdd" DROP CONSTRAINT "FK_d9b7b840ff2902874a480391ee5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleMonitorLabel" DROP CONSTRAINT "FK_6c7287fb7c0a95beac247898b16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRuleMonitorLabel" DROP CONSTRAINT "FK_359fee069a5cb9f4403dc3f6aca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_98f96a844f7c7d84e6c59d82b7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_e310644b2fe97b4d8bc95cdc825"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerUser" DROP CONSTRAINT "FK_8bee1b327cb0255e00e6c28c273"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleOwnerUser" DROP CONSTRAINT "FK_9d2e540ac44ccbfd30fe54ebf9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_de3242932121580ecd7c90c4471"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_f2dc623cd66e54c84eba1b2621a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" DROP CONSTRAINT "FK_98c467998c2183b72e3dd804b8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" DROP CONSTRAINT "FK_299aeed4113dc1a66ba02892096"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageLabelRule" DROP CONSTRAINT "FK_f6c900d7dcead2d3041e8eef853"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" DROP CONSTRAINT "FK_81dd3412c65361ac120b41f3452"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" DROP CONSTRAINT "FK_e677abbcb0bf0fd54f967946cce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOwnerRule" DROP CONSTRAINT "FK_c0025e7fe1f9de6e86818bf8f7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" DROP CONSTRAINT "FK_37eabfde6982f76314740467bb1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" DROP CONSTRAINT "FK_f5942a435d751907f1522068196"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorLabelRule" DROP CONSTRAINT "FK_7ca780e039b82a0c942688233eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" DROP CONSTRAINT "FK_ccccfaf700bd0cd58325aa336df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" DROP CONSTRAINT "FK_5572b5b7bf3ed17470c8e1497d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorOwnerRule" DROP CONSTRAINT "FK_6ad4d22a03eafb53fe6cfef1254"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_04c36315f5f084f52e72a1e395"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42ce3973a7dc95a5748677fae5"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01a4489de5facafe92f75f02df"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a381ddffaf60a6ecd85fad0a0"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageLabelRuleStatusPageLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7481d288a59e1729dfd46afcff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f36413c4792e409c9dd8be8561"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c18835950cb2291123311fab8f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a28e99ce8b7a718a2b0e6937cc"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b79f3bea87eb215b7da64711dd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f1f5be18dd08f9e37a8fc68c5"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageOwnerRuleStatusPageLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b80230822e1de0857170731b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9b7b840ff2902874a480391ee"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c7287fb7c0a95beac247898b1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_359fee069a5cb9f4403dc3f6ac"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorLabelRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98f96a844f7c7d84e6c59d82b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e310644b2fe97b4d8bc95cdc82"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bee1b327cb0255e00e6c28c27"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d2e540ac44ccbfd30fe54ebf9"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de3242932121580ecd7c90c447"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2dc623cd66e54c84eba1b2621"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorOwnerRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1123215b3e46da3c2537aa8de9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e40f65dfb5b6e50cdc47dc4ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6c900d7dcead2d3041e8eef85"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9283721b39d0401bd033cc200"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a1d6e5108a7d16f941e271c31"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0025e7fe1f9de6e86818bf8f7"`,
    );
    await queryRunner.query(`DROP TABLE "StatusPageOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d75ec1a787580a74aadacd0429"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78da6142a4115152abaa9c5828"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ca780e039b82a0c942688233e"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d383f48937863423640937f386"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7124d1f0d8835e3416bf03f3ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ad4d22a03eafb53fe6cfef125"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorOwnerRule"`);
  }
}
