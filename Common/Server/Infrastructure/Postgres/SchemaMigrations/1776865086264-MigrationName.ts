import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776865086264 implements MigrationInterface {
    name = 'MigrationName1776865086264'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "KubernetesResource" ADD "containerCount" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "KubernetesResource" DROP COLUMN "containerCount"`);
    }

}
