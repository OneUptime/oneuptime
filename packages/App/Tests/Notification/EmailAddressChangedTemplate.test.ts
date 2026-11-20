import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  EmailAddressChangedBy,
  EmailAddressChangedEmailData,
  getEmailAddressChangedEmailVariables,
} from "Common/Types/Accounts/EmailAddressChangedEmail";
import {
  getEmailLanguageVariables,
  registerEmailLanguageHelpers,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` helpers as an import
 * side effect, so this suite renders with the helpers the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

registerEmailLanguageHelpers(Handlebars);

/*
 * THE EMAIL AN ACCOUNT'S OLD ADDRESS GETS WHEN THE ACCOUNT MOVES
 * (EmailAddressChanged.hbs, #9907).
 *
 * Rendered with the variables the sender builds
 * (getEmailAddressChangedEmailVariables) and the production helpers and
 * partials: that the address changed, to which address (masked), when, and
 * from where only for the account's own change; who changed it, by role;
 * whom to ask, by the kind of server; no link that does anything; and in
 * the reader's language, the request rows of Partials/RequestOriginFields
 * included.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const HOME_URL: string = "https://oneuptime.example.com/";

const data: (
  overrides?: Partial<EmailAddressChangedEmailData>,
) => EmailAddressChangedEmailData = (
  overrides?: Partial<EmailAddressChangedEmailData>,
): EmailAddressChangedEmailData => {
  return {
    changedBy: EmailAddressChangedBy.AccountOwner,
    productName: "OneUptime",
    newEmail: "river@new-mailbox.example.com",
    changedAt: "Nov 20, 2026, 9:15 AM UTC",
    requestIpAddress: "203.0.113.7",
    requestLocation: "Berlin, Germany",
    requestDevice: "Firefox on Linux",
    ...overrides,
  };
};

function templateSource(): string {
  return fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, EmailTemplateType.EmailAddressChanged),
    { encoding: "utf8" },
  );
}

function render(
  emailData: EmailAddressChangedEmailData,
  root: Record<string, unknown> = { isSelfHosted: "true" },
): string {
  return Handlebars.compile(templateSource())({
    homeURL: HOME_URL,
    year: "2026",
    ...getEmailAddressChangedEmailVariables(emailData),
    ...root,
  });
}

const CLOUD: Record<string, unknown> = {};
const SELF_HOSTED: Record<string, unknown> = { isSelfHosted: "true" };
const RENAMED_CLOUD: Record<string, unknown> = {
  isBrandRenamed: "true",
  brandProductName: "Acme Watch",
};

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (!filename.endsWith(".hbs")) {
      continue;
    }

    Handlebars.registerPartial(
      filename.slice(0, -".hbs".length),
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("what changed, and when", () => {
  test("the title, that the address moved, and where the account's emails go now", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("Your email address was changed");
    expect(text).toContain(
      "The email address of your OneUptime account was changed from this address to a new one.",
    );
    expect(text).toContain(
      "Emails about your account, such as password resets and sign-in links, now go to the new address.",
    );
  });

  test("the card: when, and the new address masked", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("Changed at:");
    expect(text).toContain("Nov 20, 2026, 9:15 AM UTC");
    expect(text).toContain("New email address:");
    expect(text).toContain("r•••@n•••.com");
  });

  test("the new address is never in the email whole", () => {
    const html: string = render(data());

    expect(html).not.toContain("new-mailbox");
    expect(html).not.toContain("river@");
  });
});

describe("from where", () => {
  test("the account's own change: the address, place and device of its request", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("IP address:");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("Approximate location:");
    expect(text).toContain("Berlin, Germany");
    expect(text).toContain("Device:");
    expect(text).toContain("Firefox on Linux");
  });

  test("a row with nothing to say does not show", () => {
    const text: string = visibleText(
      render(data({ requestLocation: "", requestDevice: "" })),
    );

    expect(text).toContain("IP address:");
    expect(text).not.toContain("Approximate location:");
    expect(text).not.toContain("Device:");
  });

  test("a server admin's change says when alone, though a request made it", () => {
    const text: string = visibleText(
      render(data({ changedBy: EmailAddressChangedBy.ServerAdmin })),
    );

    expect(text).toContain("Changed at:");
    expect(text).not.toContain("IP address:");
    expect(text).not.toContain("203.0.113.7");
    expect(text).not.toContain("Firefox on Linux");
  });

  test("an identity provider's change says when alone", () => {
    const text: string = visibleText(
      render(data({ changedBy: EmailAddressChangedBy.IdentityProvider })),
    );

    expect(text).toContain("Changed at:");
    expect(text).not.toContain("IP address:");
  });
});

describe("who changed it, by role", () => {
  test("a server admin", () => {
    const text: string = visibleText(
      render(data({ changedBy: EmailAddressChangedBy.ServerAdmin })),
    );

    expect(text).toContain(
      "A server admin changed the email address of your OneUptime account from this address to a new one.",
    );
    expect(text).not.toContain("If this was you");
  });

  test("the organization's identity provider", () => {
    const text: string = visibleText(
      render(data({ changedBy: EmailAddressChangedBy.IdentityProvider })),
    );

    expect(text).toContain(
      "Your organization's identity provider changed the email address of your OneUptime account from this address to a new one.",
    );
  });

  test("a write OneUptime made that names nobody", () => {
    const text: string = visibleText(
      render(data({ changedBy: EmailAddressChangedBy.OneUptime })),
    );

    expect(text).toContain(
      "The email address of your OneUptime account was changed from this address to a new one.",
    );
    expect(text).not.toContain("A server admin");
    expect(text).not.toContain("identity provider");
  });
});

describe("what to do if it was not them", () => {
  test("the account's own change on a self-hosted server: nothing if it was you, else the server's admin at once", () => {
    const text: string = visibleText(render(data(), SELF_HOSTED));

    expect(text).toContain("If this was you, there is nothing else to do.");
    expect(text).toContain(
      "If this was not you, someone who was signed in to your account moved it to an address of their own.",
    );
    expect(text).toContain(
      "Contact your server's admin right away: they can move your account back to this address.",
    );
    expect(text).not.toContain("support@oneuptime.com");
  });

  test("the account's own change on OneUptime Cloud: OneUptime's support, from this address", () => {
    const text: string = visibleText(render(data(), CLOUD));

    expect(text).toContain(
      "Contact support at support@oneuptime.com right away, from this address: they can move your account back to it.",
    );
    expect(text).not.toContain("server's admin");
  });

  test("a renamed installation names no support address", () => {
    const text: string = visibleText(render(data(), RENAMED_CLOUD));

    expect(text).not.toContain("support@oneuptime.com");
    expect(text).toContain("Contact your server's admin right away");
  });

  test("a server admin's change: the server's admin, or OneUptime's support on Cloud", () => {
    const adminData: EmailAddressChangedEmailData = data({
      changedBy: EmailAddressChangedBy.ServerAdmin,
    });

    expect(visibleText(render(adminData, SELF_HOSTED))).toContain(
      "If you did not expect this, contact your server's admin.",
    );
    expect(visibleText(render(adminData, CLOUD))).toContain(
      "If you did not expect this, contact support at support@oneuptime.com.",
    );
    expect(visibleText(render(adminData, RENAMED_CLOUD))).not.toContain(
      "support@oneuptime.com",
    );
  });

  test("an identity provider's change: the organization's admin, on every server", () => {
    for (const server of [SELF_HOSTED, CLOUD, RENAMED_CLOUD]) {
      const text: string = visibleText(
        render(
          data({ changedBy: EmailAddressChangedBy.IdentityProvider }),
          server,
        ),
      );

      expect(text).toContain(
        "If you did not expect this, contact your organization's admin.",
      );
      expect(text).not.toContain("support@oneuptime.com");
    }
  });
});

describe("nothing that does anything", () => {
  test("no button, and no link but the logo's and the footer's", () => {
    for (const changedBy of Object.values(EmailAddressChangedBy)) {
      for (const server of [SELF_HOSTED, CLOUD]) {
        const html: string = render(data({ changedBy: changedBy }), server);
        const links: Array<string> = Array.from(
          html.matchAll(/href="([^"]+)"/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1]!;
        });

        // A button is an anchor of the button's class (Partials/ButtonBlock.hbs).
        expect(html).not.toMatch(/<a\b[^>]*st-Button-link/);
        expect(
          links.filter((link: string): boolean => {
            return link !== HOME_URL && link !== "https://oneuptime.com";
          }),
        ).toEqual([]);
      }
    }
  });
});

describe("what the sender hands in is written as text", () => {
  test("a product name with markup is escaped", () => {
    const html: string = render(
      data({ productName: '<a href="https://evil.example">Acme</a>' }),
    );

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(visibleText(html)).toContain(
      '<a href="https://evil.example">Acme</a>',
    );
  });

  test("a request's rows with markup are escaped", () => {
    const html: string = render(
      data({
        requestDevice: "<script>alert(1)</script>",
        requestLocation: "<b>Paris</b>",
      }),
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>Paris</b>");
  });

  test("an address with markup in its first characters stays text", () => {
    const html: string = render(data({ newEmail: "<b@<i.com" }));

    expect(html).not.toContain("<b•••");
    expect(visibleText(html)).toContain("<•••@<•••.com");
  });

  test("the template reads exactly the variables the sender writes", () => {
    const source: string = templateSource();
    const written: Array<string> = Object.keys(
      getEmailAddressChangedEmailVariables(data()),
    );

    for (const name of [
      "productName",
      "changedAt",
      "newEmailAddress",
      "changedByServerAdmin",
      "changedByIdentityProvider",
      "changedByAccountOwner",
    ]) {
      expect({ name, inTemplate: source.includes(name) }).toEqual({
        name,
        inTemplate: true,
      });
    }

    // The request rows' names, which the partial reads.
    for (const name of [
      "requestIpAddress",
      "requestLocation",
      "requestDevice",
    ]) {
      expect(written).toContain(name);
    }
  });
});

describe("in the reader's language", () => {
  test("German: the email's own words are German, the request rows' labels too, the values as they are", () => {
    const text: string = visibleText(
      render(data(), {
        ...SELF_HOSTED,
        ...getEmailLanguageVariables("de"),
      }),
    );

    expect(text).toContain("Ihre E-Mail-Adresse wurde geändert");
    expect(text).toContain("Geändert am:");
    expect(text).toContain("Neue E-Mail-Adresse:");
    expect(text).toContain("IP-Adresse:");
    expect(text).toContain("Gerät:");
    expect(text).not.toContain("Your email address was changed");
    expect(text).not.toContain("IP address:");
    expect(text).not.toContain("If this was you");
    expect(text).toContain("r•••@n•••.com");
    expect(text).toContain("203.0.113.7");
    expect(text).toContain("Firefox on Linux");
  });

  test("Persian: laid out from the right, and not in English", () => {
    const html: string = render(data(), {
      ...SELF_HOSTED,
      ...getEmailLanguageVariables("fa"),
    });

    expect(html).toContain('dir="rtl"');
    expect(visibleText(html)).not.toContain("Your email address was changed");
    expect(visibleText(html)).not.toContain("Changed at:");
  });

  test("every language the server writes in words the email, for every changer", () => {
    for (const language of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ]) {
      for (const changedBy of Object.values(EmailAddressChangedBy)) {
        for (const server of [SELF_HOSTED, CLOUD]) {
          const text: string = visibleText(
            render(data({ changedBy: changedBy }), {
              ...server,
              ...getEmailLanguageVariables(language),
            }),
          );

          for (const english of [
            "Your email address was changed",
            "from this address to a new one",
            "now go to the new address",
            "Changed at:",
            "New email address:",
            "IP address:",
            "If this was you",
            "If this was not you",
            "If you did not expect this",
            "right away",
          ]) {
            expect({
              language,
              changedBy,
              english: text.includes(english),
            }).toEqual({ language, changedBy, english: false });
          }
        }
      }
    }
  });
});
