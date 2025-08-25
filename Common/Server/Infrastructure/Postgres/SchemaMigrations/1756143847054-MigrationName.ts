import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756143847054 implements MigrationInterface {
    public name = 'MigrationName1756143847054'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "WhatsAppLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "toNumber" character varying(30) NOT NULL, "fromNumber" character varying(30), "whatsAppText" character varying(500) NOT NULL, "statusMessage" character varying(500), "status" character varying(100) NOT NULL, "whatsAppCostInUSDCents" integer, "incidentId" uuid, "userId" uuid, "alertId" uuid, "scheduledMaintenanceId" uuid, "statusPageId" uuid, "statusPageAnnouncementId" uuid, "onCallDutyPolicyId" uuid, "onCallDutyPolicyEscalationRuleId" uuid, "onCallDutyPolicyScheduleId" uuid, "teamId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_9800b27ad5072db21ff1e453300" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_20e246495b31ec9720529ec13a" ON "WhatsAppLog" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ee24b8a69670171de6c19fdcaf" ON "WhatsAppLog" ("toNumber") `);
        await queryRunner.query(`CREATE INDEX "IDX_f9cf8acb2f63698431f4f18f48" ON "WhatsAppLog" ("fromNumber") `);
        await queryRunner.query(`CREATE INDEX "IDX_2f4c03d17243b8b3ddae2677ae" ON "WhatsAppLog" ("incidentId") `);
        await queryRunner.query(`CREATE INDEX "IDX_020a8349a02b6cfc79129a8deb" ON "WhatsAppLog" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_431a6f11acfd2795b17c652fbb" ON "WhatsAppLog" ("alertId") `);
        await queryRunner.query(`CREATE INDEX "IDX_048963c43c534478290408bdd7" ON "WhatsAppLog" ("scheduledMaintenanceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_16379405298dc2b312ff456fc8" ON "WhatsAppLog" ("statusPageId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4136974e8f1832f03df27057a7" ON "WhatsAppLog" ("statusPageAnnouncementId") `);
        await queryRunner.query(`CREATE INDEX "IDX_dc907429d63e2d860bb290124e" ON "WhatsAppLog" ("onCallDutyPolicyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_486f56105b72ee019cd9634272" ON "WhatsAppLog" ("onCallDutyPolicyEscalationRuleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f78a2014c70e4846df79f9e681" ON "WhatsAppLog" ("onCallDutyPolicyScheduleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a638be5c4d5e8551f7be91dd8b" ON "WhatsAppLog" ("teamId") `);
        await queryRunner.query(`CREATE TABLE "UserWhatsApp" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "phone" character varying(30) NOT NULL, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, "verificationCode" character varying(100), CONSTRAINT "PK_19ab8aa5949cb38d08930e959ad" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cacaefed4f479bf300d4065c80" ON "UserWhatsApp" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b99e3db0cecd0e5f15b1f6738a" ON "UserWhatsApp" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b99e3db0cecd0e5f15b1f6738a" ON "UserWhatsApp" ("userId") `);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" ADD "userWhatsAppId" uuid`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD "userWhatsAppId" uuid`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`CREATE INDEX "IDX_73297560a1a70e4fe47eac2986" ON "UserNotificationRule" ("userWhatsAppId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0a67c82e4e093ae5c89d2d76bd" ON "UserOnCallLogTimeline" ("userWhatsAppId") `);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_20e246495b31ec9720529ec13a6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_2f4c03d17243b8b3ddae2677ae1" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_020a8349a02b6cfc79129a8deba" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_431a6f11acfd2795b17c652fbb5" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_048963c43c534478290408bdd78" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_16379405298dc2b312ff456fc88" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_4136974e8f1832f03df27057a7e" FOREIGN KEY ("statusPageAnnouncementId") REFERENCES "StatusPageAnnouncement"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_dc907429d63e2d860bb290124e3" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_486f56105b72ee019cd96342723" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_f78a2014c70e4846df79f9e681a" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_a638be5c4d5e8551f7be91dd8be" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "FK_2f75dca0a039aa9384de646f759" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" ADD CONSTRAINT "FK_cacaefed4f479bf300d4065c802" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" ADD CONSTRAINT "FK_b99e3db0cecd0e5f15b1f6738aa" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" ADD CONSTRAINT "FK_57d2f22db228562775e3274975a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" ADD CONSTRAINT "FK_e90592dde8357dd1afbf19073d8" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_73297560a1a70e4fe47eac29861" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf"`);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_73297560a1a70e4fe47eac29861"`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" DROP CONSTRAINT "FK_e90592dde8357dd1afbf19073d8"`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" DROP CONSTRAINT "FK_57d2f22db228562775e3274975a"`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" DROP CONSTRAINT "FK_b99e3db0cecd0e5f15b1f6738aa"`);
        await queryRunner.query(`ALTER TABLE "UserWhatsApp" DROP CONSTRAINT "FK_cacaefed4f479bf300d4065c802"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_2f75dca0a039aa9384de646f759"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_a638be5c4d5e8551f7be91dd8be"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_f78a2014c70e4846df79f9e681a"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_486f56105b72ee019cd96342723"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_dc907429d63e2d860bb290124e3"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_4136974e8f1832f03df27057a7e"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_16379405298dc2b312ff456fc88"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_048963c43c534478290408bdd78"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_431a6f11acfd2795b17c652fbb5"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_020a8349a02b6cfc79129a8deba"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_2f4c03d17243b8b3ddae2677ae1"`);
        await queryRunner.query(`ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "FK_20e246495b31ec9720529ec13a6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a67c82e4e093ae5c89d2d76bd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_73297560a1a70e4fe47eac2986"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userWhatsAppId"`);
        await queryRunner.query(`ALTER TABLE "UserNotificationRule" DROP COLUMN "userWhatsAppId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b99e3db0cecd0e5f15b1f6738a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b99e3db0cecd0e5f15b1f6738a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cacaefed4f479bf300d4065c80"`);
        await queryRunner.query(`DROP TABLE "UserWhatsApp"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a638be5c4d5e8551f7be91dd8b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f78a2014c70e4846df79f9e681"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_486f56105b72ee019cd9634272"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc907429d63e2d860bb290124e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4136974e8f1832f03df27057a7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_16379405298dc2b312ff456fc8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_048963c43c534478290408bdd7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_431a6f11acfd2795b17c652fbb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_020a8349a02b6cfc79129a8deb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2f4c03d17243b8b3ddae2677ae"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f9cf8acb2f63698431f4f18f48"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee24b8a69670171de6c19fdcaf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_20e246495b31ec9720529ec13a"`);
        await queryRunner.query(`DROP TABLE "WhatsAppLog"`);
    }

}
