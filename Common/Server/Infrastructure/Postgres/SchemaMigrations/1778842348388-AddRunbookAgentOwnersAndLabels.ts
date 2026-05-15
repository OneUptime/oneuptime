import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRunbookAgentOwnersAndLabels1778842348388
  implements MigrationInterface
{
  public name: string = "AddRunbookAgentOwnersAndLabels1778842348388";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookAgentOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "runbookAgentId" uuid NOT NULL, "teamId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ac81e767045913728c22fb4e0be" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a653cf53a14952d83acaa39e1" ON "RunbookAgentOwnerTeam" ("runbookAgentId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookAgentOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "runbookAgentId" uuid NOT NULL, "userId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ca52de57e3f3953c545a21632a8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1c4d4dc5b58c7a827157edcd0" ON "RunbookAgentOwnerUser" ("runbookAgentId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookAgentLabel" ("runbookAgentId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_08bd9ba1a96b4b6ed259b7fe429" PRIMARY KEY ("runbookAgentId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c88840425bae4caee4e4553927" ON "RunbookAgentLabel" ("runbookAgentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d14e093b375792c7507fb6f8e2" ON "RunbookAgentLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" ADD CONSTRAINT "FK_a24dd370690da68a5101fba0827" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" ADD CONSTRAINT "FK_060e3fdce32f2ae3e8af08113af" FOREIGN KEY ("runbookAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" ADD CONSTRAINT "FK_59cd65c91e9ae10bd861103bb10" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" ADD CONSTRAINT "FK_72c74137f08535200785cec3eb3" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" ADD CONSTRAINT "FK_92018b0daeac19524b45c43cb7f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" ADD CONSTRAINT "FK_545f95aef235cd8abbd2d4a11ca" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" ADD CONSTRAINT "FK_2b1b7db69ee94cef9eab74b85ae" FOREIGN KEY ("runbookAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" ADD CONSTRAINT "FK_c0d14dc88c9c009c0e352fa9274" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" ADD CONSTRAINT "FK_5e51e566f7eb7ff47a8d9c11c50" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" ADD CONSTRAINT "FK_7db69d7207d704e770bb40a0c5a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" ADD CONSTRAINT "FK_c88840425bae4caee4e45539275" FOREIGN KEY ("runbookAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" ADD CONSTRAINT "FK_d14e093b375792c7507fb6f8e24" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" DROP CONSTRAINT "FK_d14e093b375792c7507fb6f8e24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" DROP CONSTRAINT "FK_c88840425bae4caee4e45539275"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" DROP CONSTRAINT "FK_7db69d7207d704e770bb40a0c5a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" DROP CONSTRAINT "FK_5e51e566f7eb7ff47a8d9c11c50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" DROP CONSTRAINT "FK_c0d14dc88c9c009c0e352fa9274"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" DROP CONSTRAINT "FK_2b1b7db69ee94cef9eab74b85ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" DROP CONSTRAINT "FK_545f95aef235cd8abbd2d4a11ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" DROP CONSTRAINT "FK_92018b0daeac19524b45c43cb7f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" DROP CONSTRAINT "FK_72c74137f08535200785cec3eb3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" DROP CONSTRAINT "FK_59cd65c91e9ae10bd861103bb10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" DROP CONSTRAINT "FK_060e3fdce32f2ae3e8af08113af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" DROP CONSTRAINT "FK_a24dd370690da68a5101fba0827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d14e093b375792c7507fb6f8e2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c88840425bae4caee4e4553927"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookAgentLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1c4d4dc5b58c7a827157edcd0"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookAgentOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a653cf53a14952d83acaa39e1"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookAgentOwnerTeam"`);
  }
}
