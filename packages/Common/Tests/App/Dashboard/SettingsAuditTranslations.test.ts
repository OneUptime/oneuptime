import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PERMISSION_LABELS_FIELD_TITLE,
  PERMISSION_SCOPE_DESCRIPTIONS,
  PERMISSION_SCOPE_FIELD_DESCRIPTION,
  PERMISSION_SCOPE_FIELD_TITLE,
  PERMISSION_SCOPE_TITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/PermissionScopeChoice";
import { ROLE_CARD_SUMMARIES } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import {
  AUTO_RECHARGE_AMOUNT_TITLE,
  AUTO_RECHARGE_CARD_DESCRIPTION,
  AUTO_RECHARGE_ON_TEMPLATE,
  AUTO_RECHARGE_SWITCH_DESCRIPTION,
  AUTO_RECHARGE_THRESHOLD_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import type { RadioButton } from "../../../UI/Components/RadioButtons/GroupRadioButtons";
import {
  SMTP_AUTH_TYPE_CHOICES,
  SMTP_AUTH_TYPE_DESCRIPTION,
  SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
  SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
  SMTP_TRANSPORT_CHOICES,
  SMTP_TRANSPORT_DESCRIPTION,
} from "../../../UI/Components/SmtpConfig/SmtpConfigFormFields";
import {
  SSO_GLOBAL_REACH_CHOICES,
  SSO_GLOBAL_REACH_TITLE,
  SSO_GLOBAL_SIGN_UP_CHOICES,
  SSO_GLOBAL_SIGN_UP_TITLE,
} from "../../../UI/Components/Sso/SsoProviderFormFields";

/*
 * What the settings / admin simplicity audit put on screen, in the
 * Dashboard's sixteen other languages: the role cards' one-line summaries,
 * the Scope answers, the SMTP and global SSO choices, the Auto Recharge
 * card and the SSO page's providers. Each is read from the module that
 * draws it, so a sentence added there later is held here too.
 *
 * Product, protocol and grant names (SMTP, Microsoft Graph, OAuth, Client
 * Credentials, JWT Bearer, SAML) read the same in every language
 * (i18n/SameAsEnglish.json).
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const SAME_AS_ENGLISH: Array<string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/i18n/SameAsEnglish.json",
    ),
    "utf8",
  ),
) as Array<string>;

function choiceTexts(choices: Array<RadioButton>): Array<string> {
  return choices.flatMap((choice: RadioButton): Array<string> => {
    return [choice.title, choice.description || ""].filter(Boolean);
  });
}

const STRINGS: Array<string> = Array.from(
  new Set<string>([
    ...(Object.values(ROLE_CARD_SUMMARIES) as Array<string>),
    ...Object.values(PERMISSION_SCOPE_TITLES),
    ...Object.values(PERMISSION_SCOPE_DESCRIPTIONS),
    PERMISSION_SCOPE_FIELD_TITLE,
    PERMISSION_SCOPE_FIELD_DESCRIPTION,
    PERMISSION_LABELS_FIELD_TITLE,
    SMTP_TRANSPORT_DESCRIPTION,
    SMTP_AUTH_TYPE_DESCRIPTION,
    SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
    ...choiceTexts(SMTP_TRANSPORT_CHOICES),
    ...choiceTexts(SMTP_AUTH_TYPE_CHOICES),
    ...choiceTexts(SMTP_OAUTH_PROVIDER_TYPE_CHOICES),
    "The name people see your emails come from.",
    SSO_GLOBAL_SIGN_UP_TITLE,
    SSO_GLOBAL_REACH_TITLE,
    ...choiceTexts(SSO_GLOBAL_SIGN_UP_CHOICES),
    ...choiceTexts(SSO_GLOBAL_REACH_CHOICES),
    AUTO_RECHARGE_CARD_DESCRIPTION,
    AUTO_RECHARGE_SWITCH_DESCRIPTION,
    AUTO_RECHARGE_AMOUNT_TITLE,
    AUTO_RECHARGE_THRESHOLD_TITLE,
    AUTO_RECHARGE_ON_TEMPLATE,
    "Sign in through a SAML app, such as Okta, Microsoft Entra ID or OneLogin.",
    "Sign in through an OpenID Connect app, such as Google Workspace, Auth0 or Keycloak.",
    "Sign in through one of these providers before you require SSO: {{link}}",
    "Sign in with SAML or OpenID Connect.",
  ]),
);

// Words a language writes as English does: "Labels" in Dutch.
const SAME_IN_LANGUAGE: Record<string, Array<string>> = {
  "nl.json": ["Labels"],
};

const PLACEHOLDER: RegExp = /\{\{\s*[A-Za-z0-9_.]+\s*\}\}/g;

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

const FILES: Array<string> = fs
  .readdirSync(LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .sort();

describe("the settings / admin audit's strings", () => {
  test("are read from the modules that draw them", () => {
    // Forty role lines (two pairs of roles share theirs), three answers and more.
    expect(STRINGS.length).toBeGreaterThan(70);
    expect(FILES).toHaveLength(16);
  });

  test("English keys every one as itself", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, "en.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(
      STRINGS.filter((text: string): boolean => {
        return english[text] !== text;
      }),
    ).toEqual([]);
  });

  test.each(FILES)("%s words every one in its language", (file: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, file), "utf8"),
    ) as Record<string, unknown>;

    const problems: Array<string> = [];

    for (const text of STRINGS) {
      const value: unknown = locale[text];

      if (typeof value !== "string" || !value.trim()) {
        problems.push(`missing: ${text}`);
        continue;
      }

      if (
        value === text &&
        !SAME_AS_ENGLISH.includes(text) &&
        !(SAME_IN_LANGUAGE[file] || []).includes(text)
      ) {
        problems.push(`left in English: ${text}`);
        continue;
      }

      if (
        JSON.stringify(placeholdersOf(value)) !==
        JSON.stringify(placeholdersOf(text))
      ) {
        problems.push(`placeholders differ: ${text}`);
      }

      const isSentence: boolean = text.endsWith(".");
      const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
        (ending: string): boolean => {
          return value.trim().endsWith(ending);
        },
      );

      if (isSentence !== endsLikeSentence) {
        problems.push(`punctuation differs: ${text}`);
      }
    }

    expect(problems).toEqual([]);
  });
});
