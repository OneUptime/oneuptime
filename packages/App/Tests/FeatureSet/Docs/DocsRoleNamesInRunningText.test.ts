import {
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import {
  BUILT_IN_ROLE_NAMES,
  GENERAL_WORDS_NOT_THE_ROLES,
  KEPT_IN_ENGLISH,
  KeptEnglish,
  LANGUAGES_WITH_ROLE_NAME_GRAMMAR,
  NOT_A_ROLE_IN_ENGLISH,
  englishPageRoleCounts,
  englishRoleCounts,
  generalRoleWords,
  englishRoleNamesIn,
  isBuiltInRoleName,
  namesRoleAsDrawn,
  productLevelTitles,
  proseText,
  roleText,
  rolesLeftInEnglish,
  rolesNamedAsDrawn,
  runningText,
  timesRoleNamedAsDrawn,
  writtenPermissionTitle,
} from "./DocsRoleNames";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * BUILT-IN ROLES IN RUNNING TEXT, ON EVERY PAGE (#7514, #8315).
 *
 * The Dashboard draws a built-in role's name in the reader's language (the
 * role picker, the Built-in Roles card, the permission tables and the "You
 * need one of these roles" refusals all look it up), so a translated page
 * names a role as its Dashboard draws it (DocsRoleNames). The suites that
 * hold a page to the Dashboard read its bold spans, and the translations
 * wrote roles in English in their sentences and table cells: "Project
 * Owners and Project Admins" on the German dashboards page, where the
 * German Dashboard says Projektinhaber and Projektadministrator, about
 * 8,200 times on 92 pages in all sixteen translations.
 *
 * These hold every translated page's running text - outside code and
 * bold, a permission's own title kept in English - to the drawn names, in
 * both directions: no role left in English, and every role the English
 * page names in its running text named as drawn, as often as the English
 * page names it, inflected as the sentence needs
 * ("Projektadministratoren", "Propriétaires du projet", "у Владельца
 * проекта", "프로젝트 구성원과"). A paraphrase - "Projektadmins",
 * "プロジェクトのオーナー" - is a name short.
 */

// "page: role -> drawn name", as a failure lists it.
function finding(language: string, page: string, role: string): string {
  return `${page}: ${role} -> ${writtenPermissionTitle(language, role)}`;
}

const REPO_PACKAGES: string = path.resolve(__dirname, "../../../..");

describe("the role checks", () => {
  it("would find a role left in English, plural or not, and nothing in code or bold", () => {
    expect(
      rolesLeftInEnglish("de", "Nur Project Owners und Project Admins."),
    ).toEqual(["Project Owner", "Project Admin"]);
    expect(
      rolesLeftInEnglish("fa", "فقط Project Owner و ‏Project Adminها"),
    ).toEqual(["Project Owner", "Project Admin"]);
    // The longest name first: "Incident Viewer" is not also a "Viewer".
    expect(rolesLeftInEnglish("de", "ergänzen Sie Incident Viewer")).toEqual([
      "Incident Viewer",
    ]);
    // A compound that ends with a role's name is another thing's.
    expect(rolesLeftInEnglish("de", "Im Trace-Viewer hat der Span")).toEqual(
      [],
    );
    expect(rolesLeftInEnglish("de", "Jeder mit der Viewer-Rolle")).toEqual([
      "Viewer",
    ]);
    expect(rolesLeftInEnglish("de", "Rolle On-Call Admin")).toEqual([
      "On-Call Admin",
    ]);
    expect(
      rolesLeftInEnglish(
        "de",
        "**Project Owner**, `Project Admin`, **On Create Incident Member**",
      ),
    ).toEqual([]);
    expect(
      rolesLeftInEnglish("de", "```\nProject Owner\n```\nProjektinhaber"),
    ).toEqual([]);
    // English names its roles in English.
    expect(rolesLeftInEnglish("en", "Only Project Owners can.")).toEqual([]);
    // A permission's own title is not a role's name.
    expect(rolesLeftInEnglish("de", "Read Incident, Edit Project")).toEqual([]);
  });

  it("would find a role left in English next to CJK text, and before a particle", () => {
    expect(
      rolesLeftInEnglish("ja", "ワークフローの手順はProject Adminとして"),
    ).toEqual(["Project Admin"]);
    expect(rolesLeftInEnglish("ko", "Project Member와 Viewer는")).toEqual([
      "Project Member",
      "Viewer",
    ]);
    expect(rolesLeftInEnglish("zh-CN", "需要 Security Admin 角色")).toEqual([
      "Security Admin",
    ]);
  });

  it("would read past the English a page keeps, and nowhere else", () => {
    // Google Cloud's role and the Windows window are not the Viewer role.
    expect(
      rolesLeftInEnglish("de", "Ein Dienstkonto mit Monitoring Viewer anlegen"),
    ).toEqual([]);
    expect(
      rolesLeftInEnglish("ja", "*Event Viewer → Windows Logs → Application*"),
    ).toEqual([]);
    // The run log's sentence, quoted as the server writes it.
    expect(
      rolesLeftInEnglish(
        "fr",
        '*"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*',
      ),
    ).toEqual([]);
    // The role itself, next to them, is still read.
    expect(
      rolesLeftInEnglish("de", "Monitoring Viewer, aber auch ein Viewer"),
    ).toEqual(["Viewer"]);
    expect(roleText("Monitoring Viewer und Event Viewer")).not.toContain(
      "Viewer",
    );
    expect(roleText("**Projektinhaber** und `Viewer`")).not.toContain(
      "Projektinhaber",
    );
  });

  it("would accept a role named as drawn, inflected for the sentence, and refuse another word", () => {
    expect(
      namesRoleAsDrawn("de", "Nur Projektadministratoren", "Project Admin"),
    ).toBe(true);
    expect(
      namesRoleAsDrawn("de", "jedes Projektmitglied", "Project Member"),
    ).toBe(true);
    expect(
      namesRoleAsDrawn("fr", "les Propriétaires du projet", "Project Owner"),
    ).toBe(true);
    expect(
      namesRoleAsDrawn(
        "it",
        "dell'Amministratore del progetto",
        "Project Admin",
      ),
    ).toBe(true);
    expect(namesRoleAsDrawn("ru", "у Владельца проекта", "Project Owner")).toBe(
      true,
    );
    expect(
      namesRoleAsDrawn("ja", "プロジェクト所有者と", "Project Owner"),
    ).toBe(true);
    expect(namesRoleAsDrawn("ja", "Runbook 管理者だけ", "Runbook Admin")).toBe(
      true,
    );
    expect(namesRoleAsDrawn("ko", "프로젝트 구성원과", "Project Member")).toBe(
      true,
    );
    expect(namesRoleAsDrawn("fr", "les propriétaires", "Project Owner")).toBe(
      false,
    );
    expect(namesRoleAsDrawn("de", "Project Owner", "Project Owner")).toBe(
      false,
    );
  });

  it("counts a role's names, in English and as drawn, so a paraphrase is a name short", () => {
    expect([
      ...englishRoleCounts(
        "Project Owners and Project Admins; a Project Owner or an Incident Viewer",
      ),
    ]).toEqual([
      ["Project Owner", 2],
      ["Project Admin", 1],
      ["Incident Viewer", 1],
    ]);
    expect(
      timesRoleNamedAsDrawn(
        "de",
        "Projektinhaber und Projektadministratoren; ein Projektinhaber",
        "Project Owner",
      ),
    ).toBe(2);
    expect(
      timesRoleNamedAsDrawn(
        "de",
        "Projekteigentümer und Projektadmins",
        "Project Admin",
      ),
    ).toBe(0);
    expect(
      timesRoleNamedAsDrawn(
        "ja",
        "プロジェクト所有者またはプロジェクト管理者",
        "Project Admin",
      ),
    ).toBe(1);
    expect(
      timesRoleNamedAsDrawn(
        "ja",
        "プロジェクトのオーナーまたは管理者",
        "Project Owner",
      ),
    ).toBe(0);
    expect(
      timesRoleNamedAsDrawn(
        "ko",
        "프로젝트 소유자와 프로젝트 관리자가, 프로젝트 관리자는",
        "Project Admin",
      ),
    ).toBe(2);
  });

  it("keeps each piece of English for a reason, and finds it where it says", () => {
    for (const kept of KEPT_IN_ENGLISH) {
      expect(kept.why.length).toBeGreaterThan(20);
      // It has a role's name in it, or it would need no keeping.
      expect(englishRoleNamesIn(kept.text).length).toBeGreaterThan(0);
      // The English docs still say it.
      expect(
        listPages("en").some((page: string): boolean => {
          return runningText(readPage("en", page)).includes(kept.text);
        }),
      ).toBe(true);
    }

    const logError: string = fs.readFileSync(
      path.join(
        REPO_PACKAGES,
        "Common/Server/Types/Workflow/Components/BaseModel/LogComponentError.ts",
      ),
      "utf8",
    );
    const quoted: KeptEnglish | undefined = KEPT_IN_ENGLISH.find(
      (kept: KeptEnglish): boolean => {
        return kept.text.startsWith("Workflow steps");
      },
    );

    // The run log's reason is the server's own sentence.
    expect(quoted).toBeDefined();
    expect(logError).toContain(quoted!.text);
  });

  it("reads past an English word for something else, on the English page only", () => {
    for (const other of NOT_A_ROLE_IN_ENGLISH) {
      expect(other.why.length).toBeGreaterThan(20);
      expect(englishRoleNamesIn(other.text)).toEqual(["Viewer"]);
      expect(englishRoleNamesIn(roleText(other.text))).toEqual([]);
      expect(
        listPages("en").some((page: string): boolean => {
          return runningText(readPage("en", page)).includes(other.text);
        }),
      ).toBe(true);

      // A translation words it as prose, in its own language.
      for (const language of TRANSLATED_LANGUAGES) {
        expect(
          listPages(language).filter((page: string): boolean => {
            return readPage(language, page).includes(other.text);
          }),
        ).toEqual([]);
      }
    }

    // The Power BI page names no role in its running text.
    expect(
      englishRoleNamesIn(
        roleText(readPage("en", "data-observability/lineage-and-pipelines")),
      ),
    ).toEqual([]);
  });

  it("finds roles to check in the English running text", () => {
    const named: Set<string> = new Set(
      listPages("en").flatMap((page: string): Array<string> => {
        return englishRoleNamesIn(roleText(readPage("en", page)));
      }),
    );

    for (const role of [
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Viewer",
      "Incident Admin",
      "Incident Member",
      "Incident Viewer",
      "Alert Admin",
      "Alert Member",
      "Alert Viewer",
      "Monitor Admin",
      "Monitor Member",
      "Security Admin",
      "Security Member",
      "Security Viewer",
      "Telemetry Admin",
      "Telemetry Member",
      "Telemetry Viewer",
      "Settings Admin",
      "Settings Member",
      "Settings Viewer",
      "Status Page Admin",
      "Status Page Member",
      "Status Page Viewer",
      "Billing Admin",
      "Runbook Admin",
      "Runbook Member",
      "Runbook Viewer",
      "Workflow Admin",
    ]) {
      expect(isBuiltInRoleName(role)).toBe(true);
      expect(named).toContain(role);
    }
  });

  it("holds every translation, on every page", () => {
    expect(TRANSLATED_LANGUAGES).toHaveLength(16);

    for (const language of TRANSLATED_LANGUAGES) {
      expect(listPages(language).length).toBeGreaterThan(90);

      // Every role has a name of its own in every translation.
      for (const role of BUILT_IN_ROLE_NAMES) {
        expect(writtenPermissionTitle(language, role)).not.toBe(role);
      }
    }
  });

  it("would fail a translated page that puts a role back in English", () => {
    const page: string = "telemetry/security-cases";
    const translated: string = readPage("ko", page);

    expect(rolesLeftInEnglish("ko", translated)).toEqual([]);
    // One table row, as it was before #8315.
    expect(translated).toContain("| 보안 관리자 |");
    expect(
      rolesLeftInEnglish(
        "ko",
        translated.replace("| 보안 관리자 |", "| Security Admin |"),
      ),
    ).toEqual(["Security Admin"]);
  });
});

/*
 * A ROLE'S DRAWN NAME COUNTS ONLY AS A WORD OF ITS OWN, OR AN INFLECTION OF
 * IT (#11396).
 *
 * The drawn-name pattern was each word's first letters and then any letters
 * at all, so the Norwegian heading "### Les dekningen" ("Read the
 * coverage") counted as the Viewer, Leser (#11366), and so did Lese,
 * Lesinger and Leseoperasjoner. Each language's real inflections, from its
 * docs and its Dashboard's messages, are read as the role here; the words
 * that only start like a role's name, a longer role's name, and a
 * paraphrase are not.
 */
const LOCALE_FILE: RegExp = /^[a-z]{2}(-[A-Z]{2})?\.json$/;

const DASHBOARD_LOCALE_LANGUAGES: Array<string> = fs
  .readdirSync(path.join(REPO_PACKAGES, "App/FeatureSet/Dashboard/src/Locales"))
  .filter((name: string): boolean => {
    return LOCALE_FILE.test(name);
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  });

// [language, role, text, how often the text names the role as drawn]
const DRAWN_NAME_CASES: ReadonlyArray<[string, string, string, number]> = [
  // English, as the English pages and messages name the roles.
  ["en", "Project Owner", "Only Project Owners can.", 1],
  ["en", "Project Admin", "a Project Admin's key", 1],
  ["en", "Viewer", "the Incident Viewer", 0],
  ["en", "Incident Viewer", "the Incident Viewer", 1],
  // German: one word, its endings appended.
  ["de", "Project Admin", "Nur Projektadministratoren", 1],
  ["de", "Project Owner", "den Projektinhabern", 1],
  ["de", "Project Member", "alle Projektmitglieder", 1],
  ["de", "Project Member", "den Projektmitgliedern", 1],
  ["de", "Security Admin", "des Sicherheits-Administrators", 1],
  ["de", "Viewer", "eines Betrachters", 1],
  ["de", "Viewer", "den Betrachtern", 1],
  ["de", "Viewer", "die Betrachter-Rolle", 1],
  ["de", "Viewer", "Sicherheits-Betrachter", 0],
  ["de", "Security Viewer", "Sicherheits-Betrachter", 1],
  ["de", "Viewer", "Cloud-Betrachter", 0],
  ["de", "Viewer", "Betrachten Sie das", 0],
  ["de", "Viewer", "Betrachtet man es", 0],
  ["de", "Project Owner", "Projektinhaberrechte", 0],
  ["de", "Project Owner", "Projekteigentümer", 0],
  // Dutch: eigenaar → eigenaren, lid → leden.
  ["nl", "Project Owner", "de Projecteigenaren", 1],
  ["nl", "Project Owner", "Projecteigenaars", 1],
  ["nl", "Project Member", "alle Projectleden", 1],
  ["nl", "Security Member", "Beveiligingsleden", 1],
  ["nl", "Viewer", "Kijkers", 1],
  ["nl", "Viewer", "Kijk naar het dashboard", 0],
  ["nl", "Viewer", "Kijkt", 0],
  ["nl", "Project Member", "Projectlimieten", 0],
  ["nl", "Monitor Member", "Monitorlogs", 0],
  // Danish.
  ["da", "Project Owner", "Projektejere", 1],
  ["da", "Project Owner", "Projektejerne", 1],
  ["da", "Project Member", "Projektmedlemmer", 1],
  ["da", "Project Admin", "Projektadministratorerne", 1],
  ["da", "Security Admin", "Sikkerhedsadministrators", 1],
  ["da", "Viewer", "Seere", 1],
  ["da", "Viewer", "See", 0],
  ["da", "Viewer", "Seed", 0],
  // Norwegian, and the heading that passed for the Viewer (#11366).
  ["no", "Viewer", "Leser", 1],
  ["no", "Viewer", "Lesere", 1],
  ["no", "Viewer", "Leserne", 1],
  ["no", "Project Admin", "Prosjektadministratorene", 1],
  ["no", "Project Owner", "Prosjekteiere", 1],
  ["no", "Project Member", "Prosjektmedlemmer", 1],
  ["no", "Viewer", "### Les dekningen", 0],
  ["no", "Viewer", "Lesefremdrift", 0],
  ["no", "Viewer", "Lese alt i prosjektet", 0],
  ["no", "Viewer", "Lesinger", 0],
  ["no", "Viewer", "Leseoperasjoner", 0],
  ["no", "Viewer", "Skyleser", 0],
  ["no", "Viewer", "Hendelsesleser", 0],
  ["no", "Incident Viewer", "Hendelsesleser", 1],
  // Swedish: ägare → ägarna, medlem → medlemmar.
  ["sv", "Project Owner", "Projektägarna", 1],
  ["sv", "Project Admin", "Projektadministratörer", 1],
  ["sv", "Project Admin", "Projektadministratörerna", 1],
  ["sv", "Project Member", "Projektmedlemmar", 1],
  ["sv", "Security Admin", "Säkerhetsadministratörs", 1],
  ["sv", "Viewer", "Tittaren", 1],
  ["sv", "Viewer", "Titta på", 0],
  ["sv", "Viewer", "Tittar", 0],
  // French: the head's plural, an elided article before it.
  ["fr", "Project Owner", "les Propriétaires du projet", 1],
  ["fr", "Project Admin", "l'Administrateur du projet", 1],
  ["fr", "Project Admin", "d’Administrateurs du projet", 1],
  ["fr", "Viewer", "les Lecteurs", 1],
  ["fr", "Viewer", "Lecteur des incidents", 0],
  ["fr", "Incident Viewer", "Lecteur des incidents", 1],
  ["fr", "Project Member", "Members", 0],
  ["fr", "Project Owner", "les propriétaires", 0],
  ["fr", "Project Owner", "Propriétaire du projets", 0],
  // Spanish.
  ["es", "Project Owner", "los Propietarios del proyecto", 1],
  ["es", "Project Admin", "Administradores del proyecto", 1],
  ["es", "Project Admin", "la Administradora del proyecto", 1],
  ["es", "Viewer", "los Visores", 1],
  ["es", "Viewer", "Visión general", 0],
  ["es", "Viewer", "Vista", 0],
  ["es", "Viewer", "Visitor", 0],
  ["es", "Viewer", "Visor de incidentes", 0],
  // Italian: -o and -e to -i, -io to -i.
  ["it", "Project Owner", "i Proprietari del progetto", 1],
  ["it", "Project Admin", "dell'Amministratore del progetto", 1],
  ["it", "Project Admin", "gli Amministratori del progetto", 1],
  ["it", "Project Member", "i Membri del progetto", 1],
  ["it", "Viewer", "i Visualizzatori", 1],
  ["it", "Project Member", "Members", 0],
  ["it", "Viewer", "Visualizzatore degli incidenti", 0],
  // Portuguese.
  ["pt", "Project Owner", "os Proprietários do projeto", 1],
  ["pt", "Project Admin", "Administradores do projeto", 1],
  ["pt", "Viewer", "Visualizadores", 1],
  ["pt", "Project Member", "Member", 0],
  // Russian: the head's cases, its fleeting vowel.
  ["ru", "Project Owner", "у Владельца проекта", 1],
  ["ru", "Project Owner", "Владельцы проекта", 1],
  ["ru", "Project Owner", "Владельцам проекта", 1],
  ["ru", "Project Owner", "Владельцами проекта", 1],
  ["ru", "Project Admin", "Администраторы проекта", 1],
  ["ru", "Project Admin", "Администратору проекта", 1],
  ["ru", "Project Member", "Участником проекта", 1],
  ["ru", "Viewer", "Зрители", 1],
  ["ru", "Project Admin", "Административные проекта", 0],
  ["ru", "Project Owner", "Владельцы проектов", 0],
  ["ru", "Project Owner", "владельцы проекта", 0],
  ["ru", "Viewer", "Зритель инцидентов", 0],
  // Hindi: the last word's oblique plural.
  ["hi", "Project Owner", "प्रोजेक्ट स्वामियों", 1],
  ["hi", "Project Member", "प्रोजेक्ट सदस्यों", 1],
  ["hi", "Project Admin", "प्रोजेक्ट एडमिनों", 1],
  ["hi", "Viewer", "दर्शकों", 1],
  ["hi", "Viewer", "दर्ज", 0],
  ["hi", "Viewer", "संदर्भ", 0],
  ["hi", "Viewer", "दर्शाता", 0],
  ["hi", "Viewer", "व्यूअर", 0],
  ["hi", "Viewer", "घटना दर्शक", 0],
  ["hi", "Project Owner", "प्रोजेक्ट स्वास्थ्य", 0],
  ["hi", "Project Member", "प्रोजेक्ट सदस्यता", 0],
  ["hi", "Project Admin", "प्रोजेक्ट एडमिनिस्ट्रेटर", 0],
  // Persian: the head's plural and ezafe, the phrase's "a", "of", "its".
  ["fa", "Project Owner", "مالکان پروژه", 1],
  ["fa", "Project Owner", "مالکِ پروژه", 1],
  ["fa", "Project Owner", "مالکان پروژهٔ شما", 1],
  ["fa", "Security Admin", "هیچ مدیر امنیتی", 1],
  ["fa", "Project Admin", "هیچ مدیر پروژه‌ای", 1],
  ["fa", "Viewer", "بینندگان", 1],
  ["fa", "Viewer", "بیننده‌ای", 1],
  ["fa", "Project Owner", "مالی پروژه", 0],
  ["fa", "Project Owner", "مال پروژه است", 0],
  ["fa", "Project Owner", "مالکیت پروژه", 0],
  ["fa", "Project Owner", "بی‌مالک پروژه", 0],
  ["fa", "Project Admin", "مدیر پروژه‌ها", 0],
  ["fa", "Project Owner", "مالکان و مدیران پروژه", 0],
  // Arabic, which writes "and", "to" and "by" onto the noun.
  ["ar", "Project Owner", "لمالك المشروع", 1],
  ["ar", "Project Owner", "مالكو المشروع", 1],
  ["ar", "Project Admin", "ومسؤولو المشروع", 1],
  ["ar", "Project Admin", "مسؤولي المشروع", 1],
  ["ar", "Project Member", "أعضاء المشروع", 1],
  ["ar", "Project Member", "لأعضاء المشروع", 1],
  ["ar", "Viewer", "إشعارات", 0],
  ["ar", "Viewer", "لإشعارات", 0],
  ["ar", "Project Owner", "المالكون", 0],
  // Korean: the last word's particles, one or several.
  ["ko", "Project Admin", "프로젝트 관리자가", 1],
  ["ko", "Project Admin", "프로젝트 관리자에게만", 1],
  ["ko", "Project Member", "프로젝트 구성원과", 1],
  ["ko", "Viewer", "뷰어는", 1],
  ["ko", "Project Owner", "프로젝트의 소유자", 0],
  ["ko", "Monitor Admin", "모니터링 관리자", 0],
  ["ko", "Project Admin", "프로그램 관리자", 0],
  ["ko", "Viewer", "인시던트 뷰어", 0],
  ["ko", "Incident Viewer", "인시던트 뷰어", 1],
  // Japanese and Chinese: as drawn, wherever it is.
  ["ja", "Project Owner", "プロジェクト所有者と", 1],
  ["ja", "Runbook Admin", "Runbook 管理者だけ", 1],
  ["ja", "Incident Viewer", "インシデント閲覧者", 1],
  ["ja", "Viewer", "インシデント閲覧者", 0],
  ["ja", "Project Owner", "プロジェクト所属", 0],
  ["ja", "Project Owner", "プロジェクトのオーナー", 0],
  ["zh-CN", "Incident Viewer", "事件查看者", 1],
  ["zh-CN", "Viewer", "事件查看者", 0],
  ["zh-CN", "Viewer", "只有查看者可以", 1],
  ["zh-CN", "Project Owner", "项目所有者和项目管理员", 1],
  ["zh-TW", "Project Owner", "專案擁有者", 1],
  ["zh-TW", "Viewer", "事件檢視者", 0],
];

describe("a role's drawn name counts only as a word of its own, or an inflection of it", () => {
  it.each(DRAWN_NAME_CASES)(
    "%s: %s, in %j, %i times",
    (language: string, role: string, text: string, times: number) => {
      expect(timesRoleNamedAsDrawn(language, text, role)).toBe(times);
      expect(namesRoleAsDrawn(language, text, role)).toBe(times > 0);
    },
  );

  it("covers every language the docs and the Dashboard ship, and its real inflections", () => {
    const languages: Set<string> = new Set(
      DRAWN_NAME_CASES.map(
        ([language]: [string, string, string, number]): string => {
          return language;
        },
      ),
    );

    expect(DASHBOARD_LOCALE_LANGUAGES.length).toBeGreaterThan(16);
    for (const language of [
      ...TRANSLATED_LANGUAGES,
      ...DASHBOARD_LOCALE_LANGUAGES,
    ]) {
      expect(LANGUAGES_WITH_ROLE_NAME_GRAMMAR).toContain(language);
      expect(languages).toContain(language);
    }
    // Each language has a word the old pattern read as a role, and is not.
    for (const language of languages) {
      expect(
        DRAWN_NAME_CASES.some(
          ([caseLanguage, , , times]: [string, string, string, number]) => {
            return caseLanguage === language && times === 0;
          },
        ),
      ).toBe(true);
    }
  });

  it("refuses a language it knows no grammar for, rather than read it some way", () => {
    expect(() => {
      return timesRoleNamedAsDrawn("tr", "Proje Sahibi", "Project Owner");
    }).toThrow(/knows no grammar for "tr"/);
  });

  it("reads each role's drawn name as that role, in every language", () => {
    const misread: Array<string> = [];

    for (const language of LANGUAGES_WITH_ROLE_NAME_GRAMMAR) {
      for (const role of BUILT_IN_ROLE_NAMES) {
        const drawn: string = writtenPermissionTitle(language, role);
        const read: Array<string> = rolesNamedAsDrawn(language, `(${drawn}).`);

        if (read.length !== 1 || read[0] !== role) {
          misread.push(`${language}: ${drawn} -> ${read.join(", ")}`);
        }
      }
    }

    expect(misread).toEqual([]);
  });

  it("reads a name inside a longer role's name as the longer role, as English does", () => {
    expect(
      rolesNamedAsDrawn("fr", "Lecteur des incidents, puis Lecteur."),
    ).toEqual(["Incident Viewer", "Viewer"]);
    expect(
      rolesNamedAsDrawn("de", "Sicherheits-Betrachter und Betrachter"),
    ).toEqual(["Security Viewer", "Viewer"]);
    expect(rolesNamedAsDrawn("ja", "インシデント閲覧者と閲覧者")).toEqual([
      "Incident Viewer",
      "Viewer",
    ]);
    expect(englishRoleNamesIn("Incident Viewer and Viewer")).toEqual([
      "Incident Viewer",
      "Viewer",
    ]);
  });

  it("would fail each page it caught, worded as it was", () => {
    // [language, page, the page's words now, its words before #11396, role]
    const caught: ReadonlyArray<[string, string, string, string, string]> = [
      ["no", "permissions/index", "| Leser |", "| Viser |", "Viewer"],
      [
        "ru",
        "api-reference/api-reference",
        "; Владельцы проекта получают письмо",
        "; владельцы проекта получают письмо",
        "Project Owner",
      ],
      [
        "ko",
        "forms/on-submit",
        "인시던트 생성됨** 알림은 그들이 소유자가 될 때까지 기다리므로, 프로젝트 소유자가 아니라",
        "인시던트 생성됨** 알림은 그들이 소유자가 될 때까지 기다리므로, 프로젝트의 소유자가 아니라",
        "Project Owner",
      ],
      [
        "hi",
        "data-security/integrations",
        "और दर्शक पढ़",
        "और व्यूअर पढ़",
        "Viewer",
      ],
      [
        "fa",
        "permissions/index",
        "توسط مالکان پروژه و مدیران پروژه",
        "توسط مالکان و مدیران پروژه",
        "Project Owner",
      ],
    ];

    for (const [language, page, now, before, role] of caught) {
      const translated: string = readPage(language, page);
      const english: number =
        englishPageRoleCounts(readPage("en", page)).get(role) || 0;

      expect([page, translated.includes(now)]).toEqual([page, true]);
      expect([
        page,
        timesRoleNamedAsDrawn(language, roleText(translated), role) >= english,
      ]).toEqual([page, true]);
      expect([
        page,
        timesRoleNamedAsDrawn(
          language,
          roleText(translated.split(now).join(before)),
          role,
        ) < english,
      ]).toEqual([page, true]);
    }
  });

  it("reads a product's level as no built-in role", () => {
    expect(productLevelTitles()).toContain("Cloud Viewer");
    expect(productLevelTitles()).toContain("Host Member");
    for (const title of productLevelTitles()) {
      expect(isBuiltInRoleName(title)).toBe(false);
    }
    // The English pattern alone reads the Viewer into the Cloud's level.
    expect([...englishRoleCounts("A Cloud Viewer can read them.")]).toEqual([
      ["Viewer", 1],
    ]);
    expect([...englishPageRoleCounts("A Cloud Viewer can read them.")]).toEqual(
      [],
    );
    expect([
      ...englishPageRoleCounts("A Cloud Viewer, or a Viewer, can read them."),
    ]).toEqual([["Viewer", 1]]);
    // The page that named it: German's Cloud-Betrachter is no Viewer either.
    expect(readPage("en", "telemetry/cloud-costs")).toContain(
      "A Cloud Viewer can read them.",
    );
    expect(
      englishPageRoleCounts(readPage("en", "telemetry/cloud-costs")).get(
        "Viewer",
      ),
    ).toBeUndefined();
  });
});

describe.each(TRANSLATED_LANGUAGES)(
  "%s names the built-in roles as its Dashboard draws them",
  (language: string) => {
    it("writes no built-in role in English in its running text", () => {
      const left: Array<string> = listPages(language).flatMap(
        (page: string): Array<string> => {
          return rolesLeftInEnglish(language, readPage(language, page)).map(
            (role: string): string => {
              return finding(language, page, role);
            },
          );
        },
      );

      expect(left).toEqual([]);
    });

    it("names every role the English running text names, as drawn, as often", () => {
      const missing: Array<string> = listPages(language)
        .filter((page: string): boolean => {
          return hasPage("en", page);
        })
        .flatMap((page: string): Array<string> => {
          const text: string = roleText(readPage(language, page));

          return [...englishPageRoleCounts(readPage("en", page))]
            .filter(([role, times]: [string, number]): boolean => {
              return timesRoleNamedAsDrawn(language, text, role) < times;
            })
            .map(([role, times]: [string, number]): string => {
              return `${finding(language, page, role)}: ${timesRoleNamedAsDrawn(language, text, role)} of ${times}`;
            });
        });

      expect(missing).toEqual([]);
    });
  },
);

/*
 * THE ENGLISH PAGES NAME THE ROLES THEY MEAN (#8493, #8595).
 *
 * The checks above hold each translation to the roles its English page
 * names. A role the English words in general terms - "the project's owners
 * are emailed", "**A project owner or admin.**" - is one no translation
 * names either, so these hold the English pages, bold leads included, to
 * the roles' own names (DocsRoleNames.generalRoleWords).
 */
describe("the English pages name the built-in roles they mean", () => {
  it("would find a role in general words, and not a role named", () => {
    expect(generalRoleWords("The project's owners are emailed.")).toEqual([
      "The project's owners",
    ]);
    expect(
      generalRoleWords("- **A project owner or admin.** Only they can."),
    ).toEqual(["project owner", "owner or admin"]);
    expect(
      generalRoleWords("and by your project's admins and owners."),
    ).toEqual(["your project's admins", "admins and owners"]);
    expect(
      generalRoleWords("Ask a project admin, or an incident admin."),
    ).toEqual(["project admin", "incident admin"]);
    expect(generalRoleWords("Ask a Project Owner or Project Admin.")).toEqual(
      [],
    );
    expect(
      generalRoleWords(
        "Project Owners and Project Admins export a project's audit log.",
      ),
    ).toEqual([]);
    // The people in a project, not the Project Member role.
    expect(generalRoleWords("Search your project members by name.")).toEqual(
      [],
    );
    // Code is read as it is.
    expect(generalRoleWords("Set `project owners and admins` here.")).toEqual(
      [],
    );
    // Slack's own owners and admins, and the incident owner rules.
    expect(
      generalRoleWords(
        "a workspace can let only its owners and admins change them, for example through the project's owner rules",
      ),
    ).toEqual([]);
    // The bot's reply names the roles now, and reads as a role named.
    expect(
      generalRoleWords(
        '"this incident is private, so only its owners, Project Owners and Project Admins can see it."',
      ),
    ).toEqual([]);
  });

  it("lists only words the English pages use, each with its reason", () => {
    for (const kept of GENERAL_WORDS_NOT_THE_ROLES) {
      expect([kept.text, kept.why.length > 10]).toEqual([kept.text, true]);
      expect([
        kept.text,
        listPages("en").some((page: string): boolean => {
          return proseText(readPage("en", page)).includes(kept.text);
        }),
      ]).toEqual([kept.text, true]);
    }
  });

  it("would fail a page that says the project's owners again", () => {
    const page: string = "on-call/readiness";
    const english: string = readPage("en", page);

    expect(generalRoleWords(english)).toEqual([]);
    expect(english).toContain("the Project Owners get one email");
    expect(
      generalRoleWords(
        english.replace(
          "the Project Owners get one email",
          "the project's owners get one email",
        ),
      ),
    ).toEqual(["the project's owners"]);
  });

  it("names them on every English page", () => {
    const found: Array<string> = listPages("en").flatMap(
      (page: string): Array<string> => {
        return generalRoleWords(readPage("en", page)).map(
          (words: string): string => {
            return `${page}: ${words}`;
          },
        );
      },
    );

    expect(listPages("en").length).toBeGreaterThan(90);
    expect(found).toEqual([]);
  });
});
