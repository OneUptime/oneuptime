import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "Common/Types/SSO/LocalSignInClearing";
import {
  getSignInSettingsClearedEmailVariables,
  SignInAfterClearing,
  SignInSettingsClearedBy,
  SignInSettingsClearedEmailData,
} from "Common/Types/SSO/SignInSettingsClearedEmail";
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
 * THE EMAIL A PERSON GETS WHEN THEIR SIGN-IN SETTINGS ARE CLEARED
 * (SignInSettingsCleared.hbs, #9818, #9820).
 *
 * Rendered with the variables the sender builds
 * (getSignInSettingsClearedEmailVariables) and the production helpers and
 * partials: who cleared them, by role; when; a line for each thing that
 * was removed and none for what was not; one way to sign in now, with its
 * button; who to ask, by the kind of server and who cleared them; in the
 * reader's language. A project's name is its owners' words, so it is
 * escaped wherever it is drawn.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const SSO_URL: string = "https://oneuptime.example.com/accounts/sso";
const FORGOT_PASSWORD_URL: string =
  "https://oneuptime.example.com/accounts/forgot-password";
const SIGN_IN_URL: string = "https://oneuptime.example.com/accounts/login";

const EVERYTHING: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 2,
  passkeyAndSecurityKeyCount: 3,
  backupCodeCount: 8,
};

// The languages the server writes in besides English.
const SERVER_LANGUAGES: ReadonlyArray<string> = [
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
];

const RESET_LINK_LINE: string =
  "The password reset link sent to you, which no longer works";

const UNNAMED_OWNER_LINE: string =
  "A project owner cleared the sign-in settings saved on your OneUptime account.";

const data: (
  overrides?: Partial<SignInSettingsClearedEmailData>,
) => SignInSettingsClearedEmailData = (
  overrides?: Partial<SignInSettingsClearedEmailData>,
): SignInSettingsClearedEmailData => {
  return {
    clearedBy: SignInSettingsClearedBy.ServerAdmin,
    cleared: EVERYTHING,
    signIn: SignInAfterClearing.SingleSignOn,
    ssoProviderNames: ["Okta", "Azure AD"],
    clearedAt: "Nov 19, 2026, 10:42 AM UTC",
    productName: "OneUptime",
    signInUrl: SIGN_IN_URL,
    ssoSignInUrl: SSO_URL,
    forgotPasswordUrl: FORGOT_PASSWORD_URL,
    ...overrides,
  } as SignInSettingsClearedEmailData;
};

function render(
  emailData: SignInSettingsClearedEmailData,
  root: Record<string, unknown> = {},
): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, EmailTemplateType.SignInSettingsCleared),
      { encoding: "utf8" },
    ),
  )({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    isSelfHosted: "true",
    ...getSignInSettingsClearedEmailVariables(emailData),
    ...root,
  });
}

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

describe("who cleared them, and when", () => {
  test("a server admin, named by role, and the time it was done", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("Your sign-in settings were cleared");
    expect(text).toContain(
      "A server admin cleared the sign-in settings saved on your OneUptime account.",
    );
    expect(text).toContain("Cleared at:");
    expect(text).toContain("Nov 19, 2026, 10:42 AM UTC");
    expect(text).not.toContain("An owner of");
  });

  test("an owner of a project, named by the project, never as a server admin", () => {
    const text: string = visibleText(
      render(
        data({
          clearedBy: SignInSettingsClearedBy.ProjectOwner,
          projectName: "Acme Production",
        } as Partial<SignInSettingsClearedEmailData>),
      ),
    );

    expect(text).toContain(
      "An owner of Acme Production cleared the sign-in settings saved on your OneUptime account.",
    );
    expect(text).not.toContain("A server admin");
  });

  test("a project deleted since the clear (#9991): 'a project owner', no gap where its name was, never a server admin", () => {
    const text: string = visibleText(
      render(
        data({
          clearedBy: SignInSettingsClearedBy.ProjectOwner,
          projectName: "",
        } as Partial<SignInSettingsClearedEmailData>),
      ),
    );

    expect(text).toContain(UNNAMED_OWNER_LINE);
    expect(text).not.toContain("An owner of");
    expect(text).not.toContain("A server admin");
    expect(text).not.toContain("contact the owners of");
  });

  test("a project's name is escaped wherever it is drawn: its owners wrote it", () => {
    const html: string = render(
      data({
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        projectName: '<a href="https://evil.example">Acme</a>',
      } as Partial<SignInSettingsClearedEmailData>),
    );

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain("&lt;a href");
  });
});

