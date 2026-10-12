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
 * The menu files its products under groups (navbar.categories.<group>),
 * whose names some languages also word apart from the flat key: the Dutch
 * menu's Resources group reads "Bronnen" where a "Resources" label elsewhere
 * reads "Middelen". A path that names the group, "Products → Resources →
 * Real User Monitoring", draws it from the group's key, and the product after
 * it from the menu's.
 *
 * A path is one bold span with " → " between its segments, as the docs'
 * English pages write it. Persian, written right to left, bolds each segment
 * on its own and joins them with " > ", which is mirrored with the text
 * where "→" is not, as the other Persian pages do.
 *
 * The AI observability, AI tooling and security translation suites share
 * these (AiObservabilityDocsTranslations, AiToolingAndSecurityDocs-
 * Translations), and so do the RUM setup pages (RumDocsTranslations), so a
 * product reads the same on all their pages.
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
  Services: "navbar.items.servicesTitle",
  "Real User Monitoring": "navbar.items.rumTitle",
};

/*
 * The groups of the Products menu a path names, by the navbar key the menu
 * draws each group's name from.
 */
export const PRODUCTS_MENU_GROUP_KEYS: Readonly<Record<string, string>> = {
  Resources: "navbar.categories.resources",
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

// How the Products menu draws the name of one of its groups in a language.
export function drawnMenuGroup(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  const key: string | undefined = PRODUCTS_MENU_GROUP_KEYS[english];

  if (!key) {
    throw new Error(`Not a Products menu group: ${english}`);
  }

  return nestedValue(dashboardLocale(language), key) || english;
}

// Whether a path's segment is a group the Products menu opens.
function isMenuGroup(segments: Array<string>, index: number): boolean {
  return (
    index > 0 &&
    segments[index - 1] === PRODUCTS_MENU &&
    PRODUCTS_MENU_GROUP_KEYS[segments[index] as string] !== undefined
  );
}

/*
 * A segment of a menu path as a language draws it: a group of the Products
 * menu (the segment after "Products") from the group's key, a product opened
 * from the menu (the first segment, the one after "Products", or the one
 * after a group) from the menu's key, every other segment as a label.
 */
export function drawnPathSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;

  if (isMenuGroup(segments, index)) {
    return drawnMenuGroup(language, segment);
  }

  const fromMenu: boolean =
    PRODUCTS_MENU_ITEM_KEYS[segment] !== undefined &&
    (index === 0 ||
      segments[index - 1] === PRODUCTS_MENU ||
      isMenuGroup(segments, index - 1));

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
