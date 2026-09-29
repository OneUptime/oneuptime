import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The status page SAML and OIDC callbacks hand the browser back to the status
 * page with a short-lived, single-use login code - never with an access
 * token in the URL, and never by planting a cookie on the identity host. The
 * status page then exchanges the code with its own origin; that half is core
 * and stays covered by
 * packages/App/Tests/StatusPage/StatusPageAuthenticationHandoff.test.ts.
 *
 * These checks moved here with the two callbacks when they became Enterprise
 * Edition code.
 */

const IDENTITY_API: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Identity",
  "API",
);

function readCode(fileName: string): string {
  return fs
    .readFileSync(path.join(IDENTITY_API, fileName), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("status page SSO callbacks", () => {
  const callbacks: Array<[string, string]> = [
    ["SAML", readCode("StatusPageSSO.ts")],
    ["OIDC", readCode("StatusPageOIDC.ts")],
  ];

  it.each(callbacks)(
    "%s callback emits a short-lived login code rather than an access token",
    (_name: string, callback: string) => {
      expect(callback).toContain("createLoginCodeSession");
      expect(callback).toContain("loginCode: sessionMetadata.refreshToken");
      expect(callback).not.toContain("token: token");
      expect(callback).not.toContain("setStatusPagePrivateUserCookie");
      expect(callback).not.toContain('getQueryStringByName("redirectUrl")');
      expect(callback).toContain("Response.setNoCacheHeaders(res)");
    },
  );
});
