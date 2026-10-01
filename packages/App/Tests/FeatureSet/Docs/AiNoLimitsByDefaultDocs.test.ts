import {
  PACKAGES_ROOT,
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import AIWorkloadLimits, {
  MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES,
  MIN_AI_MAX_CONCURRENT_INVESTIGATIONS,
} from "Common/Types/AI/AIWorkloadLimits";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "Common/Types/Docs/DocsLanguage";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every limit on autonomous AI work is opt-in, and the AI settings left the
 * Incidents and Alerts side menus' own AI section: the settings page is
 * Settings → AI, and remediation is Rules → Auto Remediation Rules. These
 * tests hold the docs to that - the AI SRE page (English and Persian), every
 * language's incident overview and settings pages, and the 13 → 14 upgrade
 * note - and hold the docs' claims to the code that makes them true:
 * AIWorkloadLimits, the side menus and the AI settings pages.
 */

const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const DASHBOARD_SRC: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string = "### AI has no limits by default";
const PREVIOUS_NOTE_HEADING: string =
  "### New projects start with every AI feature on";
const NEXT_NOTE_HEADING: string = "### Verify the edition and the license";

// How long a queued investigation waits in a lane with a cap before it expires.
const QUEUE_EXPIRY_IN_MINUTES: number = 30;

// The side menu names, as each language's incident pages write them.
interface MenuLabels {
  ai: string;
  settings: string;
  rules: string;
  runbookRules: string;
  autoRemediationRules: string;
}

/*
 * The dashboard's own translations of the side menu titles. The Persian pages
 * keep every on-screen name in English, so their names are the English ones.
 */
const MENU_LABELS: Record<string, MenuLabels> = {
  en: {
    ai: "AI",
    settings: "Settings",
    rules: "Rules",
    runbookRules: "Runbook Rules",
    autoRemediationRules: "Auto Remediation Rules",
  },
  da: {
    ai: "AI",
    settings: "Indstillinger",
    rules: "Regler",
    runbookRules: "Runbook-regler",
    autoRemediationRules: "Regler for automatisk afhjælpning",
  },
  de: {
    ai: "KI",
    settings: "Einstellungen",
    rules: "Regeln",
    runbookRules: "Runbook-Regeln",
    autoRemediationRules: "Auto-Behebungsregeln",
  },
  es: {
    ai: "IA",
    settings: "Ajustes",
    rules: "Reglas",
    runbookRules: "Reglas de runbook",
    autoRemediationRules: "Reglas de autorremediación",
  },
  fa: {
    ai: "AI",
    settings: "Settings",
    rules: "Rules",
    runbookRules: "Runbook Rules",
    autoRemediationRules: "Auto Remediation Rules",
  },
  fr: {
    ai: "IA",
    settings: "Paramètres",
    rules: "Règles",
    runbookRules: "Règles de runbook",
    autoRemediationRules: "Règles d'auto-remédiation",
  },
  hi: {
    ai: "एआई",
    settings: "सेटिंग्स",
    rules: "नियम",
    runbookRules: "Runbook नियम",
    autoRemediationRules: "स्वचालित सुधार नियम",
  },
  it: {
    ai: "IA",
    settings: "Impostazioni",
    rules: "Regole",
    runbookRules: "Regole di runbook",
    autoRemediationRules: "Regole di rimedio automatico",
  },
  ja: {
    ai: "AI",
    settings: "設定",
    rules: "ルール",
    runbookRules: "Runbook ルール",
    autoRemediationRules: "自動修復ルール",
  },
  ko: {
    ai: "AI",
    settings: "설정",
    rules: "규칙",
    runbookRules: "Runbook 규칙",
    autoRemediationRules: "자동 해결 규칙",
  },
  nl: {
    ai: "AI",
    settings: "Instellingen",
    rules: "Regels",
    runbookRules: "Runbook-regels",
    autoRemediationRules: "Regels voor automatisch herstel",
  },
  no: {
    ai: "KI",
    settings: "Innstillinger",
    rules: "Regler",
    runbookRules: "Runbook-regler",
    autoRemediationRules: "Regler for automatisk utbedring",
  },
  pt: {
    ai: "IA",
    settings: "Configurações",
    rules: "Regras",
    runbookRules: "Regras de runbook",
    autoRemediationRules: "Regras de remediação automática",
  },
  ru: {
    ai: "ИИ",
    settings: "Настройки",
    rules: "Правила",
    runbookRules: "Правила runbook-ов",
    autoRemediationRules: "Правила автоисправления",
  },
  sv: {
    ai: "AI",
    settings: "Inställningar",
    rules: "Regler",
    runbookRules: "Runbook-regler",
    autoRemediationRules: "Regler för automatisk åtgärd",
  },
  "zh-CN": {
    ai: "人工智能",
    settings: "设置",
    rules: "规则",
    runbookRules: "Runbook 规则",
    autoRemediationRules: "自动补救规则",
  },
  "zh-TW": {
    ai: "人工智慧",
    settings: "設定",
    rules: "規則",
    runbookRules: "Runbook 規則",
    autoRemediationRules: "自動補救規則",
  },
};

// The languages whose pages write on-screen names in English.
const PERSIAN: string = "fa";
const ENGLISH_UI_NAME_LANGUAGES: ReadonlyArray<string> = ["en", PERSIAN];

/*
 * The removed side menu section, however a page spells the path: "Incidents >
 * AI > Investigation", "(Incidents or Alerts → AI → Remediation)" and the
 * bare "(Incidents > AI)" all named it.
 */
const REMOVED_MENU_PATTERNS: ReadonlyArray<RegExp> = [
  /\bAI\s*(?:>|→)\s*Investigation\b/,
  /\bAI\s*(?:>|→)\s*Remediation\b/,
  /\b(?:Incidents|Alerts)\s*(?:>|→)\s*AI\b/,
];

// The AI SRE page, in the two languages it is written in.
interface AiSrePage {
  file: string;
  costControlsHeading: string;
  where: string;
  // Where the page says auto-remediation rules are.
  remediation: string;
  // The defaults the page used to state, none of which hold any more.
  oldDefaults: ReadonlyArray<string>;
  // Each cost control's row: its name, and what the row must say.
  rows: ReadonlyArray<{ name: string; says: ReadonlyArray<string> }>;
}

const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

type PersianNumberFunction = (value: number) => string;

const persian: PersianNumberFunction = (value: number): string => {
  return String(value).replace(/\d/g, (digit: string): string => {
    return PERSIAN_DIGITS[Number(digit)] as string;
  });
};

const AI_SRE_PAGES: Record<string, AiSrePage> = {
  en: {
    file: path.join(CONTENT_DIR, "en/ai/ai-sre.md"),
    costControlsHeading: "## Cost controls",
    where: "Incidents or Alerts > Settings > AI",
    remediation:
      "**Incidents > Rules > Auto Remediation Rules** and **Alerts > Rules > Auto Remediation Rules**",
    oldDefaults: [
      "top two severity tiers",
      "Default **30 minutes**",
      "Default **3**",
      "(1–25)",
      "Default **25**",
      "built-in limit of 25",
    ],
    rows: [
      {
        name: "Severity floor",
        says: ["Unset (the default) means **every severity**."],
      },
      {
        name: "Re-investigation cooldown",
        says: [
          "Unset (the default) or 0 means **no cooldown**: every incident and alert is investigated.",
          `At most ${MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES} minutes (a day).`,
        ],
      },
      {
        name: "Concurrency cap",
        says: [
          "Unset (the default) means **no limit**: every investigation starts right away.",
          `A cap you set is at least ${MIN_AI_MAX_CONCURRENT_INVESTIGATIONS}, with no maximum; only then do queued investigations wait for a free slot, and they expire after ${QUEUE_EXPIRY_IN_MINUTES} minutes.`,
        ],
      },
      {
        name: "Investigation time limit",
        says: ["Unset (the default) means **no time limit**"],
      },
      {
        name: "Daily token limit",
        says: ["Unset (the default) means **no limit**; set **0** to pause"],
      },
      {
        name: "Daily fix-task limit",
        says: [
          "Unset (the default) means **no limit**; set 0 to pause that lane's fix tasks.",
        ],
      },
    ],
  },
  fa: {
    file: path.join(CONTENT_DIR, "fa/ai/ai-sre.md"),
    costControlsHeading: "## کنترل‌های هزینه",
    where: "Incidents یا Alerts > Settings > AI",
    remediation:
      "**Incidents > Rules > Auto Remediation Rules** و **Alerts > Rules > Auto Remediation Rules**",
    oldDefaults: [
      "دو رده شدت بالای",
      "پیش‌فرض **۳۰ دقیقه**",
      "پیش‌فرض **۳**",
      "۱ تا ۲۵",
      "پیش‌فرض **۲۵**",
      "سقف داخلی ۲۵",
      // The per-run caps the page listed after they were gone.
      "۱۵۰ ثانیه",
    ],
    rows: [
      {
        name: "کف شدت",
        says: ["تنظیم‌نشده (پیش‌فرض) یعنی **هر شدتی**."],
      },
      {
        name: "دوره خنک شدن بررسی دوباره",
        says: [
          "تنظیم‌نشده (پیش‌فرض) یا ۰ یعنی **بدون دوره خنک شدن**: هر حادثه و هشداری بررسی می‌شود.",
          `حداکثر ${persian(MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES)} دقیقه (یک روز).`,
        ],
      },
      {
        name: "سقف هم‌زمانی",
        says: [
          "تنظیم‌نشده (پیش‌فرض) یعنی **بدون محدودیت**: هر بررسی‌ای بی‌درنگ آغاز می‌شود.",
          `سقفی که تنظیم کنید دست‌کم ${persian(MIN_AI_MAX_CONCURRENT_INVESTIGATIONS)} است و بیشینه‌ای ندارد؛ فقط آن‌گاه بررسی‌های در صف منتظر جایگاهی آزاد می‌مانند، و پس از ${persian(QUEUE_EXPIRY_IN_MINUTES)} دقیقه منقضی می‌شوند.`,
        ],
      },
      {
        name: "محدودیت زمانی بررسی",
        says: ["تنظیم‌نشده (پیش‌فرض) یعنی **بدون محدودیت زمانی**"],
      },
      {
        name: "محدودیت روزانه توکن",
        says: [
          "تنظیم‌نشده (پیش‌فرض) یعنی **بدون محدودیت**؛ برای مکث آن مسیر **۰** بگذارید.",
        ],
      },
      {
        name: "محدودیت روزانه وظیفه رفع",
        says: [
          "تنظیم‌نشده (پیش‌فرض) یعنی **بدون محدودیت**؛ برای مکث وظیفه‌های رفع آن مسیر ۰ بگذارید.",
        ],
      },
    ],
  },
};

// The upgrade note's table: each setting, what it was before, and now.
const UPGRADE_TABLE: ReadonlyArray<{
  setting: string;
  before: string;
  now: string;
}> = [
  {
    setting: "**Minimum Severity To Investigate** (alerts)",
    before: "The project's top two severity tiers",
    now: "Every severity",
  },
  {
    setting: "**Re-investigation Cooldown (Minutes)** (incidents and alerts)",
    before: "30 minutes",
    now: "No cooldown: every incident and alert is investigated",
  },
  {
    setting:
      "**Max Concurrent Incident Investigations**, **Max Concurrent Alert Investigations**",
    before: "3, and a value you set was held to 1–25",
    now: "No limit: every investigation starts right away",
  },
  {
    setting:
      "**Daily Incident AI Fix Task Limit**, **Daily Alert AI Fix Task Limit**",
    before: "25 per UTC day",
    now: "No limit",
  },
  {
    setting:
      "AI work outside incidents and alerts: insight triage, and fix tasks for exceptions, insights and performance",
    before: "3 runs at once, 25 fix tasks per UTC day",
    now: "No limit",
  },
  {
    setting:
      "**Max Open Fix Pull Requests** (a repository's **Settings** page)",
    before: "5",
    now: "No cap",
  },
];

/*
 * The settings the upgrade note names, each with the dashboard page that
 * shows it under that title.
 */
const NAMED_SETTINGS: ReadonlyArray<{ title: string; page: string }> = [
  {
    title: "Minimum Severity To Investigate",
    page: "Pages/Alerts/Settings/AlertAISettings.tsx",
  },
  {
    title: "Re-investigation Cooldown (Minutes)",
    page: "Pages/Incidents/Settings/IncidentAISettings.tsx",
  },
  {
    title: "Max Concurrent Incident Investigations",
    page: "Pages/Incidents/Settings/IncidentAISettings.tsx",
  },
  {
    title: "Max Concurrent Alert Investigations",
    page: "Pages/Alerts/Settings/AlertAISettings.tsx",
  },
  {
    title: "Daily Incident AI Fix Task Limit",
    page: "Pages/Incidents/Settings/IncidentAISettings.tsx",
  },
  {
    title: "Daily Alert AI Fix Task Limit",
    page: "Pages/Alerts/Settings/AlertAISettings.tsx",
  },
  {
    title: "Daily Incident AI Token Limit",
    page: "Pages/Incidents/Settings/IncidentAISettings.tsx",
  },
  {
    title: "Daily Alert AI Token Limit",
    page: "Pages/Alerts/Settings/AlertAISettings.tsx",
  },
  {
    title: "Max Open Fix Pull Requests",
    page: "Pages/CodeRepository/View/Settings.tsx",
  },
];

const SIDE_MENUS: ReadonlyArray<string> = [
  "Pages/Incidents/SideMenu.tsx",
  "Pages/Alerts/SideMenu.tsx",
];

type FlatFunction = (markdown: string) => string;

// Line breaks read as one space, so a claim may wrap anywhere.
const flat: FlatFunction = (markdown: string): string => {
  return markdown.replace(/\s*\n\s*/g, " ").trim();
};

type TableRowsFunction = (markdown: string) => Array<string>;

// The table rows of some markdown, header and divider included.
const tableRows: TableRowsFunction = (markdown: string): Array<string> => {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.trim().startsWith("|");
  });
};

