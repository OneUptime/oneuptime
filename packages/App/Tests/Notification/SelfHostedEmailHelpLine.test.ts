import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import Path from "path";
import Handlebars from "handlebars";
import {
  decodeHtmlEntities,
  markupAsSpacesWithOutlookContent,
} from "Common/Tests/Helpers/HtmlText";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import MailService, {
  RenderedEmail,
} from "../../FeatureSet/Notification/Services/MailService";
import {
  SERVER_KIND_VARIABLE_NAMES,
  getEmailServerKindVariables,
} from "../../FeatureSet/Notification/Utils/EmailServerKind";
import "../../FeatureSet/Notification/Utils/Handlebars";
import { templateVariables } from "./Fixtures/EmailTemplateVariables";

/*
 * WHERE AN ACCOUNT EMAIL SENDS ITS READER FOR HELP (#8190).
 *
 * Every account email - a password reset, a sign-in link, a code, an
 * invitation, a changed password or address, the two factor ones - ends
 * with Partials/SupportBlock.hbs. It said "Need help? Contact support
 * (support@oneuptime.com)" on every server, though on a self-hosted one
 * OneUptime's support cannot help with somebody's own server: its admin
 * can. Now:
 *
 *   - OneUptime Cloud (billing on) keeps OneUptime's support, and a
 *     renamed installation still leaves the line out, as before;
 *   - a self-hosted server (billing off) says "Need help? Ask your
 *     server's admin." - the self-hosted welcome's words (#7988) - renamed
 *     or not, and never names OneUptime's support address;
 *   - the SMTP test, which reaches whoever set the mail server up, offers
 *     no help line on a self-hosted server, and OneUptime's on Cloud.
 *
 * Which kind of server an email comes from is decided once, by
 * MailService.render (Utils/EmailServerKind.ts), from IsBillingEnabled,
 * and no sender can say otherwise. The templates are rendered with the
 * production helpers and partials (Utils/Handlebars.ts, imported above),
 * and through MailService.render itself.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

// Billing decides the kind of server: set per test below.
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    IsDevelopment: false,
    IsBillingEnabled: false,
    Host: "oneuptime.example.test",
    HttpProtocol: "https://",
  };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: { Sendgrid: "Sendgrid", CustomSMTP: "Custom SMTP" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

const environment: { IsBillingEnabled: boolean } = jest.requireMock(
  "Common/Server/EnvironmentConfig",
) as { IsBillingEnabled: boolean };

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const ADMIN_LINE: string = "Need help? Ask your server's admin.";
const SUPPORT_ADDRESS: string = "support@oneuptime.com";
const SUPPORT_LINK: string = `Need help? <a href="mailto:${SUPPORT_ADDRESS}"`;
const WHITESPACE_RUN: RegExp = /\s+/g;
const SUPPORT_BLOCK_CALL: RegExp = /\{\{>\s*SupportBlock\b/;

/*
 * Every account email that offers help, through the partial. A template
 * that starts drawing it is a decision about who its reader asks, so it is
 * added here on purpose (the first test fails until it is).
 */
const TEMPLATES_WITH_A_HELP_LINE: ReadonlyArray<string> = [
  "AccountAlreadyExists",
  "CompleteRegistration",
  /*
   * The two emails to a new address a person asked to make their account's
   * (#9821): its link, or word that another account has it. Their reader
   * may have no account here at all, and on a self-hosted server only its
   * admin can say whose request it was.
   */
  "ConfirmEmailChange",
  "ConfirmProjectSsoSignIn",
  "EmailChangeAddressTaken",
  "EmailChanged",
  "EmailVerified",
  "ForgotPassword",
  "InfoMail",
  "InviteMember",
  "MagicLink",
  "PasswordChanged",
  /*
   * A session of the reader's account signed out for getting Confirm It's
   * You wrong (#10218): whoever held it may still sign in, and the reader
   * may need somebody to ask.
   */
  "ReauthenticationSignedOut",
  "SetPassword",
  "SignupWelcomeEmail",
  "TwoFactorBackupCodeUsed",
  "TwoFactorBackupCodesCreated",
  "TwoFactorBackupCodesRegenerated",
  "TwoFactorWrongCodes",
  "VerificationCode",
];

