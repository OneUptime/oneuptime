import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import "../../../FeatureSet/Notification/Utils/Handlebars";
import AuthenticationEmail from "../../../FeatureSet/Identity/Utils/AuthenticationEmail";
import MailService from "Common/Server/Services/MailService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import {
  FIRST_WAIT_SECONDS,
  LONGEST_WAIT_SECONDS,
  WRONG_CODES_BEFORE_WAITING,
} from "Common/Server/Utils/TwoFactorWrongCodes";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
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
 * The email that tells an account's owner wrong two factor codes are being
 * entered after their password (AuthenticationEmail.sendTwoFactorWrongCodesEmail,
 * Templates/TwoFactorWrongCodes.hbs): who it goes to, what it is called, and
 * what it says - the rule as TwoFactorWrongCodes keeps it, what to do if it
 * was them, and the way out if it was not.
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

function account(email?: string): User {
  const user: User = new User();
  user.id = ObjectID.generate();

  if (email) {
    user.email = new Email(email);
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
  return jest.mocked(MailService.sendMail).mock.calls.map(
    (call: Array<unknown>): SentMail => {
      return call[0] as SentMail;
    },
  );
}

function render(vars: Record<string, string>): string {
  return Handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, "TwoFactorWrongCodes.hbs"), "utf8"),
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
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
    });

    expect(sentMails()).toHaveLength(1);

    const mail: SentMail = sentMails()[0]!;

    expect(mail.toEmail.toString()).toBe("owner@example.com");
    expect(mail.subject).toBe(
      "Wrong two factor codes were entered for your OneUptime account",
    );
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.templateType).toBe(EmailTemplateType.TwoFactorWrongCodes);
  });

  it("the subject names the product the way the installation goes by", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
    });

    expect(sentMails()[0]!.subject).toBe(
      "Wrong two factor codes were entered for your Acme Status account",
    );
  });

  it("carries the count, when it happened, and the installation's own forgot-password page", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 7,
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["wrongCodeCount"]).toBe("7");
    expect(vars["enteredAt"]).toEqual(expect.any(String));
    expect(vars["enteredAt"]!.length).toBeGreaterThan(0);

    const forgotPassword: URL = new URL(vars["forgotPasswordUrl"]!);

    expect(forgotPassword.origin).toBe("https://oneuptime.example.com");
    expect(forgotPassword.pathname).toBe("/accounts/forgot-password");
    expect(new URL(vars["homeUrl"]!).origin).toBe(
      "https://oneuptime.example.com",
    );
  });

  it("an account without an address is sent nothing", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account(),
      wrongCodesInARow: 5,
    });

    expect(sentMails()).toHaveLength(0);
  });
});

describe("what it says", () => {
  const vars: Record<string, string> = {
    wrongCodeCount: "5",
    enteredAt: "Oct 18, 2026, 12:07 UTC",
    forgotPasswordUrl: "https://oneuptime.example.com/accounts/forgot-password",
    homeUrl: "https://oneuptime.example.com/",
  };

  it("the rule as the count keeps it: a minute at first, longer after each wrong code, up to an hour", () => {
    expect(FIRST_WAIT_SECONDS).toBe(60);
    expect(LONGEST_WAIT_SECONDS).toBe(60 * 60);
    expect(WRONG_CODES_BEFORE_WAITING).toBe(5);

    const text: string = textOf(render(vars));

    expect(text).toContain(
      "Someone entered the password of your OneUptime account, then entered wrong codes at the second step of signing in.",
    );
    expect(text).toContain(
      "each next code now waits before it is checked: one minute at first, then longer after each wrong code, up to an hour.",
    );
  });

  it("how many, and when", () => {
    const text: string = textOf(render(vars));

    expect(text).toContain("Wrong codes in a row: 5");
    expect(text).toContain("Last wrong code at: Oct 18, 2026, 12:07 UTC");
  });

  it("what to do if it was them, and what to do if it was not", () => {
    const text: string = textOf(render(vars));

    expect(text).toContain("If this was you");
    expect(text).toContain(
      "check that your phone sets its clock automatically, then try again when the wait is over. A backup code or a security key also signs you in.",
    );
    expect(text).toContain("If this was not you");
    expect(text).toContain(
      "someone knows your password. Reset it now: the old password stops working, and the wait ends for you.",
    );
  });

  /*
   * Where the button goes, and that it is the email's only action, is
   * EmailActionContracts.test.ts (forgotPasswordUrl, "Reset your password").
   */
  it("its one button resets the password", () => {
    expect(textOf(render(vars))).toContain("Reset your password");
  });

  it("its values are written as text, never as markup", () => {
    const html: string = render({
      ...vars,
      wrongCodeCount: "<img src=x onerror=alert(1)>",
      enteredAt: "<script>alert(1)</script>",
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
