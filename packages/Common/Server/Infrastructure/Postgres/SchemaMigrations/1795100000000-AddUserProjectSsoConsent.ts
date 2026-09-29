import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * UserProjectSsoConsent: the record that an account's mailbox owner agreed a
 * project's single sign-on may sign them in. See the model for why.
 */
export class AddUserProjectSsoConsent1795100000000
  implements MigrationInterface
{
  public name: string = "AddUserProjectSsoConsent1795100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserProjectSsoConsent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "userId" uuid NOT NULL, "projectId" uuid NOT NULL, CONSTRAINT "PK_7f176a58f5067976acd5e16e673" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85301f3927aa92cacc08edce68" ON "UserProjectSsoConsent" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d44fac24de1873c9ebd3d25d29" ON "UserProjectSsoConsent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_UserProjectSsoConsent_userId_projectId" ON "UserProjectSsoConsent" ("userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoConsent" ADD CONSTRAINT "FK_85301f3927aa92cacc08edce68d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoConsent" ADD CONSTRAINT "FK_d44fac24de1873c9ebd3d25d299" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoConsent" DROP CONSTRAINT "FK_d44fac24de1873c9ebd3d25d299"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoConsent" DROP CONSTRAINT "FK_85301f3927aa92cacc08edce68d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_UserProjectSsoConsent_userId_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d44fac24de1873c9ebd3d25d29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85301f3927aa92cacc08edce68"`,
    );
    await queryRunner.query(`DROP TABLE "UserProjectSsoConsent"`);
  }
}
