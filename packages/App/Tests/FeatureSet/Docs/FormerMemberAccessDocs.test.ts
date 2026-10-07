import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What leaving a project ends, as the guides say it in every docs language:
 *
 *   - permissions: an override that routes pages to somebody who has left
 *     pages the person it covers; leaving disconnects the MCP clients the
 *     person connected and empties their personal calendar link; on
 *     OneUptime Cloud, coming back through the project's SSO is confirmed
 *     from the mailbox again,
 *   - MCP server: leaving the project disconnects the client,
 *   - SCIM: confirming the project's SSO makes someone a member; somebody
 *     who has left is invited again,
 *   - calendar feeds: a personal link shows shifts only while its owner is
 *     a member, and an empty calendar can mean you have left.
 *
 * Each statement appears once per language, where it belongs.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

interface Statements {
  leaving: string;
  mcpClient: string;
  scim: string;
  personalLink: string;
  emptyCalendar: string;
}

// The start of each statement, per language.
const STATEMENTS: Record<string, Statements> = {
  en: {
    leaving: "If an override routes someone's pages to a perso",
    mcpClient: "Leaving the project also disconnects the",
    scim: "Users SCIM creates itself and users who are members of your ",
    personalLink: "A personal link shows shifts only while ",
    emptyCalendar: "If you have left the project, the li",
  },
  de: {
    leaving: "Leitet eine Vertretung die Benachrichtigungen ei",
    mcpClient: "Wenn Sie das Projekt verlassen, wird der",
    scim: "Benutzer, die SCIM selbst erstellt, und Benutzer, die Mitgli",
    personalLink: "Ein persönlicher Link zeigt Schichten nu",
    emptyCalendar: "Wenn Sie das Projekt verlassen haben",
  },
  fr: {
    leaving: "Si un remplacement transfère les alertes de quel",
    mcpClient: "Quitter le projet déconnecte aussi le cl",
    scim: "Les utilisateurs que SCIM crée lui-même et les utilisateurs ",
    personalLink: "Un lien personnel n'affiche des gardes q",
    emptyCalendar: "Si vous avez quitté le projet, le li",
  },
  es: {
    leaving: "Si una sustitución envía los avisos de alguien a",
    mcpClient: "Dejar el proyecto también desconecta el ",
    scim: "Los usuarios que crea el propio SCIM y los usuarios que son ",
    personalLink: "Un enlace personal muestra turnos solo m",
    emptyCalendar: "Si dejaste el proyecto, el enlace si",
  },
  it: {
    leaving: "Se una sostituzione inoltra le chiamate di qualc",
    mcpClient: "Lasciare il progetto scollega anche il c",
    scim: "Gli utenti che SCIM crea direttamente e gli utenti che sono ",
    personalLink: "Un link personale mostra i turni solo fi",
    emptyCalendar: "Se hai lasciato il progetto, il link",
  },
  pt: {
    leaving: "Se uma substituição encaminha os chamados de alg",
    mcpClient: "Sair do projeto também desconecta o clie",
    scim: "Usuários que o próprio SCIM cria e usuários que são membros ",
    personalLink: "Um link pessoal mostra turnos apenas enq",
    emptyCalendar: "Se você saiu do projeto, o link cont",
  },
  nl: {
    leaving: "Als een override iemands meldingen doorstuurt na",
    mcpClient: "Als u het project verlaat, wordt de clie",
    scim: "Gebruikers die SCIM zelf aanmaakt en gebruikers die lid zijn",
    personalLink: "Een persoonlijke link toont alleen diens",
    emptyCalendar: "Als je het project hebt verlaten, bl",
  },
  da: {
    leaving: "Hvis en override sender nogens kald videre til e",
    mcpClient: "At forlade projektet afbryder også klien",
    scim: "Brugere, som SCIM selv opretter, og brugere, der er medlemme",
    personalLink: "Et personligt link viser kun vagter, så ",
    emptyCalendar: "Hvis du har forladt projektet, forbl",
  },
  no: {
    leaving: "Hvis en overstyring sender noens varsler videre ",
    mcpClient: "Å forlate prosjektet kobler også fra kli",
    scim: "Brukere som SCIM oppretter selv, og brukere som er medlemmer",
    personalLink: "En personlig lenke viser vakter bare så ",
    emptyCalendar: "Hvis du har forlatt prosjektet, forb",
  },
  sv: {
    leaving: "Om en åsidosättning skickar någons larm vidare t",
    mcpClient: "Att lämna projektet kopplar också bort k",
    scim: "Användare som SCIM själv skapar och användare som är medlemm",
    personalLink: "En personlig länk visar pass bara så län",
    emptyCalendar: "Om du har lämnat projektet förblir l",
  },
  ru: {
    leaving: "Если переопределение направляет чьи-то вызовы че",
    mcpClient: "Уход из проекта также отключает клиента:",
    scim: "Пользователи, которых создаёт сам SCIM, и участники вашего п",
    personalLink: "Личная ссылка показывает смены только по",
    emptyCalendar: "Если вы покинули проект, ссылка оста",
  },
  ja: {
    leaving:
      "オーバーライドが誰かの呼び出しをプロジェクトを離れた人に回している場合は、代わりにそのオーバーラ",
    mcpClient:
      "プロジェクトを離れるとクライアントも切断されます。クライアントの認可は削除され、",
    scim: "SCIM 自身が作成したユーザーと、プロジェクトのメンバーであるユーザーは、どちらの環境でもすぐに追加されます。プロジェ",
    personalLink:
      "個人用リンクは、所有者がプロジェクトのメンバーである間だけシフトを表示します。こ",
    emptyCalendar:
      "プロジェクトを離れた場合、リンクは空のままです。リンクは、あなたがメンバ",
  },
  ko: {
    leaving:
      "재정의가 누군가의 호출을 프로젝트를 떠난 사람에게 돌리면, 대신 그 재정의가 맡고 있는",
    mcpClient:
      "프로젝트를 떠나면 클라이언트 연결도 끊깁니다. 클라이언트의 승인이 삭제되",
    scim: "SCIM이 직접 생성한 사용자와 프로젝트 멤버인 사용자는 어느 환경에서든 즉시 추가됩니다. 프로젝트의 SSO",
    personalLink:
      "개인 링크는 소유자가 프로젝트 멤버인 동안에만 교대 근무를 보여 줍니다.",
    emptyCalendar:
      "프로젝트를 떠났다면 링크는 계속 비어 있습니다. 링크는 프로젝트 ",
  },
  "zh-CN": {
    leaving:
      "如果某个覆盖把某人的呼叫转给了已离开项目的人，则改为呼叫该覆盖所替代的人。离开项目还会断开此人连",
    mcpClient:
      "离开项目也会断开客户端：其授权会被删除，如果您重新加入项目，需要重新连接它。",
    scim: "由 SCIM 自己创建的用户以及您项目的成员，在两种环境下都会被立即添加。确认您项目的 SSO 会使某人成为成员，因此此",
    personalLink:
      "个人链接仅在其所有者是项目成员期间显示班次：每次获取链接时都会检查这一点，因此已",
    emptyCalendar:
      "如果你已离开该项目，链接会一直为空：它只在你是成员期间显示班次。",
  },
  "zh-TW": {
    leaving:
      "若某個覆寫把某人的呼叫轉給已離開專案的人，則改為呼叫該覆寫所代替的人。離開專案也會中斷此人連接到",
    mcpClient:
      "離開專案也會中斷用戶端：其授權會被刪除，若您重新加入專案，需要重新連接它。",
    scim: "由 SCIM 自行建立的使用者以及您專案的成員，在兩種環境下都會被立即加入。確認您專案的 SSO 會讓某人成為成員，因此",
    personalLink:
      "個人連結只在其擁有者是專案成員期間顯示班次：每次擷取連結時都會檢查這一點，因此已",
    emptyCalendar:
      "若你已離開該專案，連結會一直是空的：它只在你是成員期間顯示班次。",
  },
  hi: {
    leaving: "अगर कोई ओवरराइड किसी के पेज ऐसे व्यक्ति को भेजता",
    mcpClient: "Project छोड़ने पर client भी disconnect ह",
    scim: "जिन users को SCIM खुद बनाता है और जो users आपके project के m",
    personalLink: "निजी लिंक शिफ्टें तभी तक दिखाता है जब तक",
    emptyCalendar: "अगर आपने प्रोजेक्ट छोड़ दिया है, तो ",
  },
  fa: {
    leaving: "اگر یک بازنویسی، فراخوان‌های کسی را به فردی بفرس",
    mcpClient: "ترک پروژه همچنین کلاینت را قطع می‌کند: م",
    scim: "کاربرانی که خود SCIM می‌سازد و کاربرانی که عضو پروژه شما هست",
    personalLink: "پیوند شخصی فقط تا وقتی که صاحبش عضو پروژ",
    emptyCalendar: "اگر پروژه را ترک کرده‌اید، پیوند خال",
  },
};

