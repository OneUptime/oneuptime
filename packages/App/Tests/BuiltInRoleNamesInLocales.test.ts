import {
  BUILT_IN_ROLE_NAMES,
  KeptEnglish,
  englishRoleCounts,
  timesRoleNamedAsDrawn,
  writtenPermissionTitle,
} from "./FeatureSet/Docs/DocsRoleNames";
import {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * TRANSLATED MESSAGES NAME THE BUILT-IN ROLES AS THE ROLE PICKER DRAWS THEM
 * (#8546).
 *
 * A message's locale key is its English, and the English names a built-in
 * role as the role picker draws it: "Ask a Project Owner or Project Admin
 * for access." (#8520). Each language's role picker draws a role from a key
 * of its own (Components/Permission/RoleCardSelectOptions ROLE_NAMES), so
 * a translated message names the role in those words: German
 * "Projektinhaber", not "Projekteigentümer"; Japanese "プロジェクト所有者",
 * not "プロジェクトのオーナー"; Arabic "مالك المشروع أو مسؤول المشروع", not
 * "مالك المشروع أو مسؤوله" (its admin). It names it inflected as its
 * sentence needs ("Projektadministratoren", "Администратора проекта",
 * "프로젝트 구성원과": DocsRoleNames.timesRoleNamedAsDrawn), as often as the
 * English does, and never in English. The translated docs name the roles
 * the same way (#8315), so a message on screen and the page describing it
 * use one name for each role.
 *
 * A value that is still the English is an untranslated placeholder: it
 * reads as the English does until a translator words it, and then this
 * holds the translation.
 */

const PACKAGES: string = path.resolve(__dirname, "../..");

// Every frontend's locales, and the server's.
const LOCALE_DIRECTORIES: ReadonlyArray<string> = [
  "App/FeatureSet/Dashboard/src/Locales",
  "App/FeatureSet/AdminDashboard/src/Locales",
  "App/FeatureSet/StatusPage/src/Locales",
  "App/FeatureSet/Accounts/src/Locales",
  "App/FeatureSet/PublicDashboard/src/Locales",
  "Common/Server/Locales",
];

const LOCALE_FILE: RegExp = /^[a-z]{2}(-[A-Z]{2})?\.json$/;

/*
 * Keys whose role word names something else: the people on an incident
 * (the IncidentMember records, not the Incident Member role) and how many
 * people opened a BI dashboard.
 */
const NOT_A_ROLE_KEYS: ReadonlyArray<KeptEnglish> = [
  {
    text: "Incident Members",
    why: "the people on an incident: IncidentMember's plural name, a table's title",
  },
  {
    text: "Incident Member Added",
    why: "an incident feed event: someone was added to the incident",
  },
  {
    text: "Incident Member Removed",
    why: "an incident feed event: someone was taken off the incident",
  },
  {
    text: "Viewers",
    why: "a BI dashboard's column: how many people opened it",
  },
];

// Phrases in keys whose role word is not the role.
const NOT_A_ROLE_PHRASES: ReadonlyArray<KeptEnglish> = [
  { text: "Monitoring Viewer", why: "a Google Cloud IAM role" },
  { text: "Cloud Asset Viewer", why: "a Google Cloud IAM role" },
  { text: "Chronicle API Viewer", why: "a Google Cloud IAM role" },
  {
    text: "Logs Viewer",
    why: "a Google Cloud IAM role, and OneUptime's own logs viewer",
  },
  { text: "Open Viewer", why: "a button that opens the telemetry viewer" },
  { text: "in the Viewer", why: "the telemetry viewer" },
  {
    text: "Viewer IP",
    why: "the address of whoever watched a session replay",
  },
  {
    text: "Top Viewers",
    why: "the people who opened a BI dashboard most",
  },
  { text: "Viewers enter a value", why: "a dashboard's viewers" },
  { text: "Viewers can still click", why: "a dashboard's viewers" },
  {
    text: "Viewer's timezone",
    why: "a dashboard clock's option: the time zone of whoever views it",
  },
];

/*
 * A product's Viewer level (#10289) is a permission of its own, not the
 * Viewer role it follows: "Cloud Viewer" reads Cloud's records as Viewer
 * reads them. Each language names a level as one name, as its role picker
 * names the area roles ("Cloudseer" beside "Monitorseer" in Danish,
 * "Molntittare" beside "Monitortittare" in Swedish), so its "Viewer" is not
 * the Viewer role's. Read from the levels themselves, so a new product's
 * level is one too.
 */
const PRODUCT_LEVEL_PHRASES: ReadonlyArray<KeptEnglish> =
  PermissionHelper.getAllPermissionProps()
    .filter((props: PermissionProps): boolean => {
      return (
        props.group === PermissionGroup.ProductAccess &&
        props.title.endsWith(" Viewer")
      );
    })
    .map((props: PermissionProps): KeptEnglish => {
      return {
        text: props.title,
        why: "a product's Viewer level, a permission of its own (#10289), named as one name",
      };
    });

// The text whose role words are the built-in roles.
function roleWords(text: string): string {
  return [...NOT_A_ROLE_PHRASES, ...PRODUCT_LEVEL_PHRASES].reduce(
    (words: string, phrase: KeptEnglish): string => {
      return words.split(phrase.text).join(" ");
    },
    text,
  );
}

// How often a locale key names each built-in role, as the English does.
function rolesTheKeyNames(key: string): Map<string, number> {
  if (
    NOT_A_ROLE_KEYS.some((kept: KeptEnglish): boolean => {
      return kept.text === key;
    })
  ) {
    return new Map();
  }

  return englishRoleCounts(roleWords(key));
}

// Whether this language's role picker draws the role in words of its own.
function isDrawnInOwnWords(language: string, role: string): boolean {
  return writtenPermissionTitle(language, role) !== role;
}

/*
 * The roles a translated value does not name as this language's role
 * picker draws them, as often as its English key names them, and those it
 * leaves in English: each once, in the key's order, then the English ones.
 */
function rolesNotNamedAsDrawn(
  language: string,
  key: string,
  value: string,
): Array<string> {
  const short: Array<string> = [];

  for (const [role, times] of rolesTheKeyNames(key)) {
    if (
      isDrawnInOwnWords(language, role) &&
      timesRoleNamedAsDrawn(language, value, role) < times
    ) {
      short.push(role);
    }
  }

  for (const role of englishRoleCounts(roleWords(value)).keys()) {
    if (isDrawnInOwnWords(language, role) && !short.includes(role)) {
      short.push(role);
    }
  }

  return short;
}

interface LocaleFile {
  directory: string;
  language: string;
  entries: Record<string, unknown>;
}

function readLocale(directory: string, name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(PACKAGES, directory, name), "utf8"),
  ) as Record<string, unknown>;
}

function translatedLocales(directory: string): Array<LocaleFile> {
  return fs
    .readdirSync(path.join(PACKAGES, directory))
    .filter((name: string): boolean => {
      return LOCALE_FILE.test(name) && name !== "en.json";
    })
    .sort()
    .map((name: string): LocaleFile => {
      return {
        directory,
        language: name.replace(/\.json$/, ""),
        entries: readLocale(directory, name),
      };
    });
}

// The flat keys of a locale that name a built-in role, with their English.
function roleKeys(directory: string): Array<[string, string]> {
  const english: Record<string, unknown> = readLocale(directory, "en.json");

  return Object.entries(english)
    .filter((entry: [string, unknown]): boolean => {
      return (
        typeof entry[1] === "string" && rolesTheKeyNames(entry[0]).size > 0
      );
    })
    .map((entry: [string, unknown]): [string, string] => {
      return [entry[0], entry[1] as string];
    });
}

// A locale's values that do not name a role as drawn, as a failure lists them.
function findings(locale: LocaleFile): Array<string> {
  const found: Array<string> = [];

  for (const [key, english] of roleKeys(locale.directory)) {
    const value: unknown = locale.entries[key];

    // Not translated yet: the English placeholder reads as the English does.
    if (typeof value !== "string" || value === key || value === english) {
      continue;
    }

    const roles: Array<string> = rolesNotNamedAsDrawn(
      locale.language,
      key,
      value,
    );

    if (roles.length > 0) {
      found.push(
        `${key} => ${value} [${roles
          .map((role: string): string => {
            return `${role} -> ${writtenPermissionTitle(locale.language, role)}`;
          })
          .join(", ")}]`,
      );
    }
  }

  return found;
}

const DASHBOARD: string = "App/FeatureSet/Dashboard/src/Locales";

function dashboardValue(language: string, key: string): string {
  return readLocale(DASHBOARD, `${language}.json`)[key] as string;
}

describe("the check on a translated message", () => {
  it("finds a role a translation words its own way, or leaves out", () => {
    expect(
      rolesNotNamedAsDrawn(
        "de",
        "Ask a Project Owner or Project Admin for access.",
        "Bitten Sie einen Projekteigentümer oder Admin um Zugriff.",
      ),
    ).toEqual(["Project Owner", "Project Admin"]);
    expect(
      rolesNotNamedAsDrawn(
        "ja",
        "Only Project Owners and Project Admins can read them.",
        "読み取れるのはプロジェクトのオーナーと管理者だけです。",
      ),
    ).toEqual(["Project Owner", "Project Admin"]);
    expect(
      rolesNotNamedAsDrawn(
        "ar",
        "Ask a Project Owner or Project Admin.",
        "اطلب ذلك من مالك المشروع أو مسؤوله.",
      ),
    ).toEqual(["Project Admin"]);
  });

  it("finds a role named as drawn fewer times than the English names it", () => {
    expect(
      rolesNotNamedAsDrawn(
        "de",
        "Off: a Security Admin let this step run without approval. Only a Security Admin can change what it does.",
        "Aus: Ein Sicherheits-Administrator hat diesen Schritt ohne Genehmigung laufen lassen. Nur ein Administrator kann ändern, was er tut.",
      ),
    ).toEqual(["Security Admin"]);
  });

  it("finds a role left in English inside a translation", () => {
    expect(
      rolesNotNamedAsDrawn(
        "ja",
        "A Project Owner, a Billing Admin or someone with Manage Billing can change these.",
        "これらを変更できるのは、プロジェクト所有者または「Billing Admin」ロールまたは「請求の管理」権限を持つユーザーです。",
      ),
    ).toEqual(["Billing Admin"]);
    expect(
      rolesNotNamedAsDrawn(
        "ar",
        "A Project Owner, a Billing Admin or someone with Manage Billing can change these.",
        "يمكن لمالك المشروع أو مسؤول الفوترة (Billing Admin) أو من لديه صلاحية «Manage Billing» تغيير هذه.",
      ),
    ).toEqual(["Billing Admin"]);
  });

  it("takes a role inflected as its sentence needs", () => {
    expect(
      rolesNotNamedAsDrawn(
        "de",
        "Only Project Owners and Project Admins can read them.",
        "Nur Projektinhaber und Projektadministratoren können sie lesen.",
      ),
    ).toEqual([]);
    expect(
      rolesNotNamedAsDrawn(
        "ru",
        "Ask a Project Owner or Project Admin.",
        "Попросите Владельца проекта или Администратора проекта.",
      ),
    ).toEqual([]);
    expect(
      rolesNotNamedAsDrawn(
        "ko",
        "Project Members and Project Owners",
        "프로젝트 구성원과 프로젝트 소유자",
      ),
    ).toEqual([]);
    expect(
      rolesNotNamedAsDrawn(
        "ar",
        "Only Project Owners and Project Admins can read them.",
        "لا يمكن قراءتها إلا لمالكي المشروع ومسؤولي المشروع.",
      ),
    ).toEqual([]);
  });

  it("reads past a role word that names something else", () => {
    // Google Cloud's own role, which every language keeps as Google names it.
    expect(
      rolesNotNamedAsDrawn(
        "ja",
        "A service account with the Monitoring Viewer role.",
        "Monitoring Viewer ロールを持つサービス アカウント。",
      ),
    ).toEqual([]);
    // The people on an incident, not the Incident Member role.
    expect(
      rolesNotNamedAsDrawn("de", "Incident Members", "Vorfallsmitglieder"),
    ).toEqual([]);
    // A role named beside one: "Incident Viewer" is the role.
    expect(
      rolesNotNamedAsDrawn(
        "de",
        "Add the Incident Viewer role, then open the Logs Viewer.",
        "Fügen Sie die Rolle Incident Viewer hinzu und öffnen Sie den Protokoll-Viewer.",
      ),
    ).toEqual(["Incident Viewer"]);
  });

  it("lists only key words the locales use, each with its reason", () => {
    const keys: Array<string> = LOCALE_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return Object.keys(readLocale(directory, "en.json"));
      },
    );

    for (const kept of [...NOT_A_ROLE_KEYS, ...NOT_A_ROLE_PHRASES]) {
      expect([kept.text, kept.why.length > 10]).toEqual([kept.text, true]);
    }

    for (const kept of NOT_A_ROLE_KEYS) {
      expect([kept.text, keys.includes(kept.text)]).toEqual([kept.text, true]);
    }

    for (const kept of NOT_A_ROLE_PHRASES) {
      expect([
        kept.text,
        keys.some((key: string): boolean => {
          return key.includes(kept.text);
        }),
      ]).toEqual([kept.text, true]);
    }
  });

  it("would fail the Dashboard's own messages worded the old way", () => {
    const key: string =
      "A Project Owner or Project Admin can make these changes in Incidents → AI → Settings.";
    const value: string = dashboardValue("de", key);

    expect(rolesNotNamedAsDrawn("de", key, value)).toEqual([]);
    expect(
      rolesNotNamedAsDrawn(
        "de",
        key,
        value.replace("Projektinhaber", "Projekteigentümer"),
      ),
    ).toEqual(["Project Owner"]);
    expect(
      rolesNotNamedAsDrawn(
        "de",
        key,
        value.replace("Projektadministrator", "Admin"),
      ),
    ).toEqual(["Project Admin"]);
  });
});

describe("translated messages name the built-in roles as their role picker draws them", () => {
  it("reads the Dashboard's messages that name a role, in seventeen languages", () => {
    expect(roleKeys(DASHBOARD).length).toBeGreaterThan(160);
    expect(
      translatedLocales(DASHBOARD).map((locale: LocaleFile): string => {
        return locale.language;
      }),
    ).toHaveLength(17);

    // Each language draws every built-in role in words of its own.
    for (const locale of translatedLocales(DASHBOARD)) {
      for (const role of BUILT_IN_ROLE_NAMES) {
        expect([
          locale.language,
          role,
          isDrawnInOwnWords(locale.language, role),
        ]).toEqual([locale.language, role, true]);
      }
    }
  });

  describe.each(LOCALE_DIRECTORIES)("%s", (directory: string) => {
    it.each(
      translatedLocales(directory).map(
        (locale: LocaleFile): [string, LocaleFile] => {
          return [locale.language, locale];
        },
      ),
    )(
      "%s names each role as drawn, as often as the English",
      (_language: string, locale: LocaleFile) => {
        expect(findings(locale)).toEqual([]);
      },
    );
  });
});
