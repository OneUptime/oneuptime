import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO MICROSOFT SIGN-IN AT `common` THAT IS NOT MEANT FOR EVERY ACCOUNT.
 *
 * Microsoft's `common` endpoint (login.microsoftonline.com/common) signs in
 * work, school and personal accounts of any organization, and Microsoft
 * refuses it for an app registered for one organization (AADSTS50194). The
 * Microsoft Teams account sign-in used it while the self-hosted guide asked
 * for exactly such an app, so nobody could connect their account (#5202).
 *
 * So `common` appears in product code only where the sign-in is meant for
 * every Microsoft account and its app is documented as registered for all of
 * them (SIGNS_IN_ANY_ACCOUNT). Everything else signs in at the tenant it
 * knows, or at `organizations` when it knows none and its app is documented
 * as multitenant - and the Teams sign-ins build Microsoft's URLs only through
 * MicrosoftTeamsSignInAuthority, which never names `common`, on the sign-in
 * host of the server's Microsoft cloud (MicrosoftTeamsHosts; the hosts are
 * Types/Workspace/MicrosoftTeamsCloud.ts's, MicrosoftTeamsCloudHostsGuard).
 */

// Microsoft's common endpoint, on its commercial and US Government sign-in hosts.
const COMMON_ENDPOINT: RegExp = /login\.microsoftonline\.(?:com|us)\/common\b/;

// A path into `common`, however the host in front of it is written.
const COMMON_PATH: RegExp = /\/common\//;

// Microsoft's sign-in host, written out.
const MICROSOFT_LOGIN_HOST: RegExp = /login\.microsoftonline\.com/;

/*
 * The product files that may sign in at `common`, each with why: its app
 * takes every Microsoft account by design.
 */
const SIGNS_IN_ANY_ACCOUNT: Record<string, string> = {
  /*
   * Sign in with Microsoft: a OneUptime account's own sign-in, for work,
   * school and personal Microsoft accounts alike (Microsoft Marketplace
   * requires it of a SaaS offer). Its app is registered for "Accounts in
   * any organizational directory and personal Microsoft accounts"
   * (config.example.env, MICROSOFT_SIGN_IN_CLIENT_ID).
   */
  "packages/Common/Server/Utils/MicrosoftSignIn/MicrosoftSignInClient.ts":
    "Sign in with Microsoft takes any Microsoft account",
};

// How MicrosoftTeamsSignInAuthority builds every authority: on the cloud's sign-in host.
const CLOUD_SIGN_IN_ORIGIN: string = "MicrosoftTeamsHosts.getSignInOrigin()";

const TEAMS_SIGN_IN_FILES: Array<string> = [
  "packages/Common/Server/API/MicrosoftTeamsAPI.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsSignInAuthority.ts",
];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
}

describe("Microsoft's common endpoint in product code", () => {
  test("is named only where the sign-in is meant for every Microsoft account", () => {
    const naming: Array<string> = listProductFiles()
      .filter((file: string): boolean => {
        return COMMON_ENDPOINT.test(read(file));
      })
      .sort();

    expect(naming).toEqual(Object.keys(SIGNS_IN_ANY_ACCOUNT).sort());
  });

  test("each file allowed to is still there, and still names it", () => {
    for (const file of Object.keys(SIGNS_IN_ANY_ACCOUNT)) {
      expect({ file, names: true }).toEqual({
        file,
        names: COMMON_ENDPOINT.test(read(file)),
      });
    }
  });

  test("the Microsoft Teams sign-ins never name it, nor build a Microsoft URL outside MicrosoftTeamsSignInAuthority", () => {
    for (const file of TEAMS_SIGN_IN_FILES) {
      expect({ file, common: false }).toEqual({
        file,
        common: COMMON_PATH.test(read(file)),
      });
    }

    /*
     * The Teams API builds every Microsoft sign-in URL through the one
     * module, which takes the sign-in host of the server's cloud (that it
     * names no host itself, MicrosoftTeamsCloudHostsGuard holds).
     */
    expect(read(TEAMS_SIGN_IN_FILES[0]!)).not.toMatch(MICROSOFT_LOGIN_HOST);
    expect(read(TEAMS_SIGN_IN_FILES[1]!)).toContain(CLOUD_SIGN_IN_ORIGIN);
  });
});
