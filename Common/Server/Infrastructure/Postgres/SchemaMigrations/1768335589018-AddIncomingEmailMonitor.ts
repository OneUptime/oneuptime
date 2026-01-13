import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncomingEmailMonitor1768335589018 implements MigrationInterface {
  public name = "AddIncomingEmailMonitor1768335589018";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingEmailSecretKey" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_Monitor_incomingEmailSecretKey" ON "Monitor" ("incomingEmailSecretKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingEmailMonitorLastEmailReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_Monitor_incomingEmailMonitorLastEmailReceivedAt" ON "Monitor" ("incomingEmailMonitorLastEmailReceivedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingEmailMonitorRequest" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingEmailMonitorHeartbeatCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_Monitor_incomingEmailMonitorHeartbeatCheckedAt" ON "Monitor" ("incomingEmailMonitorHeartbeatCheckedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_Monitor_incomingEmailMonitorHeartbeatCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailMonitorHeartbeatCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailMonitorRequest"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_Monitor_incomingEmailMonitorLastEmailReceivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailMonitorLastEmailReceivedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_Monitor_incomingEmailSecretKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailSecretKey"`,
    );
  }
}
