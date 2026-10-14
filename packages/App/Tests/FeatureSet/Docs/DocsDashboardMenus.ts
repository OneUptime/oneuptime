import { escapeRegExp } from "./DocsTranslationChecks";
import fs from "fs";
import path from "path";

/*
 * The Dashboard's side menus as a docs page names them: a product's menu
 * (its sections, each with the titles of its links) and the menu of a
 * record's own page, read from their sources as text. An App test must not
 * import the Dashboard's React components, and Markdown is not compiled,
 * so a facts suite holds a page's menu tables and paths to these readers.
 *
 * IncidentDocsFacts grew them first; the Alerts suite (AlertDocsFacts) and
 * later docs suites read them from here rather than copying them. A plain
 * module, not a .test.ts file: importing it runs no tests.
 */

export const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
export const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Dashboard/src",
);
export const COMMON_DIR: string = path.join(PACKAGES_DIR, "Common");

// A file of the Dashboard's source, as text.
export function readDashboardSource(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// A file of Common, as text.
export function readCommonSource(relative: string): string {
  return fs.readFileSync(path.join(COMMON_DIR, relative), "utf8");
}

/*
 * A side menu as the reader sees it: its sections, each with the titles of
 * its links, in order.
 */
export interface MenuSection {
  title: string;
  items: Array<string>;
}

// A section's or a link's title: `title: "Rules"` or `title="Team"`.
const TITLE: RegExp = /(link\s*[:=]\s*\{\{?\s*)?\btitle\s*[:=]\s*"([^"]+)"/g;

/*
 * Reads a side menu from its source. A section is a `title` that is not a
 * link's - `{ title: "Rules", items: [...] }` or `<SideMenuSection
 * title="Team">`; an entry is the title of a `link` - `link: { title: ... }`
 * or `link={{ title: ... }}`. Sections that are built elsewhere are put in
 * where the menu adds them: `extra` maps a marker in the source (the call
 * or spread that adds the section) to that section. A marker the source
 * does not have throws, naming it.
 */
export function menuSections(
  source: string,
  extra: Record<string, MenuSection> = {},
): Array<MenuSection> {
  interface Found {
    index: number;
    section?: MenuSection;
    item?: string;
  }

  const found: Array<Found> = [];

  for (const match of Array.from(source.matchAll(TITLE))) {
    if (match[1]) {
      found.push({ index: match.index || 0, item: match[2] as string });
    } else {
      found.push({
        index: match.index || 0,
        section: { title: match[2] as string, items: [] },
      });
    }
  }

  for (const marker of Object.keys(extra)) {
    const index: number = source.indexOf(marker);

    if (index < 0) {
      throw new Error(`The menu's source has no "${marker}"`);
    }

    const added: MenuSection = extra[marker] as MenuSection;

    found.push({
      index: index,
      section: { title: added.title, items: [...added.items] },
    });
  }

  found.sort((a: Found, b: Found): number => {
    return a.index - b.index;
  });

  const sections: Array<MenuSection> = [];

  for (const entry of found) {
    if (entry.section) {
      sections.push(entry.section);
      continue;
    }

    const current: MenuSection | undefined = sections[sections.length - 1];

    if (current && entry.item) {
      current.items.push(entry.item);
    }
  }

  return sections;
}

// The section of a menu with this title; throws, naming it, when there is none.
export function sectionByTitle(
  sections: Array<MenuSection>,
  sectionTitle: string,
): MenuSection {
  const found: MenuSection | undefined = sections.find(
    (candidate: MenuSection): boolean => {
      return candidate.title === sectionTitle;
    },
  );

  if (!found) {
    throw new Error(`The menu has no section "${sectionTitle}"`);
  }

  return found;
}

// The value of a `name: string = "..."` constant in a source file.
export function stringConstant(source: string, name: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `${escapeRegExp(name)}:\\s*string\\s*=\\s*"([^"]+)"`,
  ).exec(source);

  if (!match) {
    throw new Error(`No string constant ${name}`);
  }

  return match[1] as string;
}

