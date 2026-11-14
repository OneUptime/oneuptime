import {
  CONTENT_DIR,
  DOCS_DIR,
  TRANSLATED_LANGUAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS NAME SHORTCUTS AS THE PRODUCT DOES (#7488).
 *
 * The Traditional Chinese Dashboard calls a keyboard shortcut 快速鍵 - its
 * Keyboard shortcuts dialog is 鍵盤快速鍵, as Microsoft's Traditional
 * Chinese help writes it - and the Traditional Chinese docs had 快捷鍵 (the
 * Simplified Chinese word) in five places: the Home Page & Shortcuts
 * page's title and its two links, and the Logs explorer page's Keyboard
 * shortcuts section, which told a reader to press ? for a dialog titled
 * otherwise. The docs say 快速鍵 now.
 *
 * In every language, the Logs explorer page's Keyboard shortcuts section
 * is titled as the Logs viewer's dialog is (KeyboardShortcutsHelp, the
 * Dashboard's "Keyboard shortcuts").
 */

const ZH_TW_CONTENT: string = path.join(CONTENT_DIR, "zh-TW");
const ZH_TW_NAV: string = path.join(DOCS_DIR, "Locales", "zh-TW.json");

// The Simplified Chinese word, which Traditional Chinese writes 快速鍵.
const SIMPLIFIED_WORD: string = "快捷鍵";

function markdownFiles(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const name of fs.readdirSync(dir)) {
    const full: string = path.join(dir, name);

    if (fs.statSync(full).isDirectory()) {
      files.push(...markdownFiles(full));
    } else if (name.endsWith(".md")) {
      files.push(full);
    }
  }

  return files;
}

// Each line of a text that says the Simplified word, with its number.
function linesSaying(text: string): Array<number> {
  return text
    .split("\n")
    .map((line: string, index: number): number => {
      return line.includes(SIMPLIFIED_WORD) ? index + 1 : 0;
    })
    .filter((line: number): boolean => {
      return line > 0;
    });
}

describe("Traditional Chinese says 快速鍵, as its Dashboard does", () => {
  it("the Dashboard's Keyboard shortcuts dialog is 鍵盤快速鍵", () => {
    expect(dashboardLocale("zh-TW")["Keyboard shortcuts"]).toBe("鍵盤快速鍵");
    expect(
      (dashboardLocale("zh-TW")["keyboardShortcuts"] as Record<string, string>)[
        "title"
      ],
    ).toBe("鍵盤快速鍵");
  });

  it("no docs page says 快捷鍵", () => {
    const pages: Array<string> = markdownFiles(ZH_TW_CONTENT);

    expect(pages.length).toBeGreaterThan(100);

    expect(
      pages
        .map((file: string): string => {
          const lines: Array<number> = linesSaying(
            fs.readFileSync(file, "utf8"),
          );
          return lines.length > 0
            ? `${path.relative(ZH_TW_CONTENT, file)}: ${lines.join(", ")}`
            : "";
        })
        .filter(Boolean),
    ).toEqual([]);
  });

  it("nor does the docs' navigation", () => {
    const nav: string = fs.readFileSync(ZH_TW_NAV, "utf8");

    expect(linesSaying(nav)).toEqual([]);
    expect(
      (JSON.parse(nav) as Record<string, Record<string, string>>)["navLinks"]![
        "Home Page & Shortcuts"
      ],
    ).toBe("首頁與快速鍵");
  });

  it("the Home Page & Shortcuts page is titled as the navigation links it, and the pages that link it say so", () => {
    expect(readPage("zh-TW", "introduction/home").split("\n")[0]).toBe(
      "# 首頁與快速鍵",
    );
    expect(readPage("zh-TW", "introduction/getting-started")).toContain(
      "[首頁與快速鍵](/docs/introduction/home)",
    );
    expect(readPage("zh-TW", "introduction/your-account")).toContain(
      "[首頁與快速鍵](/docs/introduction/home)",
    );
  });

  it("negative control: the check finds the Simplified word where a line says it", () => {
    expect(
      linesSaying(
        "# 首頁與快速鍵\n\n## 鍵盤快捷鍵\n\n按 `?` 即可檢視這些快捷鍵。",
      ),
    ).toEqual([3, 5]);
    expect(linesSaying("# 首頁與快速鍵")).toEqual([]);
  });
});

/*
 * The section's place on the English page: the translations keep the
 * English page's sections, in its order.
 */
const LOGS_PAGE: string = "telemetry/logs-explorer";

// The dialog ? opens in the Logs viewer, whose title the section quotes.
const LOGS_SHORTCUTS_DIALOG: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/LogsViewer/components/KeyboardShortcutsHelp.tsx",
);

function sectionTitles(language: string): Array<string> {
  return scanMarkdown(readPage(language, LOGS_PAGE))
    .headings.filter((heading: { level: number }): boolean => {
      return heading.level === 2;
    })
    .map((heading: { text: string }): string => {
      return heading.text;
    });
}

describe("the Logs explorer page's Keyboard shortcuts section, titled as the Logs viewer's dialog", () => {
  const englishTitles: Array<string> = sectionTitles("en");
  const at: number = englishTitles.indexOf("Keyboard shortcuts");

  it("is a section of the English page", () => {
    expect(at).toBeGreaterThan(0);
    expect(dashboardLocale("en")["Keyboard shortcuts"]).toBe(
      "Keyboard shortcuts",
    );
  });

  it("is what the Logs viewer's own dialog is titled", () => {
    expect(fs.readFileSync(LOGS_SHORTCUTS_DIALOG, "utf8")).toContain(
      'translator.translateText("Keyboard shortcuts")',
    );
  });

  it.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
    const titles: Array<string> = sectionTitles(language);

    expect(titles).toHaveLength(englishTitles.length);
    expect(titles[at]).toBe(dashboardLocale(language)["Keyboard shortcuts"]);
  });
});
