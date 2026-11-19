import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #9824): the
 * verified domains a project's SAML provider (ProjectSsoDomain) and OIDC
 * provider (ProjectOidcDomain) serve, by which "Sign in with SSO" finds
 * them. Both join tables are new, so they are empty while their indexes and
 * keys are made, and need no online DDL.
 *
 * It writes no row: the backfill right after it
 * (BackfillSsoProviderDomains1809186540000, #9918) gives each provider made
 * before domains existed the verified domains its project alone holds, and
 * an admin picks the rest.
 */
export class AddSsoProviderDomains1809186480000 implements MigrationInterface {
  public name: string = "AddSsoProviderDomains1809186480000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectSsoDomain" ("projectSsoId" uuid NOT NULL, "domainId" uuid NOT NULL, CONSTRAINT "PK_1891ac1dda28d0024d31bc56446" PRIMARY KEY ("projectSsoId", "domainId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f67706010f6935678735d741db" ON "ProjectSsoDomain" ("projectSsoId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73e7c4346879567cf9bb58e7bc" ON "ProjectSsoDomain" ("domainId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProjectOidcDomain" ("projectOidcId" uuid NOT NULL, "domainId" uuid NOT NULL, CONSTRAINT "PK_73be40b8c54b80e9a0662ccaf69" PRIMARY KEY ("projectOidcId", "domainId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_02a7fd40608c56045ea6d20362" ON "ProjectOidcDomain" ("projectOidcId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90acd7accb6ec20781af24edab" ON "ProjectOidcDomain" ("domainId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSsoDomain" ADD CONSTRAINT "FK_f67706010f6935678735d741dbe" FOREIGN KEY ("projectSsoId") REFERENCES "ProjectSSO"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSsoDomain" ADD CONSTRAINT "FK_73e7c4346879567cf9bb58e7bc3" FOREIGN KEY ("domainId") REFERENCES "Domain"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcDomain" ADD CONSTRAINT "FK_02a7fd40608c56045ea6d20362d" FOREIGN KEY ("projectOidcId") REFERENCES "ProjectOIDC"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcDomain" ADD CONSTRAINT "FK_90acd7accb6ec20781af24edab3" FOREIGN KEY ("domainId") REFERENCES "Domain"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcDomain" DROP CONSTRAINT "FK_90acd7accb6ec20781af24edab3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOidcDomain" DROP CONSTRAINT "FK_02a7fd40608c56045ea6d20362d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSsoDomain" DROP CONSTRAINT "FK_73e7c4346879567cf9bb58e7bc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSsoDomain" DROP CONSTRAINT "FK_f67706010f6935678735d741dbe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90acd7accb6ec20781af24edab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_02a7fd40608c56045ea6d20362"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectOidcDomain"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73e7c4346879567cf9bb58e7bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f67706010f6935678735d741db"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectSsoDomain"`);
  }
}
