import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765477339178 implements MigrationInterface {
  public name = "MigrationName1765477339178";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD "postedFromSlackMessageId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "postedFromSlackMessageId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD "postedFromSlackMessageId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "postedFromSlackMessageId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD "postedFromSlackMessageId" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6007d639fd6dededbc77393761" ON "IncidentInternalNote" ("postedFromSlackMessageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ffc0c79197aca5dd604c9b556" ON "IncidentPublicNote" ("postedFromSlackMessageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6dff06e544ac3b99e5ec720508" ON "ScheduledMaintenanceInternalNote" ("postedFromSlackMessageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2131c4ba2b8d8e793dcc3add9e" ON "ScheduledMaintenancePublicNote" ("postedFromSlackMessageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd2d9bc2dbd669143263ae58c4" ON "AlertInternalNote" ("postedFromSlackMessageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd2d9bc2dbd669143263ae58c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2131c4ba2b8d8e793dcc3add9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6dff06e544ac3b99e5ec720508"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ffc0c79197aca5dd604c9b556"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6007d639fd6dededbc77393761"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP COLUMN "postedFromSlackMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "postedFromSlackMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP COLUMN "postedFromSlackMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "postedFromSlackMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP COLUMN "postedFromSlackMessageId"`,
    );
  }
}
