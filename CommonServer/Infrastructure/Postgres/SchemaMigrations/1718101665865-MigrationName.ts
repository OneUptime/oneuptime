import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718101665865 implements MigrationInterface {
    public name = 'MigrationName1718101665865';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "SmsLog" ALTER COLUMN "fromNumber" DROP NOT NULL`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "SmsLog" ALTER COLUMN "fromNumber" SET NOT NULL`
        );
    }
}
