import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A project attached to a global SSO or OIDC provider starts on its members
 * team in the Admin Dashboard (the Attached Projects form is one page, the
 * project and then its teams). The Global SSO guide says so in its
 * auto-provisioning bullet, in every docs language, and the permissions
 * guide says the Admin Dashboard's ways of adding someone to a project start
 * on the same team as Invite User.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

// The sentence, and the one it comes before (still there), per language.
const ATTACHED_PROJECT_SENTENCES: Record<string, [string, string]> = {
  en: [
    "A project you attach starts on its members team; pick other teams if newcomers should start with different access.",
    "Add one project + teams at a time",
  ],
  de: [
    "Ein zugewiesenes Projekt beginnt mit seinem Mitglieder-Team; wählen Sie andere Teams, wenn neue Benutzer mit anderem Zugriff starten sollen.",
    "Fügen Sie jeweils ein Projekt + Teams hinzu",
  ],
  fr: [
    "Un projet que vous attachez commence avec son équipe des membres ; choisissez d'autres équipes si les nouveaux venus doivent commencer avec un autre accès.",
    "Ajoutez un projet + des équipes à la fois",
  ],
  es: [
    "Un proyecto que adjuntas empieza con su equipo de miembros; elige otros equipos si los recién llegados deben empezar con otro acceso.",
    "Agrega un proyecto + equipos a la vez",
  ],
  it: [
    "Un progetto che colleghi parte dal suo team dei membri; scegli altri team se i nuovi arrivati devono partire con un accesso diverso.",
    "Aggiungi un progetto + team alla volta",
  ],
  pt: [
    "Um projeto que você anexa começa com a equipe de membros dele; escolha outras equipes se os recém-chegados devem começar com outro acesso.",
    "Adicione um projeto + equipes por vez",
  ],
  nl: [
    "Een gekoppeld project begint met zijn ledenteam; kies andere teams als nieuwkomers met andere toegang moeten beginnen.",
    "Voeg één project + teams tegelijk toe",
  ],
  da: [
    "Et projekt, du tilknytter, starter med sit medlemsteam; vælg andre teams, hvis nye brugere skal starte med en anden adgang.",
    "Tilføj ét projekt + teams ad gangen",
  ],
  no: [
    "Et prosjekt du knytter til, starter med medlemsteamet sitt; velg andre team hvis nye brukere skal starte med annen tilgang.",
    "Legg til ett prosjekt + team om gangen",
  ],
  sv: [
    "Ett projekt som du ansluter börjar med sitt medlemsteam; välj andra team om nya användare ska börja med annan åtkomst.",
    "Lägg till ett projekt + team i taget",
  ],
  ru: [
    "Привязанный проект начинается с команды участников; выберите другие команды, если новые пользователи должны начинать с другим доступом.",
    "Добавляйте по одному проекту с командами за раз",
  ],
  ja: [
    "接続したプロジェクトでは、最初からそのプロジェクトのメンバーチームが選択されています。新しいユーザーに別のアクセス権を与えるには、ほかのチームを選んでください。",
    "リストを作成するには、一度に 1 つのプロジェクトとチームを追加します。",
  ],
  ko: [
    "연결한 프로젝트는 처음에 해당 프로젝트의 멤버 팀이 선택되어 있습니다. 새 사용자에게 다른 접근 권한을 주려면 다른 팀을 고르세요.",
    "목록을 구성하려면 한 번에 하나의 프로젝트 + 팀을 추가하십시오.",
  ],
  "zh-CN": [
    "附加的项目默认选中其成员团队；如果新用户应从不同的访问权限开始，请选择其他团队。",
    "一次添加一个项目及其团队来构建列表",
  ],
  "zh-TW": [
    "附加的專案預設選取其成員團隊；如果新使用者應以不同的存取權限開始，請選擇其他團隊。",
    "一次新增一個專案及團隊以建立清單",
  ],
  hi: [
    "आप जो project attach करते हैं, वह शुरुआत में उसकी members team पर रहता है; अगर नए उपयोगकर्ताओं को अलग access से शुरू करना है तो दूसरी teams चुनें।",
    "list बनाने के लिए एक बार में एक project + teams जोड़ें",
  ],
  fa: [
    "پروژه‌ای که وصل می‌کنید از ابتدا با تیم اعضای آن انتخاب شده است؛ اگر کاربران تازه‌وارد باید با دسترسی دیگری شروع کنند، تیم‌های دیگری انتخاب کنید.",
    "برای ساختن فهرست، هر بار یک پروژه + تیم اضافه کنید",
  ],
};

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

describe("Global SSO guide: an attached project starts on its members team", () => {
  it("is checked in every docs language", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return (
          entry.isDirectory() &&
          fs.existsSync(path.join(CONTENT_DIR, entry.name, "identity"))
        );
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      })
      .sort();

    expect(languages).toEqual(Object.keys(ATTACHED_PROJECT_SENTENCES).sort());
  });

  it.each(Object.entries(ATTACHED_PROJECT_SENTENCES))(
    "in %s: in the auto-provisioning bullet, before how the list is built",
    (language: string, [sentence, next]: [string, string]) => {
      const lines: Array<string> = readPage(language, "identity/global-sso")
        .split("\n")
        .filter((line: string): boolean => {
          return line.includes(sentence);
        });

      // Once, on the bullet that attaches projects (it says how to build the list).
      expect({ language, lines: lines.length }).toEqual({ language, lines: 1 });
      expect(lines[0]!.startsWith("- **")).toBe(true);
      expect(lines[0]!.indexOf(sentence)).toBeLessThan(lines[0]!.indexOf(next));
    },
  );
});

describe("Permissions guide", () => {
  it("in English: the Admin Dashboard starts on the same team as Invite User", () => {
    const page: string = readPage("en", "permissions/index");
    const bullet: string =
      page.split("\n").find((line: string): boolean => {
        return line.startsWith(
          "- **Invite User** starts on the project's members team",
        );
      }) || "";

    expect(bullet).toContain(
      "The Admin Dashboard starts on the same team wherever an instance administrator adds someone to a project: **Invite User** on a project, **Add to Project** on a user and on several users at once, and the projects attached to a [global SSO provider](/docs/identity/global-sso).",
    );
  });
});
