import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1722031205897 implements MigrationInterface {
  public name = "MigrationName1722031205897";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserTwoFactorAuth" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "name" character varying(100) NOT NULL, "twoFactorSecret" text NOT NULL, "twoFactorOtpUrl" text NOT NULL, "isVerified" boolean NOT NULL DEFAULT false, "deletedByUserId" uuid, "userId" uuid, CONSTRAINT "PK_1e248beb4011dcab4bd5ca73fc1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "enableTwoFactorAuth" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" ADD CONSTRAINT "FK_6e0fdd6ab0cee72277efc2bbab4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" ADD CONSTRAINT "FK_3a7c46ce8b2f60e0801a0aaeaa2" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" DROP CONSTRAINT "FK_3a7c46ce8b2f60e0801a0aaeaa2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserTwoFactorAuth" DROP CONSTRAINT "FK_6e0fdd6ab0cee72277efc2bbab4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "enableTwoFactorAuth"`,
    );
    await queryRunner.query(`DROP TABLE "UserTwoFactorAuth"`);
  }
}
