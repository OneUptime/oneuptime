import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Runners and Runner Credentials pages moved from Project Settings into
 * Runbooks. A doc that still sends the reader to "Settings → Runners" renders
 * perfectly and is wrong — and there are seventeen copies of each page, most
 * of which nobody on the team can proofread. So this reads all of them.
 *
 * Two kinds of mention are allowed to keep the old location, both in the
 * upgrade guide: the "Dashboard pages moved" table of the 11 → 12 section,
 * which is a record of where the pages were in 12 and 13, and the note about
 * the move itself — it gives the old URLs (they redirect) and quotes the
 * "Project Settings > Runners" an older Runner image still prints.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const UPGRADING_PAGE: string = "installation/upgrading.md";

const OLD_RUNNERS_URL: string = "…/settings/runners";
const OLD_CREDENTIALS_URL: string = "…/settings/runner-credentials";
const NEW_RUNNERS_URL: string = "…/runbooks/runners";
const NEW_CREDENTIALS_URL: string = "…/runbooks/runner-credentials";

const OLD_SETTINGS_URL: RegExp = /settings\/runner(s|-credentials)\b/;

/*
 * "Settings → Runners" and its variants, in English. Translated pages are
 * checked against their own words for Settings below.
 */
const ENGLISH_SETTINGS_PATH: RegExp =
  /Settings\*{0,2}\s*(?:→|->|>)\s*\*{0,2}Runner/;

/*
 * What each locale's docs call Project Settings in a navigation path. A path
 * that starts with one of these and then names Runners, Runbook agents (the
 * page's translated title in most locales) or their credentials is the old
 * location.
 */
const SETTINGS_WORDS: Record<string, Array<string>> = {
  da: ["Indstillinger"],
  de: ["Einstellungen"],
  es: ["Ajustes", "Configuración"],
  fa: ["تنظیمات"],
  fr: ["Paramètres"],
  hi: ["सेटिंग्स"],
  it: ["Impostazioni"],
  ja: ["設定"],
  ko: ["설정"],
  nl: ["Instellingen"],
  no: ["Innstillinger"],
  pt: ["Configurações", "Definições"],
  ru: ["Настройки"],
  sv: ["Inställningar"],
  "zh-CN": ["设置"],
  "zh-TW": ["設定"],
};

const RUNNER_PAGE_WORDS: string =
  "(?:Runner|Runbook|Agent|agent|エージェント|에이전트|러너|代理|एजेंट|Агент|Credential)";

type SettingsPathPatternFunction = (language: string) => RegExp;

const settingsPathPattern: SettingsPathPatternFunction = (
  language: string,
): RegExp => {
  const words: Array<string> = [
    "Settings",
    ...(SETTINGS_WORDS[language] ?? []),
  ];

  return new RegExp(
    `(?:${words.join("|")})\\*{0,2}\\s*(?:→|->|>)\\s*\\*{0,2}${RUNNER_PAGE_WORDS}`,
  );
};

type ListPagesFunction = (directory: string) => Array<string>;

const listPages: ListPagesFunction = (directory: string): Array<string> => {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listPages(entryPath);
      }

      return entry.name.endsWith(".md") ? [entryPath] : [];
    });
};

type ReadPageFunction = (language: string, page: string) => string;

const readPage: ReadPageFunction = (language: string, page: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
};

interface Mention {
  page: string;
  line: number;
  text: string;
}

type FindMentionsFunction = (
  language: string,
  pattern: RegExp,
) => Array<Mention>;

const findMentions: FindMentionsFunction = (
  language: string,
  pattern: RegExp,
): Array<Mention> => {
  const languageDirectory: string = path.join(CONTENT_DIR, language);
  const mentions: Array<Mention> = [];

  for (const file of listPages(languageDirectory)) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((text: string, index: number) => {
        if (pattern.test(text)) {
          mentions.push({
            page: path
              .relative(languageDirectory, file)
              .split(path.sep)
              .join("/"),
            line: index + 1,
            // Whole line: the allow-list reads URLs that sit far along it.
            text: text.trim(),
          });
        }
      });
  }

  return mentions;
};

/*
 * A row of the historical "Dashboard pages moved" table: it names the old
 * Runbooks → Settings → Agents URL the page had in 11, which nothing else does.
 */
type IsHistoricalRowFunction = (text: string) => boolean;

const isHistoricalRow: IsHistoricalRowFunction = (text: string): boolean => {
  return (
    text.startsWith("|") &&
    (text.includes("…/runbooks/settings/agents") ||
      text.includes("…/runbooks/settings/credentials"))
  );
};

/*
 * The note that announces the move: the one place that sets the old URL
 * beside the new one. It also quotes the old menu path, as the log line an
 * older Runner image prints.
 */
