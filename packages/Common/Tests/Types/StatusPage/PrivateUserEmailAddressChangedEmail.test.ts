import {
  EmailAddressChangedBy,
  maskEmailAddress,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import {
  getPrivateUserEmailAddressChangedEmailVariables,
  getPrivateUserEmailAddressChangedSubject,
  getPrivateUserEmailAddressChanger,
  PrivateUserEmailAddressChangedBy,
} from "../../../Types/StatusPage/PrivateUserEmailAddressChangedEmail";
import Email from "../../../Types/Email";
import Dictionary from "../../../Types/Dictionary";
import { Translator } from "../../../Types/Translator";
import { writeInLanguage } from "../../../Server/Utils/ServerTranslation";
import fs from "fs";
import Path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * What the email to a status page private user's old address says, and who
 * it says changed it (#10156): the variables its template is handed, and the
 * changer read from the write.
 */

const SUBJECT: string = "Your email address for {{statusPage}} was changed";

function subjectIn(language: string, statusPageName: string): string {
  return writeInLanguage(language, (translator: Translator): string => {
    return getPrivateUserEmailAddressChangedSubject(translator, statusPageName);
  });
}

describe("getPrivateUserEmailAddressChanger", () => {
  test("a request's write is the status page's team's: a private user never changes their own address", () => {
    expect(
      getPrivateUserEmailAddressChanger({
        isRoot: false,
        namedChanger: undefined,
      }),
    ).toBe(PrivateUserEmailAddressChangedBy.StatusPageTeam);
  });

  test("a request cannot name another changer: its miscDataProps are its own to write", () => {
    expect(
      getPrivateUserEmailAddressChanger({
        isRoot: false,
        namedChanger: EmailAddressChangedBy.IdentityProvider,
      }),
    ).toBe(PrivateUserEmailAddressChangedBy.StatusPageTeam);
  });

  test("SCIM's root write names the identity provider", () => {
    expect(
      getPrivateUserEmailAddressChanger({
        isRoot: true,
        namedChanger: EmailAddressChangedBy.IdentityProvider,
      }),
    ).toBe(PrivateUserEmailAddressChangedBy.IdentityProvider);
  });

  test.each([
    ["nothing", undefined],
    ["an account's own change", EmailAddressChangedBy.AccountOwner],
    ["a server admin", EmailAddressChangedBy.ServerAdmin],
    ["a value that is no changer", "Somebody"],
  ])(
    "any other root write names nobody: %s",
    (_label: string, namedChanger: unknown) => {
      expect(
        getPrivateUserEmailAddressChanger({
          isRoot: true,
          namedChanger: namedChanger,
        }),
      ).toBe(PrivateUserEmailAddressChangedBy.OneUptime);
    },
  );
});

describe("getPrivateUserEmailAddressChangedEmailVariables", () => {
  const base: {
    statusPageName: string;
    newEmail: Email;
    changedAt: string;
  } = {
    statusPageName: "Acme Status",
    newEmail: new Email("river@new-mailbox.example.com"),
    changedAt: "Nov 20, 2026, 9:15 AM UTC",
  };

  test("the page's name, when, and the new address masked - never whole", () => {
    const vars: Dictionary<string> =
      getPrivateUserEmailAddressChangedEmailVariables({
        ...base,
        changedBy: PrivateUserEmailAddressChangedBy.StatusPageTeam,
      });

    expect(vars["statusPageName"]).toBe("Acme Status");
    expect(vars["changedAt"]).toBe("Nov 20, 2026, 9:15 AM UTC");
    expect(vars["newEmailAddress"]).toBe(
      maskEmailAddress("river@new-mailbox.example.com"),
    );
    expect(JSON.stringify(vars)).not.toContain("river@");
    expect(JSON.stringify(vars)).not.toContain("new-mailbox");
  });

  test.each([
    [
      PrivateUserEmailAddressChangedBy.StatusPageTeam,
      "changedByStatusPageTeam",
    ],
    [
      PrivateUserEmailAddressChangedBy.IdentityProvider,
      "changedByIdentityProvider",
    ],
    [PrivateUserEmailAddressChangedBy.OneUptime, "changedByOneUptime"],
  ])(
    "exactly one changer: %s",
    (changedBy: PrivateUserEmailAddressChangedBy, flag: string) => {
      const vars: Dictionary<string> =
        getPrivateUserEmailAddressChangedEmailVariables({
          ...base,
          changedBy: changedBy,
        });

      expect(
        Object.keys(vars).filter((name: string): boolean => {
          return name.startsWith("changedBy");
        }),
      ).toEqual([flag]);
      expect(vars[flag]).toBe("true");
    },
  );
});

describe("getPrivateUserEmailAddressChangedSubject", () => {
  test("names the page, whose name is its team's own words", () => {
    expect(subjectIn("en", "Acme Status")).toBe(
      "Your email address for Acme Status was changed",
    );
  });

  test("in the page's language, the name as it is", () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(
        Path.resolve(
          __dirname,
          "..",
          "..",
          "..",
          "Server",
          "Locales",
          "de.json",
        ),
        { encoding: "utf8" },
      ),
    ) as Record<string, string>;

    expect(german[SUBJECT]).toBeTruthy();
    expect(german[SUBJECT]).not.toBe(SUBJECT);
    expect(subjectIn("de", "Acme Status")).toBe(
      german[SUBJECT]!.replace("{{statusPage}}", "Acme Status"),
    );
  });
});
