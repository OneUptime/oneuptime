import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736788706141 implements MigrationInterface {
  public name = "MigrationName1736788706141";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "IncidentFeed" ADD "userId" uuid`);
    await queryRunner.query(`ALTER TABLE "AlertFeed" ADD "userId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD "userId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD CONSTRAINT "FK_010577090e59583da93c867f541" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD CONSTRAINT "FK_97b19fbc90b6105614cc0cba300" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD CONSTRAINT "FK_541c2b40579cbf342c8850ced2b" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP CONSTRAINT "FK_541c2b40579cbf342c8850ced2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" DROP CONSTRAINT "FK_97b19fbc90b6105614cc0cba300"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP CONSTRAINT "FK_010577090e59583da93c867f541"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP COLUMN "userId"`,
    );
    await queryRunner.query(`ALTER TABLE "AlertFeed" DROP COLUMN "userId"`);
    await queryRunner.query(`ALTER TABLE "IncidentFeed" DROP COLUMN "userId"`);
  }
}
