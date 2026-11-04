import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackHostLinkAndInstanceMetrics1808992930000 implements MigrationInterface {
    name = 'AddOpenStackHostLinkAndInstanceMetrics1808992930000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "instanceMetricsOptions" jsonb`);
        await queryRunner.query(`ALTER TABLE "Host" ADD "openStackCloudId" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "openStackCloudId"`);
        await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "instanceMetricsOptions"`);
    }

}