type CellsFunction = (row: string) => Array<string>;

// The cells of a table row, trimmed, without the empty outer ones.
const cells: CellsFunction = (row: string): Array<string> => {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
};

// Every **bold** name in some text, in order.
const boldNames: CellsFunction = (text: string): Array<string> => {
  return Array.from(text.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

type PageFunction = (language: string, relative: string) => string;

const readPage: PageFunction = (language: string, relative: string): string => {
  return read(path.join(CONTENT_DIR, language, relative));
};

type MarkdownFilesFunction = (directory: string) => Array<string>;

// Every markdown page under a directory, as absolute paths.
const markdownFiles: MarkdownFilesFunction = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFiles(entryPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
};

type RemovedPathsFunction = (text: string) => Array<string>;

// Which of the removed menu paths some text names.
const removedPathsIn: RemovedPathsFunction = (text: string): Array<string> => {
  return REMOVED_MENU_PATTERNS.filter((pattern: RegExp): boolean => {
    return pattern.test(text);
  }).map((pattern: RegExp): string => {
    return String(pattern);
  });
};

type SideMenuTableFunction = (
  markdown: string,
  labels: MenuLabels,
) => Array<string>;

/*
 * The rows of the incident overview's side menu table: the one table on the
 * page with both a Rules row and a Settings row.
 */
const sideMenuTable: SideMenuTableFunction = (
  markdown: string,
  labels: MenuLabels,
): Array<string> => {
  const tables: Array<Array<string>> = [];
  let current: Array<string> = [];

  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("|")) {
      current.push(line);
      continue;
    }

    if (current.length > 0) {
      tables.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    tables.push(current);
  }

  const matching: Array<Array<string>> = tables.filter(
    (table: Array<string>): boolean => {
      const firstCells: Array<string> = table.map((row: string): string => {
        return cells(row)[0] || "";
      });

      return (
        firstCells.includes(`**${labels.rules}**`) &&
        firstCells.includes(`**${labels.settings}**`)
      );
    },
  );

  expect(matching).toHaveLength(1);

  return matching[0] as Array<string>;
};

type RowFunction = (rows: Array<string>, firstCell: string) => string;

const rowStartingWith: RowFunction = (
  rows: Array<string>,
  firstCell: string,
): string => {
  return (
    rows.find((row: string): boolean => {
      return cells(row)[0] === firstCell;
    }) || ""
  );
};

type TitlesFunction = (source: string) => Array<string>;

// Every `title: "..."` in a dashboard source file, in order.
const titlesIn: TitlesFunction = (source: string): Array<string> => {
  return Array.from(source.matchAll(/title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

type NoteFunction = () => string;

const note: NoteFunction = (): string => {
  return getSection(read(UPGRADING_PAGE), NOTE_HEADING);
};

describe("AI has no limits by default", () => {
  it("names each docs language's side menu labels, and they are the dashboard's", () => {
    expect(Object.keys(MENU_LABELS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );

    for (const language of Object.keys(MENU_LABELS)) {
      if (ENGLISH_UI_NAME_LANGUAGES.includes(language)) {
        expect({ language: language, labels: MENU_LABELS[language] }).toEqual({
          language: language,
          labels: MENU_LABELS["en"],
        });
      }

      if (language === PERSIAN) {
        continue;
      }

      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
          "utf8",
        ),
      ) as Record<string, string>;
      const english: MenuLabels = MENU_LABELS["en"] as MenuLabels;
      const labels: MenuLabels = MENU_LABELS[language] as MenuLabels;

      expect({
        language: language,
        ai: locale[english.ai],
        settings: locale[english.settings],
        rules: locale[english.rules],
        runbookRules: locale[english.runbookRules],
        autoRemediationRules: locale[english.autoRemediationRules],
      }).toEqual({ language: language, ...labels });
    }
  });

  describe("in the dashboard", () => {
    it("unset limits are no limits, and a set one is kept within its bounds", () => {
      expect(AIWorkloadLimits.getCooldownInMinutes(undefined)).toBe(0);
      expect(AIWorkloadLimits.getCooldownInMinutes(null)).toBe(0);
      expect(AIWorkloadLimits.getCooldownInMinutes(0)).toBe(0);
      expect(
        AIWorkloadLimits.getCooldownInMinutes(
          MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES * 10,
        ),
      ).toBe(MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES);
      expect(MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES).toBe(1440);

      expect(
        AIWorkloadLimits.getMaxConcurrentInvestigations(undefined),
      ).toBeNull();
      expect(AIWorkloadLimits.getMaxConcurrentInvestigations(null)).toBeNull();
      expect(AIWorkloadLimits.getMaxConcurrentInvestigations(0)).toBe(
        MIN_AI_MAX_CONCURRENT_INVESTIGATIONS,
      );
      // No maximum: the old cap of 25 is gone.
      expect(AIWorkloadLimits.getMaxConcurrentInvestigations(500)).toBe(500);
    });

    it("puts AI first under Settings and Auto Remediation Rules right after Runbook Rules, in both side menus", () => {
      for (const sideMenu of SIDE_MENUS) {
        const titles: Array<string> = titlesIn(
          read(path.join(DASHBOARD_SRC, sideMenu)),
        );

        expect({
          sideMenu: sideMenu,
          afterSettings: titles[titles.indexOf("Settings") + 1],
          afterRunbookRules: titles[titles.indexOf("Runbook Rules") + 1],
          investigationOrRemediation: titles.filter(
            (title: string): boolean => {
              return title === "Investigation" || title === "Remediation";
            },
          ),
        }).toEqual({
          sideMenu: sideMenu,
          afterSettings: "AI",
          afterRunbookRules: "Auto Remediation Rules",
          investigationOrRemediation: [],
        });
      }
    });
  });

  describe("the AI SRE page", () => {
    it("no longer states the old defaults, in English or Persian", () => {
      for (const language of Object.keys(AI_SRE_PAGES)) {
        const page: AiSrePage = AI_SRE_PAGES[language] as AiSrePage;
        const markdown: string = flat(read(page.file));

        expect({
          language: language,
          oldDefaults: page.oldDefaults.filter((claim: string): boolean => {
            return markdown.includes(claim);
          }),
        }).toEqual({ language: language, oldDefaults: [] });
      }
    });

    it("sends people to Settings → AI and Rules → Auto Remediation Rules", () => {
      for (const language of Object.keys(AI_SRE_PAGES)) {
        const page: AiSrePage = AI_SRE_PAGES[language] as AiSrePage;
        const markdown: string = flat(read(page.file));

        expect({
          language: language,
          incidents: markdown.includes("**Incidents > Settings > AI**"),
          alerts: markdown.includes("**Alerts > Settings > AI**"),
          remediation: markdown.includes(page.remediation),
          removed: removedPathsIn(markdown),
        }).toEqual({
          language: language,
          incidents: true,
          alerts: true,
          remediation: true,
          removed: [],
        });
      }
    });

    it("says in the cost controls that no limit applies until it is set, and where each is set", () => {
      for (const language of Object.keys(AI_SRE_PAGES)) {
        const page: AiSrePage = AI_SRE_PAGES[language] as AiSrePage;
        const rows: Array<Array<string>> = tableRows(
          getSection(read(page.file), page.costControlsHeading),
        )
          .slice(2)
          .map(cells);

        expect({
          language: language,
          controls: rows.map((row: Array<string>): string => {
            return row[0] || "";
          }),
          where: Array.from(
            new Set(
              rows.map((row: Array<string>): string => {
                return row[2] || "";
              }),
            ),
          ),
        }).toEqual({
          language: language,
          controls: page.rows.map(
            (row: { name: string; says: ReadonlyArray<string> }): string => {
              return row.name;
            },
          ),
          where: [page.where],
        });

        for (const expected of page.rows) {
          const behavior: string =
            rows.find((row: Array<string>): boolean => {
              return row[0] === expected.name;
            })?.[1] || "";

          for (const claim of expected.says) {
            expect({
              language: language,
              control: expected.name,
              claim: claim,
              said: behavior.includes(claim),
            }).toEqual({
              language: language,
              control: expected.name,
              claim: claim,
              said: true,
            });
          }
        }
      }
    });
  });

  describe("every docs page, in every language", () => {
    /*
     * Negative control: the patterns catch the paths the docs used to print,
     * so a scan that finds nothing means they are gone, not missed.
     */
    it("negative control: the patterns catch the removed paths as they were written", () => {
      for (const removed of [
        "**Incidents > AI > Investigation**",
        "Incidents یا Alerts > AI > Investigation",
        "(Incidents or Alerts → AI → Remediation)",
        "(Incidents or Alerts → AI → Investigation)",
        "on the incident AI settings page (Incidents > AI)",
      ]) {
        expect({
          removed: removed,
          caught: removedPathsIn(removed),
        }).not.toEqual({ removed: removed, caught: [] });
      }

      for (const kept of [
        "**Incidents > Settings > AI**",
        "(Incidents or Alerts → Rules → Auto Remediation Rules)",
        "Project Settings > AI > AI Features > Enable AI",
        "**AI > Insights > Settings**",
      ]) {
        expect({ kept: kept, caught: removedPathsIn(kept) }).toEqual({
          kept: kept,
          caught: [],
        });
      }
    });

    it("no page names the removed AI section of the Incidents or Alerts side menu", () => {
      const offenders: Array<string> = [];

      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const pages: Array<string> = markdownFiles(
          path.join(CONTENT_DIR, language),
        );

        // A walk that found nothing would pass vacuously.
        expect({ language: language, some: pages.length > 50 }).toEqual({
          language: language,
          some: true,
        });

        for (const page of pages) {
          for (const pattern of removedPathsIn(flat(read(page)))) {
            offenders.push(`${path.relative(CONTENT_DIR, page)}: ${pattern}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe("the incident overview's side menu table, in every language", () => {
    it("has no AI section, starts Settings with the AI page and lists Auto Remediation Rules right after Runbook Rules", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const labels: MenuLabels = MENU_LABELS[language] as MenuLabels;
        const rows: Array<string> = sideMenuTable(
          readPage(language, "incidents/index.md"),
          labels,
        );
        const settings: Array<string> = boldNames(
          cells(rowStartingWith(rows, `**${labels.settings}**`))[1] || "",
        );
        const rules: Array<string> = boldNames(
          cells(rowStartingWith(rows, `**${labels.rules}**`))[1] || "",
        );

        expect({
          language: language,
          aiSection: rowStartingWith(rows, `**${labels.ai}**`),
          firstSetting: settings[0],
          afterRunbookRules: rules[rules.indexOf(labels.runbookRules) + 1],
          autoRemediationRules: rules.filter((name: string): boolean => {
            return name === labels.autoRemediationRules;
          }).length,
        }).toEqual({
          language: language,
          aiSection: "",
          firstSetting: labels.ai,
          afterRunbookRules: labels.autoRemediationRules,
          autoRemediationRules: 1,
        });
      }
    });
  });

  describe("the incident settings page, in every language", () => {
    it("lists the AI page first in its Settings table, linked to the AI SRE page", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const labels: MenuLabels = MENU_LABELS[language] as MenuLabels;
        const markdown: string = readPage(language, "incidents/settings.md");
        const firstSection: string = getSection(
          markdown,
          getHeadings(markdown).find((heading: string): boolean => {
            return heading.startsWith("## ");
          }) as string,
        );
        const firstRow: Array<string> = cells(tableRows(firstSection)[2] || "");

        expect({
          language: language,
          page: firstRow[0],
          linksToAiSre: (firstRow[1] || "").includes("](/docs/ai/ai-sre)"),
        }).toEqual({
          language: language,
          page: `**${labels.ai}**`,
          linksToAiSre: true,
        });
      }
    });

    it("counts nine Rules pages, with Auto Remediation Rules right after Runbook Rules", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const labels: MenuLabels = MENU_LABELS[language] as MenuLabels;
        const lines: Array<string> = readPage(
          language,
          "incidents/settings.md",
        ).split("\n");
        // The sentence that lists the pages under Rules.
        const listed: Array<string> = boldNames(
          lines.find((line: string): boolean => {
            return (
              line.includes(`**${labels.rules}**`) &&
              line.includes(`**${labels.runbookRules}**`) &&
              !line.startsWith("|")
            );
          }) || "",
        ).filter((name: string): boolean => {
          return name !== labels.rules;
        });
        // The rule engine bullets.
        const bullets: Array<string> = lines
          .filter((line: string): boolean => {
            return line.startsWith("- **");
          })
          .map((line: string): string => {
            return boldNames(line)[0] || "";
          });

        expect({
          language: language,
          pages: listed.length,
          afterRunbookRules: listed[listed.indexOf(labels.runbookRules) + 1],
          bulletAfterRunbookRules:
            bullets[bullets.indexOf(labels.runbookRules) + 1],
        }).toEqual({
          language: language,
          pages: 9,
          afterRunbookRules: labels.autoRemediationRules,
          bulletAfterRunbookRules: labels.autoRemediationRules,
        });
      }
    });
  });

  describe("the 13 → 14 upgrade note", () => {
    it("sits in the 13 → 14 notes, right after the note on new projects", () => {
      const headings: Array<string> = getHeadings(
        getSection(read(UPGRADING_PAGE), THIRTEEN_TO_FOURTEEN_HEADING),
      );

      expect(headings[headings.indexOf(NOTE_HEADING) - 1]).toBe(
        PREVIOUS_NOTE_HEADING,
      );
      expect(headings[headings.indexOf(NOTE_HEADING) + 1]).toBe(
        NEXT_NOTE_HEADING,
      );
      expect(
        getHeadings(read(UPGRADING_PAGE)).filter((heading: string): boolean => {
          return heading === NOTE_HEADING;
        }),
      ).toHaveLength(1);
    });

    it("tabulates each setting's old default and what it is now", () => {
      expect(
        tableRows(note())
          .slice(2)
          .map((row: string): Array<string> => {
            return cells(row);
          }),
      ).toEqual(
        UPGRADE_TABLE.map(
          (row: {
            setting: string;
            before: string;
            now: string;
          }): Array<string> => {
            return [row.setting, row.before, row.now];
          },
        ),
      );
    });

    it("names the settings by the titles the dashboard shows them under", () => {
      const text: string = flat(note());

      for (const setting of NAMED_SETTINGS) {
        expect({
          setting: setting.title,
          inNote: text.includes(`**${setting.title}**`),
          onPage: read(path.join(DASHBOARD_SRC, setting.page)).includes(
            `title: "${setting.title}"`,
          ),
        }).toEqual({ setting: setting.title, inNote: true, onPage: true });
      }
    });

    it("keeps set values, says what 0 does and how to get the old limits back", () => {
      const text: string = flat(note());

      for (const claim of [
        "Values a project already set are kept exactly, and nothing is migrated.",
        `a concurrency cap is no longer held to 25: it can be any number from ${MIN_AI_MAX_CONCURRENT_INVESTIGATIONS} up.`,
        `a queued one still expires after ${QUEUE_EXPIRY_IN_MINUTES} minutes`,
        "a daily fix task limit of 0 pauses that lane's fix tasks, and a **Max Open Fix Pull Requests** of 0 blocks AI fix pull requests on that repository.",
        `A cooldown is still held to at most ${MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES} minutes (a day).`,
        "on **Incidents → Settings → AI** and **Alerts → Settings → AI**, and **Max Open Fix Pull Requests** on each repository's **Settings** page.",
        "AI work outside incidents and alerts has no setting, so it runs without these limits.",
        "or for the investigation time limit: they were already unset by default, which means no limit.",
      ]) {
        expect({ claim: claim, said: text.includes(claim) }).toEqual({
          claim: claim,
          said: true,
        });
      }
    });

    it("says the AI section moved to Settings → AI and Rules → Auto Remediation Rules, at the same URLs", () => {
      const text: string = flat(note());

      for (const claim of [
        "the **AI** section there is gone.",
        "Its **Investigation** page is now **Settings → AI**, the first item under **Settings**",
        "its **Remediation** page is now **Rules → Auto Remediation Rules**, right after **Runbook Rules**.",
        "The URLs (`…/settings/ai` and `…/settings/auto-remediation-rules`) have not changed",
      ]) {
        expect({ claim: claim, said: text.includes(claim) }).toEqual({
          claim: claim,
          said: true,
        });
      }

      // The note describes the move without printing the removed paths.
      expect(removedPathsIn(text)).toEqual([]);
    });
  });
});
