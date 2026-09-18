import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Adds the opt-in that decides whether a Global SSO / Global OIDC provider's
 * project attachments act as an ACCESS boundary as well as a provisioning one.
 *
 * Defaults to false, which is the behaviour every existing installation
 * already has: a global login satisfies SSO enforcement for every project the
 * user is a member of. Attachments were introduced as the provisioning
 * allow-list - "a SAML assertion can only ever provision a user into projects
 * that a master admin has explicitly attached here" - and the login routers
 * grant a session on membership of ANY project, so silently reinterpreting
 * them as an access boundary would lock existing users out of projects they
 * legitimately reach, with nothing in the product to recover with.
 *
 * An admin who wants the narrower behaviour turns it on per provider.
 */
export class AddRestrictToAttachedProjectsToGlobalSso1787900000000
  implements MigrationInterface
{
  public name = "AddRestrictToAttachedProjectsToGlobalSso1787900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" ADD "restrictToAttachedProjects" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" ADD "restrictToAttachedProjects" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalOIDC" DROP COLUMN "restrictToAttachedProjects"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalSSO" DROP COLUMN "restrictToAttachedProjects"`,
    );
  }
}
