import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1777972687018 implements MigrationInterface {
  public name: string = "MigrationName1777972687018";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DockerResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "name" character varying(100) NOT NULL, "containerId" character varying(100), "imageName" character varying(100), "state" character varying(100), "labels" jsonb, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resourceCreationTimestamp" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_fe18834da4418412424e36df7ed" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85a3903c05939d0e6faf7dc30e" ON "DockerResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84fba362f2ac3a2550e08d16fb" ON "DockerResource" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0355903ed10c35eed76eacefb4" ON "DockerResource" ("projectId", "dockerHostId", "kind", "name") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ADD CONSTRAINT "FK_85a3903c05939d0e6faf7dc30ed" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ADD CONSTRAINT "FK_84fba362f2ac3a2550e08d16fb2" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ADD CONSTRAINT "FK_a9223bb731acb6a93f503978184" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ADD CONSTRAINT "FK_2fda4244a259a6e28de2df1b479" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DockerResource" DROP CONSTRAINT "FK_2fda4244a259a6e28de2df1b479"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" DROP CONSTRAINT "FK_a9223bb731acb6a93f503978184"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" DROP CONSTRAINT "FK_84fba362f2ac3a2550e08d16fb2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" DROP CONSTRAINT "FK_85a3903c05939d0e6faf7dc30ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0355903ed10c35eed76eacefb4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84fba362f2ac3a2550e08d16fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85a3903c05939d0e6faf7dc30e"`,
    );
    await queryRunner.query(`DROP TABLE "DockerResource"`);
  }
}
