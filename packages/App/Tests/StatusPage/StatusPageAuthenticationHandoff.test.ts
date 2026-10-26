import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
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
  /*
   * Rendered, not read as raw template text. The no-referrer tag and the
   * token-scrubbing bootstrap reach this page through an include of the shared
   * Common/Server/Views/Partials/SensitiveUrlToken partial, so a text-only read
   * sees the include directive and none of what it contributes — and the
   * ordering asserted below is an ordering in the page a browser actually
   * receives. `filename` is what lets ejs resolve that relative include.
   */
  const indexTemplatePath: string = path.join(
    FEATURE_SET,
    "StatusPage",
    "views",
    "index.ejs",
  );
  const statusPageIndex: string = ejs
    .render(
      fs.readFileSync(indexTemplatePath, "utf8"),
      { title: "Acme Status", enableGoogleTagManager: true },
      { filename: indexTemplatePath },
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
  const statusPageUtil: string = readCode(
    "StatusPage",
    "src",
    "Utils",
    "StatusPage.ts",
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

  /*
   * The session a status page SSO callback starts names the provider that
   * signed the person in, so it counts only while that provider vouches for
   * it: turning the provider off or deleting it ends the session
   * (StatusPagePrivateUserSessionService.addSignInRule).
   */
  it.each([
    ["SAML", "statusPageSsoId: statusPageSSO.id!"],
    ["OIDC", "statusPageOidcId: statusPageOidcId"],
  ])(
    "%s callback's session names the provider that signed the person in",
    (name: string, naming: string) => {
      const callback: string = callbacks.find(
        (entry: [string, string]): boolean => {
          return entry[0] === name;
        },
      )![1];

      const sessionStart: number = callback.indexOf("createLoginCodeSession");

      expect(sessionStart).toBeGreaterThan(-1);
      expect(callback.indexOf(naming, sessionStart)).toBeGreaterThan(
        sessionStart,
      );
    },
  );

  /*
   * Single sign-on keeps where the visitor was going for the round trip to
   * their identity provider; the overview takes it on the way back in. What
   * comes out of storage is checked again as it is taken - storage is
   * something another script on the origin could have written - and it is
   * kept for this tab and this page only (#5277), never under one name in
   * localStorage that any tab's overview, on any status page, took.
   */
  it("revalidates the stored post-login redirect at its final consumer", () => {
    const take: number = statusPageUtil.indexOf(
      "public static takeSignInRedirect(): string | null {",
    );
    const read: number = statusPageUtil.indexOf(
      "window.sessionStorage.getItem(storageKey)",
      take,
    );
    const validation: number = statusPageUtil.indexOf(
      "return StatusPageUtil.getSafeRedirectPath(redirectPath);",
      read,
    );

    expect(take).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(take);
    expect(validation).toBeGreaterThan(read);

    const taken: number = overview.indexOf(
      "const signInRedirectPath: string | null = StatusPageUtil.takeSignInRedirect();",
    );
    const navigation: number = overview.indexOf(
      "Navigation.navigate(new Route(signInRedirectPath))",
    );

    expect(taken).toBeGreaterThan(-1);
    expect(navigation).toBeGreaterThan(taken);
    expect(overview).not.toContain('LocalStorage.getItem("redirectUrl")');
    expect(overview).not.toContain(
      "Navigation.navigate(new Route(redirectUrl))",
    );
  });
});