// Reaches whoever set the mail server up: no help line on a self-hosted server.
const SMTP_TEST: string = "SMTPTest";

const RENAMED: Record<string, string> = {
  brandProductName: "Acme Watch",
  isBrandRenamed: "true",
};

const ACME: ProductBranding = {
  productName: "Acme Watch",
  websiteUrl: "https://acme.example",
};

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, `${name}.hbs`), "utf8");
};

/*
 * The email's words as its reader reads them: markup a space each, and
 * character references decoded - the help line is written in the email's
 * language (EmailLanguage's t and tt, #9897), whose output is escaped, so
 * "server's" is "server&#x27;s" in the HTML.
 */
const textOf: (html: string) => string = (html: string): string => {
  return decodeHtmlEntities(markupAsSpacesWithOutlookContent(html)).replace(
    WHITESPACE_RUN,
    " ",
  );
};

// The invitation's variables that name who made it (InvitationInviter).
const INVITER_VARIABLE_NAMES: ReadonlyArray<string> = [
  "inviterLabel",
  "inviterName",
];

const INVITER: Record<string, string> = {
  inviterLabel: "Ada Walker (ada@walk.example)",
  inviterName: "Ada Walker",
};

// What an invitation that names its inviter says on a self-hosted server.
const INVITER_LINE: string =
  "Need help? Ask Ada Walker, who invited you, or your server's admin.";

/*
 * A template rendered with a value for every variable it reads - so every
 * block it has is drawn - and with the server and the branding given here,
 * never the samples' "true".
 */
const render: (name: string, server: Record<string, string>) => string = (
  name: string,
  server: Record<string, string>,
): string => {
  const source: string = readTemplate(name);
  const variables: Record<string, unknown> = Object.fromEntries(
    templateVariables(source).values.entries(),
  );

  for (const reserved of [
    ...SERVER_KIND_VARIABLE_NAMES,
    "isBrandRenamed",
    "brandProductName",
    "brandWebsiteUrl",
    "brandLogoUrl",
    /*
     * An invitation that names who made it sends questions to them as well
     * (#7471): held below, on its own. Here, the invitation names nobody,
     * as one OneUptime, an API key or a workflow makes.
     */
    ...INVITER_VARIABLE_NAMES,
  ]) {
    delete variables[reserved];
  }

  return Handlebars.compile(source)({ ...variables, ...server });
};

const SELF_HOSTED: Record<string, string> = { isSelfHosted: "true" };
const CLOUD: Record<string, string> = {};

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
  environment.IsBillingEnabled = false;
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the emails that offer help", () => {
  test("are the account emails listed here, and the SMTP test", () => {
    const drawn: Array<string> = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((file: string): boolean => {
        return (
          file.endsWith(".hbs") &&
          SUPPORT_BLOCK_CALL.test(
            fs.readFileSync(Path.join(TEMPLATES_DIR, file), "utf8"),
          )
        );
      })
      .map((file: string): string => {
        return file.slice(0, -4);
      })
      .sort();

    expect(drawn).toEqual([...TEMPLATES_WITH_A_HELP_LINE, SMTP_TEST].sort());
  });
});