const isMoveNote: IsHistoricalRowFunction = (text: string): boolean => {
  return text.includes(OLD_RUNNERS_URL) && text.includes(NEW_RUNNERS_URL);
};

type IsAllowedMentionFunction = (mention: Mention) => boolean;

const isAllowedMention: IsAllowedMentionFunction = (
  mention: Mention,
): boolean => {
  return (
    mention.page === UPGRADING_PAGE &&
    (isHistoricalRow(mention.text) || isMoveNote(mention.text))
  );
};

describe("the suite reads the docs it claims to", () => {
  test("there are seventeen languages, English among them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain(DEFAULT_DOCS_LANGUAGE);
    expect(DEFAULT_DOCS_LANGUAGE).toBe("en");
  });

  test("every translated language has its word for Settings listed", () => {
    expect(Object.keys(SETTINGS_WORDS).sort()).toEqual(
      LANGUAGES.filter((language: string): boolean => {
        return language !== DEFAULT_DOCS_LANGUAGE;
      }).sort(),
    );
  });

  test.each(LANGUAGES)(
    "%s has the pages that name the Runners page",
    (language: string) => {
      for (const page of [
        UPGRADING_PAGE,
        "runbooks/agents.md",
        "runbooks/authoring.md",
        "ai/ai-agent.md",
      ]) {
        expect(fs.existsSync(path.join(CONTENT_DIR, language, page))).toBe(
          true,
        );
      }
    },
  );

  test.each([
    ["de", "Prüfen Sie unter **Einstellungen → Runbook-Agents**, ob"],
    ["ja", "**設定** > **Runbook エージェント** page"],
    ["ru", "Проверьте в **Настройки → Агенты runbook-ов**"],
    ["ko", "**설정 → 러너** 에서"],
    ["fr", "sous **Paramètres → Runners**."],
    ["zh-TW", "請到 **設定 → Runners** 下確認"],
    ["en", "under **Settings** > **Runners** and"],
  ])(
    "the %s pattern catches an old-location sentence",
    (language: string, sentence: string) => {
      expect(settingsPathPattern(language).test(sentence)).toBe(true);
    },
  );

  test.each([
    ["de", "unter **Runbooks → Runbook-Agents**, ob"],
    ["ja", "**Runbook → Runbook エージェント** に行き"],
    ["ru", "**Настройки → ИИ → Агенты ИИ**"],
    ["en", "under **Runbooks → Runners**"],
    ["en", "Project Settings → AI Features"],
  ])(
    "the %s pattern leaves a current sentence alone",
    (language: string, sentence: string) => {
      expect(settingsPathPattern(language).test(sentence)).toBe(false);
    },
  );
});

