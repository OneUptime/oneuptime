import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data cleanup: take the Microsoft Graph app token out of
 * WorkspaceProjectAuthToken.miscData.
 *
 * Microsoft Teams connections cached the tenant's app-only Graph token, and
 * its expiry, in miscData. That column is readable by every project Viewer
 * through the CRUD API. The token now lives only in the server-only
 * `authToken` / `authTokenExpiresAt` columns (`authToken` always held the same
 * token), so the copies in miscData are deleted here.
 *
 * `authTokenExpiresAt` is deliberately not backfilled from the old miscData
 * value. A Teams connection with no recorded expiry mints a fresh token on its
 * next Graph call, and that records one.
 *
 * Only JSON objects are touched: `-` raises on a JSON scalar, and `?|` would
 * match a scalar string equal to one of the keys.
 *
 * down() restores nothing. The values were short-lived credentials the server
 * mints again on demand, and putting them back would reopen the exposure.
 */
export class RemoveAppAccessTokenFromWorkspaceProjectAuthTokenMiscData1794700000000
  implements MigrationInterface
{
  public name: string =
    "RemoveAppAccessTokenFromWorkspaceProjectAuthTokenMiscData1794700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "WorkspaceProjectAuthToken" SET "miscData" = "miscData" - 'appAccessToken' - 'appAccessTokenExpiresAt' - 'lastAppTokenIssuedAt' WHERE jsonb_typeof("miscData") = 'object' AND "miscData" ?| ARRAY['appAccessToken', 'appAccessTokenExpiresAt', 'lastAppTokenIssuedAt']`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
