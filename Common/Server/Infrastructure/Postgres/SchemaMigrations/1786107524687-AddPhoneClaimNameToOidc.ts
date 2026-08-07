import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPhoneClaimNameToOidc1786107524687
  implements MigrationInterface
{
  public name = "AddPhoneClaimNameToOidc1786107524687";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" ADD "phoneClaimName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD "phoneClaimName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP COLUMN "phoneClaimName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" DROP COLUMN "phoneClaimName"`,
    );
  }
}
