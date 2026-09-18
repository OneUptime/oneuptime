import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOwnerRuleInheritFlags1778413144103
  implements MigrationInterface
{
  public name: string = "AddOwnerRuleInheritFlags1778413144103";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "inheritOwnersFromMonitors" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "inheritOwnersFromHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "inheritOwnersFromMonitors" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "inheritOwnersFromHosts" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "inheritOwnersFromHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "inheritOwnersFromMonitors"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "inheritOwnersFromHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "inheritOwnersFromMonitors"`,
    );
  }
}
