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
 * The two emails a person's own change of address sends, to the NEW
 * address (#9821, Common's EmailChangeConfirmation):
 *
 *   - ConfirmEmailChange.hbs: the address is free. Its link moves the
 *     account to it; until it is opened nothing changes.
 *   - EmailChangeAddressTaken.hbs: another account already has the address.
 *     Nothing changed, and there is no link to confirm.
 *
 * The page that asked says the same for both - the change is waiting - so
 * these emails, read only by whoever holds the new mailbox, are the only
 * place that says which happened. The last tests pin the variable names
 * against the code that sets them: a rename on one side would render an
 * email with an empty button on the other.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const SENDER_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Server",
  "Utils",
  "EmailChange",
  "EmailChangeConfirmation.ts",
);

const CONFIRM_URL: string =
  "https://oneuptime.test/accounts/verify-email/0b9f9d5e-8a5c-4b9a-9d42-6b1e2c3d4e5f";
const SIGN_IN_LINK: string = "https://oneuptime.test/accounts/login";

const REQUEST_VARS: Record<string, string> = {
  homeURL: "https://oneuptime.test/",
  requestedAt: "19 Nov 2026, 11:30 (Europe/Berlin)",
  requestIpAddress: "203.0.113.7",
  requestLocation: "Berlin, Germany",
  requestDevice: "Firefox on Linux",
};

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function renderConfirm(vars: Record<string, unknown> = {}): string {
  return Handlebars.compile(templateSource("ConfirmEmailChange.hbs"))({
    tokenVerifyUrl: CONFIRM_URL,
    expiresInHours: "24",
    ...REQUEST_VARS,
    ...vars,
  });
}

function renderTaken(vars: Record<string, unknown> = {}): string {
  return Handlebars.compile(templateSource("EmailChangeAddressTaken.hbs"))({
    signInLink: SIGN_IN_LINK,
    ...REQUEST_VARS,
    ...vars,
  });
}

function buttonLinks(html: string): Array<string> {
  const classFirst: Array<string> = Array.from(
    html.matchAll(
      /<a[^>]*class="[^"]*st-Button-link[^"]*"[^>]*href="([^"]+)"/g,
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
  const hrefFirst: Array<string> = Array.from(
    html.matchAll(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*st-Button-link/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  return [...classFirst, ...hrefFirst];
}

beforeAll(() => {
  // Mirrors FeatureSet/Notification/Utils/Handlebars.ts, as the other template tests do.
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

describe("ConfirmEmailChange.hbs: the new address is free", () => {
  test("asks the reader to confirm the address, with one button that does", () => {
    const html: string = renderConfirm();
    const text: string = htmlAsText(html);

    expect(text).toContain("Confirm Your New Email Address");
    expect(text).toContain("make this the email address of their");
    expect(buttonLinks(html)).toEqual([CONFIRM_URL]);
    expect(text).toContain("Confirm Email Address");
  });

  test("gives the link as text too, and says how long it works", () => {
    const html: string = renderConfirm();
    const text: string = htmlAsText(html);

    expect(text).toContain("Or copy and paste this link into your browser:");
    expect(html.split(CONFIRM_URL).length - 1).toBeGreaterThanOrEqual(2);
    /*
     * Looked up in the reader's language now (#10157), in the count's form,
     * and its number held to its unit with a no-break space, as every
     * duration OneUptime writes in English is (#8811).
     */
    expect(text).toContain("This link works for 24 hours, and only once.");
  });

  test("says when, from where and on which device the change was asked for", () => {
    const text: string = htmlAsText(renderConfirm());

    expect(text).toContain("19 Nov 2026, 11:30 (Europe/Berlin)");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("Berlin, Germany");
    expect(text).toContain("Firefox on Linux");
  });

  test("tells somebody who did not ask that nothing changes unless the link is opened", () => {
    const text: string = htmlAsText(renderConfirm());

    expect(text).toContain("Didn't ask for this?");
    expect(text).toContain("Nothing changes unless the link above is opened.");
  });

  test("never says the address already has an account", () => {
    const text: string = htmlAsText(renderConfirm()).toLowerCase();

    expect(text).not.toContain("already has an account");
    expect(text).not.toContain("already has a");
  });
});

describe("EmailChangeAddressTaken.hbs: another account has the address", () => {
  test("says the address already has an account, and that nothing was changed", () => {
    const text: string = htmlAsText(renderTaken());

    expect(text).toContain("This Address Already Has an Account");
    expect(text).toContain("This address already has an account");
    expect(text).toContain("nothing was changed");
  });

  test("has no link that confirms anything: its one button signs in", () => {
    const html: string = renderTaken();

    expect(buttonLinks(html)).toEqual([SIGN_IN_LINK]);
    expect(html).not.toContain("verify-email");
    expect(htmlAsText(html).toLowerCase()).not.toContain("confirm");
  });

  test("says when, from where and on which device the change was asked for", () => {
    const text: string = htmlAsText(renderTaken());

    expect(text).toContain("19 Nov 2026, 11:30 (Europe/Berlin)");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("Firefox on Linux");
  });

  test("leaves the details out when no request is described", () => {
    const text: string = htmlAsText(
      renderTaken({
        requestedAt: undefined,
        requestIpAddress: undefined,
        requestLocation: undefined,
        requestDevice: undefined,
      }),
    );

    expect(text).not.toContain("Details of the request");
  });

  test("tells the owner that their account is unchanged and nobody was told", () => {
    const text: string = htmlAsText(renderTaken());

    expect(text).toContain("Didn't ask for this?");
    expect(text).toContain("Your account is unchanged");
    expect(text).toContain("was not told that it has an account");
  });
});

describe("the sender and the templates agree", () => {
  const sender: string = fs.readFileSync(SENDER_PATH, "utf8");

  test("each email is sent with the variables it reads, under the same names", () => {
    expect(sender).toContain(
      "templateType: EmailTemplateType.ConfirmEmailChange,",
    );
    expect(sender).toContain(
      "templateType: EmailTemplateType.EmailChangeAddressTaken,",
    );

    for (const name of ["tokenVerifyUrl", "expiresInHours", "homeURL"]) {
      expect(templateSource("ConfirmEmailChange.hbs") + sender).toContain(name);
      expect(sender).toContain(`${name}:`);
    }

    expect(templateSource("ConfirmEmailChange.hbs")).toContain(
      "tokenVerifyUrl",
    );
    expect(templateSource("ConfirmEmailChange.hbs")).toContain(
      "expiresInHours",
    );
    expect(templateSource("EmailChangeAddressTaken.hbs")).toContain(
      "signInLink",
    );
    expect(sender).toContain("signInLink:");
  });

  test("the confirmation link opens the page that confirms it", () => {
    expect(sender).toContain('"/verify-email/" + token.toString()');
  });
});
