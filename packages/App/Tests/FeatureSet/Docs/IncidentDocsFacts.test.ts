import PromptText, {
  formatCount,
  MAX_DRAFT_PROMPT_FIELD_LENGTH,
} from "Common/Utils/AI/PromptText";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The English incident pages - the overview, declaring an incident, states
 * and severities, notes owners and the feed, linked alerts and the settings
 * reference - name a lot of the product: the Incidents side menu and every
 * page under it, the menu of an incident's own page, the dashboard addresses,
 * the dialog Create from Template shows when there are no templates, the
 * custom field option editor, and what an AI draft of a note reads. Markdown
 * is not compiled, so nothing else notices when the product moves on.
 *
 * These tests hold those facts to the source, read as text (an App test must
 * not import the Dashboard's React components): the menus, RouteMap, the
 * dialog, the option editor and the AI context builder.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);

const PAGES: ReadonlyArray<string> = [
  "index",
  "declaring-incidents",
  "states-and-severities",
  "notes-owners-and-feed",
  "linked-alerts",
  "settings",
];

function readPage(page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, "en", "incidents", `${page}.md`),
    "utf8",
  );
}

function readSource(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readCommon(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, "Common", relative), "utf8");
}

// Every **bold** name in a piece of markdown, in order.
function boldNames(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function tableCells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// The text of the "## " section with this heading, up to the next "## ".
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(/\n## /);

  return end === -1 ? rest : rest.slice(0, end);
}

// The body rows of the first table in a piece of markdown.
function tableRows(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .slice(2);
}

/*
 * A side menu as the reader sees it: its sections, each with the titles of
 * its links, in order.
 */
interface MenuSection {
  title: string;
  items: Array<string>;
}

/*
 * Reads a side menu from its source. A section is a `title` that is not a
 * link's - `{ title: "Rules", items: [...] }` or `<SideMenuSection
 * title="Team">`; an entry is the title of a `link` - `link: { title: ... }`
 * or `link={{ title: ... }}`. Sections that are built elsewhere are put in
 * where the menu adds them: `extra` maps a marker in the source (the call
 * or spread that adds the section) to that section.
 */
function menuSections(
  source: string,
  extra: Record<string, MenuSection> = {},
): Array<MenuSection> {
  interface Found {
    index: number;
    section?: MenuSection;
    item?: string;
  }

  const found: Array<Found> = [];
  const title: RegExp = /(link\s*[:=]\s*\{\{?\s*)?\btitle\s*[:=]\s*"([^"]+)"/g;

  for (const match of Array.from(source.matchAll(title))) {
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

    expect({ marker: marker, found: index >= 0 }).toEqual({
      marker: marker,
      found: true,
    });

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

function sectionByTitle(
  sections: Array<MenuSection>,
  sectionTitle: string,
): MenuSection {
  const found: MenuSection | undefined = sections.find(
    (candidate: MenuSection): boolean => {
      return candidate.title === sectionTitle;
    },
  );

  expect({ section: sectionTitle, found: Boolean(found) }).toEqual({
    section: sectionTitle,
    found: true,
  });

  return found as MenuSection;
}

// The quoted strings of a `name: ... = [ ... ];` constant in a source file.
function quotedListConstant(source: string, name: string): Array<string> {
  const start: number = source.indexOf(`${name}:`);

  expect({ constant: name, found: start >= 0 }).toEqual({
    constant: name,
    found: true,
  });

  const open: number = source.indexOf("[", start);
  const close: number = source.indexOf("];", open);

  return Array.from(source.slice(open, close).matchAll(/"([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The value of a `name: string = "..."` constant in a source file.
function stringConstant(source: string, name: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `${name}:\\s*string\\s*=\\s*"([^"]+)"`,
  ).exec(source);

  expect({ constant: name, found: Boolean(match) }).toEqual({
    constant: name,
    found: true,
  });

  return match?.[1] as string;
}

/*
 * The section the workspace hook adds to a product menu, with every entry it
 * can show: the connected workspaces, or one entry to connect one.
 */
function workspaceSection(): MenuSection {
  const source: string = readSource(
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
function developerSection(): MenuSection {
  const source: string = readSource(
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

// The Incidents product menu, with the sections it adds outside its array.
function incidentsMenu(): Array<MenuSection> {
  const sections: Array<MenuSection> = menuSections(
    readSource("Pages/Incidents/SideMenu.tsx"),
    { "...(workspaceSection ?": workspaceSection() },
  );

  // A list menu gets the Developer section last (addDeveloperSideMenuSection).
  sections.push(developerSection());

  return sections;
}

// The menu on an incident's own page.
function incidentViewMenu(): Array<MenuSection> {
  return menuSections(readSource("Pages/Incidents/View/SideMenu.tsx"), {
    "{getDeveloperSideMenuSection(": developerSection(),
  });
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
function sectionHead(menuSource: string, sectionTitle: string): string {
  const escaped: string = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const title: RegExp = new RegExp(`\\btitle\\s*[:=]\\s*"${escaped}"`, "g");

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
function startsCollapsed(menuSource: string, sectionTitle: string): boolean {
  const head: string = sectionHead(menuSource, sectionTitle);
  const own: RegExpExecArray | null = OWN_FOLD.exec(head);

  if (own) {
    // A bare JSX `defaultCollapsed` is true.
    return own[1] !== "false";
  }

  const collapsedTitles: Array<string> = quotedListConstant(
    readCommon("UI/Components/SideMenu/SideMenuSectionState.ts"),
    "SECTION_TITLES_COLLAPSED_BY_DEFAULT",
  ).map((title: string): string => {
    return title.toLowerCase();
  });

  return collapsedTitles.includes(sectionTitle.toLowerCase());
}

describe("the overview's side menu table is the Incidents side menu", () => {
  const overview: string = readPage("index");
  const table: string = section(
    overview,
    "## Where incidents live in the dashboard",
  );
  const rows: Array<string> = tableRows(table);
  const rowNames: Array<string> = rows.map((row: string): string => {
    return boldNames(tableCells(row)[0] || "")[0] || "";
  });

  function rowFor(sectionTitle: string): Array<string> {
    const row: string | undefined = rows.find((candidate: string): boolean => {
      return tableCells(candidate)[0] === `**${sectionTitle}**`;
    });

    expect({ row: sectionTitle, found: Boolean(row) }).toEqual({
      row: sectionTitle,
      found: true,
    });

    return boldNames(tableCells(row || "")[1] || "");
  }

  it("reads the menu: Integrations holds Huntress, and Developer comes last", () => {
    const titles: Array<string> = incidentsMenu().map(
      (menuSection: MenuSection): string => {
        return menuSection.title;
      },
    );

    expect(titles).toEqual([
      "Overview",
      "Episodes",
      "AI",
      "Workspace",
      "Integrations",
      "Rules",
      "Settings",
      "Developer",
    ]);
    expect(sectionByTitle(incidentsMenu(), "Integrations").items).toEqual([
      "Huntress",
    ]);
  });

  it("has a row per section, in the menu's order (Developer is named in the paragraph under it)", () => {
    expect(rowNames).toEqual(
      incidentsMenu()
        .map((menuSection: MenuSection): string => {
          return menuSection.title;
        })
        .filter((title: string): boolean => {
          return title !== "Developer";
        }),
    );
  });

  it("names every page of the Overview, Integrations, Rules and Settings sections, in order", () => {
    for (const sectionTitle of [
      "Overview",
      "Integrations",
      "Rules",
      "Settings",
    ]) {
      expect({ section: sectionTitle, names: rowFor(sectionTitle) }).toEqual({
        section: sectionTitle,
        names: sectionByTitle(incidentsMenu(), sectionTitle).items,
      });
    }
  });

  it("names the AI section's pages and every entry the Workspace section can show", () => {
    expect(rowFor("AI")).toEqual(sectionByTitle(incidentsMenu(), "AI").items);
    expect(rowFor("Workspace")).toEqual(workspaceSection().items);
  });

  it("says which sections start open and which start folded, as the menu draws them", () => {
    const menuSource: string = readSource("Pages/Incidents/SideMenu.tsx");
    const lines: Array<string> = overview.split("\n");
    const tableEnd: number = lines.lastIndexOf(rows[rows.length - 1] as string);
    const paragraph: string =
      lines.slice(tableEnd + 1).find((line: string): boolean => {
        return line.trim().length > 0;
      }) || "";
    const [openPart, foldedPart] = paragraph.split(";");
    const open: Array<string> = boldNames(openPart || "");
    const folded: Array<string> = boldNames(foldedPart || "");

    expect(open).toEqual(["Overview", "Episodes"]);
    expect([...folded].sort()).toEqual(
      [
        "AI",
        "Workspace",
        "Integrations",
        "Rules",
        "Settings",
        "Developer",
      ].sort(),
    );

    for (const title of open) {
      expect({
        section: title,
        folded: startsCollapsed(menuSource, title),
      }).toEqual({
        section: title,
        folded: false,
      });
    }

    for (const title of folded) {
      expect({
        section: title,
        folded: startsCollapsed(menuSource, title),
      }).toEqual({
        section: title,
        folded: true,
      });
    }
  });

  it("the settings page says integrations are set up under Incidents → Integrations, which holds Huntress", () => {
    const settings: string = readPage("settings");

    expect(settings).toContain(
      "such as [Huntress](/docs/integrations/huntress), are set up under **Incidents → Integrations**.",
    );
    expect(sectionByTitle(incidentsMenu(), "Integrations").items).toContain(
      "Huntress",
    );
  });
});

describe("the incident page's side menu table is the incident's own menu", () => {
  const overview: string = readPage("index");
  const rows: Array<string> = tableRows(
    section(overview, "## What each page on an incident shows"),
  );

  it("reads the menu, with the Developer section where the menu adds it", () => {
    expect(
      incidentViewMenu().map((menuSection: MenuSection): string => {
        return menuSection.title;
      }),
    ).toEqual([
      "Overview",
      "Investigation",
      "Team",
      "Notifications",
      "Notes",
      "Developer",
      "Advanced",
    ]);
  });

  it("has a row per section with its pages, in the menu's order", () => {
    const fromDocs: Array<MenuSection> = rows.map(
      (row: string): MenuSection => {
        const cells: Array<string> = tableCells(row);
        // "collapsed until you click X" names the section again.
        const pages: string = (cells[1] || "").split(" — ")[0] || "";

        return {
          title: boldNames(cells[0] || "")[0] || "",
          items: boldNames(pages),
        };
      },
    );

    expect(fromDocs).toEqual(incidentViewMenu());
  });

  it("says a section is collapsed until clicked exactly when the menu folds it", () => {
    const viewSource: string = readSource("Pages/Incidents/View/SideMenu.tsx");

    for (const row of rows) {
      const cells: Array<string> = tableCells(row);
      const title: string = boldNames(cells[0] || "")[0] || "";
      const saysFolded: boolean = (cells[1] || "").includes(
        `collapsed until you click **${title}**`,
      );

      expect({ section: title, folded: saysFolded }).toEqual({
        section: title,
        folded: startsCollapsed(viewSource, title),
      });
    }
  });

  it("names the incident page's sections and pages in the menu paths it gives", () => {
    const menu: Array<MenuSection> = incidentViewMenu();

    for (const [sectionTitle, item] of [
      ["Notes", "Public Notes"],
      ["Notes", "Private Notes"],
      ["Team", "Owners"],
      ["Advanced", "Audit Logs"],
    ] as Array<[string, string]>) {
      expect(sectionByTitle(menu, sectionTitle).items).toContain(item);
    }
  });
});

/*
 * Every bold menu path on the incident pages ("**Incidents → Rules → On-Call
 * Rules**") is a section and page of the menu it starts from. A path names a
 * section and then one of its pages, or a page straight away.
 */
describe("every menu path the incident pages give is in that menu", () => {
  type MenuReader = () => Array<MenuSection>;

  const MENUS: Record<string, MenuReader> = {
    Incidents: incidentsMenu,
    Alerts: (): Array<MenuSection> => {
      return menuSections(readSource("Pages/Alerts/SideMenu.tsx"), {
        "...(workspaceSection ?": workspaceSection(),
      });
    },
    "Scheduled Maintenance": (): Array<MenuSection> => {
      return menuSections(
        readSource("Pages/ScheduledMaintenanceEvents/SideMenu.tsx"),
      );
    },
    "Project Settings": (): Array<MenuSection> => {
      return menuSections(readSource("Pages/Settings/SideMenu.tsx"));
    },
    "User Settings": (): Array<MenuSection> => {
      return menuSections(readSource("Pages/UserSettings/SideMenu.tsx"));
    },
  };

  const PATH: RegExp = /\*\*([^*\n]+? → [^*\n]+?)\*\*/g;

  function paths(): Array<{ page: string; segments: Array<string> }> {
    const found: Array<{ page: string; segments: Array<string> }> = [];

    for (const page of PAGES) {
      for (const match of Array.from(readPage(page).matchAll(PATH))) {
        const segments: Array<string> = (match[1] as string)
          .split(" → ")
          .map((segment: string): string => {
            return segment.trim();
          });

        if (MENUS[segments[0] as string]) {
          found.push({ page: page, segments: segments });
        }
      }
    }

    return found;
  }

  it("finds the paths, from every menu it knows", () => {
    const roots: Set<string> = new Set(
      paths().map((found: { segments: Array<string> }): string => {
        return found.segments[0] as string;
      }),
    );

    expect([...roots].sort()).toEqual(Object.keys(MENUS).sort());
    expect(paths().length).toBeGreaterThan(40);
  });

  it("resolves each one to a section and its page", () => {
    const unresolved: Array<string> = [];

    for (const found of paths()) {
      const sections: Array<MenuSection> = (
        MENUS[found.segments[0] as string] as MenuReader
      )();
      const rest: Array<string> = found.segments.slice(1);
      const asSection: MenuSection | undefined = sections.find(
        (candidate: MenuSection): boolean => {
          return candidate.title === rest[0];
        },
      );
      const resolves: boolean = asSection
        ? rest.length === 1 || asSection.items.includes(rest[1] as string)
        : rest.length === 1 &&
          sections.some((candidate: MenuSection): boolean => {
            return candidate.items.includes(rest[0] as string);
          });

      if (!resolves || rest.length > 2) {
        unresolved.push(`${found.page}: ${found.segments.join(" → ")}`);
      }
    }

    expect(unresolved).toEqual([]);
  });

  it("names a monitor's Linked Resources card, which its Overview page shows", () => {
    expect(readPage("declaring-incidents")).toContain(
      "**Monitor → Overview → Linked Resources**",
    );

    const card: string = readSource(
      "Components/Monitor/Overview/MonitorLinkedResourcesCard.tsx",
    );

    expect(card).toContain('title: "Linked Resources"');
    expect(readSource("Pages/Monitor/View/Index.tsx")).toContain(
      "<MonitorLinkedResourcesCard",
    );
  });

  it("never sends people to a left navigation the dashboard does not have", () => {
    const leftNavigation: RegExp = /left[- ]nav/i;

    for (const page of PAGES) {
      expect({
        page: page,
        says: leftNavigation.test(readPage(page)),
      }).toEqual({ page: page, says: false });
    }
  });
});

/*
 * Every dashboard address the incident pages give ("`/dashboard/{projectId}/
 * incidents/settings/templates`") is one of the Incidents routes, and an
 * address given as a prefix ("routes beginning `.../incidents/ai/`") starts
 * some of them.
 */
describe("every dashboard address the incident pages give is a route", () => {
  const ROUTE_MAP: string = readSource("Utils/RouteMap.ts");
  const start: number = ROUTE_MAP.indexOf("export const IncidentsRoutePath");
  const block: string = ROUTE_MAP.slice(start, ROUTE_MAP.indexOf("};", start));
  // `${RouteParams.ModelID}` is the record's id: the docs write {incidentId} or {modelId}.
  const routes: Array<string> = Array.from(
    block.matchAll(/\]:\s*(?:"([^"]*)"|`([^`]*)`)/g),
  ).map((match: RegExpMatchArray): string => {
    return ((match[1] ?? match[2]) as string).replace(
      /\$\{RouteParams\.ModelID\}/g,
      "{id}",
    );
  });
  const ADDRESS: RegExp = /`\/dashboard\/\{projectId\}\/incidents(\/[^`]*)?`/g;

  function addresses(): Array<{ page: string; route: string }> {
    const found: Array<{ page: string; route: string }> = [];

    for (const page of PAGES) {
      for (const match of Array.from(readPage(page).matchAll(ADDRESS))) {
        found.push({
          page: page,
          route: (match[1] || "")
            .replace(/^\//, "")
            .replace(/\{(incidentId|modelId)\}/g, "{id}"),
        });
      }
    }

    return found;
  }

  it("reads the Incidents routes", () => {
    expect(routes).toContain("settings/templates");
    expect(routes).toContain("integrations/huntress");
    expect(routes).toContain("ai/insights");
    expect(routes).toContain("{id}/postmortem");
    expect(addresses().length).toBeGreaterThan(15);
  });

  it("resolves each address to a route, or to the start of some", () => {
    const unknown: Array<string> = addresses()
      .filter((found: { route: string }): boolean => {
        if (found.route === "") {
          // The incidents list itself.
          return false;
        }

        if (found.route.endsWith("/")) {
          return !routes.some((route: string): boolean => {
            return route.startsWith(found.route);
          });
        }

        return !routes.includes(found.route);
      })
      .map((found: { page: string; route: string }): string => {
        return `${found.page}: ${found.route}`;
      });

    expect(unknown).toEqual([]);
  });

  it("puts the AI section and Huntress at the routes the pages say", () => {
    const settings: string = readPage("settings");

    expect(settings).toContain(
      "**Incidents → AI**, at routes beginning `/dashboard/{projectId}/incidents/ai/`",
    );

    const aiRoutes: Array<string> = routes.filter((route: string): boolean => {
      return route.startsWith("ai/");
    });

    expect(aiRoutes.sort()).toEqual(["ai/insights", "ai/logs", "ai/settings"]);
  });
});

describe("Create from Template with no templates", () => {
  const table: string = readSource("Components/Incident/IncidentsTable.tsx");
  const modal: string = readSource(
    "Components/Template/NoTemplatesYetModal.tsx",
  );

  it("opens the No Incident Templates dialog, which says where templates are made", () => {
    expect(table).toContain('title="No Incident Templates"');
    expect(table).toContain(
      "Create them in Incidents → Settings → Incident Templates.",
    );
    expect(table).toContain("RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES]");
  });

  it("has a Create Template button that goes to that page", () => {
    expect(modal).toContain('submitButtonText="Create Template"');
    expect(modal).toContain("Navigation.navigate(props.templatesRoute)");
  });

  it("the declaring and settings pages say so, in the dialog's words", () => {
    expect(readPage("declaring-incidents")).toContain(
      "you get a **No Incident Templates** modal instead, with a **Create Template** button that takes you to **Incidents → Settings → Incident Templates**.",
    );
    expect(readPage("settings")).toContain(
      "opens a **No Incident Templates** dialog that says where templates are made, and its **Create Template** button opens **Incidents → Settings → Incident Templates**.",
    );
  });
});

describe("changing a dropdown's options", () => {
  const formFields: string = readCommon(
    "UI/Components/CustomFields/CustomFieldFormFields.ts",
  );
  const optionsInput: string = readCommon(
    "UI/Components/CustomFields/DropdownOptionsInput.tsx",
  );
  const settings: string = readPage("settings");
  const changing: string = settings.slice(
    settings.indexOf("### Changing a dropdown's options"),
    settings.indexOf("### Terraform"),
  );

  it("marks a value the field no longer offers in the product's words", () => {
    const marker: string = stringConstant(
      formFields,
      "CUSTOM_FIELD_NO_LONGER_AN_OPTION_TEXT",
    );

    expect(marker).toBe("No longer an option");
    // The docs set the marker in italics, in the running sentence.
    expect(changing).toContain(`_${marker.toLowerCase()}_`);
    expect(changing.split(`_${marker.toLowerCase()}_`).length - 1).toBe(2);
  });

  it("names the list of values that are no longer options, and Undo, as the editor draws them", () => {
    expect(optionsInput).toContain(
      'translator.translateText("No longer options")',
    );
    expect(optionsInput).toContain('title="Undo"');
    expect(changing).toContain("**No longer options**");
    expect(changing).toContain("**Undo**");
  });
});

describe("what an AI draft of a note reads", () => {
  const notes: string = readPage("notes-owners-and-feed");
  const generating: string = section(notes, "## Generating a note with AI");
  const builder: string = readCommon(
    "Server/Utils/AI/IncidentAIContextBuilder.ts",
  );

  // What the product writes for an embedded PNG of `kilobytes` KB.
  function pngNote(kilobytes: number): string {
    const signature: Buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const bytes: Buffer = Buffer.concat([
      signature,
      Buffer.alloc(kilobytes * 1024 - signature.length, 0x41),
    ]);

    return PromptText.omitEmbeddedData(
      `data:image/png;base64,${bytes.toString("base64")}`,
    ).text;
  }

  it("quotes the note the product puts in place of an embedded image", () => {
    expect(pngNote(340)).toBe("[image omitted: PNG, 340 KB]");
    expect(generating).toContain("`[image omitted: PNG, 340 KB]`");
  });

  it("names the length each text field is cut to, the draft limit", () => {
    expect(MAX_DRAFT_PROMPT_FIELD_LENGTH).toBe(16_000);
    expect(generating).toContain(
      `each text field is cut to ${formatCount(MAX_DRAFT_PROMPT_FIELD_LENGTH)} characters`,
    );
  });

  it("is what the incident's AI context does: every free-text field goes through the draft limit", () => {
    for (const field of [
      "incident.description",
      "incident.rootCause",
      "incident.remediationNotes",
      "note.note",
    ]) {
      expect({
        field: field,
        drafted: builder.includes(`PromptText.draftField(${field})`),
      }).toEqual({ field: field, drafted: true });
      // Never put in raw, where an image would reach the model whole.
      expect({
        field: field,
        raw: builder.includes(`\${${field}}`),
      }).toEqual({ field: field, raw: false });
    }
  });

  it("calls the endpoint the dashboard posts to", () => {
    expect(
      readSource("Components/EventNotes/NoteKinds/IncidentNoteKinds.tsx"),
    ).toContain('apiPath: "/incident/generate-note-from-ai"');
    expect(generating).toContain(
      "`/incident/generate-note-from-ai/{incidentId}`",
    );
  });
});

describe("API keys", () => {
  it("are where the declaring page sends people: Project Settings → Advanced → API Keys", () => {
    expect(readPage("declaring-incidents")).toContain(
      "**Project Settings → Advanced → API Keys**",
    );
    expect(
      sectionByTitle(
        menuSections(readSource("Pages/Settings/SideMenu.tsx")),
        "Advanced",
      ).items,
    ).toContain("API Keys");
  });
});

/*
 * The readers below are what the tests above lean on; a reader that found
 * nothing would make them pass for the wrong reason.
 */
describe("the source readers", () => {
  it("read a JSX menu and an array menu the same way", () => {
    const jsx: string = [
      '<SideMenuSection title="Team">',
      '  <SideMenuItem link={{ title: "Roles", to: a }} />',
      "  <SideMenuItem link={{",
      '    title: "Owners",',
      "  }} />",
      "</SideMenuSection>",
    ].join("\n");
    const array: string = [
      "{",
      '  title: "Rules",',
      "  defaultCollapsed: true,",
      "  items: [",
      '    { link: { title: "Grouping Rules", to: a } },',
      "  ],",
      "},",
    ].join("\n");

    expect(menuSections(jsx)).toEqual([
      { title: "Team", items: ["Roles", "Owners"] },
    ]);
    expect(menuSections(array)).toEqual([
      { title: "Rules", items: ["Grouping Rules"] },
    ]);
    expect(startsCollapsed(array, "Rules")).toBe(true);
  });

  it("read a section's fold from its title when the menu does not set it", () => {
    expect(
      startsCollapsed('{ title: "Overview", items: [] }', "Overview"),
    ).toBe(false);
    expect(
      startsCollapsed('{ title: "Settings", items: [] }', "Settings"),
    ).toBe(true);
  });

  it("never take a link's title for the section of the same name", () => {
    // The AI section's Settings link comes before the Settings section.
    const menu: string = [
      '{ title: "AI", items: [{ link: { title: "Settings", to: a } }] },',
      '{ title: "Settings", defaultCollapsed: false, items: [] },',
    ].join("\n");

    expect(sectionHead(menu, "Settings")).toContain("defaultCollapsed: false");
    expect(startsCollapsed(menu, "Settings")).toBe(false);
    expect(
      startsCollapsed(
        '<SideMenuSection title="Team" defaultCollapsed>',
        "Team",
      ),
    ).toBe(true);
  });
});
