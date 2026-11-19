import Handlebars from "handlebars";
import { registerEmailLanguageHelpers } from "../../FeatureSet/Notification/Utils/EmailLanguage";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  registerEmailBrandHelpers,
  registerJoiningConcat,
} from "./Fixtures/EmailBrandHelpers";
import { htmlAsText } from "Common/Tests/Helpers/HtmlText";

// The email language helpers the templates word their text with.
registerEmailLanguageHelpers(Handlebars);

/*
 * AccountAlreadyExists.hbs - sent when a sign-up names an address that
 * already has an account (#9816). The sign-up page told whoever typed the
 * address only to check their email, as it tells everybody; this email, to
 * the address itself, is the only place that says the address has an
 * account.
 *
 * Its reader may or may not be the person who signed up. The likeliest is
 * the owner, who forgot they had an account or its password: so a way to
 * sign in, and one to reset the password. Or a stranger typed their
 * address: so where the sign-up came from, and the reassurance that nothing
 * changed and nobody was told. The last test pins the variable names against
 * the code that sets them, because a rename on one side renders an email
 * with an empty button on the other.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const AUTHENTICATION_EMAIL_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "Utils",
  "AuthenticationEmail.ts",
);

const SIGN_IN_LINK: string = "https://oneuptime.test/accounts/login";
const FORGOT_PASSWORD_URL: string =
  "https://oneuptime.test/accounts/forgot-password";

function templateSource(): string {
  return fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "AccountAlreadyExists.hbs"),
    { encoding: "utf8" },
  );
}

function render(vars: Record<string, unknown> = {}): string {
  return Handlebars.compile(templateSource())({
    signInLink: SIGN_IN_LINK,
    forgotPasswordUrl: FORGOT_PASSWORD_URL,
    homeURL: "https://oneuptime.test",
    requestedAt: "19 Nov 2026, 11:30 (Europe/Berlin)",
    requestIpAddress: "203.0.113.7",
    requestLocation: "Berlin, Germany",
    requestDevice: "Firefox on Linux",
    ...vars,
  });
}

beforeAll(() => {
  // Mirrors FeatureSet/Notification/Utils/Handlebars.ts, as CompleteRegistrationTemplate.test.ts does.
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

  registerJoiningConcat(Handlebars);
  registerEmailBrandHelpers(Handlebars);
});

describe("AccountAlreadyExists.hbs", () => {
  test("says the address already has an account, and that nothing was made or changed", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain("You Already Have an Account");
    expect(text).toContain("tried to sign up for");
    expect(text).toContain("It already has an account");
    expect(text).toContain("nothing was created or changed");
  });

  test("offers a way to sign in, as its one button", () => {
    const html: string = render();
    const buttons: Array<string> = Array.from(
      html.matchAll(
        /<a[^>]*class="[^"]*st-Button-link[^"]*"[^>]*href="([^"]+)"/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    const buttonsByHrefFirst: Array<string> = Array.from(
      html.matchAll(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*st-Button-link/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect([...buttons, ...buttonsByHrefFirst]).toEqual([SIGN_IN_LINK]);
    expect(htmlAsText(html)).toContain("Sign In");
  });

  test("offers to reset the password, by its own link", () => {
    const html: string = render();

    expect(html).toContain(`href="${FORGOT_PASSWORD_URL}"`);
    expect(htmlAsText(html)).toContain("Forgot your password?");
    expect(htmlAsText(html)).toContain("Reset your password");
  });

  test("says when, from where and on which device the sign-up came", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain("19 Nov 2026, 11:30 (Europe/Berlin)");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("Berlin, Germany");
    expect(text).toContain("Firefox on Linux");
  });

  test("leaves the details out when no request is described", () => {
    const text: string = htmlAsText(
      render({
        requestedAt: undefined,
        requestIpAddress: undefined,
        requestLocation: undefined,
        requestDevice: undefined,
      }),
    );

    expect(text).not.toContain("Details of the sign-up");
  });

  test("tells somebody who did not sign up that nothing changed and nobody was told", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain("Didn't try to sign up?");
    expect(text).toContain("Your account is unchanged");
    expect(text).toContain("was not told that it has an account");
  });

  test("never congratulates its reader or asks them to verify anything", () => {
    const text: string = htmlAsText(render()).toLowerCase();

    expect(text).not.toContain("welcome");
    expect(text).not.toContain("verify");
    expect(text).not.toContain("congratulations");
  });

  test("is sent with every variable it reads, under the same names", () => {
    const sender: string = fs
      .readFileSync(AUTHENTICATION_EMAIL_PATH, "utf8")
      .replace(/\s+/g, " ");

    const senderBlock: string = sender.slice(
      sender.indexOf("public static async sendAccountAlreadyExistsEmail("),
      sender.indexOf("private static async isDelivered("),
    );

    expect(senderBlock).toContain(
      "templateType: EmailTemplateType.AccountAlreadyExists,",
    );

    for (const name of ["signInLink", "forgotPasswordUrl"]) {
      expect(templateSource()).toContain(name);
      expect(senderBlock).toContain(`${name}: new URL(`);
    }

    // The logo's link, which the Logo partial reads.
    expect(senderBlock).toContain("homeURL: new URL(");
    expect(
      fs.readFileSync(
        Path.resolve(TEMPLATES_DIR, "Partials", "Logo.hbs"),
        "utf8",
      ),
    ).toContain("homeURL");

    // The request's origin: requestedAt and the three rows it adds.
    expect(senderBlock).toContain("...RequestOriginUtil.getEmailVars({");
    expect(templateSource()).toContain("{{#if requestedAt}}");
    expect(templateSource()).toContain("{{> RequestOriginFields this }}");
  });
});
