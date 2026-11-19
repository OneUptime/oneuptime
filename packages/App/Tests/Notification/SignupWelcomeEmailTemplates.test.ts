import Handlebars from "handlebars";
import { registerEmailLanguageHelpers } from "../../FeatureSet/Notification/Utils/EmailLanguage";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  registerEmailBrandHelpers,
  registerJoiningConcat,
} from "./Fixtures/EmailBrandHelpers";
import { decodeHtmlEntities, htmlAsText } from "Common/Tests/Helpers/HtmlText";

/*
 * THE WELCOME A NEW ACCOUNT GETS, AS IT IS ON EACH KIND OF SERVER (#7988).
 *
 *   - OneUptime Cloud (billing on): an account cannot sign in until its
 *     address is verified, so the welcome asks for that - SignupWelcomeEmail,
 *     with Verify Email Address - as it always has;
 *   - a self-hosted server (billing off): sign-up takes the person straight
 *     to the Dashboard, so the welcome says the account is ready, opens it,
 *     and sends questions to the server's own admin - never to OneUptime's
 *     support, who cannot help with somebody's own server
 *     (SignupAccountReadyEmail). The first account on a server is its master
 *     admin, who is shown where the server's settings are instead.
 *
 * The last tests pin the variables against the code that sends the email: a
 * rename on one side would draw an empty button on the other.
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

const AUTHENTICATION_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "API",
  "Authentication.ts",
);

const DASHBOARD_LINK: string = "https://oneuptime.test/dashboard";
const ADMIN_DASHBOARD_LINK: string = "https://oneuptime.test/admin";
const VERIFY_LINK: string =
  "https://oneuptime.test/accounts/verify-email/44444444-4444-4444-8444-444444444444";
const SUPPORT_ADDRESS: string = "support@oneuptime.com";
const WHITESPACE_RUN: RegExp = /\s+/g;

interface Anchor {
  href: string;
  text: string;
  isButton: boolean;
  isSecondary: boolean;
}

function render(template: string, vars: Record<string, unknown>): string {
  return handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, `${template}.hbs`), "utf8"),
  )({ homeUrl: "https://oneuptime.test", ...vars });
}

function textOf(html: string): string {
  return htmlAsText(html).replace(WHITESPACE_RUN, " ");
}

function anchors(html: string): Array<Anchor> {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match: RegExpMatchArray): Anchor => {
      const attributes: string = match[1]!;
      const href: string = decodeHtmlEntities(
        attributes.match(/\bhref="([^"]*)"/)?.[1] || "",
      );

      return {
        href: href,
        text: htmlAsText(match[2]!).trim(),
        isButton: attributes.includes("st-Button-link"),
        isSecondary: attributes.includes("#e2e8f0"),
      };
    },
  );
}

function buttons(html: string): Array<Anchor> {
  return anchors(html).filter((anchor: Anchor): boolean => {
    return anchor.isButton;
  });
}

function readyEmail(vars: Record<string, unknown> = {}): string {
  return render("SignupAccountReadyEmail", {
    dashboardLink: DASHBOARD_LINK,
    ...vars,
  });
}

function masterAdminReadyEmail(vars: Record<string, unknown> = {}): string {
  return readyEmail({
    isMasterAdmin: "true",
    adminDashboardLink: ADMIN_DASHBOARD_LINK,
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

  registerJoiningConcat(handlebars);
  registerEmailBrandHelpers(handlebars);
});

describe("OneUptime Cloud's welcome still asks to verify the address", () => {
  test("its one button verifies the address", () => {
    const html: string = render("SignupWelcomeEmail", {
      tokenVerifyUrl: VERIFY_LINK,
    });

    expect(textOf(html)).toContain(
      "To get started, please verify your email address",
    );
    expect(
      buttons(html).map((anchor: Anchor): string => {
        return `${anchor.text} ${anchor.href}`;
      }),
    ).toEqual([`Verify Email Address ${VERIFY_LINK}`]);
  });

  test("and keeps OneUptime's support line", () => {
    const html: string = render("SignupWelcomeEmail", {
      tokenVerifyUrl: VERIFY_LINK,
    });

    expect(html).toContain(`mailto:${SUPPORT_ADDRESS}`);
  });
});

describe("a self-hosted server's welcome: the account is ready", () => {
  test("welcomes them by the product's name", () => {
    expect(textOf(readyEmail())).toContain("Welcome to OneUptime!");
  });

  test("says the account is ready, and asks for nothing", () => {
    const text: string = textOf(readyEmail());

    expect(text).toContain(
      "Your account is ready, and there is nothing to verify.",
    );
    expect(text).not.toMatch(/please verify/i);
    expect(text).not.toContain("Verify Email Address");
  });

  test("its button opens the Dashboard, with the link to copy under it", () => {
    const html: string = readyEmail();

    expect(
      buttons(html).map((anchor: Anchor): string => {
        return `${anchor.text} ${anchor.href}`;
      }),
    ).toEqual([`Open OneUptime ${DASHBOARD_LINK}`]);
    expect(
      anchors(html).filter((anchor: Anchor): boolean => {
        return !anchor.isButton && anchor.text === DASHBOARD_LINK;
      }),
    ).toHaveLength(1);
  });

  test("never links a verification page, even when handed one", () => {
    const html: string = readyEmail({ tokenVerifyUrl: VERIFY_LINK });

    expect(html).not.toContain("verify-email");
  });

  test("sends questions to the server's admin, not to OneUptime's support", () => {
    const html: string = readyEmail();

    expect(textOf(html)).toContain("Need help? Ask your server's admin.");
    expect(html).not.toContain(SUPPORT_ADDRESS);
    expect(textOf(html)).not.toContain("Contact support");
  });

  test("anyone but the server's admin has no Admin Dashboard button", () => {
    const html: string = readyEmail({
      adminDashboardLink: ADMIN_DASHBOARD_LINK,
    });

    expect(textOf(html)).not.toContain("Admin Dashboard");
    expect(html).not.toContain(ADMIN_DASHBOARD_LINK);
  });

  test("a renamed installation is named, and its button too", () => {
    const html: string = readyEmail({
      brandProductName: "Acme Watch",
      isBrandRenamed: "true",
    });

    expect(textOf(html)).toContain("Welcome to Acme Watch!");
    expect(buttons(html)[0]!.text).toBe("Open Acme Watch");
    expect(textOf(html)).not.toContain("OneUptime");
  });
});

describe("the first account on a server: its master admin", () => {
  test("is told they are this server's admin, and where its settings are", () => {
    const text: string = textOf(masterAdminReadyEmail());

    expect(text).toContain(
      "You are this server's admin: its settings, such as email and who can sign up, are in the Admin Dashboard.",
    );
    expect(text).not.toContain("Ask your server's admin");
  });

  test("opens the Dashboard first, then the Admin Dashboard, the quieter button", () => {
    const html: string = masterAdminReadyEmail();

    expect(
      buttons(html).map((anchor: Anchor): string => {
        return `${anchor.text} ${anchor.href} ${anchor.isSecondary ? "secondary" : "primary"}`;
      }),
    ).toEqual([
      `Open OneUptime ${DASHBOARD_LINK} primary`,
      `Open Admin Dashboard ${ADMIN_DASHBOARD_LINK} secondary`,
    ]);
  });

  test("is not sent to OneUptime's support either", () => {
    expect(masterAdminReadyEmail()).not.toContain(SUPPORT_ADDRESS);
  });
});

describe("the variables the sign-up sets", () => {
  const authentication: string = fs
    .readFileSync(AUTHENTICATION_PATH, "utf8")
    .replace(WHITESPACE_RUN, " ");

  /*
   * The ready welcome: a sign-up on a server that cannot prove the address
   * by email signs its new account straight in (#9816).
   */
  const readyBranch: string = authentication.slice(
    authentication.indexOf(
      "const signUpWithoutProvingTheAddress: SignUpWithoutProvingTheAddressFunction =",
    ),
    authentication.indexOf(
      "const signInNewAccount: SignInNewAccountFunction =",
    ),
  );

  test("the ready welcome's branch is found", () => {
    expect(readyBranch.length).toBeGreaterThan(0);
  });

  test("the ready welcome is sent where no verification is required", () => {
    expect(readyBranch).toContain(
      "templateType: EmailTemplateType.SignupAccountReadyEmail,",
    );
    expect(readyBranch).toContain(
      "subject: `Welcome to ${ProductBrandingText.getProductName()}. Your account is ready.`,",
    );
  });

  test("it sets every variable the template reads, under the same names", () => {
    for (const name of ["dashboardLink", "adminDashboardLink", "homeUrl"]) {
      expect(readyBranch).toContain(`${name}: new URL(`);
    }

    expect(readyBranch).toContain('isMasterAdmin: "true",');
    expect(readyBranch).toContain("new Route(DashboardRoute.toString())");
    expect(readyBranch).toContain("new Route(AdminDashboardRoute.toString())");
  });

  test("the verify welcome is a sign-up's that proves its address by email", () => {
    /*
     * OneUptime Cloud's, and a self-hosted server's that can send email
     * (#9816): sent after the answer every address gets, by
     * Identity/Utils/EmailProvedSignUp.
     */
    const emailProvedSignUp: string = fs
      .readFileSync(
        Path.resolve(
          AUTHENTICATION_PATH,
          "..",
          "..",
          "Utils",
          "EmailProvedSignUp.ts",
        ),
        "utf8",
      )
      .replace(WHITESPACE_RUN, " ");

    expect(emailProvedSignUp).toContain(
      "templateType: EmailTemplateType.SignupWelcomeEmail,",
    );
    expect(emailProvedSignUp).toContain(
      "subject: `Welcome to ${ProductBrandingText.getProductName()}. Please verify your email.`,",
    );
    expect(authentication).not.toContain(
      "templateType: EmailTemplateType.SignupWelcomeEmail,",
    );
  });
});
