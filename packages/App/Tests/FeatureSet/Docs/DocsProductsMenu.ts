import { dashboardLocale, drawnDashboardLabel } from "./DocsDashboardLabels";
import { PATH_SEPARATOR } from "./DocsPageShape";

/*
 * How a docs page names a product of the Dashboard's Products menu, and a
 * path through the Dashboard's menus, in each docs language.
 *
 * The Products menu draws each product's title from its own key
 * (navbar.items.<product>Title), which some languages word differently from
 * the flat key of the same English text: the Danish menu reads
 * "Overvågninger" where a Monitors tab reads "Monitorer", and the Italian
 * menu "AI / LLM" where the product's own pages read "IA / LLM". So a page
 * that opens a product from the menu names it as the menu draws it, and
 * every other segment of a path as a label (drawnDashboardLabel).
 *
 * A path is one bold span with " → " between its segments, as the docs'
 * English pages write it. Persian, written right to left, bolds each segment
 * on its own and joins them with " > ", which is mirrored with the text
 * where "→" is not, as the other Persian pages do.
 *
 * The AI observability, AI tooling and security translation suites share
 * these (AiObservabilityDocsTranslations, AiToolingAndSecurityDocs-
 * Translations), so a product reads the same on all their pages.
 */

// The menu a product's paths start from.
export const PRODUCTS_MENU: string = "Products";

// How a Persian page joins the bold segments of a menu path.
export const PERSIAN_PATH_SEPARATOR: string = " > ";

/*
 * The products a page opens from the Products menu, by the navbar key the
 * menu draws each one's title from.
 */
export const PRODUCTS_MENU_ITEM_KEYS: Readonly<Record<string, string>> = {
  "AI / LLM": "navbar.items.llmObservabilityTitle",
  Traces: "navbar.items.tracesTitle",
  Logs: "navbar.items.logsTitle",
  Metrics: "navbar.items.metricsTitle",
  "Project Settings": "navbar.items.projectSettingsTitle",
  "Security Events": "navbar.items.securityEventsTitle",
  Monitors: "navbar.items.monitorsTitle",
  Alerts: "navbar.items.alertsTitle",
  Workflows: "navbar.items.workflowsTitle",
};

// A value of a locale file by its dotted key, or null.
export function nestedValue(
  locale: Record<string, unknown>,
  key: string,
): string | null {
  let value: unknown = locale;

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  return typeof value === "string" && value.trim() ? value : null;
}

// How the Products menu draws one of its items in a language.
export function drawnMenuItem(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  const key: string | undefined = PRODUCTS_MENU_ITEM_KEYS[english];

  if (!key) {
    throw new Error(`Not a Products menu item: ${english}`);
  }

  return nestedValue(dashboardLocale(language), key) || english;
}

/*
 * A segment of a menu path as a language draws it: a product opened from
 * the Products menu (the first segment, or the one after "Products") from
 * the menu's key, every other segment as a label.
 */
export function drawnPathSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;
  const fromMenu: boolean =
    PRODUCTS_MENU_ITEM_KEYS[segment] !== undefined &&
    (index === 0 || segments[index - 1] === PRODUCTS_MENU);

  return fromMenu
    ? drawnMenuItem(language, segment)
    : drawnDashboardLabel(language, segment);
}

// A menu path as a page in a language writes it.
export function drawnPath(language: string, segments: Array<string>): string {
  const drawn: Array<string> = segments.map(
    (_segment: string, index: number): string => {
      return drawnPathSegment(language, segments, index);
    },
  );

  if (language === "fa") {
    return drawn
      .map((segment: string): string => {
        return `**${segment}**`;
      })
      .join(PERSIAN_PATH_SEPARATOR);
  }

  return `**${drawn.join(PATH_SEPARATOR)}**`;
}
