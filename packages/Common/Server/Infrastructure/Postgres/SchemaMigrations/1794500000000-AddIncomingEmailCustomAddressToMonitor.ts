import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncomingEmailCustomAddressToMonitor1794500000000
  implements MigrationInterface
{
  public name: string = "AddIncomingEmailCustomAddressToMonitor1794500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingEmailCustomLocalPart" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "UQ_7abf86b592dbbe8bf8a38bad6e5" UNIQUE ("incomingEmailCustomLocalPart")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "UQ_7abf86b592dbbe8bf8a38bad6e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailCustomLocalPart"`,
    );
  }
}