describe("what was removed", () => {
  test("a line for each thing they had, with its count", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain("What was removed");
    expect(text).toContain(
      "Your password, and any password reset or sign-in link sent to you",
    );
    expect(text).toContain("3 passkeys and security keys");
    expect(text).toContain("2 authenticator apps");
    expect(text).toContain("8 backup codes");
    expect(text).toContain(
      "Two-factor authentication, which is now turned off",
    );
  });

  test("a reset link beside a password is named in the password's line, not in one of its own (#9992)", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain(
      "Your password, and any password reset or sign-in link sent to you",
    );
    expect(text).not.toContain(RESET_LINK_LINE);
  });

  test("a reset link alone - all that a person had - is the one line (#9992)", () => {
    const text: string = visibleText(
      render(
        data({
          cleared: {
            ...NO_LOCAL_SIGN_IN_SETTINGS,
            hasPasswordResetLink: true,
          },
        }),
      ),
    );

    expect(text).toContain("What was removed");
    expect(text).toContain(RESET_LINK_LINE);
    expect(text).not.toContain("Your password");
    expect(text).not.toContain("passkey");
    expect(text).not.toContain("which is now turned off");
  });

  test("one of each reads as one", () => {
    const text: string = visibleText(
      render(
        data({
          cleared: {
            hasPassword: false,
            hasPasswordResetLink: false,
            isTwoFactorAuthEnabled: false,
            authenticatorAppCount: 1,
            passkeyAndSecurityKeyCount: 1,
            backupCodeCount: 1,
          },
        }),
      ),
    );

    expect(text).toContain("1 passkey or security key");
    expect(text).toContain("1 authenticator app");
    expect(text).toContain("1 backup code");
    expect(text).not.toContain("1 backup codes");
  });

  test("no line for what they did not have", () => {
    const text: string = visibleText(
      render(
        data({
          cleared: {
            ...NO_LOCAL_SIGN_IN_SETTINGS,
            backupCodeCount: 4,
          },
        }),
      ),
    );

    expect(text).toContain("4 backup codes");
    expect(text).not.toContain("Your password");
    expect(text).not.toContain("passkey");
    expect(text).not.toContain("authenticator app");
    expect(text).not.toContain("which is now turned off");
  });

  test("says the devices signed in without SSO were signed out", () => {
    expect(visibleText(render(data()))).toContain(
      "Devices that were signed in without single sign-on (SSO) have been signed out.",
    );
  });
});

