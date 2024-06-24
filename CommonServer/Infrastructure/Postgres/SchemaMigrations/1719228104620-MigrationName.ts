import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1719228104620 implements MigrationInterface {
    public name = 'MigrationName1719228104620'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE CopilotEvent`);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
       // we dont use this table anymore. 
    }

}
