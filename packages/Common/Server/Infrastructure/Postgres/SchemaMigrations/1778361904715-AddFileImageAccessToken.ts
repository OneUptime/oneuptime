import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFileImageAccessToken1778361904715
  implements MigrationInterface
{
  public name: string = "AddFileImageAccessToken1778361904715";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" ADD "imageAccessToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" ADD CONSTRAINT "UQ_1b6a1da6fbbcdb5c30e3b913286" UNIQUE ("imageAccessToken")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" DROP CONSTRAINT "UQ_1b6a1da6fbbcdb5c30e3b913286"`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" DROP COLUMN "imageAccessToken"`,
    );
  }
}