function read(language: string, page: string): Array<string> {
  return fs
    .readFileSync(path.join(CONTENT_DIR, language, page), "utf8")
    .split("\n");
}

// The one line holding `text`; fails when it is missing or repeated.
function lineWith(lines: Array<string>, text: string): number {
  const found: Array<number> = lines
    .map((line: string, index: number): number => {
      return line.includes(text) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  expect({ text, found: found.length }).toEqual({ text, found: 1 });

  return found[0]!;
}

describe("the guides say what leaving a project ends", () => {
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

    expect(languages).toEqual(Object.keys(STATEMENTS).sort());
  });

  for (const [language, statements] of Object.entries(STATEMENTS)) {
    it(`${language}: permissions - on the leave bullet, beside the notification methods`, () => {
      const lines: Array<string> = read(language, "permissions/index.md");
      const line: string = lines[lineWith(lines, statements.leaving)]!;

      expect(line.startsWith("- ")).toBe(true);
      expect(line).toContain("WhatsApp");
      expect(line).toContain("MCP");
      expect(line).toContain("OneUptime Cloud");
    });

    it(`${language}: MCP server - on the bullet about the client's permissions`, () => {
      const lines: Array<string> = read(language, "ai/mcp-server.md");
      const line: string = lines[lineWith(lines, statements.mcpClient)]!;

      expect(line.startsWith("- **")).toBe(true);
    });

    it(`${language}: SCIM - right after the OneUptime Cloud answer about existing users`, () => {
      const lines: Array<string> = read(language, "identity/scim.md");
      let index: number = lineWith(lines, statements.scim) - 1;

      while (index > 0 && lines[index]!.trim() === "") {
        index--;
      }

      expect(lines[index]!.startsWith("- **OneUptime Cloud**")).toBe(true);
    });

    it(`${language}: calendar feeds - the leave paragraph and the empty calendar answer`, () => {
      const lines: Array<string> = read(language, "on-call/calendar-feeds.md");

      expect(lines[lineWith(lines, statements.personalLink)]).not.toMatch(/^#/);
      expect(lines[lineWith(lines, statements.emptyCalendar)]).toContain(
        "X-WR-CALDESC",
      );
    });
  }

  it("English no longer says a consent to the project's SSO alone adds somebody as a member", () => {
    const guide: string = read("en", "identity/scim.md").join("\n");

    expect(guide).not.toContain(
      "users who have confirmed your project's SSO are added straight away everywhere",
    );
  });
});
