import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOnCallIncomingCallOwnersAndRules1778931537020
  implements MigrationInterface
{
  public name: string = "AddOnCallIncomingCallOwnersAndRules1778931537020";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "onCallDutyPolicyNamePattern" character varying(500), "onCallDutyPolicyDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6b87d4face3cc6300983e7f2aee" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c13f9c89862d2435284cd529e7" ON "OnCallDutyPolicyLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_779b43c1bc73a14112186eea09" ON "OnCallDutyPolicyLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6c3f83a345cada88f168161d9" ON "OnCallDutyPolicyLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "onCallDutyPolicyNamePattern" character varying(500), "onCallDutyPolicyDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_7af2780683585fbf1006d17e50a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_887dd174f736dc0900125b3dcf" ON "OnCallDutyPolicyOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27148c75f1b13012fe294afa83" ON "OnCallDutyPolicyOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc04325a13bfdf1ef9127314ba" ON "OnCallDutyPolicyOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyScheduleLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "onCallDutyPolicyScheduleNamePattern" character varying(500), "onCallDutyPolicyScheduleDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_44695d580f26f3cb39fba292639" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e24541c872745c2e991a52d4ec" ON "OnCallDutyPolicyScheduleLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f204b546c0b15e7d5894a3e3ca" ON "OnCallDutyPolicyScheduleLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88c507e6455dae4eb34edda106" ON "OnCallDutyPolicyScheduleLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyScheduleOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "onCallDutyPolicyScheduleNamePattern" character varying(500), "onCallDutyPolicyScheduleDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0a6d36aae8108f3667b7c16ea79" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f65dbe540a0b506068bc49fcd" ON "OnCallDutyPolicyScheduleOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66937bbedc0fa29ffd8e39f060" ON "OnCallDutyPolicyScheduleOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10409145a49f2d9cdd2c444f38" ON "OnCallDutyPolicyScheduleOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "incomingCallPolicyId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_80243a09bde79cf0846f9f1ac2a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92ed95240adc4375f352207fe0" ON "IncomingCallPolicyOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c49e561ca678966d6157f7de60" ON "IncomingCallPolicyOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_121cbf49517f79210f86208b1a" ON "IncomingCallPolicyOwnerTeam" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f60acc09ea4254150619325bb2" ON "IncomingCallPolicyOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c8d9da5d5cd959c953094653b" ON "IncomingCallPolicyOwnerTeam" ("incomingCallPolicyId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "incomingCallPolicyId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_bb66497194a3d581d0e4cba1320" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0dc11a31877253119f7bce687c" ON "IncomingCallPolicyOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed4f1087b99be0c18cc5d01f55" ON "IncomingCallPolicyOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a065bd2b37aa1faecba0ca73b" ON "IncomingCallPolicyOwnerUser" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f76dc556327c2bd2f2b322db6" ON "IncomingCallPolicyOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f9eff007b40602f856803c50a" ON "IncomingCallPolicyOwnerUser" ("incomingCallPolicyId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "incomingCallPolicyNamePattern" character varying(500), "incomingCallPolicyDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_843a7416aaa9248462785321333" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3786405419c8ceff2979e7c24c" ON "IncomingCallPolicyLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8972449d3628be4a40e4d03367" ON "IncomingCallPolicyLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4107c612098748f2693f4ceb6d" ON "IncomingCallPolicyLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "incomingCallPolicyNamePattern" character varying(500), "incomingCallPolicyDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_773365e894ceed1895594fdb649" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c0aa83f0814f7862fc66a1548" ON "IncomingCallPolicyOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d461dd731949993e9b1cabd3a" ON "IncomingCallPolicyOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c418a008e8010dab24cf35589" ON "IncomingCallPolicyOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyLabelRuleMatchLabel" ("onCallDutyPolicyLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ab0c1ca3254fcf370acb16779da" PRIMARY KEY ("onCallDutyPolicyLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2daefd1c831fdfb7d7df0fa04e" ON "OnCallDutyPolicyLabelRuleMatchLabel" ("onCallDutyPolicyLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7548f083e28758b6b844efd62e" ON "OnCallDutyPolicyLabelRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyLabelRuleLabelToAdd" ("onCallDutyPolicyLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fc3ca052e775f21c76e91a84439" PRIMARY KEY ("onCallDutyPolicyLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad322c59e1f11e4a0501754066" ON "OnCallDutyPolicyLabelRuleLabelToAdd" ("onCallDutyPolicyLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_292f154512bceaf6dfbfc1ef76" ON "OnCallDutyPolicyLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyOwnerRuleMatchLabel" ("onCallDutyPolicyOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_0bd82c6ed08ff2ff06f2b2f84b5" PRIMARY KEY ("onCallDutyPolicyOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_57a588a047270f2741f067d234" ON "OnCallDutyPolicyOwnerRuleMatchLabel" ("onCallDutyPolicyOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7de51c94e7a4711d33db736242" ON "OnCallDutyPolicyOwnerRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyOwnerRuleOwnerUser" ("onCallDutyPolicyOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_6513555346296f8f2920122f0c0" PRIMARY KEY ("onCallDutyPolicyOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f43df184c048e81cd0cda13b5" ON "OnCallDutyPolicyOwnerRuleOwnerUser" ("onCallDutyPolicyOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c167978bc6a37863856dc6bb5b" ON "OnCallDutyPolicyOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyOwnerRuleOwnerTeam" ("onCallDutyPolicyOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_e3ffa9544452350c48cb2ab5fa3" PRIMARY KEY ("onCallDutyPolicyOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66b2e34a2df3c78306d26f40ac" ON "OnCallDutyPolicyOwnerRuleOwnerTeam" ("onCallDutyPolicyOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_809a4d780174310a8003114111" ON "OnCallDutyPolicyOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallScheduleLabelRuleMatchLabel" ("onCallDutyPolicyScheduleLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_290567d51c5cf69392db6273015" PRIMARY KEY ("onCallDutyPolicyScheduleLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b54cc62d3879f130c4b913802b" ON "OnCallScheduleLabelRuleMatchLabel" ("onCallDutyPolicyScheduleLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5aa8af31b1b96b0da221e2d81f" ON "OnCallScheduleLabelRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallScheduleLabelRuleLabelToAdd" ("onCallDutyPolicyScheduleLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_092b9579c7a3df1a60ab0eb0bfb" PRIMARY KEY ("onCallDutyPolicyScheduleLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fffb50f195fea5d8a1e30e544a" ON "OnCallScheduleLabelRuleLabelToAdd" ("onCallDutyPolicyScheduleLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9f13aa851e64e1b6ad7f1322b" ON "OnCallScheduleLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallScheduleOwnerRuleMatchLabel" ("onCallDutyPolicyScheduleOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2868b08ac47805b8f4b163269f7" PRIMARY KEY ("onCallDutyPolicyScheduleOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34d4d1fe30cbe0e8fc7e011db6" ON "OnCallScheduleOwnerRuleMatchLabel" ("onCallDutyPolicyScheduleOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_21eb914c95974a75b58c783a39" ON "OnCallScheduleOwnerRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallScheduleOwnerRuleOwnerUser" ("onCallDutyPolicyScheduleOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_3da2d121f37b56fdfe00c148f0e" PRIMARY KEY ("onCallDutyPolicyScheduleOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c15f3a1a093bb3342e009555c5" ON "OnCallScheduleOwnerRuleOwnerUser" ("onCallDutyPolicyScheduleOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f5be94c01fac8fbd59e9b87ca" ON "OnCallScheduleOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallScheduleOwnerRuleOwnerTeam" ("onCallDutyPolicyScheduleOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_bcf03f0f56bae011d2027c37c69" PRIMARY KEY ("onCallDutyPolicyScheduleOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ec98e2006548e9c1093b9777e" ON "OnCallScheduleOwnerRuleOwnerTeam" ("onCallDutyPolicyScheduleOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f42cc9c12c3eeb2fc642d26abd" ON "OnCallScheduleOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyLabelRuleMatchLabel" ("incomingCallPolicyLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_04415a507d8ed0e208fcbaaf323" PRIMARY KEY ("incomingCallPolicyLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9407961ee89266fda35537d9a" ON "IncomingCallPolicyLabelRuleMatchLabel" ("incomingCallPolicyLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae74c4daaf4c7aad5b2d0cdace" ON "IncomingCallPolicyLabelRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyLabelRuleLabelToAdd" ("incomingCallPolicyLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_20db7004b15d346f2208b8b1b91" PRIMARY KEY ("incomingCallPolicyLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd4e65bdcb1bd0493a15da117f" ON "IncomingCallPolicyLabelRuleLabelToAdd" ("incomingCallPolicyLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb0b353dab7855849329c0ee9a" ON "IncomingCallPolicyLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyOwnerRuleMatchLabel" ("incomingCallPolicyOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_960c371d20309e2f5a0e1a2a2e8" PRIMARY KEY ("incomingCallPolicyOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b80d4dd163d0ad86750afd901" ON "IncomingCallPolicyOwnerRuleMatchLabel" ("incomingCallPolicyOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84dd63900a0b4b182a6734ae65" ON "IncomingCallPolicyOwnerRuleMatchLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyOwnerRuleOwnerUser" ("incomingCallPolicyOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_8e7e77431640b77e5bbb26273d6" PRIMARY KEY ("incomingCallPolicyOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10107e3d41340a14203e942034" ON "IncomingCallPolicyOwnerRuleOwnerUser" ("incomingCallPolicyOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9aa2a0e4282973a4d6904fa1ab" ON "IncomingCallPolicyOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingCallPolicyOwnerRuleOwnerTeam" ("incomingCallPolicyOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_49cf8227eabca67fa376be8b7b0" PRIMARY KEY ("incomingCallPolicyOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_511965c9639cc4a23791674f75" ON "IncomingCallPolicyOwnerRuleOwnerTeam" ("incomingCallPolicyOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4bf36bd0c318e6560fb834780" ON "IncomingCallPolicyOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" ADD CONSTRAINT "FK_c13f9c89862d2435284cd529e7b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" ADD CONSTRAINT "FK_026485afffd940982a5140c2502" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" ADD CONSTRAINT "FK_3b70c936f3f7455e2b46e9f48c4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" ADD CONSTRAINT "FK_887dd174f736dc0900125b3dcfd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" ADD CONSTRAINT "FK_59ef3f3714e01348097f6509dc6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" ADD CONSTRAINT "FK_52e705f1a8378fad04f2602b37c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" ADD CONSTRAINT "FK_e24541c872745c2e991a52d4ec6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" ADD CONSTRAINT "FK_b4de5d4a08a784cdc85effe3397" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" ADD CONSTRAINT "FK_65623d5b6f51da7691c40413c36" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" ADD CONSTRAINT "FK_0f65dbe540a0b506068bc49fcdd" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" ADD CONSTRAINT "FK_a71fa09610eb4232d9060731b4a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" ADD CONSTRAINT "FK_d70ddfa8995c7962aace4c94d81" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" ADD CONSTRAINT "FK_92ed95240adc4375f352207fe01" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" ADD CONSTRAINT "FK_c49e561ca678966d6157f7de60f" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" ADD CONSTRAINT "FK_121cbf49517f79210f86208b1a0" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" ADD CONSTRAINT "FK_9b52c626f1b32841ad7d2371bf8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" ADD CONSTRAINT "FK_26c62a4b3a3b021c16bb591e05a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" ADD CONSTRAINT "FK_0dc11a31877253119f7bce687c2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" ADD CONSTRAINT "FK_ed4f1087b99be0c18cc5d01f551" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" ADD CONSTRAINT "FK_0a065bd2b37aa1faecba0ca73bf" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" ADD CONSTRAINT "FK_ee7b5d75c6267e6e2fe7284378f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" ADD CONSTRAINT "FK_a0c5ee02ba551bcaf053be02d96" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" ADD CONSTRAINT "FK_3786405419c8ceff2979e7c24c9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" ADD CONSTRAINT "FK_94ffbff72f68b683f7bf5a79642" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" ADD CONSTRAINT "FK_8913f50c9388167305b9a5475cf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" ADD CONSTRAINT "FK_3c0aa83f0814f7862fc66a1548d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" ADD CONSTRAINT "FK_974496d0995af3111a7be0ae233" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" ADD CONSTRAINT "FK_572565b3e381aded9007e22cae4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleMatchLabel" ADD CONSTRAINT "FK_2daefd1c831fdfb7d7df0fa04ee" FOREIGN KEY ("onCallDutyPolicyLabelRuleId") REFERENCES "OnCallDutyPolicyLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleMatchLabel" ADD CONSTRAINT "FK_7548f083e28758b6b844efd62e3" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleLabelToAdd" ADD CONSTRAINT "FK_ad322c59e1f11e4a0501754066e" FOREIGN KEY ("onCallDutyPolicyLabelRuleId") REFERENCES "OnCallDutyPolicyLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleLabelToAdd" ADD CONSTRAINT "FK_292f154512bceaf6dfbfc1ef76e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleMatchLabel" ADD CONSTRAINT "FK_57a588a047270f2741f067d2341" FOREIGN KEY ("onCallDutyPolicyOwnerRuleId") REFERENCES "OnCallDutyPolicyOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleMatchLabel" ADD CONSTRAINT "FK_7de51c94e7a4711d33db736242e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerUser" ADD CONSTRAINT "FK_2f43df184c048e81cd0cda13b5c" FOREIGN KEY ("onCallDutyPolicyOwnerRuleId") REFERENCES "OnCallDutyPolicyOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerUser" ADD CONSTRAINT "FK_c167978bc6a37863856dc6bb5b6" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_66b2e34a2df3c78306d26f40ac8" FOREIGN KEY ("onCallDutyPolicyOwnerRuleId") REFERENCES "OnCallDutyPolicyOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_809a4d780174310a80031141110" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleMatchLabel" ADD CONSTRAINT "FK_b54cc62d3879f130c4b913802bd" FOREIGN KEY ("onCallDutyPolicyScheduleLabelRuleId") REFERENCES "OnCallDutyPolicyScheduleLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleMatchLabel" ADD CONSTRAINT "FK_5aa8af31b1b96b0da221e2d81ff" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleLabelToAdd" ADD CONSTRAINT "FK_fffb50f195fea5d8a1e30e544a6" FOREIGN KEY ("onCallDutyPolicyScheduleLabelRuleId") REFERENCES "OnCallDutyPolicyScheduleLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleLabelToAdd" ADD CONSTRAINT "FK_c9f13aa851e64e1b6ad7f1322b4" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleMatchLabel" ADD CONSTRAINT "FK_34d4d1fe30cbe0e8fc7e011db62" FOREIGN KEY ("onCallDutyPolicyScheduleOwnerRuleId") REFERENCES "OnCallDutyPolicyScheduleOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleMatchLabel" ADD CONSTRAINT "FK_21eb914c95974a75b58c783a39e" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerUser" ADD CONSTRAINT "FK_c15f3a1a093bb3342e009555c52" FOREIGN KEY ("onCallDutyPolicyScheduleOwnerRuleId") REFERENCES "OnCallDutyPolicyScheduleOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerUser" ADD CONSTRAINT "FK_1f5be94c01fac8fbd59e9b87ca3" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_6ec98e2006548e9c1093b9777e4" FOREIGN KEY ("onCallDutyPolicyScheduleOwnerRuleId") REFERENCES "OnCallDutyPolicyScheduleOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_f42cc9c12c3eeb2fc642d26abda" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleMatchLabel" ADD CONSTRAINT "FK_d9407961ee89266fda35537d9a9" FOREIGN KEY ("incomingCallPolicyLabelRuleId") REFERENCES "IncomingCallPolicyLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleMatchLabel" ADD CONSTRAINT "FK_ae74c4daaf4c7aad5b2d0cdace7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleLabelToAdd" ADD CONSTRAINT "FK_bd4e65bdcb1bd0493a15da117f1" FOREIGN KEY ("incomingCallPolicyLabelRuleId") REFERENCES "IncomingCallPolicyLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleLabelToAdd" ADD CONSTRAINT "FK_bb0b353dab7855849329c0ee9aa" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleMatchLabel" ADD CONSTRAINT "FK_6b80d4dd163d0ad86750afd9010" FOREIGN KEY ("incomingCallPolicyOwnerRuleId") REFERENCES "IncomingCallPolicyOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleMatchLabel" ADD CONSTRAINT "FK_84dd63900a0b4b182a6734ae65c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerUser" ADD CONSTRAINT "FK_10107e3d41340a14203e9420343" FOREIGN KEY ("incomingCallPolicyOwnerRuleId") REFERENCES "IncomingCallPolicyOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerUser" ADD CONSTRAINT "FK_9aa2a0e4282973a4d6904fa1ab5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_511965c9639cc4a23791674f756" FOREIGN KEY ("incomingCallPolicyOwnerRuleId") REFERENCES "IncomingCallPolicyOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_a4bf36bd0c318e6560fb8347801" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_a4bf36bd0c318e6560fb8347801"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_511965c9639cc4a23791674f756"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerUser" DROP CONSTRAINT "FK_9aa2a0e4282973a4d6904fa1ab5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleOwnerUser" DROP CONSTRAINT "FK_10107e3d41340a14203e9420343"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleMatchLabel" DROP CONSTRAINT "FK_84dd63900a0b4b182a6734ae65c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRuleMatchLabel" DROP CONSTRAINT "FK_6b80d4dd163d0ad86750afd9010"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleLabelToAdd" DROP CONSTRAINT "FK_bb0b353dab7855849329c0ee9aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleLabelToAdd" DROP CONSTRAINT "FK_bd4e65bdcb1bd0493a15da117f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleMatchLabel" DROP CONSTRAINT "FK_ae74c4daaf4c7aad5b2d0cdace7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRuleMatchLabel" DROP CONSTRAINT "FK_d9407961ee89266fda35537d9a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_f42cc9c12c3eeb2fc642d26abda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_6ec98e2006548e9c1093b9777e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerUser" DROP CONSTRAINT "FK_1f5be94c01fac8fbd59e9b87ca3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleOwnerUser" DROP CONSTRAINT "FK_c15f3a1a093bb3342e009555c52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleMatchLabel" DROP CONSTRAINT "FK_21eb914c95974a75b58c783a39e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleOwnerRuleMatchLabel" DROP CONSTRAINT "FK_34d4d1fe30cbe0e8fc7e011db62"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleLabelToAdd" DROP CONSTRAINT "FK_c9f13aa851e64e1b6ad7f1322b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleLabelToAdd" DROP CONSTRAINT "FK_fffb50f195fea5d8a1e30e544a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleMatchLabel" DROP CONSTRAINT "FK_5aa8af31b1b96b0da221e2d81ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallScheduleLabelRuleMatchLabel" DROP CONSTRAINT "FK_b54cc62d3879f130c4b913802bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_809a4d780174310a80031141110"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_66b2e34a2df3c78306d26f40ac8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerUser" DROP CONSTRAINT "FK_c167978bc6a37863856dc6bb5b6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleOwnerUser" DROP CONSTRAINT "FK_2f43df184c048e81cd0cda13b5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleMatchLabel" DROP CONSTRAINT "FK_7de51c94e7a4711d33db736242e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRuleMatchLabel" DROP CONSTRAINT "FK_57a588a047270f2741f067d2341"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleLabelToAdd" DROP CONSTRAINT "FK_292f154512bceaf6dfbfc1ef76e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleLabelToAdd" DROP CONSTRAINT "FK_ad322c59e1f11e4a0501754066e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleMatchLabel" DROP CONSTRAINT "FK_7548f083e28758b6b844efd62e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRuleMatchLabel" DROP CONSTRAINT "FK_2daefd1c831fdfb7d7df0fa04ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" DROP CONSTRAINT "FK_572565b3e381aded9007e22cae4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" DROP CONSTRAINT "FK_974496d0995af3111a7be0ae233"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerRule" DROP CONSTRAINT "FK_3c0aa83f0814f7862fc66a1548d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" DROP CONSTRAINT "FK_8913f50c9388167305b9a5475cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" DROP CONSTRAINT "FK_94ffbff72f68b683f7bf5a79642"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabelRule" DROP CONSTRAINT "FK_3786405419c8ceff2979e7c24c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" DROP CONSTRAINT "FK_a0c5ee02ba551bcaf053be02d96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" DROP CONSTRAINT "FK_ee7b5d75c6267e6e2fe7284378f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" DROP CONSTRAINT "FK_0a065bd2b37aa1faecba0ca73bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" DROP CONSTRAINT "FK_ed4f1087b99be0c18cc5d01f551"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerUser" DROP CONSTRAINT "FK_0dc11a31877253119f7bce687c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" DROP CONSTRAINT "FK_26c62a4b3a3b021c16bb591e05a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" DROP CONSTRAINT "FK_9b52c626f1b32841ad7d2371bf8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" DROP CONSTRAINT "FK_121cbf49517f79210f86208b1a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" DROP CONSTRAINT "FK_c49e561ca678966d6157f7de60f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyOwnerTeam" DROP CONSTRAINT "FK_92ed95240adc4375f352207fe01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" DROP CONSTRAINT "FK_d70ddfa8995c7962aace4c94d81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" DROP CONSTRAINT "FK_a71fa09610eb4232d9060731b4a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerRule" DROP CONSTRAINT "FK_0f65dbe540a0b506068bc49fcdd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" DROP CONSTRAINT "FK_65623d5b6f51da7691c40413c36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" DROP CONSTRAINT "FK_b4de5d4a08a784cdc85effe3397"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLabelRule" DROP CONSTRAINT "FK_e24541c872745c2e991a52d4ec6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" DROP CONSTRAINT "FK_52e705f1a8378fad04f2602b37c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" DROP CONSTRAINT "FK_59ef3f3714e01348097f6509dc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyOwnerRule" DROP CONSTRAINT "FK_887dd174f736dc0900125b3dcfd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" DROP CONSTRAINT "FK_3b70c936f3f7455e2b46e9f48c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" DROP CONSTRAINT "FK_026485afffd940982a5140c2502"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyLabelRule" DROP CONSTRAINT "FK_c13f9c89862d2435284cd529e7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4bf36bd0c318e6560fb834780"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_511965c9639cc4a23791674f75"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncomingCallPolicyOwnerRuleOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9aa2a0e4282973a4d6904fa1ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10107e3d41340a14203e942034"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncomingCallPolicyOwnerRuleOwnerUser"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84dd63900a0b4b182a6734ae65"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b80d4dd163d0ad86750afd901"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncomingCallPolicyOwnerRuleMatchLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb0b353dab7855849329c0ee9a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd4e65bdcb1bd0493a15da117f"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncomingCallPolicyLabelRuleLabelToAdd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae74c4daaf4c7aad5b2d0cdace"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9407961ee89266fda35537d9a"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncomingCallPolicyLabelRuleMatchLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f42cc9c12c3eeb2fc642d26abd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ec98e2006548e9c1093b9777e"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallScheduleOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f5be94c01fac8fbd59e9b87ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c15f3a1a093bb3342e009555c5"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallScheduleOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_21eb914c95974a75b58c783a39"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34d4d1fe30cbe0e8fc7e011db6"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallScheduleOwnerRuleMatchLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9f13aa851e64e1b6ad7f1322b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fffb50f195fea5d8a1e30e544a"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallScheduleLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5aa8af31b1b96b0da221e2d81f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b54cc62d3879f130c4b913802b"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallScheduleLabelRuleMatchLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_809a4d780174310a8003114111"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66b2e34a2df3c78306d26f40ac"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c167978bc6a37863856dc6bb5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f43df184c048e81cd0cda13b5"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7de51c94e7a4711d33db736242"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_57a588a047270f2741f067d234"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyOwnerRuleMatchLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_292f154512bceaf6dfbfc1ef76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad322c59e1f11e4a0501754066"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7548f083e28758b6b844efd62e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2daefd1c831fdfb7d7df0fa04e"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyLabelRuleMatchLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c418a008e8010dab24cf35589"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d461dd731949993e9b1cabd3a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c0aa83f0814f7862fc66a1548"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingCallPolicyOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4107c612098748f2693f4ceb6d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8972449d3628be4a40e4d03367"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3786405419c8ceff2979e7c24c"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingCallPolicyLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f9eff007b40602f856803c50a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f76dc556327c2bd2f2b322db6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a065bd2b37aa1faecba0ca73b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed4f1087b99be0c18cc5d01f55"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0dc11a31877253119f7bce687c"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingCallPolicyOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c8d9da5d5cd959c953094653b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f60acc09ea4254150619325bb2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_121cbf49517f79210f86208b1a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c49e561ca678966d6157f7de60"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92ed95240adc4375f352207fe0"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingCallPolicyOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10409145a49f2d9cdd2c444f38"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66937bbedc0fa29ffd8e39f060"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f65dbe540a0b506068bc49fcd"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyScheduleOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88c507e6455dae4eb34edda106"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f204b546c0b15e7d5894a3e3ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e24541c872745c2e991a52d4ec"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyScheduleLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc04325a13bfdf1ef9127314ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27148c75f1b13012fe294afa83"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_887dd174f736dc0900125b3dcf"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6c3f83a345cada88f168161d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_779b43c1bc73a14112186eea09"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c13f9c89862d2435284cd529e7"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyLabelRule"`);
  }
}
