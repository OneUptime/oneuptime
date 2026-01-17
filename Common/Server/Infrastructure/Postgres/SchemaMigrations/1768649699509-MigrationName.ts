import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1768649699509 implements MigrationInterface {
  public name = "MigrationName1768649699509";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_IncomingCallPolicy_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_IncomingCallPolicy_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_IncomingCallPolicy_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_IncomingCallPolicyEscalationRule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_IncomingCallPolicyEscalationRule_incomingCallPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_IncomingCallPolicyEscalationRule_onCallDutyPolicyScheduleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_IncomingCallPolicyEscalationRule_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_IncomingCallPolicyEscalationRule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_IncomingCallPolicyEscalationRule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_IncomingCallLog_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_IncomingCallLog_incomingCallPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_IncomingCallLog_answeredByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_IncomingCallLogItem_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_IncomingCallLogItem_incomingCallLogId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_IncomingCallLogItem_incomingCallPolicyEscalationRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_IncomingCallLogItem_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" DROP CONSTRAINT "FK_IncomingCallPolicyLabel_incomingCallPolicyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" DROP CONSTRAINT "FK_IncomingCallPolicyLabel_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicy_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicy_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicy_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicy_routingPhoneNumber"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicyEscalationRule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicyEscalationRule_incomingCallPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicyEscalationRule_order"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLog_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLog_incomingCallPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLog_callProviderCallId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_IncomingCallLog_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLog_startedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLogItem_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLogItem_incomingCallLogId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLogItem_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLogItem_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallLogItem_startedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicyLabel_incomingCallPolicyId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_IncomingCallPolicyLabel_labelId"`,
    );
    await queryRunner.query(
      `CREATE TABLE "UserIncomingCallNumber" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "phone" character varying(30) NOT NULL, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, "verificationCode" character varying(100) NOT NULL, CONSTRAINT "PK_6e487c7ce740c2f21f83904afbe" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af7375987850451a60f0002ae4" ON "UserIncomingCallNumber" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b7f38fb56ffd49e972205cb48" ON "UserIncomingCallNumber" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "callProviderCostPerMonthInUSDCents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "customerCostPerMonthInUSDCents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "webhookPathSecret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "busyMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "maxConcurrentCalls"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "maxTotalCallDurationSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "projectCallSMSConfigId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ALTER COLUMN "version" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "phoneNumberPurchasedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "phoneNumberPurchasedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ALTER COLUMN "noOneAvailableMessage" SET DEFAULT 'We are sorry, but no on-call engineer is currently available. Please try again later or contact support.'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ALTER COLUMN "version" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ALTER COLUMN "version" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "startedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "startedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "endedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "endedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ALTER COLUMN "version" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "startedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "startedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "endedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "endedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c52bf3d9f9aca2ac74848fc0f" ON "IncomingCallPolicy" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2f54dca4c8c0bbdea4c37edb2" ON "IncomingCallPolicy" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5242e2cffd7f4050e6189e569d" ON "IncomingCallPolicy" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6680fc89e547525f8051bb2599" ON "IncomingCallPolicy" ("routingPhoneNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ff7e49f61d10020a7298c3dc6" ON "IncomingCallPolicyEscalationRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9358a64a7d4a3f48804844e69" ON "IncomingCallPolicyEscalationRule" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2940b1f9392441bcff1a33ebc4" ON "IncomingCallPolicyEscalationRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_915f3d5f9bf60430bbd89a1efc" ON "IncomingCallLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18e2254401cd580a906808d690" ON "IncomingCallLog" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4769731b4e40dd238410b47337" ON "IncomingCallLog" ("callProviderCallId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bac28bb0cfff30703cb79e4a9c" ON "IncomingCallLog" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0821fb47819572b56836b06102" ON "IncomingCallLog" ("startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d0e67775a87ffdf8b1413d5bc" ON "IncomingCallLogItem" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d11a949952998081bed04512a7" ON "IncomingCallLogItem" ("incomingCallLogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb196303d93ee4044d0a4f076e" ON "IncomingCallLogItem" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ecd45b8e5c05322459b01f37e" ON "IncomingCallLogItem" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c2f339131713708082a01cd880" ON "IncomingCallLogItem" ("startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fb7de9bbc395452347629e9131" ON "IncomingCallPolicyLabel" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fb6335122b06a052c29d3d6d8b" ON "IncomingCallPolicyLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_3c52bf3d9f9aca2ac74848fc0f7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_08a214983b56f6102a4fdecfa65" FOREIGN KEY ("projectCallSMSConfigId") REFERENCES "ProjectCallSMSConfig"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_fb8001e77d8907b8e089afa6193" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_197d35d96152cbaa101afa670bd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_3ff7e49f61d10020a7298c3dc64" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_d9358a64a7d4a3f48804844e698" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_5e2f646a84077a5fd4969ef090b" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_c0c7ea3cb722a94e074c4486b29" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_c0726b90365656bd869ad821b3b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_c434cfc9ca11de56e1b5a316559" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_915f3d5f9bf60430bbd89a1efce" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_18e2254401cd580a906808d6908" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_fb2531b7d8c44e4cad026fb8662" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_4d0e67775a87ffdf8b1413d5bcb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_d11a949952998081bed04512a77" FOREIGN KEY ("incomingCallLogId") REFERENCES "IncomingCallLog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_b1fbb2661c86de72ffd61f807b9" FOREIGN KEY ("incomingCallPolicyEscalationRuleId") REFERENCES "IncomingCallPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_cb196303d93ee4044d0a4f076e5" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_af7375987850451a60f0002ae43" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_3b7f38fb56ffd49e972205cb483" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_4565a75d2ff8c3f363ac2a9c056" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD CONSTRAINT "FK_cab048905c4eb8f87aff75feaa7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" ADD CONSTRAINT "FK_fb7de9bbc395452347629e91318" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" ADD CONSTRAINT "FK_fb6335122b06a052c29d3d6d8b5" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" DROP CONSTRAINT "FK_fb6335122b06a052c29d3d6d8b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" DROP CONSTRAINT "FK_fb7de9bbc395452347629e91318"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_cab048905c4eb8f87aff75feaa7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_4565a75d2ff8c3f363ac2a9c056"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_3b7f38fb56ffd49e972205cb483"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP CONSTRAINT "FK_af7375987850451a60f0002ae43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_cb196303d93ee4044d0a4f076e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_b1fbb2661c86de72ffd61f807b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_d11a949952998081bed04512a77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP CONSTRAINT "FK_4d0e67775a87ffdf8b1413d5bcb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_fb2531b7d8c44e4cad026fb8662"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_18e2254401cd580a906808d6908"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP CONSTRAINT "FK_915f3d5f9bf60430bbd89a1efce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_c434cfc9ca11de56e1b5a316559"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_c0726b90365656bd869ad821b3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_c0c7ea3cb722a94e074c4486b29"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_5e2f646a84077a5fd4969ef090b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_d9358a64a7d4a3f48804844e698"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP CONSTRAINT "FK_3ff7e49f61d10020a7298c3dc64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_197d35d96152cbaa101afa670bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_fb8001e77d8907b8e089afa6193"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_08a214983b56f6102a4fdecfa65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP CONSTRAINT "FK_3c52bf3d9f9aca2ac74848fc0f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb6335122b06a052c29d3d6d8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fb7de9bbc395452347629e9131"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c2f339131713708082a01cd880"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ecd45b8e5c05322459b01f37e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb196303d93ee4044d0a4f076e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d11a949952998081bed04512a7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d0e67775a87ffdf8b1413d5bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0821fb47819572b56836b06102"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bac28bb0cfff30703cb79e4a9c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4769731b4e40dd238410b47337"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18e2254401cd580a906808d690"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_915f3d5f9bf60430bbd89a1efc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2940b1f9392441bcff1a33ebc4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9358a64a7d4a3f48804844e69"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ff7e49f61d10020a7298c3dc6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6680fc89e547525f8051bb2599"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5242e2cffd7f4050e6189e569d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2f54dca4c8c0bbdea4c37edb2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c52bf3d9f9aca2ac74848fc0f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "endedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "endedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "startedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "startedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ALTER COLUMN "version" SET DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "endedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "endedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "startedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "startedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ALTER COLUMN "version" SET DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ALTER COLUMN "version" SET DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ALTER COLUMN "noOneAvailableMessage" SET DEFAULT 'We are sorry, but no on-call engineer is currently available. Please try again later or contact support.'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "phoneNumberPurchasedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "phoneNumberPurchasedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ALTER COLUMN "version" SET DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" DROP COLUMN "projectCallSMSConfigId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "maxTotalCallDurationSeconds" integer NOT NULL DEFAULT '300'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "maxConcurrentCalls" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "busyMessage" character varying(500) DEFAULT 'All lines are currently busy. Please try again in a few minutes.'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "webhookPathSecret" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "customerCostPerMonthInUSDCents" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD "callProviderCostPerMonthInUSDCents" integer`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b7f38fb56ffd49e972205cb48"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af7375987850451a60f0002ae4"`,
    );
    await queryRunner.query(`DROP TABLE "UserIncomingCallNumber"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicyLabel_labelId" ON "IncomingCallPolicyLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicyLabel_incomingCallPolicyId" ON "IncomingCallPolicyLabel" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLogItem_startedAt" ON "IncomingCallLogItem" ("startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLogItem_status" ON "IncomingCallLogItem" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLogItem_userId" ON "IncomingCallLogItem" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLogItem_incomingCallLogId" ON "IncomingCallLogItem" ("incomingCallLogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLogItem_projectId" ON "IncomingCallLogItem" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLog_startedAt" ON "IncomingCallLog" ("startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLog_status" ON "IncomingCallLog" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLog_callProviderCallId" ON "IncomingCallLog" ("callProviderCallId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLog_incomingCallPolicyId" ON "IncomingCallLog" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallLog_projectId" ON "IncomingCallLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicyEscalationRule_order" ON "IncomingCallPolicyEscalationRule" ("order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicyEscalationRule_incomingCallPolicyId" ON "IncomingCallPolicyEscalationRule" ("incomingCallPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicyEscalationRule_projectId" ON "IncomingCallPolicyEscalationRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicy_routingPhoneNumber" ON "IncomingCallPolicy" ("routingPhoneNumber") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicy_slug" ON "IncomingCallPolicy" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicy_name" ON "IncomingCallPolicy" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_IncomingCallPolicy_projectId" ON "IncomingCallPolicy" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" ADD CONSTRAINT "FK_IncomingCallPolicyLabel_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyLabel" ADD CONSTRAINT "FK_IncomingCallPolicyLabel_incomingCallPolicyId" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_IncomingCallLogItem_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_IncomingCallLogItem_incomingCallPolicyEscalationRuleId" FOREIGN KEY ("incomingCallPolicyEscalationRuleId") REFERENCES "IncomingCallPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_IncomingCallLogItem_incomingCallLogId" FOREIGN KEY ("incomingCallLogId") REFERENCES "IncomingCallLog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLogItem" ADD CONSTRAINT "FK_IncomingCallLogItem_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_IncomingCallLog_answeredByUserId" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_IncomingCallLog_incomingCallPolicyId" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallLog" ADD CONSTRAINT "FK_IncomingCallLog_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_IncomingCallPolicyEscalationRule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_IncomingCallPolicyEscalationRule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_IncomingCallPolicyEscalationRule_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_IncomingCallPolicyEscalationRule_onCallDutyPolicyScheduleId" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_IncomingCallPolicyEscalationRule_incomingCallPolicyId" FOREIGN KEY ("incomingCallPolicyId") REFERENCES "IncomingCallPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicyEscalationRule" ADD CONSTRAINT "FK_IncomingCallPolicyEscalationRule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_IncomingCallPolicy_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_IncomingCallPolicy_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingCallPolicy" ADD CONSTRAINT "FK_IncomingCallPolicy_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
