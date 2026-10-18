import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * UserProjectSsoIdentity: the identity provider's immutable ID for the person
 * an account signed in as through a project's SAML provider, bound at the
 * first sign-in so a later one that asserts the address with another ID is
 * refused. See the model. A new table: its indexes and foreign keys hold up
 * no writer.
 */
export class AddUserProjectSsoIdentity1803750000000
  implements MigrationInterface
{
  public name: string = "AddUserProjectSsoIdentity1803750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserProjectSsoIdentity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "userId" uuid NOT NULL, "projectId" uuid NOT NULL, "projectSsoId" uuid NOT NULL, "objectId" character varying(100) NOT NULL, CONSTRAINT "PK_3b330389fef6ccacabbd9414af4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_740cae9788b87a1f51843c05a7" ON "UserProjectSsoIdentity" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a47b6768a4b5be121cd5b666f" ON "UserProjectSsoIdentity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2105a0f5afa52982dc1c58dfc1" ON "UserProjectSsoIdentity" ("projectSsoId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_UserProjectSsoIdentity_projectSsoId_userId" ON "UserProjectSsoIdentity" ("projectSsoId", "userId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoIdentity" ADD CONSTRAINT "FK_740cae9788b87a1f51843c05a76" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoIdentity" ADD CONSTRAINT "FK_4a47b6768a4b5be121cd5b666fa" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoIdentity" ADD CONSTRAINT "FK_2105a0f5afa52982dc1c58dfc1f" FOREIGN KEY ("projectSsoId") REFERENCES "ProjectSSO"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoIdentity" DROP CONSTRAINT "FK_2105a0f5afa52982dc1c58dfc1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoIdentity" DROP CONSTRAINT "FK_4a47b6768a4b5be121cd5b666fa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserProjectSsoIdentity" DROP CONSTRAINT "FK_740cae9788b87a1f51843c05a76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_UserProjectSsoIdentity_projectSsoId_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2105a0f5afa52982dc1c58dfc1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a47b6768a4b5be121cd5b666f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_740cae9788b87a1f51843c05a7"`,
    );
    await queryRunner.query(`DROP TABLE "UserProjectSsoIdentity"`);
  }
}
