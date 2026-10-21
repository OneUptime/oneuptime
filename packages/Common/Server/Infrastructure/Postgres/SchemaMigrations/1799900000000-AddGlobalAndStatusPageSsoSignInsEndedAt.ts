import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * When a global SAML or OIDC provider, or a status page's, was last turned
 * off (signInsEndedAt): the sign-ins it gave before then no longer count,
 * even once it is turned on again, as for a project's providers
 * (AddSsoProviderSignInsEndedAt). Nullable with no default: a provider that
 * is on starts as "never turned off". A provider that is off already is
 * stamped by the next migration (EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff).
 *
 * A status page session names the provider that signed it in, if one did
 * (statusPageSsoId, statusPageOidcId), so it counts only while that provider
 * vouches for it (StatusPagePrivateUserSessionService.addSignInRule). Not
 * foreign keys: a provider deleted leaves its id behind, and its sessions
 * stop counting.
 */
export class AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000
  implements MigrationInterface
{
  public name: string = "AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUserSession" ADD "statusPageSsoId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUserSession" ADD "statusPageOidcId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageOIDC" DROP COLUMN "signInsEndedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSSO" DROP COLUMN "signInsEndedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUserSession" DROP COLUMN "statusPageOidcId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUserSession" DROP COLUMN "statusPageSsoId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP COLUMN "signInsEndedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP COLUMN "signInsEndedAt"`,
    );
  }
}
