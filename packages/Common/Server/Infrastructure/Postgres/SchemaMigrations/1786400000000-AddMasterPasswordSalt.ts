import { MigrationInterface, QueryRunner } from "typeorm";

type ScryptHashExistsResult = {
  exists: boolean;
};

export class AddMasterPasswordSalt1786400000000 implements MigrationInterface {
  public name = "AddMasterPasswordSalt1786400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "masterPasswordSalt" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "masterPasswordSalt" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [dashboardResult] = (await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM "Dashboard" WHERE "masterPassword" LIKE 'scrypt$%') AS "exists"`,
    )) as Array<ScryptHashExistsResult>;
    const [statusPageResult] = (await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM "StatusPage" WHERE "masterPassword" LIKE 'scrypt$%') AS "exists"`,
    )) as Array<ScryptHashExistsResult>;

    if (dashboardResult?.exists || statusPageResult?.exists) {
      throw new Error(
        "Cannot remove master-password salt columns while scrypt master-password hashes exist.",
      );
    }

    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "masterPasswordSalt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "masterPasswordSalt"`,
    );
  }
}