describe.each([...TEMPLATES_WITH_A_HELP_LINE])("%s", (name: string) => {
  test("on OneUptime Cloud: OneUptime's support, as it always was", () => {
    const html: string = render(name, CLOUD);

    expect(html).toContain(SUPPORT_LINK);
    expect(textOf(html)).not.toContain(ADMIN_LINE);
  });

  test("on a self-hosted server: the server's admin, never OneUptime's support", () => {
    const html: string = render(name, SELF_HOSTED);

    expect(textOf(html)).toContain(ADMIN_LINE);
    expect(html).not.toContain(SUPPORT_ADDRESS);
    expect(textOf(html)).not.toContain("Contact support");
  });

  test("on a self-hosted server that goes by another name: the server's admin too", () => {
    const html: string = render(name, { ...SELF_HOSTED, ...RENAMED });

    expect(textOf(html)).toContain(ADMIN_LINE);
    expect(html).not.toContain(SUPPORT_ADDRESS);
  });

  test("renamed, and not self-hosted: no help line, as before", () => {
    const html: string = render(name, RENAMED);

    expect(html).not.toContain(SUPPORT_ADDRESS);
    expect(textOf(html)).not.toContain(ADMIN_LINE);
  });

  test("says it once", () => {
    const text: string = textOf(render(name, SELF_HOSTED));

    expect(text.split(ADMIN_LINE).length - 1).toBe(1);
  });
});

describe("an invitation that names who made it (#7471)", () => {
  const renderInvitation: (server: Record<string, string>) => string = (
    server: Record<string, string>,
  ): string => {
    return render("InviteMember", { ...INVITER, ...server });
  };

  test("on a self-hosted server, sends questions to the inviter or the server's admin, never OneUptime's support", () => {
    const html: string = renderInvitation(SELF_HOSTED);

    expect(textOf(html)).toContain(INVITER_LINE);
    expect(textOf(html).split("Need help?").length - 1).toBe(1);
    expect(textOf(html)).not.toContain(ADMIN_LINE);
    expect(html).not.toContain(SUPPORT_ADDRESS);
    expect(textOf(html)).not.toContain("Contact support");
  });

  test("renamed, on a self-hosted server, says the same", () => {
    const html: string = renderInvitation({ ...SELF_HOSTED, ...RENAMED });

    expect(textOf(html)).toContain(INVITER_LINE);
    expect(html).not.toContain(SUPPORT_ADDRESS);
  });

  test("on OneUptime Cloud, keeps OneUptime's support, and names the inviter only as who invited them", () => {
    const html: string = renderInvitation(CLOUD);

    expect(html).toContain(SUPPORT_LINK);
    expect(textOf(html)).not.toContain(INVITER_LINE);
    expect(textOf(html)).not.toContain(ADMIN_LINE);
  });

  test("the inviter's name is printed as their words, never as HTML", () => {
    const html: string = render("InviteMember", {
      ...SELF_HOSTED,
      inviterLabel: '<a href="https://evil.example">Ada</a> (ada@walk.example)',
      inviterName: '<a href="https://evil.example">Ada</a>',
    });

    expect(html).not.toContain('<a href="https://evil.example">');
    // Handlebars escapes "=" too.
    expect(html).toContain(
      "&lt;a href&#x3D;&quot;https://evil.example&quot;&gt;",
    );
  });
});

describe("the SMTP test email", () => {
  test("on OneUptime Cloud keeps OneUptime's support", () => {
    expect(render(SMTP_TEST, CLOUD)).toContain(SUPPORT_LINK);
  });

  test.each([
    ["by its own name", SELF_HOSTED],
    ["renamed", { ...SELF_HOSTED, ...RENAMED }],
  ] as Array<[string, Record<string, string>]>)(
    "on a self-hosted server, %s, offers no help line: it reaches whoever set email up",
    (_name: string, server: Record<string, string>) => {
      const html: string = render(SMTP_TEST, server);

      expect(html).not.toContain(SUPPORT_ADDRESS);
      expect(textOf(html)).not.toContain(ADMIN_LINE);
      expect(textOf(html)).not.toContain("Need help?");
      expect(textOf(html)).toContain(
        "This is a test email sent from your SMTP Server.",
      );
    },
  );
});

