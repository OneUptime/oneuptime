import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";

/*
 * AN ARCHIVED OPENSTACK CLOUD'S CHECKS KEEP RUNNING, AND THE DOCS SAY SO (OneUptime issue #8449).
 *
 * Archiving a cloud hides it from the lists. Its collection never stopped (#8324), and its checks
 * stopped while the Archived page said it keeps collecting: the checks' claim read
 * `c."isArchived" = false`, so an archived cloud's API checks and lifecycle check - and the sweep
 * that clears up after a lifecycle run - waited until it was unarchived. They run now, and each
 * language's guide says so where it says how to stop the lifecycle check: under "Turning it off",
 * after the commands that find what a run left behind. Markdown is not compiled, so this reads the
 * pages and the claim's own source.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(PACKAGES, "App/FeatureSet/Docs/Content");

// The command the section ends with, the same in every language.
const CLEANUP_COMMAND: string =
  "openstack server list --name '^oneuptime-check-'";

// A heading that ends the section.
const SECTION_HEADING: RegExp = /^#{2,4} /;

// What each language's guide says, word for word.
const ARCHIVED_CHECKS: Record<string, string> = {
  en: "Archiving the cloud turns none of this off. An archived cloud is only hidden from the lists: it is still collected, and its API checks and lifecycle check keep running. Turn a check off to stop it.",
  da: "At arkivere clouden slår intet af dette fra. En arkiveret cloud er kun skjult i listerne: den indsamles stadig, og dens API-tjek og livscyklustjekket bliver ved med at køre. Slå et tjek fra for at stoppe det.",
  de: "Das Archivieren der Cloud schaltet nichts davon aus. Eine archivierte Cloud ist nur in den Listen ausgeblendet: Sie wird weiter erfasst, und ihre API-Prüfungen und die Lebenszyklusprüfung laufen weiter. Schalten Sie eine Prüfung aus, um sie anzuhalten.",
  es: "Archivar la nube no desactiva nada de esto. Una nube archivada solo se oculta de las listas: se sigue recopilando, y sus comprobaciones de API y la comprobación del ciclo de vida siguen ejecutándose. Desactiva una comprobación para detenerla.",
  fa: "بایگانی کردن ابر هیچ‌کدام از این‌ها را خاموش نمی‌کند. ابری که بایگانی شده است فقط از فهرست‌ها پنهان می‌شود: همچنان جمع‌آوری می‌شود، و بررسی‌های API و بررسی چرخه عمر آن همچنان اجرا می‌شوند. برای متوقف کردن یک بررسی، آن را خاموش کنید.",
  fr: "Archiver le cloud ne désactive rien de tout cela. Un cloud archivé est seulement masqué dans les listes : il est toujours collecté, et ses vérifications d'API et son contrôle du cycle de vie continuent de s'exécuter. Désactivez un contrôle pour l'arrêter.",
  hi: "क्लाउड को संग्रहीत करने से इनमें से कुछ भी बंद नहीं होता। संग्रहीत क्लाउड केवल सूचियों से छिपा होता है: वह इकट्ठा होता रहता है, और उसकी API जाँचें और लाइफ़साइकल जाँच चलती रहती हैं। किसी जाँच को रोकने के लिए उसे बंद करें।",
  it: "Archiviare il cloud non disattiva nulla di tutto questo. Un cloud archiviato è solo nascosto dagli elenchi: continua a essere raccolto, e i suoi controlli API e il controllo del ciclo di vita continuano a essere eseguiti. Disattiva un controllo per fermarlo.",
  ja: "クラウドをアーカイブしても、これらは何もオフになりません。アーカイブしたクラウドは一覧に表示されなくなるだけで、引き続き収集され、API チェックとライフサイクルチェックも実行され続けます。チェックを止めるには、そのチェックをオフにしてください。",
  ko: "클라우드를 보관해도 이 중 어느 것도 꺼지지 않습니다. 보관된 클라우드는 목록에서 숨겨질 뿐, 계속 수집되며 API 점검과 라이프사이클 점검도 계속 실행됩니다. 점검을 멈추려면 그 점검을 끄세요.",
  nl: "Het archiveren van de cloud zet hier niets van uit. Een gearchiveerde cloud is alleen verborgen in de lijsten: hij wordt nog steeds verzameld, en zijn API-controles en de levenscyclus-controle blijven draaien. Zet een controle uit om die te stoppen.",
  no: "Å arkivere skyen slår ingenting av dette av. En arkivert sky er bare skjult i listene: den samles fortsatt inn, og API-sjekkene og livssykluskontrollen fortsetter å kjøre. Slå av en kontroll for å stoppe den.",
  pt: "Arquivar a nuvem não desativa nada disso. Uma nuvem arquivada só fica oculta nas listas: ela continua sendo coletada, e as verificações de API e a verificação de ciclo de vida dela continuam em execução. Desative uma verificação para pará-la.",
  ru: "Архивирование облака ничего из этого не отключает. Архивированное облако только скрыто из списков: оно по-прежнему собирается, а его проверки API и проверка жизненного цикла продолжают выполняться. Чтобы остановить проверку, отключите её.",
  sv: "Att arkivera molnet stänger inte av något av detta. Ett arkiverat moln är bara dolt i listorna: det samlas fortfarande in, och dess API-kontroller och livscykelkontrollen fortsätter att köras. Slå av en kontroll för att stoppa den.",
  "zh-CN":
    "归档云不会关闭其中任何一项。已归档的云只是不在列表中显示：它仍会被收集，其 API 检查和生命周期检查也会继续运行。要停止某项检查，请将其关闭。",
  "zh-TW":
    "封存雲端不會關閉其中任何一項。已封存的雲端只是不會顯示在清單中：它仍會被收集，其 API 檢查和生命週期檢查也會繼續執行。要停止某項檢查，請將其關閉。",
};

function lines(language: string): Array<string> {
  return fs
    .readFileSync(
      path.join(CONTENT_DIR, language, "telemetry/openstack.md"),
      "utf8",
    )
    .split("\n");
}

// The section the cleanup commands end: from its heading to the next one.
function turningItOff(language: string): {
  heading: string;
  body: Array<string>;
  afterCommands: Array<string>;
} {
  const all: Array<string> = lines(language);
  const command: number = all.findIndex((line: string): boolean => {
    return line.includes(CLEANUP_COMMAND);
  });

  expect(command).toBeGreaterThan(0);

  let start: number = command;

  while (start > 0 && !all[start]!.startsWith("#### ")) {
    start--;
  }

  let end: number = command;

  while (end < all.length && !SECTION_HEADING.test(all[end]!)) {
    end++;
  }

  const fence: number = all.indexOf("```", command);

  return {
    heading: all[start]!,
    body: all.slice(start + 1, end),
    afterCommands: all.slice(fence + 1, end).filter((line: string) => {
      return line.trim().length > 0;
    }),
  };
}

// The claim's rule for a check, as its source writes it.
function claimableSqlSource(): string {
  const source: string = fs.readFileSync(
    path.join(PACKAGES, "Common/Server/Utils/OpenStack/OpenStackCheckStore.ts"),
    "utf8",
  );
  const start: number = source.indexOf("public static getClaimableSql(");

  expect(start).toBeGreaterThan(0);

  return source.substring(start, source.indexOf("\n  }\n", start));
}

describe("an archived OpenStack cloud's checks, in the guide", () => {
  it("every language the docs are written in has its words here", () => {
    expect(Object.keys(ARCHIVED_CHECKS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  it.each(Object.keys(ARCHIVED_CHECKS))(
    "%s: the section that says how to turn the lifecycle check off ends by saying archiving turns nothing off",
    (language: string) => {
      const section: ReturnType<typeof turningItOff> = turningItOff(language);

      // The one sentence after the commands, and only once on the page.
      expect(section.afterCommands).toEqual([ARCHIVED_CHECKS[language]]);
      expect(
        lines(language).filter((line: string): boolean => {
          return line === ARCHIVED_CHECKS[language];
        }),
      ).toHaveLength(1);
    },
  );

  it.each(Object.keys(ARCHIVED_CHECKS))(
    "%s: it names the API checks as their section does",
    (language: string) => {
      const apiHeading: string | undefined = lines(language).find(
        (line: string): boolean => {
          return line.startsWith("### ") && line.includes("API");
        },
      );

      expect(apiHeading).toBeDefined();
      expect(ARCHIVED_CHECKS[language]).toContain("API");
    },
  );

  it("the English names the two checks by the headings of their sections", () => {
    const page: string = lines("en").join("\n");

    expect(page).toContain("### API checks");
    expect(page).toContain("### The lifecycle check");
    expect(ARCHIVED_CHECKS["en"]).toContain(
      "its API checks and lifecycle check",
    );
  });
});

describe("what the guide says is what the claim does", () => {
  it("the checks' claim never reads whether the cloud is archived", () => {
    const rule: string = claimableSqlSource();

    expect(rule).not.toContain("isArchived");
    // It still reads the cloud: a deleted one stops its checks.
    expect(rule).toContain('`c."deletedAt" IS NULL`');
    // The lifecycle rule covers the sweep after one turned off.
    expect(rule).toContain('ck."isSweepPending" = true');
  });

  it("no write brings an unarchived cloud's checks back, because none ever left", () => {
    const service: string = fs.readFileSync(
      path.join(PACKAGES, "Common/Server/Services/OpenStackCloudService.ts"),
      "utf8",
    );
    const store: string = fs.readFileSync(
      path.join(
        PACKAGES,
        "Common/Server/Utils/OpenStack/OpenStackCheckStore.ts",
      ),
      "utf8",
    );

    expect(service).not.toContain("isUnarchive");
    expect(service).not.toContain("OpenStackCheckStore.makeDueNow");
    expect(store).not.toMatch(/public static async makeDueNow\(/);
  });

  it("the Archived page still says what happens: hidden, and collecting", () => {
    const archivedPage: string = fs.readFileSync(
      path.join(
        PACKAGES,
        "App/FeatureSet/Dashboard/src/Pages/OpenStack/Archived.tsx",
      ),
      "utf8",
    );

    expect(archivedPage).toContain(
      "They are hidden from the main list but keep collecting telemetry.",
    );
  });
});
