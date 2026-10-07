import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * When a project's SAML or OIDC provider was last turned off
 * (Server/Utils/ProjectSsoProviderChanges): the sign-ins it gave before then
 * no longer count, even once it is turned on again
 * (Server/Utils/ProjectSsoProviderStanding).
 *
 * Nullable with no default: a provider that is on starts as "never turned
 * off", and the sign-ins it gave keep counting while it stays on. A provider
 * that is off already is stamped by the next migration
 * (EndSignInsOfSsoProvidersAlreadyOff).
 */
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
