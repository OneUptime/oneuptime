import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The two ALTER TABLE statements were generated with npm run
 * generate-postgres-migration, then renumbered after the last registered
 * migration. The two UPDATE statements were written by hand.
 *
 * When a project's SAML or OIDC provider was last turned off
 * (Server/Utils/ProjectSsoProviderChanges): the sign-ins it gave before then
 * no longer count, even once it is turned on again
 * (Server/Utils/ProjectSsoProviderStanding).
 *
 * Nullable with no default: a provider that is on starts as "never turned
 * off", and the sign-ins it gave keep counting while it stays on. A provider
 * that is off already is treated as turned off now, so turning it on again
 * later does not bring back the sign-ins it gave before, as for a provider
 * turned off after this release.
 */
export const END_SIGN_INS_OF_SAML_PROVIDERS_OFF: string = `UPDATE "ProjectSSO" SET "signInsEndedAt" = now() WHERE "isEnabled" = false`;

export const END_SIGN_INS_OF_OIDC_PROVIDERS_OFF: string = `UPDATE "ProjectOIDC" SET "signInsEndedAt" = now() WHERE "isEnabled" = false`;

export class AddSsoProviderSignInsEndedAt1799800000000
  implements MigrationInterface
{
  public name: string = "AddSsoProviderSignInsEndedAt1799800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(END_SIGN_INS_OF_SAML_PROVIDERS_OFF);
    await queryRunner.query(END_SIGN_INS_OF_OIDC_PROVIDERS_OFF);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectOIDC" DROP COLUMN "signInsEndedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSSO" DROP COLUMN "signInsEndedAt"`,
    );
  }
}
