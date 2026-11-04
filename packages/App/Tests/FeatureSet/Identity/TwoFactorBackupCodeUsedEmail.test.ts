import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import "../../../FeatureSet/Notification/Utils/Handlebars";
import AuthenticationEmail from "../../../FeatureSet/Identity/Utils/AuthenticationEmail";
import MailService from "Common/Server/Services/MailService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";
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
 * The email that tells an account's owner one of their two factor backup
 * codes was just spent to sign in (AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail,
 * Templates/TwoFactorBackupCodeUsed.hbs): who it goes to, what it is called,
 * the count that is left and the advice that goes with it, and - so an owner
 * who did not sign in can tell where somebody did - the address, the place
 * and the device the code was spent from.
 */

jest.mock("Common/Server/DatabaseConfig", () => {
  const HostnameType: typeof import("Common/Types/API/Hostname").default =
    jest.requireActual("Common/Types/API/Hostname").default;
  const ProtocolType: typeof import("Common/Types/API/Protocol").default =
    jest.requireActual("Common/Types/API/Protocol").default;

  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve(new HostnameType("oneuptime.example.com"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve(ProtocolType.HTTPS);
      },
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: { sendMail: jest.fn() },
  };
});

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");
const WHITESPACE_RUN: RegExp = /\s+/g;

function textOf(html: string): string {
  return markupAsSpacesWithOutlookContent(html).replace(WHITESPACE_RUN, " ");
}

function account(email?: string, timezone?: Timezone): User {
  const user: User = new User();
  user.id = ObjectID.generate();

  if (email) {
    user.email = new Email(email);
  }

  if (timezone) {
    user.timezone = timezone;
  }

  return user;
}

type SentMail = {
  toEmail: Email;
  subject: string;
  isSubjectLiteral: boolean;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
};

function sentMails(): Array<SentMail> {
  return jest
    .mocked(MailService.sendMail)
    .mock.calls.map((call: Array<unknown>): SentMail => {
      return call[0] as SentMail;
    });
}

function render(vars: Record<string, string>): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, "TwoFactorBackupCodeUsed.hbs"),
      "utf8",
    ),
  )({ brandProductName: "OneUptime", ...vars });
}

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
  jest.mocked(MailService.sendMail).mockReset();
  jest.mocked(MailService.sendMail).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who it goes to and what it is called", () => {
  it("one mail, to the address on the account, with a subject sent as it is", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 7,
    });

    expect(sentMails()).toHaveLength(1);

    const mail: SentMail = sentMails()[0]!;

    expect(mail.toEmail.toString()).toBe("owner@example.com");
    expect(mail.subject).toBe(
      "A backup code was used to sign in to your OneUptime account",
    );
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.templateType).toBe(EmailTemplateType.TwoFactorBackupCodeUsed);
  });

  it("the subject names the product the way the installation goes by", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 7,
    });

    expect(sentMails()[0]!.subject).toBe(
      "A backup code was used to sign in to your Acme Status account",
    );
  });

  it("an account without an address is sent nothing", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account(),
      remainingCodeCount: 7,
    });

    expect(sentMails()).toHaveLength(0);
  });

  it("links to the installation's own two factor page", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 7,
    });

    const twoFactor: URL = new URL(sentMails()[0]!.vars["twoFactorAuthUrl"]!);

    expect(twoFactor.origin).toBe("https://oneuptime.example.com");
    expect(twoFactor.pathname).toBe("/dashboard/user-profile/two-factor-auth");
  });
});

describe("the count that is left, and what to do about it", () => {
  it("plenty left: where to see them and make more", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 7,
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["remainingCodeCount"]).toBe("7");
    expect(vars["remainingCodeMessage"]).toContain(
      "You can see how many codes you have left",
    );
  });

  it("three or fewer left: running low", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 3,
    });

    expect(sentMails()[0]!.vars["remainingCodeMessage"]).toContain(
      "You are running low on backup codes.",
    );
  });

  it("none left: that was the last one", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 0,
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["remainingCodeCount"]).toBe("0");
    expect(vars["remainingCodeMessage"]).toContain(
      "That was your last backup code.",
    );
  });
});

describe("where the code was spent from", () => {
  it("carries the address, the place and the device of the sign-in", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 7,
      origin: {
        ipAddress: "203.0.113.7",
        location: "Lyon, France",
        device: "Firefox 132 on Windows",
      },
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(vars["requestLocation"]).toBe("Lyon, France");
    expect(vars["requestDevice"]).toBe("Firefox 132 on Windows");
  });

  it("the moment is in the owner's own time zone", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com", Timezone.AsiaKolkata),
      remainingCodeCount: 7,
      origin: { ipAddress: "203.0.113.7" },
    });

    expect(sentMails()[0]!.vars["requestedAt"]).toContain("IST");
  });

  it("without a request to describe, carries none of them", async () => {
    await AuthenticationEmail.sendTwoFactorBackupCodeUsedEmail({
      user: account("owner@example.com"),
      remainingCodeCount: 7,
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestLocation"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
  });
});

describe("what it says", () => {
  const vars: Record<string, string> = {
    signedInAt: "Oct 18 2026, 12:07 UTC",
    remainingCodeCount: "7",
    remainingCodeMessage:
      "You can see how many codes you have left, and generate a new set, from your user profile.",
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
      "Signed in at: Oct 18 2026, 12:07 UTC Backup codes remaining: 7 IP address: 203.0.113.7 Approximate location: Lyon, France Device: Firefox 132 on Windows",
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
