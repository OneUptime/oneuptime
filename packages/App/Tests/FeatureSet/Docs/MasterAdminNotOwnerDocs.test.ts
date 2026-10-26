import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A MASTER ADMIN IS NOT MADE AN OWNER OF WHAT THEY CREATE.
 *
 * Whoever declares an incident or creates an alert becomes one of its
 * owners - except a master admin, who runs the whole installation
 * (DatabaseService.autoOwnerOnCreate returns before it adds one), and the
 * first person to sign up on a self-hosted install is one. The create forms
 * tell a master admin so (#5209); the docs said "you become an owner
 * whatever you pick" to everyone. Both pages that say it now name the
 * exception, in every language, in the word each language's docs use for a
 * master admin elsewhere.
 */

const APP_DIR: string = path.join(__dirname, "..", "..", "..");
const CONTENT_DIR: string = path.join(APP_DIR, "FeatureSet", "Docs", "Content");
const COMMON_DIR: string = path.join(APP_DIR, "..", "Common");

// The word each language's docs call a master admin, as installation does.
const MASTER_ADMIN: Record<string, string> = {
  en: "master admin",
  da: "master-admin",
  de: "Master-Admin",
  es: "administrador maestro",
  fa: "مدیر ارشد",
  fr: "administrateur principal",
  hi: "मास्टर एडमिन",
  it: "amministratore principale",
  ja: "マスター管理者",
  ko: "마스터 관리자",
  nl: "master-admin",
  no: "master-admin",
  pt: "administrador mestre",
  ru: "мастер-администратор",
  sv: "master admin",
  "zh-CN": "主管理员",
  "zh-TW": "主管理員",
};

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// The page's line that says the creator becomes an owner, by its place.
function lineOf(language: string, page: string, index: number): string {
  return read(language, page).split("\n")[index] || "";
}

describe("the code", () => {
  test("never makes a master admin the owner of what they create", () => {
    const source: string = fs.readFileSync(
      path.join(COMMON_DIR, "Server", "Services", "DatabaseService.ts"),
      "utf8",
    );
    const start: number = source.indexOf("private async autoOwnerOnCreate(");
    const body: string = source.slice(start, start + 1200);

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain(
      "if (props.isRoot || props.isMasterAdmin || !props.userId) {",
    );
  });
});

describe("the docs", () => {
  test("say so where they say the creator becomes an owner, in English", () => {
    const declaring: string = lineOf(
      "en",
      "incidents/declaring-incidents.md",
      128,
    );
    const alerts: string = lineOf("en", "alerts/index.md", 79);

    expect(declaring).toContain(
      "A master admin, who runs the whole installation, is not made an owner of what they create, so their summary lists only the owners they pick and the ones the rules add.",
    );
    expect(alerts).toContain("you become an owner of the alert you create");
    expect(alerts).toContain(
      "A master admin, who runs the whole installation, is the one exception: they are not made an owner of what they create.",
    );
  });

  test.each(Object.keys(MASTER_ADMIN))(
    "say so in %s too, in the word its installation docs use",
    (language: string) => {
      const word: string = MASTER_ADMIN[language]!.toLowerCase();

      // The same word the language's docs use for a master admin elsewhere.
      expect(
        read(language, "installation/local-development.md").toLowerCase(),
      ).toContain(word);

      expect(
        lineOf(language, "incidents/declaring-incidents.md", 128).toLowerCase(),
      ).toContain(word);
      expect(lineOf(language, "alerts/index.md", 79).toLowerCase()).toContain(
        word,
      );
    },
  );

  test("every language has both pages", () => {
    for (const language of Object.keys(MASTER_ADMIN)) {
      expect(
        fs.existsSync(
          path.join(CONTENT_DIR, language, "incidents/declaring-incidents.md"),
        ),
      ).toBe(true);
    }

    expect(
      fs
        .readdirSync(CONTENT_DIR, { withFileTypes: true })
        .filter((entry: fs.Dirent): boolean => {
          return entry.isDirectory();
        })
        .map((entry: fs.Dirent): string => {
          return entry.name;
        })
        .sort(),
    ).toEqual(Object.keys(MASTER_ADMIN).sort());
  });
});
