import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1768825402472 implements MigrationInterface {
    public name = 'MigrationName1768825402472'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "IncomingCallPolicy" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "slug" character varying(100) NOT NULL, "routingPhoneNumber" character varying(30), "callProviderPhoneNumberId" character varying(100), "phoneNumberCountryCode" character varying(100), "phoneNumberAreaCode" character varying(100), "phoneNumberPurchasedAt" TIMESTAMP WITH TIME ZONE, "greetingMessage" character varying(500) DEFAULT 'Please wait while we connect you to the on-call engineer.', "noAnswerMessage" character varying(500) DEFAULT 'No one is available. Please try again later.', "noOneAvailableMessage" character varying(500) DEFAULT 'We are sorry, but no on-call engineer is currently available. Please try again later or contact support.', "isEnabled" boolean NOT NULL DEFAULT true, "repeatPolicyIfNoOneAnswers" boolean NOT NULL DEFAULT false, "repeatPolicyIfNoOneAnswersTimes" integer NOT NULL DEFAULT '1', "projectCallSMSConfigId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_5242e2cffd7f4050e6189e569d5" UNIQUE ("slug"), CONSTRAINT "PK_1cce87f0549b0284e23492d0910" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3c52bf3d9f9aca2ac74848fc0f" ON "IncomingCallPolicy" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f2f54dca4c8c0bbdea4c37edb2" ON "IncomingCallPolicy" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_5242e2cffd7f4050e6189e569d" ON "IncomingCallPolicy" ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_6680fc89e547525f8051bb2599" ON "IncomingCallPolicy" ("routingPhoneNumber") `);
        await queryRunner.query(`CREATE TABLE "IncomingCallPolicyEscalationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incomingCallPolicyId" uuid NOT NULL, "name" character varying(100), "description" character varying(500), "order" integer NOT NULL, "escalateAfterSeconds" integer NOT NULL DEFAULT '30', "onCallDutyPolicyScheduleId" uuid, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_162e367fb58da2aea22a14057e1" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3ff7e49f61d10020a7298c3dc6" ON "IncomingCallPolicyEscalationRule" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d9358a64a7d4a3f48804844e69" ON "IncomingCallPolicyEscalationRule" ("incomingCallPolicyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2940b1f9392441bcff1a33ebc4" ON "IncomingCallPolicyEscalationRule" ("order") `);
        await queryRunner.query(`CREATE TABLE "IncomingCallLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incomingCallPolicyId" uuid NOT NULL, "callerPhoneNumber" character varying(30), "routingPhoneNumber" character varying(30), "callProviderCallId" character varying(100), "status" character varying(100) NOT NULL DEFAULT 'Initiated', "statusMessage" character varying(500), "callDurationInSeconds" integer DEFAULT '0', "callCostInUSDCents" integer DEFAULT '0', "incomingCallCostInUSDCents" integer DEFAULT '0', "outgoingCallCostInUSDCents" integer DEFAULT '0', "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "answeredByUserId" uuid, "currentEscalationRuleOrder" integer DEFAULT '1', "repeatCount" integer DEFAULT '0', CONSTRAINT "PK_c1fd81ebc16e88b441dd8d19108" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_915f3d5f9bf60430bbd89a1efc" ON "IncomingCallLog" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_18e2254401cd580a906808d690" ON "IncomingCallLog" ("incomingCallPolicyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4769731b4e40dd238410b47337" ON "IncomingCallLog" ("callProviderCallId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bac28bb0cfff30703cb79e4a9c" ON "IncomingCallLog" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_0821fb47819572b56836b06102" ON "IncomingCallLog" ("startedAt") `);
        await queryRunner.query(`CREATE TABLE "IncomingCallLogItem" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incomingCallLogId" uuid NOT NULL, "incomingCallPolicyEscalationRuleId" uuid, "userId" uuid, "userPhoneNumber" character varying(30), "status" character varying(100) NOT NULL DEFAULT 'Ringing', "statusMessage" character varying(500), "dialDurationInSeconds" integer DEFAULT '0', "callCostInUSDCents" integer DEFAULT '0', "startedAt" TIMESTAMP WITH TIME ZONE, "endedAt" TIMESTAMP WITH TIME ZONE, "isAnswered" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_00c152a3a8f417339c18000d197" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4d0e67775a87ffdf8b1413d5bc" ON "IncomingCallLogItem" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d11a949952998081bed04512a7" ON "IncomingCallLogItem" ("incomingCallLogId") `);
        await queryRunner.query(`CREATE INDEX "IDX_cb196303d93ee4044d0a4f076e" ON "IncomingCallLogItem" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_5ecd45b8e5c05322459b01f37e" ON "IncomingCallLogItem" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_c2f339131713708082a01cd880" ON "IncomingCallLogItem" ("startedAt") `);
        await queryRunner.query(`CREATE TABLE "UserIncomingCallNumber" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "phone" character varying(30) NOT NULL, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, "verificationCode" character varying(100) NOT NULL, CONSTRAINT "PK_6e487c7ce740c2f21f83904afbe" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_af7375987850451a60f0002ae4" ON "UserIncomingCallNumber" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3b7f38fb56ffd49e972205cb48" ON "UserIncomingCallNumber" ("userId") `);
        await queryRunner.query(`CREATE TABLE "IncomingCallPolicyLabel" ("incomingCallPolicyId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_dbe36f4c556e85705e2ff19e4a5" PRIMARY KEY ("incomingCallPolicyId", "labelId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fb7de9bbc395452347629e9131" ON "IncomingCallPolicyLabel" ("incomingCallPolicyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fb6335122b06a052c29d3d6d8b" ON "IncomingCallPolicyLabel" ("labelId") `);
        await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "alertPhoneNumber"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_3c52bf3d9f9aca2ac74848fc0f7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_08a214983b56f6102a4fdecfa65" FOREIGN KEY ("projectCallSMSConfigId") REFERENCES "ProjectCallSMSConfig"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_fb8001e77d8907b8e089afa6193" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_197d35d96152cbaa101afa670bd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_3ff7e49f61d10020a7298c3dc64" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_d9358a64a7d4a3f48804844e698" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_5e2f646a84077a5fd4969ef090b" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_c0c7ea3cb722a94e074c4486b29" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_c0726b90365656bd869ad821b3b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_c434cfc9ca11de56e1b5a316559" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_915f3d5f9bf60430bbd89a1efce" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_18e2254401cd580a906808d6908" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_fb2531b7d8c44e4cad026fb8662" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_4d0e67775a87ffdf8b1413d5bcb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_d11a949952998081bed04512a77" FOREIGN KEY ("incomingCallLogId") REFERENCES "IncomingCallLog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_b1fbb2661c86de72ffd61f807b9" FOREIGN KEY ("incomingCallPolicyEscalationRuleId") REFERENCES "IncomingCallPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_cb196303d93ee4044d0a4f076e5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_af7375987850451a60f0002ae43" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_3b7f38fb56ffd49e972205cb483" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_4565a75d2ff8c3f363ac2a9c056" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_cab048905c4eb8f87aff75feaa7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyLabel" ADD CONSTRAINT "FK_fb7de9bbc395452347629e91318" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyLabel" ADD CONSTRAINT "FK_fb6335122b06a052c29d3d6d8b5" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyLabel" DROP CONSTRAINT "FK_fb6335122b06a052c29d3d6d8b5"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyLabel" DROP CONSTRAINT "FK_fb7de9bbc395452347629e91318"`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_cab048905c4eb8f87aff75feaa7"`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_4565a75d2ff8c3f363ac2a9c056"`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_3b7f38fb56ffd49e972205cb483"`);
        await queryRunner.query(`ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_af7375987850451a60f0002ae43"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_cb196303d93ee4044d0a4f076e5"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_b1fbb2661c86de72ffd61f807b9"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_d11a949952998081bed04512a77"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_4d0e67775a87ffdf8b1413d5bcb"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_fb2531b7d8c44e4cad026fb8662"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_18e2254401cd580a906808d6908"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_915f3d5f9bf60430bbd89a1efce"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_c434cfc9ca11de56e1b5a316559"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_c0726b90365656bd869ad821b3b"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_c0c7ea3cb722a94e074c4486b29"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_5e2f646a84077a5fd4969ef090b"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_d9358a64a7d4a3f48804844e698"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_3ff7e49f61d10020a7298c3dc64"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_197d35d96152cbaa101afa670bd"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_fb8001e77d8907b8e089afa6193"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_08a214983b56f6102a4fdecfa65"`);
        await queryRunner.query(`ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_3c52bf3d9f9aca2ac74848fc0f7"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "User" ADD "alertPhoneNumber" character varying(30)`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb6335122b06a052c29d3d6d8b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb7de9bbc395452347629e9131"`);
        await queryRunner.query(`DROP TABLE "IncomingCallPolicyLabel"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3b7f38fb56ffd49e972205cb48"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af7375987850451a60f0002ae4"`);
        await queryRunner.query(`DROP TABLE "UserIncomingCallNumber"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c2f339131713708082a01cd880"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ecd45b8e5c05322459b01f37e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb196303d93ee4044d0a4f076e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d11a949952998081bed04512a7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4d0e67775a87ffdf8b1413d5bc"`);
        await queryRunner.query(`DROP TABLE "IncomingCallLogItem"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0821fb47819572b56836b06102"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bac28bb0cfff30703cb79e4a9c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4769731b4e40dd238410b47337"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_18e2254401cd580a906808d690"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_915f3d5f9bf60430bbd89a1efc"`);
        await queryRunner.query(`DROP TABLE "IncomingCallLog"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2940b1f9392441bcff1a33ebc4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9358a64a7d4a3f48804844e69"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3ff7e49f61d10020a7298c3dc6"`);
        await queryRunner.query(`DROP TABLE "IncomingCallPolicyEscalationRule"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6680fc89e547525f8051bb2599"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5242e2cffd7f4050e6189e569d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f2f54dca4c8c0bbdea4c37edb2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3c52bf3d9f9aca2ac74848fc0f"`);
        await queryRunner.query(`DROP TABLE "IncomingCallPolicy"`);
    }

}
