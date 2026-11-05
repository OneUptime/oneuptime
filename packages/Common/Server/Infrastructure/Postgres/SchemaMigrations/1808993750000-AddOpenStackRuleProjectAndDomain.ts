import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackRuleProjectAndDomain1808993750000
  implements MigrationInterface
{
  public name: string = "AddOpenStackRuleProjectAndDomain1808993750000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudOwnerRule" ADD "openStackProjectId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudOwnerRule" ADD "openStackDomainId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudLabelRule" ADD "openStackProjectId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudLabelRule" ADD "openStackDomainId" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudLabelRule" DROP COLUMN "openStackDomainId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudLabelRule" DROP COLUMN "openStackProjectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudOwnerRule" DROP COLUMN "openStackDomainId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloudOwnerRule" DROP COLUMN "openStackProjectId"`,
    );
  }
}
