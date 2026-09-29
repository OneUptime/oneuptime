import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedByUserToUser1784048917994 implements MigrationInterface {
  public name: string = "AddCreatedByUserToUser1784048917994";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Track who created (invited) a user, when they were invited by another user.
     * Existing users are left NULL; this is only populated going forward.
     */
    await queryRunner.query(`ALTER TABLE "User" ADD "createdByUserId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "User" ADD CONSTRAINT "FK_cd94f8dd722e4d9e890b68ea262" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP CONSTRAINT "FK_cd94f8dd722e4d9e890b68ea262"`,
    );
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "createdByUserId"`);
  }
}
