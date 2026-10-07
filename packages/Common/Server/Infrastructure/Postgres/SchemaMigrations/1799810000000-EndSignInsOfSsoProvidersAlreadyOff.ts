import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: a project's SAML or OIDC provider that is off at the upgrade
 * counts as turned off now (signInsEndedAt, AddSsoProviderSignInsEndedAt).
 *
 * Turning a provider off now stamps when (Server/Utils/
 * ProjectSsoProviderChanges), and the sign-ins it gave before then no longer
 * count, even once it is turned on again (Server/Utils/
 * ProjectSsoProviderStanding). A provider turned off before this release has
 * no stamp; without one, turning it on again would bring back every sign-in
 * it gave before it was turned off. Stamping it now treats it as a provider
 * turned off after this release: its earlier sign-ins stay ended, and the
 * ones it gives once it is on again count.
 *
 * Only providers that are off are stamped, and only once: a provider that is
 * on keeps no stamp, and the sign-ins it gave keep counting.
 *
 * down() changes nothing: the stamp is dropped with its column, by the
 * migration before this one.
 */
export const END_SIGN_INS_OF_SAML_PROVIDERS_OFF: string = `UPDATE "ProjectSSO" SET "signInsEndedAt" = now() WHERE "isEnabled" = false AND "signInsEndedAt" IS NULL`;

export const END_SIGN_INS_OF_OIDC_PROVIDERS_OFF: string = `UPDATE "ProjectOIDC" SET "signInsEndedAt" = now() WHERE "isEnabled" = false AND "signInsEndedAt" IS NULL`;

export class EndSignInsOfSsoProvidersAlreadyOff1799810000000
  implements MigrationInterface
{
  public name: string = "EndSignInsOfSsoProvidersAlreadyOff1799810000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(END_SIGN_INS_OF_SAML_PROVIDERS_OFF);
    await queryRunner.query(END_SIGN_INS_OF_OIDC_PROVIDERS_OFF);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
