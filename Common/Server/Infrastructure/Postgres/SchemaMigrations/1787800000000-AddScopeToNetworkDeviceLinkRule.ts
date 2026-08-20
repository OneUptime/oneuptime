import { MigrationInterface, QueryRunner } from "typeorm";

export class AddScopeToNetworkDeviceLinkRule1787800000000
  implements MigrationInterface
{
  public name: string = "AddScopeToNetworkDeviceLinkRule1787800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" ADD "scope" character varying(100) DEFAULT 'Project'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLinkRule" DROP COLUMN "scope"`,
    );
  }
}
