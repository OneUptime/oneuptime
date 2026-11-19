import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ISSUE #8796: USER PROFILE > SECURITY IN EVERY LANGUAGE.
 *
 * #8774 gave each Dashboard language one word for two-factor authentication,
 * and the Security pages around it still read in English in twelve of them:
 * the Authenticator apps, Security keys and Backup codes cards, their empty
 * states, forms and dialogs, the Passkeys page, and the words the sentences
 * build on ("authenticator app", "security key", "passkey"). In Danish,
 * Hindi, Italian, Korean, Dutch, Norwegian, Portuguese, Russian, Swedish and
 * both Chinese, some 70 of these pages' keys were the English; in French,
 * every one from "Passkey name" on.
 *
 * Every word these pages draw is worded in every Dashboard language now, as
 * the toolchain counts it (`npm run i18n:check`): a value of its own, the
 * same English a language keeps on purpose (German and Dutch say
 * "Passkeys"), or text with no words. Each language names a backup code, an
 * authenticator app, a security key and a passkey one way, as its sign-in
 * page and its docs do (THINGS): the passkey errors, translated before,
 * said "passkey" in six languages and 通行金鑰 in Traditional Chinese.
 */

const SECURITY_ROOTS: Array<SourceRoot> = [
  // Security > Two-factor authentication, and Security > Passkeys.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Passkeys.tsx",
    kind: "ui",
  },
  // The menu that leads there.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/SideMenu.tsx",
    kind: "ui",
  },
  // Their cards: the status, security keys and passkeys, backup codes.
  {
    directory: "packages/App/FeatureSet/Dashboard/src/Components/TwoFactorAuth",
    kind: "ui",
  },
  /*
   * What the profile says in their place to somebody whose organization
   * manages their sign-in (#9688), and the Password page it says it on.
   */
  {
    directory: "packages/App/FeatureSet/Dashboard/src/Components/UserProfile",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Password.tsx",
    kind: "ui",
  },
  // The QR code and setup key an authenticator app is added with.
  {
    directory: "packages/Common/UI/Components/AuthenticatorAppSetupCode",
    kind: "ui",
  },
  // The errors adding a passkey can end in, which the Passkeys page shows.
  {
    directory: "packages/Common/UI/Utils/WebAuthn.ts",
    kind: "ui",
  },
  // The records the pages list, by the names their tables give them.
  {
    directory: "packages/Common/Models/DatabaseModels/UserTotpAuth.ts",
    kind: "models",
  },
  {
    directory: "packages/Common/Models/DatabaseModels/UserWebAuthn.ts",
    kind: "models",
  },
  {
    directory:
      "packages/Common/Models/DatabaseModels/UserTwoFactorBackupCode.ts",
    kind: "models",
  },
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface SecurityKey {
  key: string;
  file: string;
}

// Every key the Security pages read: each text, and a plural's "one" form.
function getSecurityKeys(): Array<SecurityKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(SECURITY_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): SecurityKey => {
      return { key, file };
    },
  );
}

