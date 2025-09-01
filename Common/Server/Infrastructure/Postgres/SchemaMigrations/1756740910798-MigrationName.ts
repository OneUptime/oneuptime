import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1756740910798 implements MigrationInterface {
    public name = 'MigrationName1756740910798'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "SCIMUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "scimConfigId" uuid NOT NULL, "userId" uuid NOT NULL, "externalId" character varying(500) NOT NULL, CONSTRAINT "PK_161711d359ba1935520b5aa313e" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7561dd17a97f143cdffe341184" ON "SCIMUser" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ca31718fa40f6a1ac4aa63b5d8" ON "SCIMUser" ("scimConfigId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c0bebe6a5b38293c297a6e2b1c" ON "SCIMUser" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3593cbfcd05e591bfe131bf58a" ON "SCIMUser" ("externalId") `);
        await queryRunner.query(`CREATE TABLE "StatusPageSCIMUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "statusPageId" uuid NOT NULL, "scimConfigId" uuid NOT NULL, "statusPagePrivateUserId" uuid NOT NULL, "externalId" character varying(500) NOT NULL, CONSTRAINT "PK_e2fb21d6da5fc881f7adf2310f6" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e0f38e455921c08948b9402e8f" ON "StatusPageSCIMUser" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4282ed65830c3301d7b91297b3" ON "StatusPageSCIMUser" ("statusPageId") `);
        await queryRunner.query(`CREATE INDEX "IDX_43712b2bba1e0f13970353bee6" ON "StatusPageSCIMUser" ("scimConfigId") `);
        await queryRunner.query(`CREATE INDEX "IDX_8e7127bd5155fd551b218076e0" ON "StatusPageSCIMUser" ("statusPagePrivateUserId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3cbb3996ed387428369f45b3cb" ON "StatusPageSCIMUser" ("externalId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "SCIMUser" ADD CONSTRAINT "FK_7561dd17a97f143cdffe341184f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "SCIMUser" ADD CONSTRAINT "FK_ca31718fa40f6a1ac4aa63b5d8f" FOREIGN KEY ("scimConfigId") REFERENCES "ProjectSCIM"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "SCIMUser" ADD CONSTRAINT "FK_c0bebe6a5b38293c297a6e2b1c7" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" ADD CONSTRAINT "FK_e0f38e455921c08948b9402e8ff" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" ADD CONSTRAINT "FK_4282ed65830c3301d7b91297b3f" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" ADD CONSTRAINT "FK_43712b2bba1e0f13970353bee64" FOREIGN KEY ("scimConfigId") REFERENCES "StatusPageSCIM"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" ADD CONSTRAINT "FK_8e7127bd5155fd551b218076e0e" FOREIGN KEY ("statusPagePrivateUserId") REFERENCES "StatusPagePrivateUser"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" DROP CONSTRAINT "FK_8e7127bd5155fd551b218076e0e"`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" DROP CONSTRAINT "FK_43712b2bba1e0f13970353bee64"`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" DROP CONSTRAINT "FK_4282ed65830c3301d7b91297b3f"`);
        await queryRunner.query(`ALTER TABLE "StatusPageSCIMUser" DROP CONSTRAINT "FK_e0f38e455921c08948b9402e8ff"`);
        await queryRunner.query(`ALTER TABLE "SCIMUser" DROP CONSTRAINT "FK_c0bebe6a5b38293c297a6e2b1c7"`);
        await queryRunner.query(`ALTER TABLE "SCIMUser" DROP CONSTRAINT "FK_ca31718fa40f6a1ac4aa63b5d8f"`);
        await queryRunner.query(`ALTER TABLE "SCIMUser" DROP CONSTRAINT "FK_7561dd17a97f143cdffe341184f"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3cbb3996ed387428369f45b3cb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8e7127bd5155fd551b218076e0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_43712b2bba1e0f13970353bee6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4282ed65830c3301d7b91297b3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e0f38e455921c08948b9402e8f"`);
        await queryRunner.query(`DROP TABLE "StatusPageSCIMUser"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3593cbfcd05e591bfe131bf58a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c0bebe6a5b38293c297a6e2b1c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ca31718fa40f6a1ac4aa63b5d8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7561dd17a97f143cdffe341184"`);
        await queryRunner.query(`DROP TABLE "SCIMUser"`);
    }

}