// The quoted strings of a `name: ... = [ ... ];` constant in a source file.
export function quotedListConstant(
  source: string,
  name: string,
): Array<string> {
  const start: number = source.indexOf(`${name}:`);

  if (start < 0) {
    throw new Error(`No list constant ${name}`);
  }

  const open: number = source.indexOf("[", start);
  const close: number = source.indexOf("];", open);

  return Array.from(source.slice(open, close).matchAll(/"([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The section the workspace hook adds to a product menu, with every entry it
 * can show: the connected workspaces, or one entry to connect one.
 */
export function workspaceSection(): MenuSection {
  const source: string = readDashboardSource(
    "Components/Workspace/WorkspaceSideMenuSection.ts",
  );
  const titles: string = source.slice(
    source.indexOf("WORKSPACE_MENU_ENTRY_TITLES"),
    source.indexOf("WORKSPACE_MENU_ENTRY_ICONS"),
  );

  return {
    title: stringConstant(source, "WORKSPACE_SECTION_TITLE"),
    items: Array.from(titles.matchAll(/\]:\s*"([^"]+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  };
}

// The Developer section every resource menu gets, with its pages.
export function developerSection(): MenuSection {
  const source: string = readDashboardSource(
    "Components/DeveloperDocs/DeveloperDocsPages.ts",
  );
  const pages: string = source.slice(
    source.indexOf("DEVELOPER_DOCS_PAGES"),
    source.indexOf("];", source.indexOf("DEVELOPER_DOCS_PAGES")),
  );

  return {
    title: stringConstant(source, "DEVELOPER_DOCS_SECTION_TITLE"),
    items: Array.from(pages.matchAll(/title:\s*"([^"]+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  };
}

// The end of the source just before a link's title: `link: {` or `link={{`.
const BEFORE_LINK_TITLE: RegExp = /link\s*[:=]\s*\{\{?\s*$/;
// A section's own fold: `defaultCollapsed: true`, or a bare JSX prop.
const OWN_FOLD: RegExp = /defaultCollapsed(?:\s*[:=]\s*\{?\s*(true|false))?/;

/*
 * What a menu's source says about one of its sections, from its title up to
 * its entries: `{ title: "Rules", defaultCollapsed: true, items: [` or
 * `<SideMenuSection title="Team" defaultCollapsed>`. Empty when the section
 * is built elsewhere (the Workspace and Developer sections).
 */
export function sectionHead(menuSource: string, sectionTitle: string): string {
  const title: RegExp = new RegExp(
    `\\btitle\\s*[:=]\\s*"${escapeRegExp(sectionTitle)}"`,
    "g",
  );

  for (const match of Array.from(menuSource.matchAll(title))) {
    const index: number = match.index || 0;
    const before: string = menuSource.slice(Math.max(0, index - 40), index);

    // A link's title is an entry, not a section.
    if (BEFORE_LINK_TITLE.test(before)) {
      continue;
    }

    const rest: string = menuSource.slice(index);
    const end: number = rest.search(/items\s*:|>/);

    return end >= 0 ? rest.slice(0, end) : rest;
  }

  return "";
}

/*
 * Whether a section of a menu starts folded: its own defaultCollapsed, or
 * else its title (SideMenuSectionState's startsCollapsed).
 */
export function startsCollapsed(
  menuSource: string,
  sectionTitle: string,
): boolean {
  const head: string = sectionHead(menuSource, sectionTitle);
  const own: RegExpExecArray | null = OWN_FOLD.exec(head);

  if (own) {
    // A bare JSX `defaultCollapsed` is true.
    return own[1] !== "false";
  }

  const collapsedTitles: Array<string> = quotedListConstant(
    readCommonSource("UI/Components/SideMenu/SideMenuSectionState.ts"),
    "SECTION_TITLES_COLLAPSED_BY_DEFAULT",
  ).map((title: string): string => {
    return title.toLowerCase();
  });

  return collapsedTitles.includes(sectionTitle.toLowerCase());
}

// A route of a group: `[PageMap.X]: "path"` or a template literal.
const ROUTE_ENTRY: RegExp = /\]:\s*(?:"([^"]*)"|`([^`]*)`)/g;
// The record's id in a route: `${RouteParams.ModelID}`.
const MODEL_ID_PARAM: RegExp = /\$\{RouteParams\.ModelID\}/g;

/*
 * The routes of one of RouteMap's route groups (`AlertsRoutePath`), as a
 * docs page writes an address after the product's own: the record's id
 * (`${RouteParams.ModelID}`) as {id}.
 */
export function routeGroup(groupName: string): Array<string> {
  const routeMap: string = readDashboardSource("Utils/RouteMap.ts");
  const start: number = routeMap.indexOf(`export const ${groupName}`);

  if (start < 0) {
    throw new Error(`RouteMap has no ${groupName}`);
  }

  const block: string = routeMap.slice(start, routeMap.indexOf("};", start));

  return Array.from(block.matchAll(ROUTE_ENTRY)).map(
    (match: RegExpMatchArray): string => {
      return ((match[1] ?? match[2]) as string).replace(MODEL_ID_PARAM, "{id}");
    },
  );
}
