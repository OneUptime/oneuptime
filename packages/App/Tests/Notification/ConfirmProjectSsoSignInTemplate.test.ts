import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ConfirmProjectSsoSignIn.hbs - sent on the hosted service the first time a
 * project's own identity provider tries to sign an address in to OneUptime
 * (ee/Server/Identity/Utils/ProjectSsoSignInConfirmation.ts, whose tests pin
 * the variable names against the code that sets them).
 *
 * The recipient may never have tried to sign in: the identity provider belongs
 * to that project's admins, who can assert any address they like. So the copy
 * must not assume the recipient asked for it, must say plainly what confirming
 * does, and must say that ignoring it is safe. The project name in it is
 * chosen by those same admins, so it must arrive as text, never as markup.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const CONFIRMATION_URL: string =
  "https://oneuptime.test/identity/sso-sign-in-confirmation/saml/99999999-9999-4999-8999-999999999999/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?token=dddddddd-dddd-4ddd-8ddd-dddddddddddd&signature=0123456789abcdef";

const TOKEN: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function templateSource(): string {
  return fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "ConfirmProjectSsoSignIn.hbs"),
    { encoding: "utf8" },
  );
}

function render(vars: Record<string, unknown> = {}): string {
  return Handlebars.compile(templateSource())({
    signInSummary:
      'Someone just signed in through the single sign-on of the OneUptime project "Acme" as alice@example.com. Before that sign-in can reach your OneUptime account, we need to know it was you.',
    confirmationUrl: CONFIRMATION_URL,
    expiryNote: "This link expires in 24 hours and can only be used once.",
    homeUrl: "https://oneuptime.test",
    ...vars,
  });
}

beforeAll(() => {
  // Mirrors FeatureSet/Notification/Utils/Handlebars.ts, as the sibling template tests do.
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }

  Handlebars.registerHelper(
    "ifCond",
    function (v1: any, v2: any, options: any) {
      // @ts-expect-error - Handlebars uses dynamic this context for template helpers
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );

  Handlebars.registerHelper("concat", (v1: any, v2: any) => {
    return v1 + v2;
  });
});

describe("ConfirmProjectSsoSignIn.hbs", () => {
  test("makes the confirmation link the call to action", () => {
    const html: string = render();

    expect(html).toContain("Confirm Sign-In");
    expect(html).toContain(Handlebars.escapeExpression(CONFIRMATION_URL));
  });

  test("also prints the link as text, for clients that swallow the button", () => {
    const occurrences: number = render().split(TOKEN).length - 1;

    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("the button's link decodes back to the exact URL, token and signature included", () => {
    const button: string =
      render().match(/<a\b[^>]*\bclass="[^"]*\bst-Button-link\b[^>]*>/)?.[0] ||
      "";
    const href: RegExpMatchArray | null = button.match(/href="([^"]+)"/);

    expect(href).not.toBeNull();

    const decoded: string = href![1]!
      .replace(/&#x2F;/g, "/")
      .replace(/&#x3D;/g, "=")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");

    expect(decoded).toBe(CONFIRMATION_URL);
  });

  test("prints an admin-chosen project name as text, not markup", () => {
    const html: string = render({
      signInSummary:
        'Someone just signed in through the single sign-on of the OneUptime project "<img src=x onerror=alert(1)><a href="https://evil.example">Click</a>".',
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;img src&#x3D;x");
  });

  test("says what confirming does, and that it happens once per project", () => {
    const html: string = render();

    expect(html).toContain("sign you in to OneUptime from now on");
    expect(html).toContain("once for each project");
  });

  test("does not assume the recipient asked for it, and says ignoring it is safe", () => {
    const html: string = render();

    expect(html).toContain("we need to know it was you");
    expect(html).toContain("weren&#x27;t expecting this");
    expect(html).toContain(
      "cannot sign in to your OneUptime account unless the button above is used",
    );
  });

  test("says the link expires and is single use", () => {
    expect(render()).toContain(
      "This link expires in 24 hours and can only be used once.",
    );
  });

  test("never renders an empty call to action", () => {
    expect(render()).not.toContain('href=""');
  });

  test("renders no button at all without a link, rather than a dead one", () => {
    const html: string = render({ confirmationUrl: undefined });

    // The class name also appears in the stylesheet, so look for the anchor.
    expect(html).not.toMatch(/<a\b[^>]*\bst-Button-link\b/);
  });
});