describe("how to sign in now", () => {
  test("with single sign-on: says so, names the providers, and links the SSO sign-in page", () => {
    const html: string = render(data());
    const text: string = visibleText(html);

    expect(text).toContain("How to sign in now");
    expect(text).toContain(
      "Sign in with single sign-on (SSO). Your organization's identity provider now manages your password and two-factor authentication.",
    );
    expect(text).toContain("Single sign-on:");
    expect(text).toContain("Okta · Azure AD");
    expect(text).toContain("Sign In with SSO");
    expect(html).toContain(`href="${SSO_URL}"`);
    expect(text).not.toContain("Set a New Password");
    expect(html).not.toContain(FORGOT_PASSWORD_URL);
  });

  test("a provider's name is escaped: its admins wrote it", () => {
    const html: string = render(
      data({ ssoProviderNames: ["<img src=x onerror=alert(1)>"] }),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src");
  });

  test("with nothing managing their sign-in: a new password, from Forgot password?", () => {
    const html: string = render(
      data({ signIn: SignInAfterClearing.ForgotPassword }),
    );
    const text: string = visibleText(html);

    expect(text).toContain(
      "To sign in with a password again, set a new one with Forgot password? on the sign-in page.",
    );
    expect(text).toContain("Set a New Password");
    expect(html).toContain(`href="${FORGOT_PASSWORD_URL}"`);
    expect(text).not.toContain("Sign In with SSO");
    expect(text).not.toContain("Single sign-on:");
  });

  test("when it could not be read: both ways, and the sign-in page", () => {
    const html: string = render(data({ signIn: SignInAfterClearing.Unknown }));
    const text: string = visibleText(html);

    expect(text).toContain(
      "Sign in with single sign-on (SSO) if your organization uses it. Otherwise, set a new password with Forgot password? on the sign-in page.",
    );
    expect(html).toContain(`href="${SIGN_IN_URL}"`);
    expect(text).not.toContain("Sign In with SSO");
    expect(text).not.toContain("Set a New Password");
  });
});

describe("who to ask", () => {
  test("a project owner's clear: the project's owners", () => {
    const text: string = visibleText(
      render(
        data({
          clearedBy: SignInSettingsClearedBy.ProjectOwner,
          projectName: "Acme Production",
        } as Partial<SignInSettingsClearedEmailData>),
      ),
    );

    expect(text).toContain(
      "If you did not expect this, contact the owners of Acme Production.",
    );
    expect(text).not.toContain("server's admin");
    expect(text).not.toContain("support@oneuptime.com");
  });

  test("a server admin's on a self-hosted server: the server's admin, never OneUptime's support", () => {
    const text: string = visibleText(render(data()));

    expect(text).toContain(
      "If you did not expect this, contact your server's admin.",
    );
    expect(text).not.toContain("support@oneuptime.com");
  });

  test("a server admin's on OneUptime Cloud: OneUptime's support", () => {
    const text: string = visibleText(render(data(), { isSelfHosted: "" }));

    expect(text).toContain(
      "If you did not expect this, contact support at support@oneuptime.com.",
    );
    expect(text).not.toContain("server's admin");
  });

  test("a project deleted since the clear: the server's admin on a self-hosted server, support on Cloud", () => {
    const ownerOfNoProject: SignInSettingsClearedEmailData = data({
      clearedBy: SignInSettingsClearedBy.ProjectOwner,
      projectName: "",
    } as Partial<SignInSettingsClearedEmailData>);

    expect(visibleText(render(ownerOfNoProject))).toContain(
      "If you did not expect this, contact your server's admin.",
    );
    expect(
      visibleText(render(ownerOfNoProject, { isSelfHosted: "" })),
    ).toContain(
      "If you did not expect this, contact support at support@oneuptime.com.",
    );
  });

  test("a renamed Cloud installation names no support address", () => {
    const text: string = visibleText(
      render(data(), { isSelfHosted: "", isBrandRenamed: "true" }),
    );

    expect(text).not.toContain("support@oneuptime.com");
    expect(text).not.toContain("server's admin");
  });
});

describe("in the reader's language", () => {
  test("German: the email's own words are German, the values as they are", () => {
    const text: string = visibleText(
      render(data(), getEmailLanguageVariables("de")),
    );

    expect(text).not.toContain("Your sign-in settings were cleared");
    expect(text).not.toContain("What was removed");
    expect(text).not.toContain("How to sign in now");
    expect(text).not.toContain("Sign In with SSO");
    expect(text).toContain("Okta · Azure AD");
    expect(text).toContain("OneUptime");
  });

  test("Persian: laid out from the right, and not in English", () => {
    const html: string = render(data(), getEmailLanguageVariables("fa"));

    expect(html).toContain('dir="rtl"');
    expect(visibleText(html)).not.toContain(
      "Your sign-in settings were cleared",
    );
  });

  test("every language the server writes in words the email's title", () => {
    for (const language of SERVER_LANGUAGES) {
      expect(
        visibleText(render(data(), getEmailLanguageVariables(language))),
      ).not.toContain("Your sign-in settings were cleared");
    }
  });

  test("every language words a reset link's line (#9992), and a deleted project's owner (#9991)", () => {
    for (const language of SERVER_LANGUAGES) {
      const resetLinkOnly: string = visibleText(
        render(
          data({
            cleared: {
              ...NO_LOCAL_SIGN_IN_SETTINGS,
              hasPasswordResetLink: true,
            },
          }),
          getEmailLanguageVariables(language),
        ),
      );

      const ownerOfNoProject: string = visibleText(
        render(
          data({
            clearedBy: SignInSettingsClearedBy.ProjectOwner,
            projectName: "",
          } as Partial<SignInSettingsClearedEmailData>),
          getEmailLanguageVariables(language),
        ),
      );

      expect(resetLinkOnly).not.toContain(RESET_LINK_LINE);
      expect(ownerOfNoProject).not.toContain(UNNAMED_OWNER_LINE);
      // The product's name stays as the installation calls itself.
      expect(ownerOfNoProject).toContain("OneUptime");
    }
  });
});
