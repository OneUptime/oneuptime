import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * ProjectSCIMUser: what a project SCIM connection keeps of each user it
 * provisioned - whether the identity provider has them active, and what it
 * sent for them - so a deactivated user is still found, inactive. See the
 * model. A new table: its indexes and foreign keys hold up no writer.
 *
 * The OAuth 2.0 client secrets of project and status page SCIM connections
 * (hashed, with when each expires): new nullable columns with no default,
 * which change no row.
 */
export class AddProjectSCIMUsersAndClientSecrets1803700000000
  implements MigrationInterface
{
  public name: string = "AddProjectSCIMUsersAndClientSecrets1803700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectSCIMUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "projectScimId" uuid NOT NULL, "userId" uuid NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "userName" character varying(500), "externalId" character varying(500), "scimAttributes" jsonb, CONSTRAINT "PK_1054a1e8fc0d555b0003b8aa582" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92f0121e82ad87656cc219fdd8" ON "ProjectSCIMUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45bc65e521fcfb1a8c178a8b48" ON "ProjectSCIMUser" ("projectScimId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e11966367e41c7b0b243b1af06" ON "ProjectSCIMUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ProjectSCIMUser_projectScimId_userId" ON "ProjectSCIMUser" ("projectScimId", "userId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD "oauthClientSecretHash" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD "oauthClientSecretExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD "oauthPreviousClientSecretHash" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" ADD "oauthPreviousClientSecretExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD "oauthClientSecretHash" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD "oauthClientSecretExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD "oauthPreviousClientSecretHash" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD "oauthPreviousClientSecretExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMUser" ADD CONSTRAINT "FK_92f0121e82ad87656cc219fdd89" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMUser" ADD CONSTRAINT "FK_45bc65e521fcfb1a8c178a8b488" FOREIGN KEY ("projectScimId") REFERENCES "ProjectSCIM"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMUser" ADD CONSTRAINT "FK_e11966367e41c7b0b243b1af065" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMUser" DROP CONSTRAINT "FK_e11966367e41c7b0b243b1af065"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMUser" DROP CONSTRAINT "FK_45bc65e521fcfb1a8c178a8b488"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIMUser" DROP CONSTRAINT "FK_92f0121e82ad87656cc219fdd89"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP COLUMN "oauthPreviousClientSecretExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP COLUMN "oauthPreviousClientSecretHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP COLUMN "oauthClientSecretExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP COLUMN "oauthClientSecretHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP COLUMN "oauthPreviousClientSecretExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP COLUMN "oauthPreviousClientSecretHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP COLUMN "oauthClientSecretExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSCIM" DROP COLUMN "oauthClientSecretHash"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ProjectSCIMUser_projectScimId_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e11966367e41c7b0b243b1af06"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45bc65e521fcfb1a8c178a8b48"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92f0121e82ad87656cc219fdd8"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectSCIMUser"`);
  }
}
