import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769723982900 implements MigrationInterface {
    public name = 'MigrationName1769723982900'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "IncidentEpisodeRoleMember" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "incidentEpisodeId" uuid NOT NULL, "incidentRoleId" uuid NOT NULL, "notes" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_474532526d5cc3545b4ef9919cd" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bcdab2b1d21ff93704e75dac32" ON "IncidentEpisodeRoleMember" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ee6272bd247bb27cc32a90d63d" ON "IncidentEpisodeRoleMember" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_298c9f71f35578ee46e7ec83d5" ON "IncidentEpisodeRoleMember" ("incidentEpisodeId") `);
        await queryRunner.query(`CREATE INDEX "IDX_08c8933e37d14069c0d18b34f1" ON "IncidentEpisodeRoleMember" ("incidentRoleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3060e36031e7e1ee51ef7dc404" ON "IncidentEpisodeRoleMember" ("incidentEpisodeId", "userId", "projectId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleEpisodeLabel" ("incidentGroupingRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_e0f2fe8a66b083f9e6c9c766428" PRIMARY KEY ("incidentGroupingRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d5bc4e62ddb6143f3a86443c9e" ON "IncidentGroupingRuleEpisodeLabel" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1208b47347c42eee54d30ef41c" ON "IncidentGroupingRuleEpisodeLabel" ("labelId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleEpisodeOwnerUser" ("incidentGroupingRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_6696e08589d401da95e805fd01e" PRIMARY KEY ("incidentGroupingRuleId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_512cbd12562a86fd309d02ef51" ON "IncidentGroupingRuleEpisodeOwnerUser" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ed8e00b2e1168c5431a1132bce" ON "IncidentGroupingRuleEpisodeOwnerUser" ("userId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleEpisodeOwnerTeam" ("incidentGroupingRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_4fdf83443d8eef360584980a925" PRIMARY KEY ("incidentGroupingRuleId", "teamId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_42d2bf6cf9c970ff9ca5b8b41b" ON "IncidentGroupingRuleEpisodeOwnerTeam" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6373d4adb83cefdf4c644b8d07" ON "IncidentGroupingRuleEpisodeOwnerTeam" ("teamId") `);
        await queryRunner.query(`CREATE TABLE "IncidentGroupingRuleEpisodeMemberRole" ("incidentGroupingRuleId" uuid NOT NULL, "incidentRoleId" uuid NOT NULL, CONSTRAINT "PK_e9568c14fda0f151210c447a114" PRIMARY KEY ("incidentGroupingRuleId", "incidentRoleId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fc46e5f2b3f571415f5736fa75" ON "IncidentGroupingRuleEpisodeMemberRole" ("incidentGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b674b686375dc9222ea2bb58a7" ON "IncidentGroupingRuleEpisodeMemberRole" ("incidentRoleId") `);
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleEpisodeLabel" ("alertGroupingRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_4e9ad795f04c3dcac6446a91c76" PRIMARY KEY ("alertGroupingRuleId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_28abdcd3e91f1f4cdf21eec7dd" ON "AlertGroupingRuleEpisodeLabel" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a3be4082d83804fcc6f3ed3fad" ON "AlertGroupingRuleEpisodeLabel" ("labelId") `);
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleEpisodeOwnerUser" ("alertGroupingRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_f96bf78702ba9bfd88b8e8e8caa" PRIMARY KEY ("alertGroupingRuleId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_51925b30ebf88f5bf1b38e8297" ON "AlertGroupingRuleEpisodeOwnerUser" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_369d346204ccbe621c22eae96b" ON "AlertGroupingRuleEpisodeOwnerUser" ("userId") `);
        await queryRunner.query(`CREATE TABLE "AlertGroupingRuleEpisodeOwnerTeam" ("alertGroupingRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_07647854529478d8e894c7a1b6e" PRIMARY KEY ("alertGroupingRuleId", "teamId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5226fd027c4672d28d65b1782d" ON "AlertGroupingRuleEpisodeOwnerTeam" ("alertGroupingRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fd97bc4266b115315af32cb073" ON "AlertGroupingRuleEpisodeOwnerTeam" ("teamId") `);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" ADD "episodeMemberRoleAssignments" jsonb`);
        await queryRunner.query(`ALTER TABLE "IncidentMember" ADD "isMemberNotified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_bcdab2b1d21ff93704e75dac327" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_ee6272bd247bb27cc32a90d63db" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_298c9f71f35578ee46e7ec83d53" FOREIGN KEY ("incidentEpisodeId") REFERENCES "IncidentEpisode"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_08c8933e37d14069c0d18b34f14" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_7a122bd7fa9d7b9c7ddd3aba72e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" ADD CONSTRAINT "FK_6dcab8328cd2f6856845cd5fcbe" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeLabel" ADD CONSTRAINT "FK_d5bc4e62ddb6143f3a86443c9e4" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeLabel" ADD CONSTRAINT "FK_1208b47347c42eee54d30ef41c2" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerUser" ADD CONSTRAINT "FK_512cbd12562a86fd309d02ef513" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerUser" ADD CONSTRAINT "FK_ed8e00b2e1168c5431a1132bce5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerTeam" ADD CONSTRAINT "FK_42d2bf6cf9c970ff9ca5b8b41b6" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerTeam" ADD CONSTRAINT "FK_6373d4adb83cefdf4c644b8d073" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeMemberRole" ADD CONSTRAINT "FK_fc46e5f2b3f571415f5736fa756" FOREIGN KEY ("incidentGroupingRuleId") REFERENCES "IncidentGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeMemberRole" ADD CONSTRAINT "FK_b674b686375dc9222ea2bb58a7a" FOREIGN KEY ("incidentRoleId") REFERENCES "IncidentRole"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeLabel" ADD CONSTRAINT "FK_28abdcd3e91f1f4cdf21eec7ddc" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeLabel" ADD CONSTRAINT "FK_a3be4082d83804fcc6f3ed3fad5" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerUser" ADD CONSTRAINT "FK_51925b30ebf88f5bf1b38e8297a" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerUser" ADD CONSTRAINT "FK_369d346204ccbe621c22eae96b2" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerTeam" ADD CONSTRAINT "FK_5226fd027c4672d28d65b1782da" FOREIGN KEY ("alertGroupingRuleId") REFERENCES "AlertGroupingRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerTeam" ADD CONSTRAINT "FK_fd97bc4266b115315af32cb073f" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerTeam" DROP CONSTRAINT "FK_fd97bc4266b115315af32cb073f"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerTeam" DROP CONSTRAINT "FK_5226fd027c4672d28d65b1782da"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerUser" DROP CONSTRAINT "FK_369d346204ccbe621c22eae96b2"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeOwnerUser" DROP CONSTRAINT "FK_51925b30ebf88f5bf1b38e8297a"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeLabel" DROP CONSTRAINT "FK_a3be4082d83804fcc6f3ed3fad5"`);
        await queryRunner.query(`ALTER TABLE "AlertGroupingRuleEpisodeLabel" DROP CONSTRAINT "FK_28abdcd3e91f1f4cdf21eec7ddc"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeMemberRole" DROP CONSTRAINT "FK_b674b686375dc9222ea2bb58a7a"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeMemberRole" DROP CONSTRAINT "FK_fc46e5f2b3f571415f5736fa756"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerTeam" DROP CONSTRAINT "FK_6373d4adb83cefdf4c644b8d073"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerTeam" DROP CONSTRAINT "FK_42d2bf6cf9c970ff9ca5b8b41b6"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerUser" DROP CONSTRAINT "FK_ed8e00b2e1168c5431a1132bce5"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeOwnerUser" DROP CONSTRAINT "FK_512cbd12562a86fd309d02ef513"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeLabel" DROP CONSTRAINT "FK_1208b47347c42eee54d30ef41c2"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRuleEpisodeLabel" DROP CONSTRAINT "FK_d5bc4e62ddb6143f3a86443c9e4"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_6dcab8328cd2f6856845cd5fcbe"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_7a122bd7fa9d7b9c7ddd3aba72e"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_08c8933e37d14069c0d18b34f14"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_298c9f71f35578ee46e7ec83d53"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_ee6272bd247bb27cc32a90d63db"`);
        await queryRunner.query(`ALTER TABLE "IncidentEpisodeRoleMember" DROP CONSTRAINT "FK_bcdab2b1d21ff93704e75dac327"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "IncidentMember" DROP COLUMN "isMemberNotified"`);
        await queryRunner.query(`ALTER TABLE "IncidentGroupingRule" DROP COLUMN "episodeMemberRoleAssignments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd97bc4266b115315af32cb073"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5226fd027c4672d28d65b1782d"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleEpisodeOwnerTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_369d346204ccbe621c22eae96b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_51925b30ebf88f5bf1b38e8297"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleEpisodeOwnerUser"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a3be4082d83804fcc6f3ed3fad"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_28abdcd3e91f1f4cdf21eec7dd"`);
        await queryRunner.query(`DROP TABLE "AlertGroupingRuleEpisodeLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b674b686375dc9222ea2bb58a7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fc46e5f2b3f571415f5736fa75"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleEpisodeMemberRole"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6373d4adb83cefdf4c644b8d07"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_42d2bf6cf9c970ff9ca5b8b41b"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleEpisodeOwnerTeam"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed8e00b2e1168c5431a1132bce"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_512cbd12562a86fd309d02ef51"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleEpisodeOwnerUser"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1208b47347c42eee54d30ef41c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d5bc4e62ddb6143f3a86443c9e"`);
        await queryRunner.query(`DROP TABLE "IncidentGroupingRuleEpisodeLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3060e36031e7e1ee51ef7dc404"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_08c8933e37d14069c0d18b34f1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_298c9f71f35578ee46e7ec83d5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee6272bd247bb27cc32a90d63d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bcdab2b1d21ff93704e75dac32"`);
        await queryRunner.query(`DROP TABLE "IncidentEpisodeRoleMember"`);
    }

}
