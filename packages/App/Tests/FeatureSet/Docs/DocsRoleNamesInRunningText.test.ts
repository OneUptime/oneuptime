import {
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import {
  BUILT_IN_ROLE_NAMES,
  KEPT_IN_ENGLISH,
  KeptEnglish,
  NOT_A_ROLE_IN_ENGLISH,
  englishRoleCounts,
  englishRoleNamesIn,
  isBuiltInRoleName,
  namesRoleAsDrawn,
  roleText,
  rolesLeftInEnglish,
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

          return [...englishRoleCounts(roleText(readPage("en", page)))]
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
