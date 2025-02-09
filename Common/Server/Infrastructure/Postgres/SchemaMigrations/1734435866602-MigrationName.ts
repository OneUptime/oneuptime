import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1734435866602 implements MigrationInterface {
  public name = "MigrationName1734435866602";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "isSubscriptionConfirmed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "subscriptionConfirmationToken" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "subscriptionConfirmationToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "isSubscriptionConfirmed"`,
    );
  }
}
