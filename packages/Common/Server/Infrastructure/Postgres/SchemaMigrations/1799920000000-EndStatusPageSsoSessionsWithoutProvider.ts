import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: a status page session signed in with SSO before this release
 * cannot say which provider signed it in, so it signs in again once.
 *
 * A status page session now names the provider that signed it in
 * (AddGlobalAndStatusPageSsoSignInsEndedAt), and counts only while that
 * provider vouches for it: still the status page's, on, and not turned off
 * since (StatusPagePrivateUserSessionService.addSignInRule). The sessions
 * made before this release name none. On a status page that requires SSO, a
 * session that names no provider no longer counts, so those are taken care
 * of. Elsewhere such a session counts as a password sign-in, which would let
 * an SSO sign-in from before this release outlast its provider.
 *
 * So the live sessions of the people an SSO provider signed up (a random
 * password they were never told, isSsoUser) are ended here: they could only
 * have signed in with SSO. They sign in again with SSO, and their new
 * session names its provider. Sessions of people who also have a password
 * are left alone: a password sign-in does not depend on a provider.
 *
 * Only once, and only sessions that name no provider. down() changes
 * nothing: a session ended stays ended.
 */
export const END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER: string = `UPDATE "StatusPagePrivateUserSession" AS "session" SET "isRevoked" = true, "revokedAt" = now(), "revokedReason" = 'Signed in with SSO before sessions named their provider' FROM "StatusPagePrivateUser" AS "privateUser" WHERE "session"."statusPagePrivateUserId" = "privateUser"."_id" AND "privateUser"."isSsoUser" = true AND "session"."isRevoked" = false AND "session"."refreshTokenExpiresAt" > now() AND "session"."statusPageSsoId" IS NULL AND "session"."statusPageOidcId" IS NULL`;

export class EndStatusPageSsoSessionsWithoutProvider1799920000000
  implements MigrationInterface
{
  public name: string = "EndStatusPageSsoSessionsWithoutProvider1799920000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
