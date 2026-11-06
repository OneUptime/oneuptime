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
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { MAGIC_LINK_EXPIRY_MINUTES } from "Common/Types/Accounts/MagicLink";

/*
 * MagicLink.hbs - an account's sign-in link (Common/Types/Accounts/
 * MagicLink), mailed by Identity's POST /send-magic-link.
 *
 *  - It says what the link does, with the product's name (an installation
 *    may go by a name of its own), and has one action: Sign In, the link
 *    again under it to copy.
 *  - It says the link stands in for the password only: an account with two
 *    factor authentication is still asked for its code.
 *  - It says how long the link works and that it works once - the numbers
 *    the server holds it to - and that a newer link replaces it.
 *  - It may reach somebody who never asked (anyone can type an address), so
 *    it says what happens when it is ignored, and says when, from where and
 *    on which device the link was asked for, after the link rather than in
 *    the way of the button. RequestOriginEmails.test.ts holds the card's rows,
 *    as it does for every security email.
 */

const handlebars: typeof Handlebars = Handlebars.create();
registerEmailLanguageHelpers(handlebars);

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const LINK: string =
  "https://oneuptime.acme.test/accounts/magic-link-login/6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

function render(vars: Record<string, unknown> = {}): string {
  return handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, EmailTemplateType.MagicLink),
      "utf8",
    ),
  )({
    tokenVerifyUrl: LINK,
    homeURL: "https://oneuptime.acme.test",
    expiresInMinutes: String(MAGIC_LINK_EXPIRY_MINUTES),
    year: "2026",
    ...vars,
  });
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (filename.endsWith(".hbs")) {
      handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, filename), "utf8"),
      );
    }
  }

  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return left === right ? options.fn(this) : options.inverse(this);
    },
  );
  handlebars.registerHelper(
    "ifNotCond",
    function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return left !== right ? options.fn(this) : options.inverse(this);
    },
  );

  registerJoiningConcat(handlebars);
  registerEmailBrandHelpers(handlebars);
});

describe("MagicLink.hbs", () => {
  test("is the template the template type names", () => {
    expect(
      fs.existsSync(Path.join(TEMPLATES_DIR, EmailTemplateType.MagicLink)),
    ).toBe(true);
  });

  test("says what it is for, with the product's name", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain("Sign in to OneUptime");
    expect(text).toContain(
      "Use the button below to sign in to OneUptime. You don't need your password.",
    );
  });

  test("names an installation by the name it goes by", () => {
    const text: string = htmlAsText(
      render({ brandProductName: "Acme Monitoring" }),
    );

    expect(text).toContain("Sign in to Acme Monitoring");
    expect(text).toContain("to sign in to Acme Monitoring.");
    expect(text).not.toContain("Sign in to OneUptime");
  });

  test("says that two factor authentication still asks for its code", () => {
    expect(htmlAsText(render())).toContain(
      "If your account uses two factor authentication, you will still be asked for your code.",
    );
  });

  test("has one action, Sign In, to the link - and the link again to copy", () => {
    const html: string = render();
    const anchors: Array<RegExpMatchArray> = Array.from(
      html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi),
    );
    const toLink: Array<RegExpMatchArray> = anchors.filter(
      (anchor: RegExpMatchArray): boolean => {
        return anchor[1] === LINK;
      },
    );

    expect(toLink).toHaveLength(2);
    expect(htmlAsText(toLink[0]![2]!).trim()).toBe("Sign In");
    expect(htmlAsText(toLink[1]![2]!).trim()).toBe(LINK);
  });

  test("says how long the link works, as the server holds it, and that it works once", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain(
      `The link works once and expires in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.`,
    );
    expect(text).toContain("Asking for another link replaces this one.");
  });

  test("tells somebody who never asked that ignoring it is safe", () => {
    expect(htmlAsText(render())).toContain(
      "If you didn't ask to sign in, you can safely ignore this email. Nobody can sign in with it unless the link above is used.",
    );
  });

  test("says where the request came from, between the link and what to do if it wasn't you", () => {
    const text: string = htmlAsText(
      render({
        requestedAt: "Nov 3, 2026, 2:15 PM CET",
        requestIpAddress: "203.0.113.7",
        requestLocation: "Berlin, Germany",
        requestDevice: "Chrome 130 on macOS",
      }),
    );

    for (const value of [
      "Nov 3, 2026, 2:15 PM CET",
      "203.0.113.7",
      "Berlin, Germany",
      "Chrome 130 on macOS",
    ]) {
      expect(text).toContain(value);
    }

    expect(text.indexOf(LINK)).toBeLessThan(
      text.indexOf("Details of the request:"),
    );
    expect(text.indexOf("Details of the request:")).toBeLessThan(
      text.indexOf("If you didn't ask to sign in"),
    );
  });

  test("still reads as a whole when it is sent with no request details", () => {
    const text: string = htmlAsText(render());

    expect(text).not.toContain("Details of the request:");
    expect(text).toContain("If you didn't ask to sign in");
  });

  test("loads nothing from outside the installation", () => {
    const html: string = render();
    const absoluteAddress: RegExp = /^https?:/i;
    const loads: Array<string> = Array.from(
      html.matchAll(/\b(?:src|background)\s*=\s*"([^"]+)"/gi),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      loads.filter((value: string): boolean => {
        return absoluteAddress.test(value) || value.startsWith("//");
      }),
    ).toEqual([]);
  });
});
