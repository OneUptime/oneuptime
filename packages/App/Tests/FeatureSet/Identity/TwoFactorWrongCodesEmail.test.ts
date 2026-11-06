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
 * entered at the second step of signing in
 * (AuthenticationEmail.sendTwoFactorWrongCodesEmail,
 * Templates/TwoFactorWrongCodes.hbs): who it goes to, what it is called, and
 * what it says - the rule as TwoFactorWrongCodes keeps it, what to do if it
 * was them, and the way out if it was not, which depends on what began the
 * sign-in. Somebody who entered the password is shut out by a new one;
 * somebody who opened a sign-in link can read the mailbox, and a new password
 * does not secure that.
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
  return jest
    .mocked(MailService.sendMail)
    .mock.calls.map((call: Array<unknown>): SentMail => {
      return call[0] as SentMail;
    });
}

function render(vars: Record<string, string>): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, "TwoFactorWrongCodes.hbs"),
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
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
      isMagicLinkSignIn: false,
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
      isMagicLinkSignIn: false,
    });

    expect(sentMails()[0]!.subject).toBe(
      "Wrong two factor codes were entered for your Acme Status account",
    );
  });

  it("carries the count, when it happened, and the installation's own forgot-password page", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 7,
      isMagicLinkSignIn: false,
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

  it.each([
    [false, "false"],
    [true, "true"],
  ])(
    "tells the template what began the sign-in, as text its condition compares: %s",
    async (isMagicLinkSignIn: boolean, expected: string) => {
      await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
        user: account("owner@example.com"),
        wrongCodesInARow: 5,
        isMagicLinkSignIn: isMagicLinkSignIn,
      });

      expect(sentMails()[0]!.vars["isMagicLinkSignIn"]).toBe(expected);
    },
  );

  it("is called the same whichever began the sign-in", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
      isMagicLinkSignIn: true,
    });

    expect(sentMails()[0]!.subject).toBe(
      "Wrong two factor codes were entered for your OneUptime account",
    );
  });

  it("an account without an address is sent nothing", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account(),
      wrongCodesInARow: 5,
      isMagicLinkSignIn: false,
    });

    expect(sentMails()).toHaveLength(0);
  });
});

const VARS: Record<string, string> = {
  wrongCodeCount: "5",
  enteredAt: "Oct 18, 2026, 12:07 UTC",
  forgotPasswordUrl: "https://oneuptime.example.com/accounts/forgot-password",
  homeUrl: "https://oneuptime.example.com/",
  isMagicLinkSignIn: "false",
};

describe("what it says when the password began the sign-in", () => {
  const vars: Record<string, string> = VARS;

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

  it("sends nobody to their mailbox: nothing says it is being read", () => {
    const text: string = textOf(render(vars));

    expect(text).not.toContain("can read your email");
    expect(text).not.toContain("sign-in link");
    expect(text).not.toContain("forwarding");
  });

  it("is what an email that does not say what began the sign-in reads as", () => {
    const withoutIt: Record<string, string> = { ...VARS };
    delete withoutIt["isMagicLinkSignIn"];

    expect(render(withoutIt)).toBe(render(vars));
  });
});

describe("what it says when a sign-in link began the sign-in", () => {
  const vars: Record<string, string> = { ...VARS, isMagicLinkSignIn: "true" };

  it("says a sign-in link was opened, and that nobody entered the password", () => {
    const text: string = textOf(render(vars));

    expect(text).toContain(
      "Someone opened a sign-in link emailed to you for your OneUptime account, then entered wrong codes at the second step of signing in.",
    );
    expect(text).not.toContain("entered the password");
    expect(text).not.toContain("knows your password");
  });

  it("the rule, how many and when, as a password's email says them", () => {
    const text: string = textOf(render(vars));

    expect(text).toContain(
      "each next code now waits before it is checked: one minute at first, then longer after each wrong code, up to an hour.",
    );
    expect(text).toContain("Wrong codes in a row: 5");
    expect(text).toContain("Last wrong code at: Oct 18, 2026, 12:07 UTC");
  });

  it("what to do if it was them: a backup code and a security key finish a link's sign-in too", () => {
    const text: string = textOf(render(vars));

    expect(text).toContain("If this was you");
    expect(text).toContain(
      "check that your phone sets its clock automatically, then try again when the wait is over. A backup code or a security key also signs you in.",
    );
  });

  it("if it was not them: someone can read their email, and a new password alone does not stop that person", () => {
    const text: string = textOf(render(vars));

    expect(text).toContain("If this was not you");
    expect(text).toContain(", someone can read your email.");
    expect(text).toContain(
      "a new OneUptime password alone does not stop them asking for another link.",
    );
  });

  it("has the mailbox secured before the password is reset, since a reset ends the wait for anyone who can ask for a new link", () => {
    const text: string = textOf(render(vars));

    const secure: number = text.indexOf(
      "First, change your email account's password and remove any forwarding you did not set up",
    );
    const reset: number = text.indexOf(
      "Then reset your OneUptime password: any link already sent stops working, and the wait ends for you.",
    );

    expect(secure).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(secure);
  });

  it("its one button still resets the password, and comes after what to do first", () => {
    const text: string = textOf(render(vars));

    expect(text.indexOf("Reset your password")).toBeGreaterThan(
      text.indexOf("Then reset your OneUptime password"),
    );
  });

  it("names the product the way the installation goes by, as text", () => {
    const html: string = render({ ...vars, brandProductName: "Acme & Co" });

    expect(html).toContain("for your Acme &amp; Co account");
    expect(html).toContain("a new Acme &amp; Co password alone");
    expect(html).toContain("Then reset your Acme &amp; Co password");
    expect(html).not.toContain("OneUptime password");
  });

  it("its values are written as text here too", () => {
    const html: string = render({
      ...vars,
      wrongCodeCount: "<img src=x onerror=alert(1)>",
    });

    expect(html).not.toContain("<img src=x");
  });
});

describe("where the codes came from", () => {
  it("carries the address, the place and the device of the last wrong code", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
      isMagicLinkSignIn: false,
      origin: {
        ipAddress: "203.0.113.7",
        location: "Berlin, Germany",
        device: "Chrome 130 on Android",
      },
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(vars["requestLocation"]).toBe("Berlin, Germany");
    expect(vars["requestDevice"]).toBe("Chrome 130 on Android");
  });

  it("a request whose device nobody could name says so", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
      isMagicLinkSignIn: false,
      origin: { ipAddress: "203.0.113.7" },
    });

    expect(sentMails()[0]!.vars["requestDevice"]).toBe("Unknown device");
  });

  it("without a request to describe, carries none of them", async () => {
    await AuthenticationEmail.sendTwoFactorWrongCodesEmail({
      user: account("owner@example.com"),
      wrongCodesInARow: 5,
      isMagicLinkSignIn: false,
    });

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestLocation"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
  });

  it("shows them in the card, after how many and when", () => {
    const text: string = textOf(
      render({
        wrongCodeCount: "5",
        enteredAt: "Oct 18, 2026, 12:07 UTC",
        forgotPasswordUrl:
          "https://oneuptime.example.com/accounts/forgot-password",
        homeUrl: "https://oneuptime.example.com/",
        requestIpAddress: "203.0.113.7",
        requestLocation: "Berlin, Germany",
        requestDevice: "Chrome 130 on Android",
      }),
    );

    expect(text).toContain(
      "Last wrong code at: Oct 18, 2026, 12:07 UTC IP address: 203.0.113.7 Approximate location: Berlin, Germany Device: Chrome 130 on Android",
    );
  });
});
