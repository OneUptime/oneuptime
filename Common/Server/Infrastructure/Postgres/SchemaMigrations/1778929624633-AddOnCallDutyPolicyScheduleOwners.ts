import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOnCallDutyPolicyScheduleOwners1778929624633
  implements MigrationInterface
{
  public name: string = "AddOnCallDutyPolicyScheduleOwners1778929624633";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyScheduleOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "onCallDutyPolicyScheduleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_1807186a9177dd65a12c20e9d1a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35098bf76f97bdcaf9290093e0" ON "OnCallDutyPolicyScheduleOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_723878127ba7082474963b5926" ON "OnCallDutyPolicyScheduleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_70e8807aa1d4903997dd15c6ea" ON "OnCallDutyPolicyScheduleOwnerTeam" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fffe2a99c9b7fc59cff3e8035" ON "OnCallDutyPolicyScheduleOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_377b22d5ffc7f1e3d5085a27ea" ON "OnCallDutyPolicyScheduleOwnerTeam" ("onCallDutyPolicyScheduleId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "OnCallDutyPolicyScheduleOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "onCallDutyPolicyScheduleId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_202aa1526c5fca7af8d3b55f0a2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2415a13ed9e2223d866a6ede1d" ON "OnCallDutyPolicyScheduleOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6c91d3f742a78985ba84aaff3" ON "OnCallDutyPolicyScheduleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c13ffb9268e57ed7843ecb46a2" ON "OnCallDutyPolicyScheduleOwnerUser" ("onCallDutyPolicyScheduleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_21d632252f9ba79784a49dbb09" ON "OnCallDutyPolicyScheduleOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abc604b71465bc5579525ff256" ON "OnCallDutyPolicyScheduleOwnerUser" ("onCallDutyPolicyScheduleId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" ADD CONSTRAINT "FK_35098bf76f97bdcaf9290093e03" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" ADD CONSTRAINT "FK_723878127ba7082474963b5926a" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" ADD CONSTRAINT "FK_70e8807aa1d4903997dd15c6ea9" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" ADD CONSTRAINT "FK_5ed3837c07ed37cd6a803078686" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" ADD CONSTRAINT "FK_4777eabd2b25fd992d96e587aa6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" ADD CONSTRAINT "FK_2415a13ed9e2223d866a6ede1d0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" ADD CONSTRAINT "FK_a6c91d3f742a78985ba84aaff32" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" ADD CONSTRAINT "FK_c13ffb9268e57ed7843ecb46a2e" FOREIGN KEY ("onCallDutyPolicyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" ADD CONSTRAINT "FK_149c46aeb6eea203cbe286aa3ef" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" ADD CONSTRAINT "FK_7d4b5fea944b7fded0751a430cf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" DROP CONSTRAINT "FK_7d4b5fea944b7fded0751a430cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" DROP CONSTRAINT "FK_149c46aeb6eea203cbe286aa3ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" DROP CONSTRAINT "FK_c13ffb9268e57ed7843ecb46a2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" DROP CONSTRAINT "FK_a6c91d3f742a78985ba84aaff32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerUser" DROP CONSTRAINT "FK_2415a13ed9e2223d866a6ede1d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" DROP CONSTRAINT "FK_4777eabd2b25fd992d96e587aa6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" DROP CONSTRAINT "FK_5ed3837c07ed37cd6a803078686"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" DROP CONSTRAINT "FK_70e8807aa1d4903997dd15c6ea9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" DROP CONSTRAINT "FK_723878127ba7082474963b5926a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleOwnerTeam" DROP CONSTRAINT "FK_35098bf76f97bdcaf9290093e03"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abc604b71465bc5579525ff256"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_21d632252f9ba79784a49dbb09"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c13ffb9268e57ed7843ecb46a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6c91d3f742a78985ba84aaff3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2415a13ed9e2223d866a6ede1d"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyScheduleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_377b22d5ffc7f1e3d5085a27ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fffe2a99c9b7fc59cff3e8035"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_70e8807aa1d4903997dd15c6ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_723878127ba7082474963b5926"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35098bf76f97bdcaf9290093e0"`,
    );
    await queryRunner.query(`DROP TABLE "OnCallDutyPolicyScheduleOwnerTeam"`);
  }
}
