import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import {
  EMAIL_ADDRESS_CHANGED_BY_KEY,
  EmailAddressChangedBy,
  EmailAddressChangedEmailData,
  getEmailAddressChangedEmailVariables,
  getEmailAddressChangedSubject,
  getEmailAddressChanger,
  isEmailAddressChangedBy,
  MASKED_ADDRESS_PART,
  maskEmailAddress,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import { describe, expect, test } from "@jest/globals";

/*
 * THE EMAIL AN ACCOUNT'S OLD ADDRESS GETS WHEN THE ACCOUNT MOVES (#9907):
 * who it says changed the address, how it masks the new one, its subject
 * and the variables its template is handed. The template is rendered in
 * App's EmailAddressChangedTemplate.test.ts; the sender in Common's
 * Server/Utils/EmailChange/EmailAddressChangedNotice.test.ts; each way an
 * address changes, through UserService, in
 * Server/Services/UserServiceEmailAddressChangedNotice.test.ts.
 */

const ACCOUNT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID: string = "22222222-2222-4222-8222-222222222222";

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

describe("the new address, masked", () => {
  test("its name's and its domain's first character, a mask, and the top-level label", () => {
    expect(maskEmailAddress("river@new-mailbox.example.com")).toBe(
      "r•••@n•••.com",
    );
    expect(maskEmailAddress("j@g.io")).toBe("j•••@g•••.io");
  });

  test("an Email is masked as its text is", () => {
    expect(maskEmailAddress(new Email("Ada.Lovelace@Example.org"))).toBe(
      "a•••@e•••.org",
    );
  });

  test("the mask is one width, so neither part's length shows", () => {
    const short: string = maskEmailAddress("a@b.com");
    const long: string = maskEmailAddress(
      "a-very-long-name-indeed@b-very-long-domain-indeed.com",
    );

    expect(short).toBe(long);
    expect(short.length).toBe(long.length);
  });

  test("never more than two of the address's characters besides the top-level label", () => {
    const addresses: Array<string> = [
      "river@new-mailbox.example.com",
      "first.last+tag@mail.subdomain.example.co.uk",
      "ops@localhost.localdomain",
      "x@y.z",
    ];

    for (const address of addresses) {
      const masked: string = maskEmailAddress(address);
      const topLevel: string = address.slice(address.lastIndexOf("."));
      const withoutTopLevel: string = masked.endsWith(topLevel)
        ? masked.slice(0, masked.length - topLevel.length)
        : masked;
      const kept: string = withoutTopLevel
        .split(MASKED_ADDRESS_PART)
        .join("")
        .replace("@", "");

      expect({ address, kept: kept.length }).toEqual({ address, kept: 2 });

      // A name of more than one character never shows whole.
      const name: string = address.slice(0, address.indexOf("@"));

      if (name.length > 1) {
        expect(masked).not.toContain(name);
      }
    }
  });

  test("a domain of one label keeps no top-level label", () => {
    expect(maskEmailAddress("admin@localhost")).toBe("a•••@l•••");
  });

  test("a first character is kept whole, however it is written", () => {
    expect(maskEmailAddress("éloise@ümlaut.de")).toBe("é•••@ü•••.de");
    expect(maskEmailAddress("😀team@🎉party.example")).toBe(
      "😀•••@🎉•••.example",
    );
  });

  test("an address that cannot be read is the mask alone", () => {
    for (const unreadable of [
      "",
      "   ",
      "no-at-sign",
      "@example.com",
      "name@",
      "name@...",
      null,
      undefined,
    ]) {
      expect(maskEmailAddress(unreadable)).toBe(MASKED_ADDRESS_PART);
    }
  });

  test("markup in an address stays text: the template escapes it, and the mask keeps one character of it", () => {
    const masked: string = maskEmailAddress("<b>@<i>.com");

    expect(masked).toBe("<•••@<•••.com");
    expect(masked).not.toContain("<b>");
  });
});

describe("who changed the address", () => {
  test("OneUptime's own write names its changer: the confirmation link, SCIM", () => {
    expect(
      getEmailAddressChanger({
        isRoot: true,
        isMasterAdmin: false,
        callerUserId: undefined,
        accountUserId: ACCOUNT_ID,
        namedChanger: EmailAddressChangedBy.AccountOwner,
      }),
    ).toBe(EmailAddressChangedBy.AccountOwner);

    expect(
      getEmailAddressChanger({
        isRoot: true,
        isMasterAdmin: false,
        callerUserId: undefined,
        accountUserId: ACCOUNT_ID,
        namedChanger: EmailAddressChangedBy.IdentityProvider,
      }),
    ).toBe(EmailAddressChangedBy.IdentityProvider);
  });

  test("OneUptime's own write that names nobody, or names something else, is said without a role", () => {
    for (const namedChanger of [undefined, null, "", "Somebody", 3, {}]) {
      expect(
        getEmailAddressChanger({
          isRoot: true,
          isMasterAdmin: false,
          callerUserId: undefined,
          accountUserId: ACCOUNT_ID,
          namedChanger: namedChanger,
        }),
      ).toBe(EmailAddressChangedBy.OneUptime);
    }
  });

  test("a request cannot name its changer: miscDataProps are its caller's to write", () => {
    expect(
      getEmailAddressChanger({
        isRoot: false,
        isMasterAdmin: true,
        callerUserId: ADMIN_ID,
        accountUserId: ACCOUNT_ID,
        namedChanger: EmailAddressChangedBy.IdentityProvider,
      }),
    ).toBe(EmailAddressChangedBy.ServerAdmin);
  });

  test("a master admin changing their own address is the account's own change", () => {
    expect(
      getEmailAddressChanger({
        isRoot: false,
        isMasterAdmin: true,
        callerUserId: ACCOUNT_ID.toUpperCase(),
        accountUserId: ACCOUNT_ID,
        namedChanger: undefined,
      }),
    ).toBe(EmailAddressChangedBy.AccountOwner);
  });

  test("a master admin changing somebody else's is a server admin's", () => {
    expect(
      getEmailAddressChanger({
        isRoot: false,
        isMasterAdmin: true,
        callerUserId: ADMIN_ID,
        accountUserId: ACCOUNT_ID,
        namedChanger: undefined,
      }),
    ).toBe(EmailAddressChangedBy.ServerAdmin);
  });

  test("anybody else's request is said without a role", () => {
    expect(
      getEmailAddressChanger({
        isRoot: false,
        isMasterAdmin: false,
        callerUserId: ADMIN_ID,
        accountUserId: ACCOUNT_ID,
        namedChanger: undefined,
      }),
    ).toBe(EmailAddressChangedBy.OneUptime);
  });

  test("the changers, and the key OneUptime's writes name them by", () => {
    expect(EMAIL_ADDRESS_CHANGED_BY_KEY).toBe("emailAddressChangedBy");

    for (const changer of Object.values(EmailAddressChangedBy)) {
      expect(isEmailAddressChangedBy(changer)).toBe(true);
    }

    expect(isEmailAddressChangedBy("ServerAdmin ")).toBe(false);
    expect(isEmailAddressChangedBy(undefined)).toBe(false);
  });
});

describe("the template's variables", () => {
  test("the account's own change: the masked address, when, and from where", () => {
    expect(getEmailAddressChangedEmailVariables(data())).toEqual({
      productName: "OneUptime",
      changedAt: "Nov 20, 2026, 9:15 AM UTC",
      newEmailAddress: "r•••@n•••.com",
      requestIpAddress: "203.0.113.7",
      requestLocation: "Berlin, Germany",
      requestDevice: "Firefox on Linux",
      changedByAccountOwner: "true",
    });
  });

  test("the new address is never handed on whole", () => {
    const vars: Dictionary<string> = getEmailAddressChangedEmailVariables(
      data({ newEmail: new Email("river@new-mailbox.example.com") }),
    );

    expect(JSON.stringify(vars)).not.toContain("new-mailbox");
    expect(JSON.stringify(vars)).not.toContain("river@");
  });

  test("a server admin's change says when alone, whatever origin it is handed", () => {
    const vars: Dictionary<string> = getEmailAddressChangedEmailVariables(
      data({ changedBy: EmailAddressChangedBy.ServerAdmin }),
    );

    expect(vars["changedByServerAdmin"]).toBe("true");
    expect(vars["changedByAccountOwner"]).toBeUndefined();
    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestLocation"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
    expect(vars["changedAt"]).toBe("Nov 20, 2026, 9:15 AM UTC");
  });

  test("an identity provider's change, and OneUptime's own, say when alone too", () => {
    for (const [changedBy, flag] of [
      [EmailAddressChangedBy.IdentityProvider, "changedByIdentityProvider"],
      [EmailAddressChangedBy.OneUptime, "changedByOneUptime"],
    ] as Array<[EmailAddressChangedBy, string]>) {
      const vars: Dictionary<string> = getEmailAddressChangedEmailVariables(
        data({ changedBy: changedBy }),
      );

      expect(vars[flag]).toBe("true");
      expect(vars["requestIpAddress"]).toBe("");
      expect(vars["requestDevice"]).toBe("");
    }
  });

  test("exactly one changer flag is set", () => {
    for (const changedBy of Object.values(EmailAddressChangedBy)) {
      const flags: Array<string> = Object.keys(
        getEmailAddressChangedEmailVariables(data({ changedBy: changedBy })),
      ).filter((name: string): boolean => {
        return name.startsWith("changedBy");
      });

      expect(flags).toHaveLength(1);
    }
  });

  test("an origin it does not know is empty, so its row does not show", () => {
    const vars: Dictionary<string> = getEmailAddressChangedEmailVariables(
      data({ requestIpAddress: "", requestLocation: "", requestDevice: "" }),
    );

    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestLocation"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
  });
});

describe("the subject", () => {
  test("names the product, in English", () => {
    expect(
      getEmailAddressChangedSubject(getServerTranslator("en"), "Acme Ops"),
    ).toBe("Your Acme Ops email address was changed");
  });

  test("is worded in every language the server writes in, the product as it is", () => {
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
      const subject: string = getEmailAddressChangedSubject(
        getServerTranslator(language),
        "Acme Ops",
      );

      expect({ language, english: subject.includes("was changed") }).toEqual({
        language,
        english: false,
      });
      expect(subject).toContain("Acme Ops");
    }
  });
});
