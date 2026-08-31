import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");
const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

function readCode(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(FEATURE_SET, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("Status Page authentication handoff", () => {
  const masterPage: string = readCode(
    "StatusPage",
    "src",
    "Components",
    "MasterPage",
    "MasterPage.tsx",
  );
  const loginUtil: string = readCode("StatusPage", "src", "Utils", "Login.ts");
  const loginCodeUtil: string = readCode(
    "StatusPage",
    "src",
    "Utils",
    "LoginCode.ts",
  );
  const statusPageIndex: string = fs
    .readFileSync(
      path.join(FEATURE_SET, "StatusPage", "views", "index.ejs"),
      "utf8",
    )
    .replace(/\s+/g, " ");
  const authenticationApi: string = readCode(
    "Identity",
    "API",
    "StatusPageAuthentication.ts",
  );
  const overview: string = readCode(
    "StatusPage",
    "src",
    "Pages",
    "Overview",
    "Overview.tsx",
  );
  const callbacks: Array<[string, string]> = [
    ["SAML", readCode("Identity", "API", "StatusPageSSO.ts")],
    ["OIDC", readCode("Identity", "API", "StatusPageOIDC.ts")],
  ];

  it("contains no client-side JWT decoder", () => {
    expect(
      fs.existsSync(path.join(COMMON_UI, "Utils", "JsonWebToken.ts")),
    ).toBe(false);
    expect(masterPage).not.toContain("JSONWebToken");
    expect(masterPage).not.toContain('getQueryStringByName("redirectUrl")');
  });

  it("exchanges the opaque code with the destination-origin server", () => {
    expect(masterPage).toContain("LOGIN_CODE_EXCHANGE_API_URL");
    expect(masterPage).toContain("LoginCodeUtil.consume()");
    expect(loginCodeUtil).toContain('getQueryStringByName("loginCode")');
    expect(masterPage).toContain("LoginUtil.login({ user })");
    expect(masterPage).toContain(
      "Navigation.setQueryString({ loginCode: null, token: null })",
    );
  });

  it("scrubs bearer credentials before loading assets or analytics", () => {
    const capture: number = statusPageIndex.indexOf(
      'searchParams.get("loginCode")',
    );
    const scrub: number = statusPageIndex.indexOf(
      'searchParams.delete("loginCode")',
    );
    const firstExternalScript: number = statusPageIndex.indexOf(
      '<script src="/status-page/env.js">',
    );

    expect(statusPageIndex).toContain(
      '<meta name="referrer" content="no-referrer" />',
    );
    expect(capture).toBeGreaterThan(-1);
    expect(scrub).toBeGreaterThan(capture);
    expect(firstExternalScript).toBeGreaterThan(scrub);
    expect(statusPageIndex).toContain(
      "__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__",
    );
  });

  it("treats an invalid callback as bad input without logging out a valid session", () => {
    expect(authenticationApi).toContain(
      'new BadDataException("Login code is invalid or expired.")',
    );
    expect(masterPage).not.toContain("PageMap.LOGOUT");
    expect(masterPage).not.toContain("PageMap.PREVIEW_LOGOUT");
    expect(masterPage).toContain("Navigation.navigate(overviewRoute");
  });

  it("never installs an authentication cookie from browser-controlled data", () => {
    expect(loginUtil).not.toContain("Cookie.setItem");
    expect(loginUtil).not.toContain("user-token-");
    expect(loginUtil).not.toContain("token:");
  });

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

  it("revalidates the stored post-login redirect at its final consumer", () => {
    const validation: number = overview.indexOf(
      "StatusPageUtil.getSafeRedirectPath(redirectUrl)",
    );
    const navigation: number = overview.indexOf(
      "Navigation.navigate(new Route(safeRedirectPath))",
    );

    expect(validation).toBeGreaterThan(-1);
    expect(navigation).toBeGreaterThan(validation);
    expect(overview).not.toContain(
      "Navigation.navigate(new Route(redirectUrl))",
    );
  });
});
