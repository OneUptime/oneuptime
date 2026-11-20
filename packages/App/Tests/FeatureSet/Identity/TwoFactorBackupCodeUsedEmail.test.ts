import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import "../../../FeatureSet/Notification/Utils/Handlebars";
import AuthenticationEmail from "../../../FeatureSet/Identity/Utils/AuthenticationEmail";
import TwoFactorBackupCodeNotification, {
  BackupCodeUse,
} from "Common/Server/Utils/TwoFactorBackupCodeNotification";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { markupAsSpacesWithOutlookContent } from "Common/Tests/Helpers/HtmlText";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

/*
 * The email that tells an account's owner one of their two-factor backup
 * codes was spent to sign in: the sign-in route's way to it
 * (AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail), and the template
 * it renders (Templates/TwoFactorBackupCodeUsed.hbs).
 *
 * Since #10219 the email itself is Common's
 * (Utils/TwoFactorBackupCodeNotification.sendCodeUsedEmail), which Confirm
 * It's You sends too when a backup code confirms it's the owner: its
 * address, its words in the owner's language, its subject and its count are
 * pinned by Common/Tests/Server/Utils/Reauthentication/
 * ReauthenticationEmails.test.ts, and the template in every language by
 * Tests/Notification/ConfirmItsYouEmailsInLanguages.test.ts. Here: that the
 * sign-in's way sends it, once, for a sign-in, with the count and where the
 * code was spent from; and the card the template draws.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");
const WHITESPACE_RUN: RegExp = /\s+/g;

function textOf(html: string): string {
  return markupAsSpacesWithOutlookContent(html).replace(WHITESPACE_RUN, " ");
}

function account(id: ObjectID | null = ObjectID.generate()): User {
  const user: User = new User();

  if (id) {
    user.id = id;
  }

  user.email = new Email("owner@example.com");
  return user;
}

function render(vars: Record<string, string>): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, "TwoFactorBackupCodeUsed.hbs"),
      "utf8",
    ),
  )({ brandProductName: "OneUptime", ...vars });
}

let sendCodeUsedEmail: jest.SpiedFunction<
  typeof TwoFactorBackupCodeNotification.sendCodeUsedEmail
>;

beforeAll(async () => {
  const partialNames: Array<string> = fs
    .readdirSync(PARTIALS_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production util registers its partials asynchronously; wait for them.
  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  sendCodeUsedEmail = jest
    .spyOn(TwoFactorBackupCodeNotification, "sendCodeUsedEmail")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the sign-in's way to the email", () => {
  it("sends Common's email once, for a sign-in, with the count and where the code was spent from", async () => {
    const user: User = account();

    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: user,
      remainingCodeCount: 7,
      origin: {
        ipAddress: "203.0.113.7",
        location: "Lyon, France",
        device: "Firefox 132 on Windows",
      },
    });

    expect(sendCodeUsedEmail).toHaveBeenCalledTimes(1);
    expect(sendCodeUsedEmail).toHaveBeenCalledWith({
      userId: user.id,
      remainingCodeCount: 7,
      usedFor: BackupCodeUse.SignIn,
      origin: {
        ipAddress: "203.0.113.7",
        location: "Lyon, France",
        device: "Firefox 132 on Windows",
      },
    });
  });

  it("names the account by its id: the address is read off the account, never taken from the caller", async () => {
    const user: User = account();

    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: user,
      remainingCodeCount: 0,
    });

    expect(JSON.stringify(sendCodeUsedEmail.mock.calls[0]![0])).not.toContain(
      "owner@example.com",
    );
  });

  it("an account with no id sends nothing", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account(null),
      remainingCodeCount: 7,
    });

    expect(sendCodeUsedEmail).not.toHaveBeenCalled();
  });
});

describe("what it says", () => {
  const vars: Record<string, string> = {
    usedAt: "Oct 18, 2026, 12:07 UTC",
    remainingCodeCount: "7",
    twoFactorAuthUrl:
      "https://oneuptime.example.com/dashboard/user-profile/two-factor-auth",
    homeUrl: "https://oneuptime.example.com/",
  };

  it("when, how many are left, and where the code was spent from, in one card", () => {
    const text: string = textOf(
      render({
        ...vars,
        requestIpAddress: "203.0.113.7",
        requestLocation: "Lyon, France",
        requestDevice: "Firefox 132 on Windows",
      }),
    );

    expect(text).toContain(
      "Used at: Oct 18, 2026, 12:07 UTC Backup codes remaining: 7 IP address: 203.0.113.7 Approximate location: Lyon, France Device: Firefox 132 on Windows",
    );
  });

  it("an installation that names no geo header shows no location row", () => {
    const text: string = textOf(
      render({
        ...vars,
        requestIpAddress: "203.0.113.7",
        requestLocation: "",
        requestDevice: "Firefox 132 on Windows",
      }),
    );

    expect(text).toContain(
      "Backup codes remaining: 7 IP address: 203.0.113.7 Device: Firefox 132 on Windows",
    );
    expect(text).not.toContain("Approximate location:");
  });

  it("the request's values are written as text, never as markup", () => {
    const html: string = render({
      ...vars,
      requestIpAddress: "<img src=x onerror=alert(1)>",
      requestLocation: "<script>alert(1)</script>",
      requestDevice: "<b>Chrome</b>",
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>Chrome</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});
