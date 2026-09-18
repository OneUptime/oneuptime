import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageImageAltText1782100000000
  implements MigrationInterface
{
  public name = "AddStatusPageImageAltText1782100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "logoAltText" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "coverImageAltText" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "coverImageAltText"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "logoAltText"`,
    );
  }
}