describe("the self-hosted welcome", () => {
  test("says what every other self-hosted email says, word for word", () => {
    const welcome: string = textOf(readTemplate("SignupAccountReadyEmail"));
    const partial: string = textOf(
      fs.readFileSync(Path.join(PARTIALS_DIR, "SupportBlock.hbs"), "utf8"),
    );

    expect(welcome).toContain(ADMIN_LINE);
    expect(partial).toContain(ADMIN_LINE);
  });
});

describe("the kind of server, as an email's variables", () => {
  test("a server that bills (OneUptime Cloud) adds nothing", () => {
    expect(getEmailServerKindVariables(true)).toEqual({});
  });

  test("a server that does not (self-hosted) says so", () => {
    expect(getEmailServerKindVariables(false)).toEqual({
      isSelfHosted: "true",
    });
  });

  test("the variable is reserved", () => {
    expect([...SERVER_KIND_VARIABLE_NAMES]).toEqual(["isSelfHosted"]);
  });
});

/*
 * Through MailService.render, as every email is sent: the kind of server
 * comes from IsBillingEnabled alone.
 */
describe("MailService.render", () => {
  const passwordReset: (vars?: Record<string, string>) => EmailMessage = (
    vars: Record<string, string> = {},
  ): EmailMessage => {
    return {
      toEmail: new Email("grace@example.test"),
      subject: "Password Reset Request for OneUptime",
      isSubjectLiteral: true,
      templateType: EmailTemplateType.ForgotPassword,
      vars: {
        tokenVerifyUrl: "https://oneuptime.example.test/accounts/reset",
        homeUrl: "https://oneuptime.example.test",
        ...vars,
      },
    };
  };

  test("on a self-hosted server, sends the reader to the server's admin", async () => {
    environment.IsBillingEnabled = false;

    const rendered: RenderedEmail = await MailService.render(passwordReset());

    expect(textOf(rendered.body)).toContain(ADMIN_LINE);
    expect(rendered.body).not.toContain(SUPPORT_ADDRESS);
  });

  test("on OneUptime Cloud, sends the reader to OneUptime's support", async () => {
    environment.IsBillingEnabled = true;

    const rendered: RenderedEmail = await MailService.render(passwordReset());

    expect(rendered.body).toContain(SUPPORT_LINK);
    expect(textOf(rendered.body)).not.toContain(ADMIN_LINE);
  });

  test("a self-hosted server that goes by another name still names its admin", async () => {
    environment.IsBillingEnabled = false;
    jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(ACME);

    const rendered: RenderedEmail = await MailService.render(passwordReset());

    expect(textOf(rendered.body)).toContain(ADMIN_LINE);
    expect(rendered.body).not.toContain(SUPPORT_ADDRESS);
  });

  test.each([
    // [billing on, what the sender put there, says the admin line]
    [true, "true", false],
    [false, "", true],
    [false, "false", true],
  ])(
    "billing on %p: a sender's isSelfHosted of %p is replaced",
    async (isBillingEnabled: boolean, given: string, saysAdmin: boolean) => {
      environment.IsBillingEnabled = isBillingEnabled;

      const rendered: RenderedEmail = await MailService.render(
        passwordReset({ isSelfHosted: given }),
      );

      expect(textOf(rendered.body).includes(ADMIN_LINE)).toBe(saysAdmin);
      expect(rendered.body.includes(SUPPORT_ADDRESS)).toBe(!saysAdmin);
    },
  );

  test("the SMTP test on a self-hosted server offers no help line", async () => {
    environment.IsBillingEnabled = false;

    const rendered: RenderedEmail = await MailService.render({
      subject: "Test Email from OneUptime",
      isSubjectLiteral: true,
      templateType: EmailTemplateType.SMTPTest,
      vars: {},
    });

    expect(textOf(rendered.body)).not.toContain("Need help?");
    expect(rendered.body).not.toContain(SUPPORT_ADDRESS);
  });

  test("leaves the sender's own variables alone", async () => {
    const message: EmailMessage = passwordReset();

    await MailService.render(message);

    expect(message.vars).not.toHaveProperty("isSelfHosted");
  });
});
