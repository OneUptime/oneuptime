import { describe, expect, test } from "@jest/globals";
import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";

/*
 * THE GROUPING SETTINGS, AS EACH LANGUAGE'S DASHBOARD DRAWS THEM (#10584).
 *
 * An Incoming Request criteria's grouping settings read English in eleven
 * Dashboard languages, and German, French and Spanish left "Auto-resolve
 * each incident when…" in English. The docs quote each setting as the
 * reader's Dashboard draws it, so seven pages quoted them in English in
 * those languages: the Incoming Request monitor page, Incident & Alert
 * Templating, Criteria & Statuses, and the Grafana, Prometheus
 * Alertmanager, Datadog and Zabbix guides. Persian's settings table named
 * its fields in English too, beside a Persian Dashboard.
 *
 * Each setting is now worded in every language
 * (IncomingRequestGroupingSettingsInEveryLanguage), and every page quotes
 * it as drawn: in bold, and in the settings table's first column, as often
 * as the English page does, and never in English.
 */

const PAGES: ReadonlyArray<string> = [
  "monitor/incoming-request-monitor",
  "monitor/incident-alert-templating",
  "monitor/criteria-and-statuses",
  "integrations/grafana",
  "integrations/prometheus-alertmanager",
  "integrations/datadog",
  "integrations/zabbix",
];

const LABELS: ReadonlyArray<string> = [
  "Group incidents and alerts by a payload field",
  "Open a separate incident for each…",
  "Auto-resolve each incident when…",
  "Field that signals recovery",
  "Value that means recovered",
  "Max incidents per request",
];

// How often a page quotes a label: in bold, and as a table row's first cell.
function quotes(markdown: string, label: string): number {
  const bold: number = markdown.split(`**${label}**`).length - 1;
  const firstCell: number = (
    markdown.match(new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|`, "gm")) ||
    []
  ).length;

  return bold + firstCell;
}

describe("the English pages", () => {
  test("quote every grouping setting somewhere", () => {
    for (const label of LABELS) {
      const total: number = PAGES.reduce((sum: number, page: string) => {
        return sum + quotes(readPage("en", page), label);
      }, 0);

      expect({ label, isQuoted: total > 0 }).toEqual({ label, isQuoted: true });
    }
  });

  test("name the settings table's fields as the form does", () => {
    const page: string = readPage("en", "monitor/incoming-request-monitor");

    for (const label of [
      "Open a separate incident for each…",
      "Field that signals recovery",
      "Value that means recovered",
      "Max incidents per request",
    ]) {
      expect(page).toMatch(
        new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|`, "m"),
      );
    }
  });
});

describe.each(TRANSLATED_LANGUAGES)("in %s", (language: string) => {
  test("every grouping setting is worded by its Dashboard", () => {
    const inEnglish: Array<string> = LABELS.filter((label: string): boolean => {
      return dashboardLabel(language, label) === label;
    });

    expect({ language, inEnglish }).toEqual({ language, inEnglish: [] });
  });

  test.each([...PAGES])(
    "%s quotes each setting as drawn, as often as the English page",
    (page: string) => {
      const english: string = readPage("en", page);
      const translated: string = readPage(language, page);

      for (const label of LABELS) {
        const drawn: string = dashboardLabel(language, label);

        expect({
          language,
          page,
          label,
          drawn,
          quoted: quotes(translated, drawn),
        }).toEqual({
          language,
          page,
          label,
          drawn,
          quoted: quotes(english, label),
        });

        expect({
          language,
          page,
          label,
          inEnglish: quotes(translated, label),
        }).toEqual({ language, page, label, inEnglish: 0 });
      }
    },
  );
});
