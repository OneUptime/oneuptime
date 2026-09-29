import ejs from "ejs";
import nodePath from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * SsoSignInConfirmation.ejs - the page a project-SSO confirmation email links
 * to (ee/Server/Identity/API/ProjectSsoSignInConfirmation.ts renders it).
 *
 * What the page has to get right, each of which fails silently:
 *
 *  - it confirms with a POST behind a button, never on load: mail scanners
 *    open links before people do;
 *  - the URL that opened it carries a single-use token, so no Referer may
 *    carry that URL anywhere, and no third-party tag may load;
 *  - the project name in its message is chosen by that project's admins, so
 *    every value is printed escaped.
 */

const VIEW: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "Views",
  "SsoSignInConfirmation.ejs",
);

const TOKEN: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SIGNATURE: string = "0123456789abcdef".repeat(4);
const FORM_ACTION: string =
  "/identity/sso-sign-in-confirmation/saml/99999999-9999-4999-8999-999999999999/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function renderView(vars: Record<string, unknown>): Promise<string> {
  return await ejs.renderFile(VIEW, {
    enableGoogleTagManager: false,
    ...vars,
  });
}

describe("SsoSignInConfirmation.ejs -- asking", () => {
  const asking: Record<string, unknown> = {
    title: "Confirm single sign-on.",
    message: 'Allow the single sign-on of the OneUptime project "Acme"?',
    formAction: FORM_ACTION,
    token: TOKEN,
    signature: SIGNATURE,
    buttonText: "Confirm Sign-In",
  };

  test("confirms through a POST form, not on load", async () => {
    const html: string = await renderView(asking);

    expect(html).toContain(`<form method="POST" action="${FORM_ACTION}"`);
    expect(html).toContain('data-testid="sso-confirmation-submit"');
    expect(html).not.toMatch(/http-equiv=["']refresh/i);
    expect(html).not.toMatch(/<script>[^<]*submit\(/);
  });

  test("carries the token and signature in the body, not the action URL", async () => {
    const html: string = await renderView(asking);

    expect(html).toContain(`name="token" value="${TOKEN}"`);
    expect(html).toContain(`name="signature" value="${SIGNATURE}"`);

    const action: string = html.match(/<form[^>]*action="([^"]*)"/)?.[1] || "";

    expect(action).not.toContain(TOKEN);
    expect(action).not.toContain("?");
  });

  test("keeps the token-bearing URL out of every Referer", async () => {
    expect(await renderView(asking)).toContain(
      '<meta name="referrer" content="no-referrer" />',
    );
  });

  test("loads no third-party tag manager", async () => {
    const html: string = await renderView(asking);

    expect(html).not.toContain("googletagmanager.com");
  });

  test("prints an admin-chosen project name as text", async () => {
    const html: string = await renderView({
      ...asking,
      message:
        'Allow the single sign-on of the OneUptime project "<script>alert(1)</script>"?',
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("cannot be broken out of a hidden field", async () => {
    const html: string = await renderView({
      ...asking,
      token: '"><script>alert(1)</script>',
    });

    expect(html).not.toContain('"><script>alert(1)</script>');
  });
});

describe("SsoSignInConfirmation.ejs -- telling", () => {
  test("offers no form when there is nothing to confirm", async () => {
    const html: string = await renderView({
      title: "This link is not valid.",
      message: "Sign in with single sign-on again.",
    });

    expect(html).toContain("This link is not valid.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('data-testid="sso-confirmation-link"');
  });

  test("links back to the provider's sign-in once confirmed", async () => {
    const html: string = await renderView({
      title: "Single sign-on confirmed.",
      message: "Continue to finish signing in.",
      linkUrl: "/identity/sso/p/q",
      linkText: "Continue to sign in",
    });

    expect(html).toContain('data-testid="sso-confirmation-link"');
    expect(html).toContain('href="/identity/sso/p/q"');
    expect(html).toContain("Continue to sign in");
    expect(html).not.toContain("<form");
  });
});