describe("no docs page sends the reader to Project Settings for a Runner", () => {
  test.each(LANGUAGES)(
    "%s names a Settings path to Runners only in the upgrade guide's history",
    (language: string) => {
      const mentions: Array<Mention> = findMentions(
        language,
        settingsPathPattern(language),
      ).filter((mention: Mention): boolean => {
        return !isAllowedMention(mention);
      });

      expect(mentions).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s links the old Settings URLs only from the upgrade guide",
    (language: string) => {
      const pages: Array<string> = Array.from(
        new Set(
          findMentions(language, OLD_SETTINGS_URL).map(
            (mention: Mention): string => {
              return mention.page;
            },
          ),
        ),
      );

      expect(pages).toEqual([UPGRADING_PAGE]);
    },
  );

  test("the English pattern finds nothing outside the history in any language", () => {
    // A translated page that left an English sentence in place is still wrong.
    for (const language of LANGUAGES) {
      const mentions: Array<Mention> = findMentions(
        language,
        ENGLISH_SETTINGS_PATH,
      ).filter((mention: Mention): boolean => {
        return !isAllowedMention(mention);
      });

      expect({ language, mentions }).toEqual({ language, mentions: [] });
    }
  });
});

describe("the upgrade guide records the move in every language", () => {
  test.each(LANGUAGES)(
    "%s gives the new URLs and says the old ones redirect",
    (language: string) => {
      const lines: Array<string> = readPage(language, UPGRADING_PAGE).split(
        "\n",
      );

      // The "Other changes in 14" bullet: old and new URLs in one item.
      const bullet: string | undefined = lines
        .map((line: string, index: number): string => {
          // A bullet may wrap; join it with its continuation lines.
          if (!line.startsWith("- ")) {
            return "";
          }
          const continuation: Array<string> = [];
          for (
            let next: number = index + 1;
            next < lines.length && lines[next]!.startsWith("  ");
            next++
          ) {
            continuation.push(lines[next]!.trim());
          }
          return [line, ...continuation].join(" ");
        })
        .find((item: string): boolean => {
          return (
            item.includes(NEW_RUNNERS_URL) &&
            item.includes(NEW_CREDENTIALS_URL) &&
            item.includes(OLD_RUNNERS_URL) &&
            item.includes(OLD_CREDENTIALS_URL)
          );
        });

      expect(bullet).toBeDefined();
      // It is a headed bullet, like its neighbours.
      expect(bullet!.startsWith("- **")).toBe(true);
      /*
       * The log line an older Runner image prints is quoted as printed, in
       * English, so the reader can match it against their own logs.
       */
      expect(bullet).toContain("Project Settings > Runners");
    },
  );

  test.each(LANGUAGES)(
    "%s keeps the 11 → 12 table as the record it is, with a pointer after it",
    (language: string) => {
      const page: string = readPage(language, UPGRADING_PAGE);
      const lines: Array<string> = page.split("\n");

      const historicalRows: Array<string> = lines.filter(isHistoricalRow);

      // Runners and Runner Credentials: one row each, URLs untouched.
      expect(historicalRows).toHaveLength(2);
      expect(historicalRows[0]).toContain(OLD_RUNNERS_URL);
      expect(historicalRows[1]).toContain(OLD_CREDENTIALS_URL);
      for (const row of historicalRows) {
        expect(row).not.toContain("…/runbooks/runners");
        expect(row).not.toContain("…/runbooks/runner-credentials");
      }

      // After the table, the reader is told the pages moved again in 14.
      const afterTable: string = lines
        .slice(lines.indexOf(historicalRows[1]!) + 1)
        .join("\n");
      const nextHeading: number = afterTable.search(/^#{2,3} /m);
      const restOfSection: string = afterTable.slice(
        0,
        nextHeading === -1 ? undefined : nextHeading,
      );

      expect(restOfSection).toContain(NEW_RUNNERS_URL);
      expect(restOfSection).toContain(NEW_CREDENTIALS_URL);
    },
  );

  test("the English bullet sits in Other changes in 14 and says what did not change", () => {
    const page: string = readPage(DEFAULT_DOCS_LANGUAGE, UPGRADING_PAGE);
    const start: number = page.indexOf("### Other changes in 14");
    const end: number = page.indexOf("\n### ", start + 1);

    expect(start).toBeGreaterThan(-1);

    const section: string = page.slice(start, end).replace(/\s+/g, " ");

    expect(section).toContain(
      "**Runners moved from Project Settings into Runbooks.**",
    );
    expect(section).toContain("**Runbooks → Runners** (`…/runbooks/runners`)");
    expect(section).toContain(
      "**Runbooks → Runners → Credentials** (`…/runbooks/runner-credentials`)",
    );
    expect(section).toContain("URLs redirect, so bookmarks keep working");
    expect(section).toContain(
      "Runners keep their ids, keys, capabilities and permissions",
    );
    // An older Runner image still prints the old menu path; say how to read it.
    expect(section).toContain('"Project Settings > Runners"');
  });

  test("the English pointer links to a heading that exists", () => {
    const page: string = readPage(DEFAULT_DOCS_LANGUAGE, UPGRADING_PAGE);

    expect(page).toContain("See [Other changes in 14](#other-changes-in-14).");
    expect(page).toContain("\n### Other changes in 14\n");
  });
});

describe("the English pages name the new location", () => {
  test.each([
    [
      "runbooks/agents.md",
      "Go to **Runbooks → Runners** and create a new agent.",
    ],
    ["runbooks/agents.md", "Go back to **Runbooks → Runners**."],
    [
      "runbooks/authoring.md",
      "Add an agent under **Runbooks → Runners** before relying on a Bash step.",
    ],
    [
      "runbooks/credentials.md",
      "Manage them under **Runbooks → Runners → Credentials**.",
    ],
    ["ai/ai-agent.md", "Create a Runner under **Runbooks** > **Runners**"],
    [
      "ai/ai-agent.md",
      "shows as connected on the **Runbooks** > **Runners** page",
    ],
    ["ai/github-app.md", "is online under **Runbooks → Runners**."],
    ["ai/ai-sre.md", "never appears under Runbooks → Runners."],
    ["ai/ai-sre.md", "through a Runner you run (Runbooks → Runners)."],
    [
      "ai/infrastructure-ai-agents.md",
      "It never appears under Runbooks → Runners,",
    ],
    [
      "telemetry/kubernetes-agent.md",
      "never appears under Runbooks → Runners:",
    ],
    [UPGRADING_PAGE, "(Or open the Runner in **Runbooks → Runners** and use"],
    [UPGRADING_PAGE, "1. Create a Runner under **Runbooks → Runners** and"],
  ])("%s says: %s", (page: string, sentence: string) => {
    expect(
      readPage(DEFAULT_DOCS_LANGUAGE, page).replace(/\s+/g, " "),
    ).toContain(sentence);
  });
});
