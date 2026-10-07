import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Someone who leaves a project stops getting its notifications: their own
 * notification methods, rules and settings for it go with their last team,
 * and whatever still names them notifies them no more, marked "No longer a
 * member" in the Dashboard. The permissions guide says so in its Users
 * section, in every docs language, right before the SSO bullet - and uses
 * the Dashboard's own words for the marker in that language.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

// How the bullet starts, per language.
const BULLET_STARTS: Record<string, string> = {
  en: "- Someone who leaves a project stops getting its notifications.",
  de: "- Wer ein Projekt verlässt, erhält keine Benachrichtigungen mehr daraus.",
  fr: "- Une personne qui quitte un projet ne reçoit plus ses notifications.",
  es: "- Quien deja un proyecto deja de recibir sus notificaciones.",
  it: "- Chi lascia un progetto smette di riceverne le notifiche.",
  pt: "- Quem sai de um projeto deixa de receber as notificações dele.",
  nl: "- Wie een project verlaat, krijgt er geen meldingen meer van.",
  da: "- Den, der forlader et projekt, får ikke længere dets notifikationer.",
  no: "- Den som forlater et prosjekt, får ikke lenger varslene fra det.",
  sv: "- Den som lämnar ett projekt får inte längre dess aviseringar.",
  ru: "- Тот, кто покидает проект, перестаёт получать его уведомления.",
  ja: "- プロジェクトを離れた人には、そのプロジェクトの通知が届かなくなります。",
  ko: "- 프로젝트를 떠난 사람은 더 이상 그 프로젝트의 알림을 받지 않습니다.",
  "zh-CN": "- 离开项目的人不会再收到该项目的通知。",
  "zh-TW": "- 離開專案的人不會再收到該專案的通知。",
  hi: "- प्रोजेक्ट छोड़ने वाले व्यक्ति को उस प्रोजेक्ट की सूचनाएँ मिलना बंद हो जाती हैं।",
  fa: "- کسی که پروژه‌ای را ترک می‌کند، دیگر اعلان‌های آن را دریافت نمی‌کند.",
};

function readGuide(language: string): Array<string> {
  return fs
    .readFileSync(
      path.join(CONTENT_DIR, language, "permissions", "index.md"),
      "utf8",
    )
    .split("\n");
}

function dashboardWords(language: string): string {
  const translations: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  const words: string | undefined = translations["No longer a member"];

  if (!words) {
    throw new Error(`The Dashboard has no "No longer a member" in ${language}`);
  }

  return words;
}

describe("the permissions guide says what leaving a project does to notifications", () => {
  it("covers every docs language", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return (
          entry.isDirectory() &&
          fs.existsSync(
            path.join(CONTENT_DIR, entry.name, "permissions", "index.md"),
          )
        );
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      })
      .sort();

    expect(languages).toEqual(Object.keys(BULLET_STARTS).sort());
  });

  for (const [language, start] of Object.entries(BULLET_STARTS)) {
    it(`${language}: once, in the Users section right before the SSO bullet, with the Dashboard's words`, () => {
      const lines: Array<string> = readGuide(language);
      const bullets: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith(start) ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect(bullets).toHaveLength(1);

      const bullet: string = lines[bullets[0]!]!;
      const next: string = lines[bullets[0]! + 1] || "";

      expect(next.startsWith("- ")).toBe(true);
      expect(next).toContain("(/docs/identity/sso)");
      expect(bullet).toContain(`**${dashboardWords(language)}**`);
      expect(bullet).toContain("WhatsApp");
      expect(bullet).toContain("Microsoft Teams");
    });
  }

  it("English no longer says that roles and ownership stay until reassigned", () => {
    const guide: string = readGuide("en").join("\n");

    expect(guide).not.toContain("stay assigned until you reassign them");
    expect(guide).toContain(
      "resolved incidents keep the record of who owned and ran them",
    );
  });
});
