import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1730117995642 implements MigrationInterface {
  public name = "MigrationName1730117995642";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "allowSubscribersToChooseEventTypes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "isSubscribedToAllEventTypes" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "statusPageEventTypes" jsonb DEFAULT '[]'`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "statusPageEventTypes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "isSubscribedToAllEventTypes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "allowSubscribersToChooseEventTypes"`,
    );
  }
}
