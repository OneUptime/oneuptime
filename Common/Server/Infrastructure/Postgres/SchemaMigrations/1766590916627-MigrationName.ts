import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1766590916627 implements MigrationInterface {
    public name = 'MigrationName1766590916627'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "AIAgent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "key" character varying NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(50), "slug" character varying(100) NOT NULL, "aiAgentVersion" character varying(30) NOT NULL, "lastAlive" TIMESTAMP WITH TIME ZONE, "iconFileId" uuid, "projectId" uuid, "deletedByUserId" uuid, "createdByUserId" uuid, "isGlobalAIAgent" boolean NOT NULL DEFAULT false, "connectionStatus" character varying, CONSTRAINT "UQ_6f3d82cf89d939fc35fe952b4f6" UNIQUE ("key"), CONSTRAINT "PK_301ae636fef4e6de7c3bf70129c" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE TABLE "AIAgentOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "aiAgentId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_c7d8a8b3aabb95fa3868fcff828" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_57891366dea4262e29ca7d9286" ON "AIAgentOwnerTeam" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ee75f6778240d20acd0e0ea5de" ON "AIAgentOwnerTeam" ("teamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0723d49dfb7b29c8f787755673" ON "AIAgentOwnerTeam" ("aiAgentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0221605414e639cd2df48fb450" ON "AIAgentOwnerTeam" ("isOwnerNotified") `);
        await queryRunner.query(`CREATE TABLE "AIAgentOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "aiAgentId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_df08e4685717bcb169324697cae" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cac129218093e5984a057f268b" ON "AIAgentOwnerUser" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_7a6dad3d4a801c718886b3a087" ON "AIAgentOwnerUser" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_27d84c74c31e7653fc77cab8cc" ON "AIAgentOwnerUser" ("aiAgentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_88675054e489932d5df250e0b4" ON "AIAgentOwnerUser" ("isOwnerNotified") `);
        await queryRunner.query(`CREATE TABLE "AIAgentLabel" ("aiAgentId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_57429d04a63b8149ed4508543a2" PRIMARY KEY ("aiAgentId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6939139a0104e1b331c19f7ea6" ON "AIAgentLabel" ("aiAgentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_676606a57c0a1d45b3faf9d49f" ON "AIAgentLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "AIAgent" ADD CONSTRAINT "FK_5b650f1a5349ec3baa09948642d" FOREIGN KEY ("iconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgent" ADD CONSTRAINT "FK_0cd88831f8f382eabcc13c7f61c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgent" ADD CONSTRAINT "FK_d28e33795c84713c421e91f3104" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgent" ADD CONSTRAINT "FK_083a49a5f23f71c4aa26a754a06" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" ADD CONSTRAINT "FK_57891366dea4262e29ca7d92861" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" ADD CONSTRAINT "FK_ee75f6778240d20acd0e0ea5de1" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" ADD CONSTRAINT "FK_0723d49dfb7b29c8f7877556739" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" ADD CONSTRAINT "FK_e3321a602f9d091a5e8c21dd581" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" ADD CONSTRAINT "FK_26fd04196dedd19188625cbd847" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" ADD CONSTRAINT "FK_cac129218093e5984a057f268b0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" ADD CONSTRAINT "FK_7a6dad3d4a801c718886b3a087f" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" ADD CONSTRAINT "FK_27d84c74c31e7653fc77cab8cc9" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" ADD CONSTRAINT "FK_72cdcfce1cdb4ee65262dcbac69" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" ADD CONSTRAINT "FK_61e11581dbae0cf42967dbe219a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "AIAgentLabel" ADD CONSTRAINT "FK_6939139a0104e1b331c19f7ea6c" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "AIAgentLabel" ADD CONSTRAINT "FK_676606a57c0a1d45b3faf9d49f7" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "AIAgentLabel" DROP CONSTRAINT "FK_676606a57c0a1d45b3faf9d49f7"`);
        await queryRunner.query(`ALTER TABLE "AIAgentLabel" DROP CONSTRAINT "FK_6939139a0104e1b331c19f7ea6c"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" DROP CONSTRAINT "FK_61e11581dbae0cf42967dbe219a"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" DROP CONSTRAINT "FK_72cdcfce1cdb4ee65262dcbac69"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" DROP CONSTRAINT "FK_27d84c74c31e7653fc77cab8cc9"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" DROP CONSTRAINT "FK_7a6dad3d4a801c718886b3a087f"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerUser" DROP CONSTRAINT "FK_cac129218093e5984a057f268b0"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" DROP CONSTRAINT "FK_26fd04196dedd19188625cbd847"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" DROP CONSTRAINT "FK_e3321a602f9d091a5e8c21dd581"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" DROP CONSTRAINT "FK_0723d49dfb7b29c8f7877556739"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" DROP CONSTRAINT "FK_ee75f6778240d20acd0e0ea5de1"`);
        await queryRunner.query(`ALTER TABLE "AIAgentOwnerTeam" DROP CONSTRAINT "FK_57891366dea4262e29ca7d92861"`);
        await queryRunner.query(`ALTER TABLE "AIAgent" DROP CONSTRAINT "FK_083a49a5f23f71c4aa26a754a06"`);
        await queryRunner.query(`ALTER TABLE "AIAgent" DROP CONSTRAINT "FK_d28e33795c84713c421e91f3104"`);
        await queryRunner.query(`ALTER TABLE "AIAgent" DROP CONSTRAINT "FK_0cd88831f8f382eabcc13c7f61c"`);
        await queryRunner.query(`ALTER TABLE "AIAgent" DROP CONSTRAINT "FK_5b650f1a5349ec3baa09948642d"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_676606a57c0a1d45b3faf9d49f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6939139a0104e1b331c19f7ea6"`);
        await queryRunner.query(`DROP TABLE "AIAgentLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_88675054e489932d5df250e0b4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_27d84c74c31e7653fc77cab8cc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7a6dad3d4a801c718886b3a087"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cac129218093e5984a057f268b"`);
        await queryRunner.query(`DROP TABLE "AIAgentOwnerUser"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0221605414e639cd2df48fb450"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0723d49dfb7b29c8f787755673"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee75f6778240d20acd0e0ea5de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_57891366dea4262e29ca7d9286"`);
        await queryRunner.query(`DROP TABLE "AIAgentOwnerTeam"`);
        await queryRunner.query(`DROP TABLE "AIAgent"`);
    }

}
