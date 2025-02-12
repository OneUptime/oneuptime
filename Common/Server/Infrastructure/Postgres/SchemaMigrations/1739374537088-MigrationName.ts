import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1739374537088 implements MigrationInterface {
    public name = 'MigrationName1739374537088'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Incident" RENAME COLUMN "postUpdatesToSlackChannelId" TO "postUpdatesToSlackChannelName"`);
        await queryRunner.query(`ALTER TABLE "Alert" RENAME COLUMN "postUpdatesToSlackChannelId" TO "postUpdatesToSlackChannelName"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "postUpdatesToSlackChannelId" TO "postUpdatesToSlackChannelName"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "postUpdatesToSlackChannelName" TO "postUpdatesToSlackChannelId"`);
        await queryRunner.query(`ALTER TABLE "Alert" RENAME COLUMN "postUpdatesToSlackChannelName" TO "postUpdatesToSlackChannelId"`);
        await queryRunner.query(`ALTER TABLE "Incident" RENAME COLUMN "postUpdatesToSlackChannelName" TO "postUpdatesToSlackChannelId"`);
    }

}
