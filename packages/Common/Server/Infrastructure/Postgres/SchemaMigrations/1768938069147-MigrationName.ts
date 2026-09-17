import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1768938069147 implements MigrationInterface {
  public name = "MigrationName1768938069147";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertGroupingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "priority" integer NOT NULL DEFAULT '1', "isEnabled" boolean NOT NULL DEFAULT true, "matchCriteria" jsonb, "timeWindowMinutes" integer NOT NULL DEFAULT '60', "groupByFields" jsonb, "episodeTitleTemplate" character varying(100), "resolveDelayMinutes" integer NOT NULL DEFAULT '0', "reopenWindowMinutes" integer NOT NULL DEFAULT '0', "inactivityTimeoutMinutes" integer NOT NULL DEFAULT '60', "defaultAssignToUserId" uuid, "defaultAssignToTeamId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_9097eb26247232b9d911f3dc0fd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfb25f386359c3717126ecea1e" ON "AlertGroupingRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b828bfbe2edbffd53213f4c2c4" ON "AlertGroupingRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e493339eed92199a43c5ddebe" ON "AlertGroupingRule" ("priority") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c546da77e04aebb0249d1b1441" ON "AlertGroupingRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a361c35b33d76e4c4d97f27e11" ON "AlertGroupingRule" ("defaultAssignToUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de1e396519c6da05b889a12169" ON "AlertGroupingRule" ("defaultAssignToTeamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisode" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "title" character varying(500) NOT NULL, "description" text, "episodeNumber" integer, "currentAlertStateId" uuid NOT NULL, "alertSeverityId" uuid, "rootCause" text, "lastAlertAddedAt" TIMESTAMP WITH TIME ZONE, "resolvedAt" TIMESTAMP WITH TIME ZONE, "assignedToUserId" uuid, "assignedToTeamId" uuid, "alertGroupingRuleId" uuid, "isOnCallPolicyExecuted" boolean NOT NULL DEFAULT false, "alertCount" integer NOT NULL DEFAULT '0', "isManuallyCreated" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotifiedOfEpisodeCreation" boolean NOT NULL DEFAULT false, "groupingKey" character varying(500), CONSTRAINT "PK_2e22f03c5e8057c1a9e64df8b5f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32bad121c94b4024f2b42c56e6" ON "AlertEpisode" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_609b97c21c0eed3ac245f155d6" ON "AlertEpisode" ("title") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c81dab13dbd1ce1711d05a897f" ON "AlertEpisode" ("episodeNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b98b5bde99d96631ca66c8fd8" ON "AlertEpisode" ("currentAlertStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1707b042f7da296409fc8e6e3c" ON "AlertEpisode" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e761f26e4824f6379f2ebefef3" ON "AlertEpisode" ("lastAlertAddedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5181cb8a1471f0130c771544a" ON "AlertEpisode" ("resolvedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0569ad819089ad1b62e7080b0b" ON "AlertEpisode" ("assignedToUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9dbe80e8446a3082d2904f616" ON "AlertEpisode" ("assignedToTeamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89099729ddded8c275b201a7c9" ON "AlertEpisode" ("alertGroupingRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0bc17e7d0d4e8647ae7ab1f5c" ON "AlertEpisode" ("isOnCallPolicyExecuted") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2fdffde2abde7855a92491482b" ON "AlertEpisode" ("alertCount") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a95ab301f037e626b06af5ea7d" ON "AlertEpisode" ("isManuallyCreated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a4c42288b10fe27e6cd655a0d" ON "AlertEpisode" ("isOwnerNotifiedOfEpisodeCreation") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7daaa2e53985bc52154462b310" ON "AlertEpisode" ("groupingKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeMember" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertEpisodeId" uuid NOT NULL, "alertId" uuid NOT NULL, "addedAt" TIMESTAMP WITH TIME ZONE, "addedBy" character varying(100) NOT NULL DEFAULT 'rule', "addedByUserId" uuid, "matchedRuleId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c6ee6182c79bf8c05f1e95b7721" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96904f3696228eb910379f2331" ON "AlertEpisodeMember" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_331aa5398b81014cf1b3e294ff" ON "AlertEpisodeMember" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69af045b1aad0e7792edf2660b" ON "AlertEpisodeMember" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b437e214ebfc5c9169fa28b73" ON "AlertEpisodeMember" ("addedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_231127e3cfd3caee50d5852e1b" ON "AlertEpisodeMember" ("addedByUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dc51318091c186f2b8122c5428" ON "AlertEpisodeMember" ("matchedRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b95fe8c9396c1e1bcf24a941fd" ON "AlertEpisodeMember" ("alertEpisodeId", "alertId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeStateTimeline" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertEpisodeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "alertStateId" uuid NOT NULL, "isOwnerNotified" boolean NOT NULL DEFAULT false, "stateChangeLog" jsonb, "rootCause" text, "endsAt" TIMESTAMP WITH TIME ZONE, "startsAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_90a60f43a80ed99d649d37718b0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ceb895e071ac6c5692bd0a286" ON "AlertEpisodeStateTimeline" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_375d6f86d0f3e152ddf85daea3" ON "AlertEpisodeStateTimeline" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c787c0bc5a12b94976f28d0a12" ON "AlertEpisodeStateTimeline" ("alertStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc7f8772f2daabc44003ba6550" ON "AlertEpisodeStateTimeline" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5b9ab34c48f20d8f25e5897b3" ON "AlertEpisodeStateTimeline" ("rootCause") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1bd75133c8b3adb6b07af3d26" ON "AlertEpisodeStateTimeline" ("endsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69f8e12370a0309482c3ee8c72" ON "AlertEpisodeStateTimeline" ("startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d3ee6df3f7a160f826732ad4f" ON "AlertEpisodeStateTimeline" ("alertEpisodeId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "alertEpisodeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_188167880144883dfbea50f0234" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41ba6bc50ab371af8ce95adf20" ON "AlertEpisodeOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc00e04c42fa14e8a6a0ee9fb6" ON "AlertEpisodeOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_800af5b4ac2180cc4ade32718c" ON "AlertEpisodeOwnerUser" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_642bd8ead91eb90278a5356728" ON "AlertEpisodeOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79c03a537d5c1f4dbeb8beb355" ON "AlertEpisodeOwnerUser" ("alertEpisodeId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "alertEpisodeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_2239fecae595100af93eec3cec0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_143813e802d4b01c0ad70cf5db" ON "AlertEpisodeOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f50385bf56d90ec19e26becd1c" ON "AlertEpisodeOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_818a93df19196a047511267990" ON "AlertEpisodeOwnerTeam" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da4932e36b0d598f4f1bd8fa5b" ON "AlertEpisodeOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74c82db90ec03c884ba9da813a" ON "AlertEpisodeOwnerTeam" ("alertEpisodeId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeInternalNote" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertEpisodeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "note" text NOT NULL, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_3bc6cc2267abc203d9e85ad2602" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02013c0e8b919622f79183ee28" ON "AlertEpisodeInternalNote" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac812fdc779677403928a936c9" ON "AlertEpisodeInternalNote" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a0c81b3e3e570221c5253bc14" ON "AlertEpisodeInternalNote" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertEpisodeId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "alertEpisodeFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_964c353b1fc268fd060875b9f64" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9286b0216728194aa75cd8f29" ON "AlertEpisodeFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3cc423c26870c099bb43291203" ON "AlertEpisodeFeed" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertGroupingRuleOnCallDutyPolicy" ("alertGroupingRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_22f9896710fffa9d5909011407f" PRIMARY KEY ("alertGroupingRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfbd2e0aa4ba9bf5613cd1f0de" ON "AlertGroupingRuleOnCallDutyPolicy" ("alertGroupingRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a52cf44c3af5db42c746e9ba3" ON "AlertGroupingRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOnCallDutyPolicy" ("alertEpisodeId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_8fa29f51f3b6942f036d7ac1721" PRIMARY KEY ("alertEpisodeId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fcbe4d926f19af8c15c6aed14e" ON "AlertEpisodeOnCallDutyPolicy" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca8d1c28cdf91b999911c78734" ON "AlertEpisodeOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeLabel" ("alertEpisodeId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_889ecdcbd147f7d667965979c53" PRIMARY KEY ("alertEpisodeId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c21d8f93c62e3a7cd4e321ddc" ON "AlertEpisodeLabel" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1339030062467a133052b3a203" ON "AlertEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeInternalNoteFile" ("alertEpisodeInternalNoteId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_da4c0328f4fdd41aa2361761ded" PRIMARY KEY ("alertEpisodeInternalNoteId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2944093e5e375d021e2ad8b9e8" ON "AlertEpisodeInternalNoteFile" ("alertEpisodeInternalNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f05861a3dc9e8db97fed3f674a" ON "AlertEpisodeInternalNoteFile" ("fileId") `,
    );
    await queryRunner.query(`ALTER TABLE "Alert" ADD "alertEpisodeId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a8ec56304ee3dbb682be731793" ON "Alert" ("alertEpisodeId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD CONSTRAINT "FK_cfb25f386359c3717126ecea1e2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD CONSTRAINT "FK_a361c35b33d76e4c4d97f27e113" FOREIGN KEY ("defaultAssignToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD CONSTRAINT "FK_de1e396519c6da05b889a12169a" FOREIGN KEY ("defaultAssignToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD CONSTRAINT "FK_c2e138d694dfff4e3e86e6cfc6b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD CONSTRAINT "FK_7a91abf5593435797ac4fe99125" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_32bad121c94b4024f2b42c56e64" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_3b98b5bde99d96631ca66c8fd82" FOREIGN KEY ("currentAlertStateId") REFERENCES "AlertState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_1707b042f7da296409fc8e6e3cd" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_0569ad819089ad1b62e7080b0b7" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_a9dbe80e8446a3082d2904f6167" FOREIGN KEY ("assignedToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_89099729ddded8c275b201a7c9a" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_58d264daa6693c3ee9e59a42953" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD CONSTRAINT "FK_70fea6d5bce21e224230864acd1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD CONSTRAINT "FK_a8ec56304ee3dbb682be7317937" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_96904f3696228eb910379f23317" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_331aa5398b81014cf1b3e294ff7" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_69af045b1aad0e7792edf2660bf" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_231127e3cfd3caee50d5852e1be" FOREIGN KEY ("addedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_dc51318091c186f2b8122c5428d" FOREIGN KEY ("matchedRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_1756f31f87314129a7003d727e0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD CONSTRAINT "FK_dea2569c6ecb31e997b82bc592e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" ADD CONSTRAINT "FK_6ceb895e071ac6c5692bd0a286f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" ADD CONSTRAINT "FK_375d6f86d0f3e152ddf85daea38" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" ADD CONSTRAINT "FK_7ba13caf6c7f089019b77e2e14b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" ADD CONSTRAINT "FK_19cd5959475f1459c24491d4634" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" ADD CONSTRAINT "FK_c787c0bc5a12b94976f28d0a12c" FOREIGN KEY ("alertStateId") REFERENCES "AlertState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" ADD CONSTRAINT "FK_41ba6bc50ab371af8ce95adf206" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" ADD CONSTRAINT "FK_cc00e04c42fa14e8a6a0ee9fb6e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" ADD CONSTRAINT "FK_800af5b4ac2180cc4ade32718c9" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" ADD CONSTRAINT "FK_093ca468ee1e7458065295f9432" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" ADD CONSTRAINT "FK_917f125b25eabb6c5bab802d8fb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" ADD CONSTRAINT "FK_143813e802d4b01c0ad70cf5db8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" ADD CONSTRAINT "FK_f50385bf56d90ec19e26becd1c7" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" ADD CONSTRAINT "FK_818a93df19196a047511267990f" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" ADD CONSTRAINT "FK_37cc09e358934c5be8ff7856615" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" ADD CONSTRAINT "FK_47e5937c2b8988ae5f86c33a95a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" ADD CONSTRAINT "FK_02013c0e8b919622f79183ee285" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" ADD CONSTRAINT "FK_ac812fdc779677403928a936c94" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" ADD CONSTRAINT "FK_eaf6c93cfac5dfa742337dfc8cc" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" ADD CONSTRAINT "FK_345f9ec2dba210d9d7360f26e2a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" ADD CONSTRAINT "FK_f9286b0216728194aa75cd8f298" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" ADD CONSTRAINT "FK_3cc423c26870c099bb432912033" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" ADD CONSTRAINT "FK_74e7ff46a5bbbecc1be93bc52a1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" ADD CONSTRAINT "FK_e44b2c00fac4093980b1d747c39" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" ADD CONSTRAINT "FK_0a2917a7fa5853a2174a19983a4" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_cfbd2e0aa4ba9bf5613cd1f0de2" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_3a52cf44c3af5db42c746e9ba3d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallDutyPolicy" ADD CONSTRAINT "FK_fcbe4d926f19af8c15c6aed14e9" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallDutyPolicy" ADD CONSTRAINT "FK_ca8d1c28cdf91b999911c78734a" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabel" ADD CONSTRAINT "FK_3c21d8f93c62e3a7cd4e321ddc3" FOREIGN KEY ("alertEpisodeId") REFERENCES "AlertEpisode"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabel" ADD CONSTRAINT "FK_1339030062467a133052b3a2038" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNoteFile" ADD CONSTRAINT "FK_2944093e5e375d021e2ad8b9e82" FOREIGN KEY ("alertEpisodeInternalNoteId") REFERENCES "AlertEpisodeInternalNote"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNoteFile" ADD CONSTRAINT "FK_f05861a3dc9e8db97fed3f674a3" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNoteFile" DROP CONSTRAINT "FK_f05861a3dc9e8db97fed3f674a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNoteFile" DROP CONSTRAINT "FK_2944093e5e375d021e2ad8b9e82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabel" DROP CONSTRAINT "FK_1339030062467a133052b3a2038"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeLabel" DROP CONSTRAINT "FK_3c21d8f93c62e3a7cd4e321ddc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallDutyPolicy" DROP CONSTRAINT "FK_ca8d1c28cdf91b999911c78734a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallDutyPolicy" DROP CONSTRAINT "FK_fcbe4d926f19af8c15c6aed14e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_3a52cf44c3af5db42c746e9ba3d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_cfbd2e0aa4ba9bf5613cd1f0de2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" DROP CONSTRAINT "FK_0a2917a7fa5853a2174a19983a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" DROP CONSTRAINT "FK_e44b2c00fac4093980b1d747c39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" DROP CONSTRAINT "FK_74e7ff46a5bbbecc1be93bc52a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" DROP CONSTRAINT "FK_3cc423c26870c099bb432912033"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" DROP CONSTRAINT "FK_f9286b0216728194aa75cd8f298"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" DROP CONSTRAINT "FK_345f9ec2dba210d9d7360f26e2a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" DROP CONSTRAINT "FK_eaf6c93cfac5dfa742337dfc8cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" DROP CONSTRAINT "FK_ac812fdc779677403928a936c94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" DROP CONSTRAINT "FK_02013c0e8b919622f79183ee285"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" DROP CONSTRAINT "FK_47e5937c2b8988ae5f86c33a95a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" DROP CONSTRAINT "FK_37cc09e358934c5be8ff7856615"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" DROP CONSTRAINT "FK_818a93df19196a047511267990f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" DROP CONSTRAINT "FK_f50385bf56d90ec19e26becd1c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerTeam" DROP CONSTRAINT "FK_143813e802d4b01c0ad70cf5db8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" DROP CONSTRAINT "FK_917f125b25eabb6c5bab802d8fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" DROP CONSTRAINT "FK_093ca468ee1e7458065295f9432"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" DROP CONSTRAINT "FK_800af5b4ac2180cc4ade32718c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" DROP CONSTRAINT "FK_cc00e04c42fa14e8a6a0ee9fb6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerUser" DROP CONSTRAINT "FK_41ba6bc50ab371af8ce95adf206"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" DROP CONSTRAINT "FK_c787c0bc5a12b94976f28d0a12c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" DROP CONSTRAINT "FK_19cd5959475f1459c24491d4634"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" DROP CONSTRAINT "FK_7ba13caf6c7f089019b77e2e14b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" DROP CONSTRAINT "FK_375d6f86d0f3e152ddf85daea38"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeStateTimeline" DROP CONSTRAINT "FK_6ceb895e071ac6c5692bd0a286f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_dea2569c6ecb31e997b82bc592e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_1756f31f87314129a7003d727e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_dc51318091c186f2b8122c5428d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_231127e3cfd3caee50d5852e1be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_69af045b1aad0e7792edf2660bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_331aa5398b81014cf1b3e294ff7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP CONSTRAINT "FK_96904f3696228eb910379f23317"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP CONSTRAINT "FK_a8ec56304ee3dbb682be7317937"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_70fea6d5bce21e224230864acd1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_58d264daa6693c3ee9e59a42953"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_89099729ddded8c275b201a7c9a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_a9dbe80e8446a3082d2904f6167"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_0569ad819089ad1b62e7080b0b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_1707b042f7da296409fc8e6e3cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_3b98b5bde99d96631ca66c8fd82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP CONSTRAINT "FK_32bad121c94b4024f2b42c56e64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP CONSTRAINT "FK_7a91abf5593435797ac4fe99125"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP CONSTRAINT "FK_c2e138d694dfff4e3e86e6cfc6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP CONSTRAINT "FK_de1e396519c6da05b889a12169a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP CONSTRAINT "FK_a361c35b33d76e4c4d97f27e113"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP CONSTRAINT "FK_cfb25f386359c3717126ecea1e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a8ec56304ee3dbb682be731793"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(`ALTER TABLE "Alert" DROP COLUMN "alertEpisodeId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f05861a3dc9e8db97fed3f674a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2944093e5e375d021e2ad8b9e8"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeInternalNoteFile"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1339030062467a133052b3a203"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c21d8f93c62e3a7cd4e321ddc"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca8d1c28cdf91b999911c78734"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fcbe4d926f19af8c15c6aed14e"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a52cf44c3af5db42c746e9ba3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfbd2e0aa4ba9bf5613cd1f0de"`,
    );
    await queryRunner.query(`DROP TABLE "AlertGroupingRuleOnCallDutyPolicy"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3cc423c26870c099bb43291203"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9286b0216728194aa75cd8f29"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a0c81b3e3e570221c5253bc14"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac812fdc779677403928a936c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_02013c0e8b919622f79183ee28"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeInternalNote"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74c82db90ec03c884ba9da813a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da4932e36b0d598f4f1bd8fa5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_818a93df19196a047511267990"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f50385bf56d90ec19e26becd1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_143813e802d4b01c0ad70cf5db"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_79c03a537d5c1f4dbeb8beb355"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_642bd8ead91eb90278a5356728"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_800af5b4ac2180cc4ade32718c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc00e04c42fa14e8a6a0ee9fb6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41ba6bc50ab371af8ce95adf20"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d3ee6df3f7a160f826732ad4f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_69f8e12370a0309482c3ee8c72"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1bd75133c8b3adb6b07af3d26"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5b9ab34c48f20d8f25e5897b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc7f8772f2daabc44003ba6550"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c787c0bc5a12b94976f28d0a12"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_375d6f86d0f3e152ddf85daea3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6ceb895e071ac6c5692bd0a286"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeStateTimeline"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b95fe8c9396c1e1bcf24a941fd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dc51318091c186f2b8122c5428"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_231127e3cfd3caee50d5852e1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b437e214ebfc5c9169fa28b73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_69af045b1aad0e7792edf2660b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_331aa5398b81014cf1b3e294ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96904f3696228eb910379f2331"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeMember"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7daaa2e53985bc52154462b310"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a4c42288b10fe27e6cd655a0d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a95ab301f037e626b06af5ea7d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2fdffde2abde7855a92491482b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0bc17e7d0d4e8647ae7ab1f5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89099729ddded8c275b201a7c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9dbe80e8446a3082d2904f616"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0569ad819089ad1b62e7080b0b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5181cb8a1471f0130c771544a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e761f26e4824f6379f2ebefef3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1707b042f7da296409fc8e6e3c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b98b5bde99d96631ca66c8fd8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c81dab13dbd1ce1711d05a897f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_609b97c21c0eed3ac245f155d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32bad121c94b4024f2b42c56e6"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisode"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de1e396519c6da05b889a12169"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a361c35b33d76e4c4d97f27e11"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c546da77e04aebb0249d1b1441"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e493339eed92199a43c5ddebe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b828bfbe2edbffd53213f4c2c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfb25f386359c3717126ecea1e"`,
    );
    await queryRunner.query(`DROP TABLE "AlertGroupingRule"`);
  }
}
