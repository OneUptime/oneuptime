import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRedisAndPostgresHealthNotificationColumns1785749674203
  implements MigrationInterface
{
  public name: string =
    "AddRedisAndPostgresHealthNotificationColumns1785749674203";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "redisMemoryNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "redisMemoryNotificationThresholdPercent" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "redisConnectionNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "redisConnectionNotificationThresholdPercent" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "redisKeyEvictionNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "redisPersistenceFailureNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresStorageNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresStorageLimitInGb" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresStorageNotificationThresholdPercent" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresConnectionNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresConnectionNotificationThresholdPercent" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresWraparoundNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresWraparoundNotificationThresholdPercent" integer NOT NULL DEFAULT '50'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresReplicationSlotNotificationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "postgresRetainedWalLimitInGb" integer NOT NULL DEFAULT '10'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresRetainedWalLimitInGb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresReplicationSlotNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresWraparoundNotificationThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresWraparoundNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresConnectionNotificationThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresConnectionNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresStorageNotificationThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresStorageLimitInGb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "postgresStorageNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "redisPersistenceFailureNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "redisKeyEvictionNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "redisConnectionNotificationThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "redisConnectionNotificationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "redisMemoryNotificationThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "redisMemoryNotificationEnabled"`,
    );
  }
}
