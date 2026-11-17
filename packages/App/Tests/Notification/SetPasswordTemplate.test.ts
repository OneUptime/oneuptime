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
import { SET_PASSWORD_LINK_EXPIRY_DAYS } from "Common/Types/Accounts/SetPasswordLink";

/*
 * SetPassword.hbs - the link a new user chooses their first password with,
 * when a master admin created their account in the Admin Dashboard
 * (Users > Create User, #9139; Common/Types/Accounts/SetPasswordLink).
 *
 *  - It says who it is for and why: an administrator created an account for
 *    this address, with the product's name (an installation may go by its
 *    own), and has one action, Set Your Password, with the link again to copy.
 *  - It says how long the link works and that it works once - the numbers
 *    the server holds it to - and where to get a new one: Forgot password,
 *    which sends such an account a new set-password link (#9260).
 *  - Sent because its owner asked Forgot password (#9260), it says a
 *    request was made, and when and from where, instead of saying an
 *    administrator created the account.
 *  - It may reach somebody who did not expect it, so it says what happens
 *    when it is ignored.
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
  "https://oneuptime.acme.test/accounts/set-password/6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

function render(vars: Record<string, unknown> = {}): string {
  return handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, EmailTemplateType.SetPassword),
      "utf8",
    ),
  )({
    tokenVerifyUrl: LINK,
    homeURL: "https://oneuptime.acme.test",
    email: "new.person@acme.test",
    expiresInDays: String(SET_PASSWORD_LINK_EXPIRY_DAYS),
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

describe("SetPassword.hbs", () => {
  test("is the template the template type names", () => {
    expect(
      fs.existsSync(Path.join(TEMPLATES_DIR, EmailTemplateType.SetPassword)),
    ).toBe(true);
  });

  test("says who created the account, for which address, with the product's name", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain("Set your password for OneUptime");
    expect(text).toContain(
      "An administrator created a OneUptime account for you, new.person@acme.test. Choose your password to sign in.",
    );
  });

  test("names an installation by the name it goes by", () => {
    const text: string = htmlAsText(
      render({ brandProductName: "Acme Monitoring" }),
    );

    expect(text).toContain("Set your password for Acme Monitoring");
    expect(text).toContain("created a Acme Monitoring account");
    expect(text).not.toContain("for OneUptime");
  });

  test("has one action, Set Your Password, to the link - and the link again to copy", () => {
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
    expect(htmlAsText(toLink[0]![2]!).trim()).toBe("Set Your Password");
    expect(htmlAsText(toLink[1]![2]!).trim()).toBe(LINK);
  });

  test("says how long the link works, as the server holds it, that it works once, and where to get another", () => {
    expect(htmlAsText(render())).toContain(
      `The link works once and expires in ${SET_PASSWORD_LINK_EXPIRY_DAYS} days. If it has expired, ask for a new one with Forgot password on the sign-in page.`,
    );
  });

  test("tells somebody who did not expect it that ignoring it is safe", () => {
    expect(htmlAsText(render())).toContain(
      "Not expecting this? You can safely ignore this email. Without the link above, nobody can set a password for this account.",
    );
  });

  test("never says it was a reset somebody asked for", () => {
    const text: string = htmlAsText(render());

    expect(text).not.toMatch(/reset your password|password reset/i);
    expect(text).not.toContain("Details of the request:");
  });

  describe("sent because its owner asked Forgot password", () => {
    const ASKED: Record<string, string> = {
      requestedAt: "Nov 17, 2026, 09:30 UTC",
      requestIpAddress: "203.0.113.7",
      requestLocation: "",
      requestDevice: "Firefox on Linux",
    };

    test("says a request was made, not that an administrator created the account", () => {
      const text: string = htmlAsText(render(ASKED));

      expect(text).toContain(
        "We received a request to set a password for your OneUptime account, new.person@acme.test. Choose your password to sign in.",
      );
      expect(text).not.toContain("An administrator created");
    });

    test("says when, from which address and on which device, as a reset email does", () => {
      const text: string = htmlAsText(render(ASKED));

      expect(text).toContain("Details of the request:");
      expect(text).toContain("Nov 17, 2026, 09:30 UTC");
      expect(text).toContain("203.0.113.7");
      expect(text).toContain("Firefox on Linux");
    });

    test("is still a first password, never a reset", () => {
      const text: string = htmlAsText(render(ASKED));

      expect(text).toContain("Set your password for OneUptime");
      expect(text).not.toMatch(/reset your password|password reset/i);
    });
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
