import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import { TRANSLATED_LANGUAGES } from "Common/Scripts/I18n/ServerLocales";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { TemplateValues } from "Common/Types/Translator";
import {
  getEmailLanguageVariables,
  registerEmailLanguageHelpers,
} from "../../FeatureSet/Notification/Utils/EmailLanguage";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` / brand helpers as an
 * import side effect, so this suite renders with the helpers the product
 * ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

registerEmailLanguageHelpers(Handlebars);

/*
 * THE INVITATION EMAIL, IN THE INVITEE'S LANGUAGE (#9897).
 *
 * InviteMember.hbs was written in English only. Every shape of it - an
 * invitation to accept or one accepted for them, a new account or one that
 * has signed up, single sign-on or a password, with an inviter or without -
 * now words each sentence whole in the email's language (EmailLanguage's
 * t and tt), with the project, the inviter and the product as values: the
 * team's own words, put in as written and escaped. Its help line and the
 * link's label are the email's language's too, so a German invitee reads a
 * German email, the sign-up page it opens is German as well, and a Persian
 * one reads from the right. Which language an invitation is written in is
 * TeamMemberService's to say (Common/Types/Team/InvitationEmailWords).
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const PROJECT_NAME: string = "Acme Production";
const INVITER_LABEL: string = "Ada Walker (ada@walk.example)";
const INVITER_NAME: string = "Ada Walker";
const SIGN_IN_LINK: string = "https://oneuptime.test/accounts";
const REGISTER_LINK: string =
  "https://oneuptime.test/accounts/register?email=grace%40company.com&token=t";
const SSO_SIGN_IN_LINK: string = "https://oneuptime.test/accounts/sso";

// A shape of the email: the variables TeamMemberService sets.
interface Shape {
  label: string;
  isInvitationAccepted: "true" | "false";
  isNewUser: "true" | "false";
  isSsoSignIn: "true" | "false";
  hasInviter: boolean;
}

const SHAPES: Array<Shape> = [];

for (const isInvitationAccepted of ["false", "true"] as const) {
  for (const isSsoSignIn of ["false", "true"] as const) {
    for (const isNewUser of ["true", "false"] as const) {
      for (const hasInviter of [true, false]) {
        SHAPES.push({
          label: [
            isInvitationAccepted === "true" ? "added" : "invited",
            isSsoSignIn === "true" ? "SSO" : "password",
            isNewUser === "true" ? "new account" : "signed up",
            hasInviter ? "an inviter" : "no inviter",
          ].join(", "),
          isInvitationAccepted,
          isNewUser,
          isSsoSignIn,
          hasInviter,
        });
      }
    }
  }
}

function render(
  shape: Shape,
  language: string,
  extra: Record<string, unknown> = {},
): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, EmailTemplateType.InviteMember),
      { encoding: "utf8" },
    ),
  )({
    signInLink: SIGN_IN_LINK,
    registerLink: REGISTER_LINK,
    ssoSignInLink: SSO_SIGN_IN_LINK,
    projectName: PROJECT_NAME,
    homeUrl: "https://oneuptime.test",
    year: "2026",
    isInvitationAccepted: shape.isInvitationAccepted,
    isNewUser: shape.isNewUser,
    isSsoSignIn: shape.isSsoSignIn,
    ...(shape.hasInviter
      ? { inviterLabel: INVITER_LABEL, inviterName: INVITER_NAME }
      : {}),
    ...getEmailLanguageVariables(language),
    ...extra,
  });
}

// The email's sentences, by its English, as the template writes them.
const FIRST_LINES: Record<string, string> = {
  "added|SSO|inviter":
    "{{inviter}} added you to {{project}} on {{product}}. It signs you in with your organization's single sign-on (SSO), so there is no password to create.",
  "added|SSO|nobody":
    "You've been added to a project on {{product}}. It signs you in with your organization's single sign-on (SSO), so there is no password to create.",
  "added|new|inviter":
    "{{inviter}} added you to {{project}} on {{product}}. Create your account to get started - your access is already waiting for you.",
  "added|new|nobody":
    "You've been added to a project on {{product}}. Create your account to get started - your access is already waiting for you.",
  "added|signed up|inviter":
    "{{inviter}} added you to {{project}} on {{product}}. Sign in to get started - there is nothing for you to accept.",
  "added|signed up|nobody":
    "You've been added to a project on {{product}}. Sign in to get started - there is nothing for you to accept.",
  "invited|SSO|inviter":
    "{{inviter}} invited you to join {{project}} on {{product}}. It signs you in with your organization's single sign-on (SSO), so there is no password to create.",
  "invited|SSO|nobody":
    "You've been invited to join a project on {{product}}. It signs you in with your organization's single sign-on (SSO), so there is no password to create.",
  "invited|new|inviter":
    "{{inviter}} invited you to join {{project}} on {{product}}. Create your account to get started.",
  "invited|new|nobody":
    "You've been invited to join a project on {{product}}. Create your account to get started.",
  "invited|signed up|inviter":
    "{{inviter}} invited you to join {{project}} on {{product}}. Sign in to view and manage your invitations.",
  "invited|signed up|nobody":
    "You've been invited to join a project on {{product}}. Sign in to view and manage your invitations.",
};

// The English the template says for this shape: its title, first line and button.
function englishOf(shape: Shape): {
  title: string;
  firstLine: string;
  button: { text: string; values: TemplateValues };
} {
  const kind: string =
    shape.isInvitationAccepted === "true" ? "added" : "invited";
  const way: string =
    shape.isSsoSignIn === "true"
      ? "SSO"
      : shape.isNewUser === "true"
        ? "new"
        : "signed up";

  return {
    title:
      kind === "added"
        ? "You've Been Added to {{project}}"
        : "You're Invited to {{project}}",
    firstLine:
      FIRST_LINES[`${kind}|${way}|${shape.hasInviter ? "inviter" : "nobody"}`]!,
    button:
      way === "SSO"
        ? { text: "Sign In with SSO", values: {} }
        : way === "new"
          ? { text: "Create Your Account", values: {} }
          : {
              text: "Sign In to {{product}}",
              values: { product: "OneUptime" },
            },
  };
}

// The values the template puts in each sentence.
const VALUES: TemplateValues = {
  inviter: INVITER_LABEL,
  project: PROJECT_NAME,
  product: "OneUptime",
};

/*
 * English fragments that no language's email may still show: each is a
 * piece of one of the email's own sentences, and none is a value, a
 * product name or a word a language keeps (SSO).
 */
const ENGLISH_FRAGMENTS: ReadonlyArray<string> = [
  "invited you",
  "added you",
  "You've been",
  "You're Invited",
  "You've Been Added",
  "It signs you in with your organization's",
  "no password to create",
  "Create your account",
  "Create Your Account",
  "your access is already waiting",
  "nothing for you to accept",
  "view and manage your invitations",
  "Sign In with SSO",
  "Sign In to OneUptime",
  "Or copy and paste this link",
  "Need help?",
  "Contact support",
  "who invited you",
  "server's admin",
  "Powered by",
];

function englishLeftIn(text: string): Array<string> {
  return ENGLISH_FRAGMENTS.filter((fragment: string): boolean => {
    return text.includes(fragment);
  });
}

const WHITESPACE_RUN: RegExp = /\s+/g;

/*
 * A sentence in `language` with its values, as a reader reads it in the
 * email: worded by the translator the email's helpers use (one for text a
 * person reads, which holds French marks to their words with no-break
 * spaces), every run of whitespace one space, as visibleText reads it.
 */
function asRead(
  language: string,
  template: string,
  values: TemplateValues,
): string {
  return getServerTranslator(language, { readByAPerson: true })
    .translateTemplate(template, values)
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

// The partials, from disk, so every shape renders its blocks.
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

describe("in German", () => {
  test.each(SHAPES)(
    "$label: the title, the first line and the button are German, the names as written",
    (shape: Shape) => {
      const english: ReturnType<typeof englishOf> = englishOf(shape);
      const html: string = render(shape, "de");
      const text: string = visibleText(html);

      expect(html).toContain('lang="de"');
      expect(text).toContain(asRead("de", english.title, VALUES));
      expect(text).toContain(asRead("de", english.firstLine, VALUES));
      expect(text).toContain(
        asRead("de", english.button.text, english.button.values),
      );
      expect(englishLeftIn(text)).toEqual([]);
    },
  );

  test("an invitation to join, from Ada, to a signed-up account, word for word", () => {
    const text: string = visibleText(
      render(
        {
          label: "",
          isInvitationAccepted: "false",
          isNewUser: "false",
          isSsoSignIn: "false",
          hasInviter: true,
        },
        "de",
      ),
    );

    expect(text).toContain("Sie sind zu Acme Production eingeladen");
    expect(text).toContain(
      "Ada Walker (ada@walk.example) hat Sie eingeladen, Acme Production auf OneUptime beizutreten. Melden Sie sich an, um Ihre Einladungen anzusehen und zu verwalten.",
    );
    expect(text).toContain("Bei OneUptime anmelden");
    expect(text).toContain("Oder kopieren Sie diesen Link in Ihren Browser:");
    expect(text).toContain("Brauchen Sie Hilfe?");
    expect(text).toContain("Support kontaktieren");
    expect(text).toContain("Bereitgestellt von");
  });

  test("the single sign-on invitation: German words, and SSO's button and link", () => {
    const html: string = render(
      {
        label: "",
        isInvitationAccepted: "false",
        isNewUser: "true",
        isSsoSignIn: "true",
        hasInviter: false,
      },
      "de",
    );

    expect(visibleText(html)).toContain(
      "Sie wurden eingeladen, einem Projekt auf OneUptime beizutreten. Sie melden sich mit dem Single Sign-On (SSO) Ihrer Organisation an, ein Passwort müssen Sie nicht erstellen.",
    );
    expect(visibleText(html)).toContain("Mit SSO anmelden");
    expect(html).toContain(`href="${SSO_SIGN_IN_LINK}"`);
    expect(html).not.toContain("accounts/register");
  });

  test("a self-hosted server sends questions to the inviter or its admin, in German", () => {
    const text: string = visibleText(
      render(SHAPES[0]!, "de", { isSelfHosted: "true" }),
    );

    expect(text).toContain(
      "Brauchen Sie Hilfe? Fragen Sie Ada Walker, die Person, die Sie eingeladen hat, oder Ihren Server-Administrator.",
    );
    expect(text).not.toContain("Support kontaktieren");
  });

  test("a self-hosted invitation that names nobody sends questions to the server's admin, in German", () => {
    const text: string = visibleText(
      render(
        {
          label: "",
          isInvitationAccepted: "false",
          isNewUser: "true",
          isSsoSignIn: "false",
          hasInviter: false,
        },
        "de",
        { isSelfHosted: "true" },
      ),
    );

    expect(text).toContain(
      "Brauchen Sie Hilfe? Fragen Sie Ihren Server-Administrator.",
    );
  });
});

describe("in Persian, read from the right", () => {
  test.each(SHAPES)(
    "$label: laid out from the right, in Persian, every value reading its own way",
    (shape: Shape) => {
      const english: ReturnType<typeof englishOf> = englishOf(shape);
      const html: string = render(shape, "fa");
      const text: string = visibleText(html);

      expect(html).toContain('lang="fa"');
      expect(html).toContain('dir="rtl"');
      expect(text).toContain(asRead("fa", english.title, VALUES));
      expect(text).toContain(asRead("fa", english.firstLine, VALUES));
      // The project's name is an isolate: English inside a Persian sentence.
      expect(text).toContain(`⁨${PROJECT_NAME}⁩`);
      expect(englishLeftIn(text)).toEqual([]);
    },
  );

  test("an invitation to join from Ada: the Persian words, with her name and the project's set apart", () => {
    const text: string = visibleText(
      render(
        {
          label: "",
          isInvitationAccepted: "false",
          isNewUser: "true",
          isSsoSignIn: "false",
          hasInviter: true,
        },
        "fa",
      ),
    );

    expect(text).toContain(
      `⁨${INVITER_LABEL}⁩ شما را به پیوستن به پروژهٔ ⁨${PROJECT_NAME}⁩ در ⁨OneUptime⁩ دعوت کرده است. برای شروع، حساب خود را بسازید.`,
    );
    expect(text).toContain("ساختن حساب");
    expect(text).toContain("به کمک نیاز دارید؟");
  });

  test("the single sign-on invitation is Persian too", () => {
    const text: string = visibleText(
      render(
        {
          label: "",
          isInvitationAccepted: "true",
          isNewUser: "false",
          isSsoSignIn: "true",
          hasInviter: false,
        },
        "fa",
      ),
    );

    expect(text).toContain(
      "با ورود یکپارچه (SSO) سازمانتان وارد می‌شوید، پس نیازی به ساختن رمز عبور نیست.",
    );
    expect(text).toContain("ورود با SSO");
  });
});

describe("in Arabic, read from the right", () => {
  test.each(SHAPES)(
    "$label: laid out from the right, in Arabic",
    (shape: Shape) => {
      const english: ReturnType<typeof englishOf> = englishOf(shape);
      const html: string = render(shape, "ar");
      const text: string = visibleText(html);

      expect(html).toContain('lang="ar"');
      expect(html).toContain('dir="rtl"');
      expect(text).toContain(asRead("ar", english.title, VALUES));
      expect(text).toContain(asRead("ar", english.firstLine, VALUES));
      expect(englishLeftIn(text)).toEqual([]);
    },
  );

  test("the help line asks in Arabic, with Arabic punctuation", () => {
    const text: string = visibleText(
      render(SHAPES[0]!, "ar", { isSelfHosted: "true" }),
    );

    expect(text).toContain("هل تحتاج إلى مساعدة؟");
    expect(text).toContain("الذي دعاك، أو مسؤول الخادم لديك.");
  });
});

describe("in every language the server writes in", () => {
  test.each([...TRANSLATED_LANGUAGES])(
    "%s: every shape words every sentence, and leaves no English",
    (language: string) => {
      for (const shape of SHAPES) {
        for (const isSelfHosted of [false, true]) {
          const english: ReturnType<typeof englishOf> = englishOf(shape);
          const text: string = visibleText(
            render(
              shape,
              language,
              isSelfHosted ? { isSelfHosted: "true" } : {},
            ),
          );

          expect({
            language,
            shape: shape.label,
            isSelfHosted,
            english: englishLeftIn(text),
          }).toEqual({
            language,
            shape: shape.label,
            isSelfHosted,
            english: [],
          });
          expect(text).toContain(asRead(language, english.firstLine, VALUES));
        }
      }
    },
  );
});

describe("what the team wrote is printed as words, in every language", () => {
  test.each(["de", "fa", "ar", "ja"])(
    "%s: the project's and the inviter's names are escaped, never HTML",
    (language: string) => {
      for (const shape of SHAPES) {
        const html: string = render(shape, language, {
          projectName: "<b>Acme</b>",
          inviterLabel:
            '<img src="https://evil.example/x.png"> (ada@walk.example)',
          inviterName: '<a href="https://evil.example">Ada</a>',
          isSelfHosted: "true",
        });

        expect(html).not.toContain("<b>Acme</b>");
        expect(html).not.toContain('<img src="https://evil.example');
        expect(html).not.toContain('<a href="https://evil.example">');
        expect(html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
      }
    },
  );
});

describe("in English", () => {
  test("an email with no language reads exactly as it always did", () => {
    const text: string = visibleText(
      render(
        {
          label: "",
          isInvitationAccepted: "false",
          isNewUser: "true",
          isSsoSignIn: "false",
          hasInviter: true,
        },
        "en",
      ),
    );

    expect(text).toContain("You're Invited to Acme Production");
    expect(text).toContain(
      "Ada Walker (ada@walk.example) invited you to join Acme Production on OneUptime. Create your account to get started.",
    );
    expect(text).toContain("Create Your Account");
    expect(text).toContain("Or copy and paste this link into your browser:");
    expect(text).toContain("Need help? Contact support");
    expect(text).toContain("Powered by");
  });

  test("a renamed installation's name is the product in every sentence", () => {
    const text: string = visibleText(
      render(
        {
          label: "",
          isInvitationAccepted: "false",
          isNewUser: "false",
          isSsoSignIn: "false",
          hasInviter: false,
        },
        "de",
        { brandProductName: "Acme Watch", isBrandRenamed: "true" },
      ),
    );

    expect(text).toContain(
      "Sie wurden eingeladen, einem Projekt auf Acme Watch beizutreten.",
    );
    expect(text).toContain("Bei Acme Watch anmelden");
  });
});
