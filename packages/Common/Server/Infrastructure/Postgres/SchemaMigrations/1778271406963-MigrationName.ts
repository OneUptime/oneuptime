import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778271406963 implements MigrationInterface {
  public name: string = "MigrationName1778271406963";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "alertTitlePattern" character varying(500), "alertDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_1ea99c7f5451beaf9f2f78cb5dd" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c24490ab754c328ad7902ee064" ON "AlertOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9eae3b3741bf986883d5f342a" ON "AlertOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_232611a95b98232ebfaf87e7ea" ON "AlertOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOnCallRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8dbcba9baabadfe6178f525fae1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_925b11625ef70530bab7330428" ON "AlertEpisodeOnCallRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e94fbff78604e84c4269639524" ON "AlertEpisodeOnCallRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9df4c9cf11fb33aeb75739f374" ON "AlertEpisodeOnCallRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e0c826e49d233b346952daf1f68" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf4c8e7d039a1a5a520359d12b" ON "AlertEpisodeOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1feaa3d4161b15de7033e9f025" ON "AlertEpisodeOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_259ba617532bebd2b0e6156916" ON "AlertEpisodeOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "incidentTitlePattern" character varying(500), "incidentDescriptionPattern" character varying(500), "monitorNamePattern" character varying(500), "monitorDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c764ea14cc71889f7c1c062fe7d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_72388e76278cf8ffa4bf6cb35a" ON "IncidentOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca0e58305bd805fc2166f9e451" ON "IncidentOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98a22f03c5f0033caf1b8e9c98" ON "IncidentOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOnCallRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_faa0404f061f53a7270a353b8e5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31dec51833abb083a58b4fc678" ON "IncidentEpisodeOnCallRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45c9b412c1c676768fd4a28fc3" ON "IncidentEpisodeOnCallRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2e8819289aa775c8f7bcc6b800" ON "IncidentEpisodeOnCallRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "episodeTitlePattern" character varying(500), "episodeDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6b11966b265f1b2015254404cb8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae4635e1be4496f71a33030663" ON "IncidentEpisodeOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d6c3943adb0d65490801970cb" ON "IncidentEpisodeOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bed0773e391709b113c8a9681" ON "IncidentEpisodeOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleMonitor" ("alertOwnerRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_9a74dc2401c99ef12c374028468" PRIMARY KEY ("alertOwnerRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f86f136ef479d19f09b9b01428" ON "AlertOwnerRuleMonitor" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ba8ccc03bcbb6bd4c7d6581562" ON "AlertOwnerRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleAlertSeverity" ("alertOwnerRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_657d655dbb0a4795a2799d17863" PRIMARY KEY ("alertOwnerRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e7dbb953098bf164bae14f555" ON "AlertOwnerRuleAlertSeverity" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5f3ba8d0ca8ba39c9a95e8b59" ON "AlertOwnerRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleAlertLabel" ("alertOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_543c5bef55298f6fd83897d8e3b" PRIMARY KEY ("alertOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2d7aeef3719d93d3a609c3e4e" ON "AlertOwnerRuleAlertLabel" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e79b7824c4b874a9a3e3c434d6" ON "AlertOwnerRuleAlertLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleMonitorLabel" ("alertOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_50a370af491de23773d49c4cd37" PRIMARY KEY ("alertOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a8a6cbfe0d1e0dd2b0321479ad" ON "AlertOwnerRuleMonitorLabel" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2fc51bb951796eaef833be40d8" ON "AlertOwnerRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleOwnerUser" ("alertOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_d32405e24254f88ea384be227cf" PRIMARY KEY ("alertOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12fac4038e9621b609722d3149" ON "AlertOwnerRuleOwnerUser" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_274f7cbbc830b814abe90051cf" ON "AlertOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertOwnerRuleOwnerTeam" ("alertOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_77a8b96c2fe733bf59d7c44a827" PRIMARY KEY ("alertOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f14bb5601bd692aecde56f9d6" ON "AlertOwnerRuleOwnerTeam" ("alertOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bbf7e25c250eba94d76a22a5c" ON "AlertOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOnCallRuleAlertSeverity" ("alertEpisodeOnCallRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_fe68215b318f3bd5587da49ba74" PRIMARY KEY ("alertEpisodeOnCallRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_856551a415ba29bb09843d69e6" ON "AlertEpisodeOnCallRuleAlertSeverity" ("alertEpisodeOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eba2123691a9ddd740636bb108" ON "AlertEpisodeOnCallRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOnCallRuleEpisodeLabel" ("alertEpisodeOnCallRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_13515820ca0eca3ec89adb0d8fa" PRIMARY KEY ("alertEpisodeOnCallRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0996d6dce4ff0d47c51cacf5e9" ON "AlertEpisodeOnCallRuleEpisodeLabel" ("alertEpisodeOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66b64f9676e73ed2b82911a890" ON "AlertEpisodeOnCallRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOnCallRuleOnCallDutyPolicy" ("alertEpisodeOnCallRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_2532683e5e4f42659719d11c3b1" PRIMARY KEY ("alertEpisodeOnCallRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f779ecc3942d1964704437393" ON "AlertEpisodeOnCallRuleOnCallDutyPolicy" ("alertEpisodeOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_745a9fe787123e0e31edf22aaf" ON "AlertEpisodeOnCallRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerRuleAlertSeverity" ("alertEpisodeOwnerRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_ca905ae84f3bff0f28ab142a34d" PRIMARY KEY ("alertEpisodeOwnerRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0248df4f0b2133611edc97914c" ON "AlertEpisodeOwnerRuleAlertSeverity" ("alertEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d1c69cf4d98db000f99b20d8a4" ON "AlertEpisodeOwnerRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerRuleEpisodeLabel" ("alertEpisodeOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_f1f7a393360207f980a17f5375c" PRIMARY KEY ("alertEpisodeOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d3f682913ac6c2b89a7729892" ON "AlertEpisodeOwnerRuleEpisodeLabel" ("alertEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abbeac22dc5b42f1e535e41f48" ON "AlertEpisodeOwnerRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerRuleOwnerUser" ("alertEpisodeOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_1994e609e6200e419bdf54f591b" PRIMARY KEY ("alertEpisodeOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c4fb4db0f3bb3acd22ce387f9" ON "AlertEpisodeOwnerRuleOwnerUser" ("alertEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dea1b859379fb260b2ba9a8614" ON "AlertEpisodeOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertEpisodeOwnerRuleOwnerTeam" ("alertEpisodeOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_5cc80c1b13c57949fd21afce80c" PRIMARY KEY ("alertEpisodeOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbbf9d464d753916004299fea3" ON "AlertEpisodeOwnerRuleOwnerTeam" ("alertEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d626eaca30221044b2c756018d" ON "AlertEpisodeOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleMonitor" ("incidentOwnerRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_4c7a09209b4ab3b1e4738b620ea" PRIMARY KEY ("incidentOwnerRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_64b4c4fccaf880bf5310efc477" ON "IncidentOwnerRuleMonitor" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b64fa218b4e1a61d91cc7d5ae0" ON "IncidentOwnerRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleIncidentSeverity" ("incidentOwnerRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_06a97d142c6a0d6f3e2f04b8ac4" PRIMARY KEY ("incidentOwnerRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5a8e7054f2246afec8d15c3db" ON "IncidentOwnerRuleIncidentSeverity" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_608a9549da47127b23d129266b" ON "IncidentOwnerRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleIncidentLabel" ("incidentOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_934e4bc2d18d8d25d461ecb7747" PRIMARY KEY ("incidentOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32a2517872204e6c5fbde27472" ON "IncidentOwnerRuleIncidentLabel" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e1355dadb49d4be26a422645d" ON "IncidentOwnerRuleIncidentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleMonitorLabel" ("incidentOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_016d2c02c6e0cf6a5e2f67dc91c" PRIMARY KEY ("incidentOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d260bde468cf0ba26665ef1fe9" ON "IncidentOwnerRuleMonitorLabel" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89fe97a77f22981a037ac7e0f7" ON "IncidentOwnerRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleOwnerUser" ("incidentOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_5fa208f6432412cd94a0166a1b3" PRIMARY KEY ("incidentOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f5d0485b251832c4c17e88fda" ON "IncidentOwnerRuleOwnerUser" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9cc991bbde7f4711a6e042df6" ON "IncidentOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentOwnerRuleOwnerTeam" ("incidentOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_007b4fc0c26d8f699d104b83f56" PRIMARY KEY ("incidentOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aa160f4ad436a7ab845b98a9da" ON "IncidentOwnerRuleOwnerTeam" ("incidentOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1221dcb72b1136da98bf9a0b42" ON "IncidentOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOnCallRuleIncidentSeverity" ("incidentEpisodeOnCallRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_d62539c78be48d79a2c1f033d2d" PRIMARY KEY ("incidentEpisodeOnCallRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97a38bfc379515275e8e47d6fd" ON "IncidentEpisodeOnCallRuleIncidentSeverity" ("incidentEpisodeOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_507174ee7a8eb98e0603147080" ON "IncidentEpisodeOnCallRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOnCallRuleEpisodeLabel" ("incidentEpisodeOnCallRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_7d85dfa891fe7384fd7ae7ed2cf" PRIMARY KEY ("incidentEpisodeOnCallRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_313b07adec93ef5f1c346c9bfc" ON "IncidentEpisodeOnCallRuleEpisodeLabel" ("incidentEpisodeOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_185247d85bfb22d39af1b72470" ON "IncidentEpisodeOnCallRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOnCallRuleOnCallDutyPolicy" ("incidentEpisodeOnCallRuleId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_615e15296ec75e1778bb78cc4ce" PRIMARY KEY ("incidentEpisodeOnCallRuleId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f9ac88f9223076f043d0b91d1" ON "IncidentEpisodeOnCallRuleOnCallDutyPolicy" ("incidentEpisodeOnCallRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4620e5f5a53d958e095e81b141" ON "IncidentEpisodeOnCallRuleOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOwnerRuleIncidentSeverity" ("incidentEpisodeOwnerRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_26a54af547d79e0875b2ce0fafe" PRIMARY KEY ("incidentEpisodeOwnerRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f38855e56d8dd50a81c958bb6" ON "IncidentEpisodeOwnerRuleIncidentSeverity" ("incidentEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_411e161902878dc2e3292b0ebc" ON "IncidentEpisodeOwnerRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOwnerRuleEpisodeLabel" ("incidentEpisodeOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_c0845235163470982b4cdc5c955" PRIMARY KEY ("incidentEpisodeOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9e72f562ec15bea1bd316a3dc" ON "IncidentEpisodeOwnerRuleEpisodeLabel" ("incidentEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f7500fa9e80a79d060ea597ff9" ON "IncidentEpisodeOwnerRuleEpisodeLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOwnerRuleOwnerUser" ("incidentEpisodeOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_c78c0cefb3a57d1a23726464566" PRIMARY KEY ("incidentEpisodeOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78b6800b5e35b0addaf85a0cfb" ON "IncidentEpisodeOwnerRuleOwnerUser" ("incidentEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49678cc0ceeae2f697d76a60a5" ON "IncidentEpisodeOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentEpisodeOwnerRuleOwnerTeam" ("incidentEpisodeOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_04a9a609f5098341b6677b3ce71" PRIMARY KEY ("incidentEpisodeOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f9de7ff755c684d7344be8fd9" ON "IncidentEpisodeOwnerRuleOwnerTeam" ("incidentEpisodeOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_307d92c61eb3e26aca345b0eb5" ON "IncidentEpisodeOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD CONSTRAINT "FK_c24490ab754c328ad7902ee0648" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD CONSTRAINT "FK_10f38fe190e7612fe6f1f1ce722" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD CONSTRAINT "FK_06e80f78e314285647c7b470ba6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD CONSTRAINT "FK_925b11625ef70530bab73304284" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD CONSTRAINT "FK_db42cdbbd0b63863491c4db2f81" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD CONSTRAINT "FK_370ee9ed19d6b22f114ace74182" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" ADD CONSTRAINT "FK_cf4c8e7d039a1a5a520359d12bb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" ADD CONSTRAINT "FK_5110729b8979b447d6ce46c19d5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" ADD CONSTRAINT "FK_244bdfd5a941ed1056ccdc01ebd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD CONSTRAINT "FK_72388e76278cf8ffa4bf6cb35aa" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD CONSTRAINT "FK_1d9b96f50d19aef0dfd8ab1eeaa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD CONSTRAINT "FK_9870a8adb67709c80174fc2aa5e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD CONSTRAINT "FK_31dec51833abb083a58b4fc6785" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD CONSTRAINT "FK_a375541150734ff9d20fdf8bd94" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD CONSTRAINT "FK_291620246bb9e0b5bb7164da481" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" ADD CONSTRAINT "FK_ae4635e1be4496f71a330306636" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" ADD CONSTRAINT "FK_8bddfda1720fa1c8414564529ae" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" ADD CONSTRAINT "FK_c42e4138898bfbce6666e60a263" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitor" ADD CONSTRAINT "FK_f86f136ef479d19f09b9b014289" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitor" ADD CONSTRAINT "FK_ba8ccc03bcbb6bd4c7d6581562a" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertSeverity" ADD CONSTRAINT "FK_0e7dbb953098bf164bae14f555a" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertSeverity" ADD CONSTRAINT "FK_b5f3ba8d0ca8ba39c9a95e8b59a" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertLabel" ADD CONSTRAINT "FK_f2d7aeef3719d93d3a609c3e4ee" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertLabel" ADD CONSTRAINT "FK_e79b7824c4b874a9a3e3c434d6c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_a8a6cbfe0d1e0dd2b0321479ad3" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_2fc51bb951796eaef833be40d8c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerUser" ADD CONSTRAINT "FK_12fac4038e9621b609722d31493" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerUser" ADD CONSTRAINT "FK_274f7cbbc830b814abe90051cf6" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_1f14bb5601bd692aecde56f9d6c" FOREIGN KEY ("alertOwnerRuleId") REFERENCES "AlertOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_8bbf7e25c250eba94d76a22a5c9" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleAlertSeverity" ADD CONSTRAINT "FK_856551a415ba29bb09843d69e69" FOREIGN KEY ("alertEpisodeOnCallRuleId") REFERENCES "AlertEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleAlertSeverity" ADD CONSTRAINT "FK_eba2123691a9ddd740636bb108f" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleEpisodeLabel" ADD CONSTRAINT "FK_0996d6dce4ff0d47c51cacf5e94" FOREIGN KEY ("alertEpisodeOnCallRuleId") REFERENCES "AlertEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleEpisodeLabel" ADD CONSTRAINT "FK_66b64f9676e73ed2b82911a8900" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_0f779ecc3942d19647044373931" FOREIGN KEY ("alertEpisodeOnCallRuleId") REFERENCES "AlertEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_745a9fe787123e0e31edf22aaf4" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleAlertSeverity" ADD CONSTRAINT "FK_0248df4f0b2133611edc97914c8" FOREIGN KEY ("alertEpisodeOwnerRuleId") REFERENCES "AlertEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleAlertSeverity" ADD CONSTRAINT "FK_d1c69cf4d98db000f99b20d8a4e" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleEpisodeLabel" ADD CONSTRAINT "FK_5d3f682913ac6c2b89a7729892f" FOREIGN KEY ("alertEpisodeOwnerRuleId") REFERENCES "AlertEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleEpisodeLabel" ADD CONSTRAINT "FK_abbeac22dc5b42f1e535e41f484" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerUser" ADD CONSTRAINT "FK_1c4fb4db0f3bb3acd22ce387f99" FOREIGN KEY ("alertEpisodeOwnerRuleId") REFERENCES "AlertEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerUser" ADD CONSTRAINT "FK_dea1b859379fb260b2ba9a86141" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_cbbf9d464d753916004299fea39" FOREIGN KEY ("alertEpisodeOwnerRuleId") REFERENCES "AlertEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_d626eaca30221044b2c756018d1" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitor" ADD CONSTRAINT "FK_64b4c4fccaf880bf5310efc477a" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitor" ADD CONSTRAINT "FK_b64fa218b4e1a61d91cc7d5ae0b" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentSeverity" ADD CONSTRAINT "FK_e5a8e7054f2246afec8d15c3db1" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentSeverity" ADD CONSTRAINT "FK_608a9549da47127b23d129266b4" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentLabel" ADD CONSTRAINT "FK_32a2517872204e6c5fbde27472c" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentLabel" ADD CONSTRAINT "FK_8e1355dadb49d4be26a422645d0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_d260bde468cf0ba26665ef1fe9f" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitorLabel" ADD CONSTRAINT "FK_89fe97a77f22981a037ac7e0f70" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerUser" ADD CONSTRAINT "FK_4f5d0485b251832c4c17e88fda2" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerUser" ADD CONSTRAINT "FK_c9cc991bbde7f4711a6e042df6e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_aa160f4ad436a7ab845b98a9dae" FOREIGN KEY ("incidentOwnerRuleId") REFERENCES "IncidentOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_1221dcb72b1136da98bf9a0b421" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleIncidentSeverity" ADD CONSTRAINT "FK_97a38bfc379515275e8e47d6fd9" FOREIGN KEY ("incidentEpisodeOnCallRuleId") REFERENCES "IncidentEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleIncidentSeverity" ADD CONSTRAINT "FK_507174ee7a8eb98e06031470805" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleEpisodeLabel" ADD CONSTRAINT "FK_313b07adec93ef5f1c346c9bfc3" FOREIGN KEY ("incidentEpisodeOnCallRuleId") REFERENCES "IncidentEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleEpisodeLabel" ADD CONSTRAINT "FK_185247d85bfb22d39af1b72470d" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_0f9ac88f9223076f043d0b91d10" FOREIGN KEY ("incidentEpisodeOnCallRuleId") REFERENCES "IncidentEpisodeOnCallRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleOnCallDutyPolicy" ADD CONSTRAINT "FK_4620e5f5a53d958e095e81b141d" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleIncidentSeverity" ADD CONSTRAINT "FK_0f38855e56d8dd50a81c958bb67" FOREIGN KEY ("incidentEpisodeOwnerRuleId") REFERENCES "IncidentEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleIncidentSeverity" ADD CONSTRAINT "FK_411e161902878dc2e3292b0ebc1" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleEpisodeLabel" ADD CONSTRAINT "FK_f9e72f562ec15bea1bd316a3dcb" FOREIGN KEY ("incidentEpisodeOwnerRuleId") REFERENCES "IncidentEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleEpisodeLabel" ADD CONSTRAINT "FK_f7500fa9e80a79d060ea597ff99" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerUser" ADD CONSTRAINT "FK_78b6800b5e35b0addaf85a0cfb6" FOREIGN KEY ("incidentEpisodeOwnerRuleId") REFERENCES "IncidentEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerUser" ADD CONSTRAINT "FK_49678cc0ceeae2f697d76a60a5e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_6f9de7ff755c684d7344be8fd96" FOREIGN KEY ("incidentEpisodeOwnerRuleId") REFERENCES "IncidentEpisodeOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_307d92c61eb3e26aca345b0eb5e" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_307d92c61eb3e26aca345b0eb5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_6f9de7ff755c684d7344be8fd96"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerUser" DROP CONSTRAINT "FK_49678cc0ceeae2f697d76a60a5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleOwnerUser" DROP CONSTRAINT "FK_78b6800b5e35b0addaf85a0cfb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleEpisodeLabel" DROP CONSTRAINT "FK_f7500fa9e80a79d060ea597ff99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleEpisodeLabel" DROP CONSTRAINT "FK_f9e72f562ec15bea1bd316a3dcb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleIncidentSeverity" DROP CONSTRAINT "FK_411e161902878dc2e3292b0ebc1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRuleIncidentSeverity" DROP CONSTRAINT "FK_0f38855e56d8dd50a81c958bb67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_4620e5f5a53d958e095e81b141d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_0f9ac88f9223076f043d0b91d10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleEpisodeLabel" DROP CONSTRAINT "FK_185247d85bfb22d39af1b72470d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleEpisodeLabel" DROP CONSTRAINT "FK_313b07adec93ef5f1c346c9bfc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleIncidentSeverity" DROP CONSTRAINT "FK_507174ee7a8eb98e06031470805"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRuleIncidentSeverity" DROP CONSTRAINT "FK_97a38bfc379515275e8e47d6fd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_1221dcb72b1136da98bf9a0b421"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_aa160f4ad436a7ab845b98a9dae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerUser" DROP CONSTRAINT "FK_c9cc991bbde7f4711a6e042df6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleOwnerUser" DROP CONSTRAINT "FK_4f5d0485b251832c4c17e88fda2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_89fe97a77f22981a037ac7e0f70"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_d260bde468cf0ba26665ef1fe9f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentLabel" DROP CONSTRAINT "FK_8e1355dadb49d4be26a422645d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentLabel" DROP CONSTRAINT "FK_32a2517872204e6c5fbde27472c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentSeverity" DROP CONSTRAINT "FK_608a9549da47127b23d129266b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleIncidentSeverity" DROP CONSTRAINT "FK_e5a8e7054f2246afec8d15c3db1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitor" DROP CONSTRAINT "FK_b64fa218b4e1a61d91cc7d5ae0b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRuleMonitor" DROP CONSTRAINT "FK_64b4c4fccaf880bf5310efc477a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_d626eaca30221044b2c756018d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_cbbf9d464d753916004299fea39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerUser" DROP CONSTRAINT "FK_dea1b859379fb260b2ba9a86141"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleOwnerUser" DROP CONSTRAINT "FK_1c4fb4db0f3bb3acd22ce387f99"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleEpisodeLabel" DROP CONSTRAINT "FK_abbeac22dc5b42f1e535e41f484"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleEpisodeLabel" DROP CONSTRAINT "FK_5d3f682913ac6c2b89a7729892f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleAlertSeverity" DROP CONSTRAINT "FK_d1c69cf4d98db000f99b20d8a4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRuleAlertSeverity" DROP CONSTRAINT "FK_0248df4f0b2133611edc97914c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_745a9fe787123e0e31edf22aaf4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleOnCallDutyPolicy" DROP CONSTRAINT "FK_0f779ecc3942d19647044373931"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleEpisodeLabel" DROP CONSTRAINT "FK_66b64f9676e73ed2b82911a8900"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleEpisodeLabel" DROP CONSTRAINT "FK_0996d6dce4ff0d47c51cacf5e94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleAlertSeverity" DROP CONSTRAINT "FK_eba2123691a9ddd740636bb108f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRuleAlertSeverity" DROP CONSTRAINT "FK_856551a415ba29bb09843d69e69"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_8bbf7e25c250eba94d76a22a5c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_1f14bb5601bd692aecde56f9d6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerUser" DROP CONSTRAINT "FK_274f7cbbc830b814abe90051cf6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleOwnerUser" DROP CONSTRAINT "FK_12fac4038e9621b609722d31493"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_2fc51bb951796eaef833be40d8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitorLabel" DROP CONSTRAINT "FK_a8a6cbfe0d1e0dd2b0321479ad3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertLabel" DROP CONSTRAINT "FK_e79b7824c4b874a9a3e3c434d6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertLabel" DROP CONSTRAINT "FK_f2d7aeef3719d93d3a609c3e4ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertSeverity" DROP CONSTRAINT "FK_b5f3ba8d0ca8ba39c9a95e8b59a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleAlertSeverity" DROP CONSTRAINT "FK_0e7dbb953098bf164bae14f555a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitor" DROP CONSTRAINT "FK_ba8ccc03bcbb6bd4c7d6581562a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRuleMonitor" DROP CONSTRAINT "FK_f86f136ef479d19f09b9b014289"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" DROP CONSTRAINT "FK_c42e4138898bfbce6666e60a263"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" DROP CONSTRAINT "FK_8bddfda1720fa1c8414564529ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOwnerRule" DROP CONSTRAINT "FK_ae4635e1be4496f71a330306636"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP CONSTRAINT "FK_291620246bb9e0b5bb7164da481"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP CONSTRAINT "FK_a375541150734ff9d20fdf8bd94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP CONSTRAINT "FK_31dec51833abb083a58b4fc6785"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP CONSTRAINT "FK_9870a8adb67709c80174fc2aa5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP CONSTRAINT "FK_1d9b96f50d19aef0dfd8ab1eeaa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP CONSTRAINT "FK_72388e76278cf8ffa4bf6cb35aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" DROP CONSTRAINT "FK_244bdfd5a941ed1056ccdc01ebd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" DROP CONSTRAINT "FK_5110729b8979b447d6ce46c19d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOwnerRule" DROP CONSTRAINT "FK_cf4c8e7d039a1a5a520359d12bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP CONSTRAINT "FK_370ee9ed19d6b22f114ace74182"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP CONSTRAINT "FK_db42cdbbd0b63863491c4db2f81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP CONSTRAINT "FK_925b11625ef70530bab73304284"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP CONSTRAINT "FK_06e80f78e314285647c7b470ba6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP CONSTRAINT "FK_10f38fe190e7612fe6f1f1ce722"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP CONSTRAINT "FK_c24490ab754c328ad7902ee0648"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_307d92c61eb3e26aca345b0eb5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f9de7ff755c684d7344be8fd9"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodeOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49678cc0ceeae2f697d76a60a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78b6800b5e35b0addaf85a0cfb"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodeOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f7500fa9e80a79d060ea597ff9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9e72f562ec15bea1bd316a3dc"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeOwnerRuleEpisodeLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_411e161902878dc2e3292b0ebc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f38855e56d8dd50a81c958bb6"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeOwnerRuleIncidentSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4620e5f5a53d958e095e81b141"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f9ac88f9223076f043d0b91d1"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeOnCallRuleOnCallDutyPolicy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_185247d85bfb22d39af1b72470"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_313b07adec93ef5f1c346c9bfc"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeOnCallRuleEpisodeLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_507174ee7a8eb98e0603147080"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97a38bfc379515275e8e47d6fd"`,
    );
    await queryRunner.query(
      `DROP TABLE "IncidentEpisodeOnCallRuleIncidentSeverity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1221dcb72b1136da98bf9a0b42"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa160f4ad436a7ab845b98a9da"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9cc991bbde7f4711a6e042df6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f5d0485b251832c4c17e88fda"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89fe97a77f22981a037ac7e0f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d260bde468cf0ba26665ef1fe9"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e1355dadb49d4be26a422645d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_32a2517872204e6c5fbde27472"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleIncidentLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_608a9549da47127b23d129266b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5a8e7054f2246afec8d15c3db"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b64fa218b4e1a61d91cc7d5ae0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64b4c4fccaf880bf5310efc477"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d626eaca30221044b2c756018d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cbbf9d464d753916004299fea3"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dea1b859379fb260b2ba9a8614"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c4fb4db0f3bb3acd22ce387f9"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abbeac22dc5b42f1e535e41f48"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d3f682913ac6c2b89a7729892"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerRuleEpisodeLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d1c69cf4d98db000f99b20d8a4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0248df4f0b2133611edc97914c"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_745a9fe787123e0e31edf22aaf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f779ecc3942d1964704437393"`,
    );
    await queryRunner.query(
      `DROP TABLE "AlertEpisodeOnCallRuleOnCallDutyPolicy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66b64f9676e73ed2b82911a890"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0996d6dce4ff0d47c51cacf5e9"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOnCallRuleEpisodeLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eba2123691a9ddd740636bb108"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_856551a415ba29bb09843d69e6"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOnCallRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bbf7e25c250eba94d76a22a5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f14bb5601bd692aecde56f9d6"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_274f7cbbc830b814abe90051cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12fac4038e9621b609722d3149"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2fc51bb951796eaef833be40d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a8a6cbfe0d1e0dd2b0321479ad"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e79b7824c4b874a9a3e3c434d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2d7aeef3719d93d3a609c3e4e"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleAlertLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5f3ba8d0ca8ba39c9a95e8b59"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e7dbb953098bf164bae14f555"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba8ccc03bcbb6bd4c7d6581562"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f86f136ef479d19f09b9b01428"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bed0773e391709b113c8a9681"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d6c3943adb0d65490801970cb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae4635e1be4496f71a33030663"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodeOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2e8819289aa775c8f7bcc6b800"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45c9b412c1c676768fd4a28fc3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31dec51833abb083a58b4fc678"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentEpisodeOnCallRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98a22f03c5f0033caf1b8e9c98"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca0e58305bd805fc2166f9e451"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_72388e76278cf8ffa4bf6cb35a"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_259ba617532bebd2b0e6156916"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1feaa3d4161b15de7033e9f025"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf4c8e7d039a1a5a520359d12b"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9df4c9cf11fb33aeb75739f374"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e94fbff78604e84c4269639524"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_925b11625ef70530bab7330428"`,
    );
    await queryRunner.query(`DROP TABLE "AlertEpisodeOnCallRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_232611a95b98232ebfaf87e7ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9eae3b3741bf986883d5f342a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c24490ab754c328ad7902ee064"`,
    );
    await queryRunner.query(`DROP TABLE "AlertOwnerRule"`);
  }
}