const SECURITY_KEYS: Array<SecurityKey> = getSecurityKeys();

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(data: {
  key: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

/*
 * The things the pages name, and each language's one word for them: the
 * word its sign-in page (Accounts) and its docs (Your Account) use. The
 * keys that name a thing say it with this word, in a form of its own
 * ("adgangsnøgler", "sikkerhedsnøgle"), and never with the English.
 */
interface Thing {
  name: string;
  keys: ReadonlyArray<string>;
  words: Readonly<Record<string, RegExp>>;
}

const THINGS: ReadonlyArray<Thing> = [
  {
    name: "passkey",
    keys: [
      "Passkeys",
      "passkey",
      "Add Passkey",
      "Create Passkey",
      "Passkey name",
      "No passkeys added yet.",
      "Passkey added. Use it the next time you sign in.",
      "Passkeys require a secure connection. Open OneUptime using HTTPS, or sign in with your password.",
      "This browser does not support passkeys. Use a supported browser or sign in with your password.",
      "Passkey registration was canceled or timed out. Try again when you are ready.",
      "This authenticator is already registered. Choose a different authenticator or use your existing passkey.",
      "Unable to complete passkey registration. Please try again.",
    ],
    words: {
      da: /adgangsnøgle/i,
      fr: /clés? d['’]accès/i,
      hi: /पासकी/,
      it: /passkey/i,
      ko: /패스키/,
      nl: /passkey/i,
      no: /passnøk(?:kel|ler)/i,
      pt: /chaves? de acesso/i,
      ru: /ключ(?:и|а|ей)? доступа/i,
      sv: /passnyck(?:el|lar)/i,
      "zh-CN": /通行密钥/,
      "zh-TW": /通行密鑰/,
    },
  },
  {
    name: "security key",
    keys: [
      "Security keys",
      "security key",
      "Security key name",
      "My security key",
      "No security keys added yet.",
    ],
    words: {
      da: /sikkerhedsnøgle/i,
      fr: /clés? de sécurité/i,
      hi: /सुरक्षा कुंज(?:ी|ियाँ)/,
      it: /chiav[ei] di sicurezza/i,
      ko: /보안 키/,
      nl: /beveiligingssleutel/i,
      no: /sikkerhetsnøk(?:kel|ler)/i,
      pt: /chaves? de segurança/i,
      ru: /ключ(?:и|а)? безопасности/i,
      sv: /säkerhetsnyck(?:el|lar)/i,
      "zh-CN": /安全密钥/,
      "zh-TW": /安全金鑰/,
    },
  },
  {
    name: "authenticator app",
    keys: [
      "Authenticator apps",
      "authenticator app",
      "My authenticator app",
      "No authenticator apps added yet.",
      "Enter the 6-digit code from your authenticator app.",
    ],
    words: {
      da: /godkendelsesapp/i,
      fr: /applications? d'authentification/i,
      hi: /ऑथेंटिकेटर ऐप/,
      it: /app di autenticazione/i,
      ko: /인증 앱/,
      nl: /authenticator-app/i,
      no: /autentiseringsapp/i,
      pt: /apps? autenticador/i,
      ru: /приложени[еяи]-аутентификатор/i,
      sv: /autentiseringsapp/i,
      "zh-CN": /身份验证器应用/,
      "zh-TW": /驗證器應用程式/,
    },
  },
  {
    name: "backup code",
    keys: [
      "Backup codes",
      "Your backup codes",
      "Generate backup codes",
      "Regenerate backup codes?",
      "Backup codes copied to clipboard.",
      "Two Factor Backup Codes",
    ],
    words: {
      da: /backupkode/i,
      fr: /codes? de secours/i,
      hi: /बैकअप कोड/,
      it: /codici di backup/i,
      ko: /백업 코드/,
      nl: /back-upcode/i,
      no: /reservekode/i,
      pt: /códigos de backup/i,
      ru: /резервн(?:ые|ых) код/i,
      sv: /reservkod/i,
      "zh-CN": /备用代码/,
      "zh-TW": /備用代碼/,
    },
  },
];

describe("User Profile > Security's words in every Dashboard language", () => {
  test("the scan reads the words #8796 found English", () => {
    const keys: Set<string> = new Set<string>(
      SECURITY_KEYS.map((entry: SecurityKey): string => {
        return entry.key;
      }),
    );

    for (const key of [
      // The cards' titles and their empty states.
      "Authenticator apps",
      "Security keys",
      "Backup codes",
      "No authenticator apps added yet.",
      "No security keys added yet.",
      "No passkeys added yet.",
      // The forms and dialogs.
      "App name",
      "My authenticator app",
      "Security key name",
      "Passkey name",
      "Verify and finish",
      "Your backup codes",
      "Regenerate backup codes?",
      "I have saved these codes somewhere safe.",
      // The status of a set of codes.
      "Ready to use",
      "Running low",
      "No codes left",
      // The menu, and the words sentences build on.
      "Passkeys",
      "authenticator app",
      "security key",
      "passkey",
      // The records, by their tables' names.
      "TOTP Authentication for users",
      "WebAuthn credentials for users (security keys)",
    ]) {
      expect([key, keys.has(key)]).toEqual([key, true]);
    }

    expect(
      SECURITY_KEYS.filter((entry: SecurityKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      const progress: LocaleProgress | undefined = readLocaleProgress(language);
      const sameAsEnglish: Set<string> = new Set<string>(
        progress ? progress.sameAsEnglish : [],
      );
      const locale: Record<string, unknown> = readLocale(language);

      expect(
        SECURITY_KEYS.filter((entry: SecurityKey): boolean => {
          return !isWorded({ key: entry.key, locale, sameAsEnglish });
        }).map((entry: SecurityKey): string => {
          return `${entry.key} (${path.basename(entry.file)})`;
        }),
      ).toEqual([]);
    },
  );

  test.each(
    THINGS.flatMap((thing: Thing): Array<[string, string, Thing]> => {
      return Object.keys(thing.words).map(
        (language: string): [string, string, Thing] => {
          return [language, thing.name, thing];
        },
      );
    }),
  )(
    "%s names a %s one way",
    (language: string, _name: string, thing: Thing) => {
      const locale: Record<string, unknown> = readLocale(language);
      const word: RegExp = thing.words[language]!;

      expect(
        thing.keys
          .filter((key: string): boolean => {
            return !word.test(String(locale[key] || ""));
          })
          .map((key: string): string => {
            return `${key} => ${String(locale[key])}`;
          }),
      ).toEqual([]);
    },
  );

  test("the sign-in page names a passkey with the Dashboard's word", () => {
    const passkey: Thing = THINGS[0]!;

    for (const language of Object.keys(passkey.words)) {
      const accounts: string = fs.readFileSync(
        path.join(
          LOCALES_DIRECTORY,
          "..",
          "..",
          "..",
          "Accounts",
          "src",
          "Locales",
          `${language}.json`,
        ),
        "utf8",
      );

      expect([language, passkey.words[language]!.test(accounts)]).toEqual([
        language,
        true,
      ]);
    }
  });
});
