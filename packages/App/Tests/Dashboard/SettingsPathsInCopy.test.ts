import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Please also find similar issues across the project and fix them as well."
 *
 * The incident's Postmortem page answered Apply Template, in a project with
 * no postmortem templates, with a dialog that sent people to "Project
 * Settings > Incident > Postmortem Templates" - a page that does not exist:
 * postmortem templates are in Incidents → Settings → Postmortem Templates.
 * The same kind of wrong path was in the incident, scheduled maintenance and
 * announcement template dialogs, the monitor and Ping monitor messages about
 * a missing status or severity, the status page subscriber template hints,
 * the team member custom field messages, the incoming call Twilio notice and
 * the incident role hints.
 *
 * A path written into the Dashboard's copy has to name pages the reader can
 * find, in the menus as they are:
 *
 *   1. "Project Settings → X" is walked through the Project Settings menu,
 *      with the folded section of every page named, in every text the
 *      product writes, by ProjectSettingsMenuPathsInProductText (the shared
 *      walker in SettingsMenuPaths). This file once held it on its own, and
 *      took "Project Settings → Domains" - a page of the folded Advanced
 *      section - and a page's breadcrumb title for a path a reader can follow.
 *   2. "<Product> → Settings → Y" for the products below: Y is a page of
 *      that product's Settings section.
 *   3. "Incidents → AI → Z" and "Alerts → AI → Z": Z is a page of that
 *      product's AI section. The AI settings page and the Auto Remediation
 *      Rules moved there from Settings and Rules, and a sentence still
 *      sending people to "Incidents → Settings → AI" fails rule 2.
 *   4. A dialog that offers Create Template goes to the page its words name.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

// "→", "->", ">" and ">" as JSX text writes it.
const SEPARATOR: string = String.raw`\s*(?:→|->|&gt;|>|›)\s*`;

const WORD_CHARACTER: RegExp = /[A-Za-z0-9]/;

// What the old no-templates dialogs said before naming Project Settings.
const OLD_TEMPLATE_DIALOG_WORDS: RegExp = /templates have been created yet/i;

interface MenuItem {
  title: string;
  // The page the item links to, as PageMap names it.
  pageMapKey: string | null;
}

interface MenuSection {
  title: string;
  items: Array<MenuItem>;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

/*
 * A side menu's sections and their pages, read from its source: a section's
 * title sits six spaces in, a page's link title deeper, followed by the
 * RouteMap[PageMap.X] it opens.
 */
function readSideMenu(relativePath: string): Array<MenuSection> {
  const lines: Array<string> = readSource(relativePath).split("\n");
  const sections: Array<MenuSection> = [];
  let currentSection: MenuSection | null = null;
  let currentItem: MenuItem | null = null;

  for (const line of lines) {
    const sectionTitle: RegExpMatchArray | null = line.match(
      /^ {6}title: "([^"]+)",$/,
    );

    if (sectionTitle) {
      currentSection = { title: sectionTitle[1]!, items: [] };
      currentItem = null;
      sections.push(currentSection);
      continue;
    }

    const itemTitle: RegExpMatchArray | null = line.match(
      /^ {12,}title: "([^"]+)",$/,
    );

    if (itemTitle && currentSection) {
      currentItem = { title: itemTitle[1]!, pageMapKey: null };
      currentSection.items.push(currentItem);
      continue;
    }

    const pageMapKey: RegExpMatchArray | null = line.match(
      /PageMap\.([A-Z0-9_]+)/,
    );

    if (pageMapKey && currentItem && !currentItem.pageMapKey) {
      currentItem.pageMapKey = pageMapKey[1]!;
    }
  }

  return sections;
}

// The products whose Settings section a path may name, by their menu title.
const PRODUCT_SIDE_MENUS: Record<string, string> = {
  Incidents: "Pages/Incidents/SideMenu.tsx",
  Alerts: "Pages/Alerts/SideMenu.tsx",
  "Status Pages": "Pages/StatusPages/SideMenu.tsx",
  "Scheduled Maintenance": "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
  Monitors: "Pages/Monitor/SideMenu.tsx",
  Users: "Pages/Users/SideMenu.tsx",
};

function getProductSectionItems(
  product: string,
  sectionTitle: string,
): Array<MenuItem> {
  const section: MenuSection | undefined = readSideMenu(
    PRODUCT_SIDE_MENUS[product]!,
  ).find((candidate: MenuSection): boolean => {
    return candidate.title === sectionTitle;
  });

  return section ? section.items : [];
}

function getProductSettingsItems(product: string): Array<MenuItem> {
  return getProductSectionItems(product, "Settings");
}

// The products whose menu has an AI section a path may name.
const PRODUCTS_WITH_AI_SECTION: Array<string> = ["Incidents", "Alerts"];

function getProductAiItems(product: string): Array<MenuItem> {
  return getProductSectionItems(product, "AI");
}

/*
 * The longest of these titles the text starts with, as a whole name (not
 * "AI" out of "AI Features").
 */
function findTitleAtStart(text: string, titles: Array<string>): string | null {
  let found: string | null = null;

  for (const title of titles) {
    if (!text.startsWith(title)) {
      continue;
    }

    const next: string = text.charAt(title.length);

    if (next && WORD_CHARACTER.test(next)) {
      continue;
    }

    if (!found || title.length > found.length) {
      found = title;
    }
  }

  return found;
}

function shorten(text: string): string {
  return text.slice(0, 60).split("\n")[0]!;
}

function findProductSettingsPathProblems(text: string): Array<string> {
  const problems: Array<string> = [];
  const products: Array<string> = Object.keys(PRODUCT_SIDE_MENUS);
  const pathStart: RegExp = new RegExp(
    `(?<![A-Za-z])(${products.join("|")})${SEPARATOR}Settings${SEPARATOR}`,
    "g",
  );

  for (const match of text.matchAll(pathStart)) {
    const product: string = match[1]!;
    const rest: string = text.slice(match.index! + match[0].length);

    if (rest.startsWith("${") || rest.startsWith("{")) {
      continue;
    }

    const page: string | null = findTitleAtStart(
      rest,
      getProductSettingsItems(product).map((item: MenuItem): string => {
        return item.title;
      }),
    );

    if (!page) {
      problems.push(
        `"${product} → Settings → ${shorten(rest)}": ${product} has no such Settings page`,
      );
    }
  }

  return problems;
}

/*
 * "Incidents → AI → Z" and "Alerts → AI → Z": Z must be a page of that
 * product's AI section. "AI Features" after "Project Settings →" is not
 * this path: the product name has to come right before "AI".
 */
function findProductAiPathProblems(text: string): Array<string> {
  const problems: Array<string> = [];
  const pathStart: RegExp = new RegExp(
    `(?<![A-Za-z])(${PRODUCTS_WITH_AI_SECTION.join("|")})${SEPARATOR}AI${SEPARATOR}`,
    "g",
  );

  for (const match of text.matchAll(pathStart)) {
    const product: string = match[1]!;
    const rest: string = text.slice(match.index! + match[0].length);

    if (rest.startsWith("${") || rest.startsWith("{")) {
      continue;
    }

    const page: string | null = findTitleAtStart(
      rest,
      getProductAiItems(product).map((item: MenuItem): string => {
        return item.title;
      }),
    );

    if (!page) {
      problems.push(
        `"${product} → AI → ${shorten(rest)}": the ${product} AI section has no such page`,
      );
    }
  }

  return problems;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

/*
 * The source without its comments: a path a comment mentions is not shown
 * to anyone. Block comments, and line comments that start a line.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCES: Array<{ file: string; text: string }> = listSourceFiles(
  DASHBOARD_SRC,
).map((file: string) => {
  return {
    file: path.relative(DASHBOARD_SRC, file),
    text: withoutComments(fs.readFileSync(file, "utf8")),
  };
});

describe("the menus the paths are checked against", () => {
  test("are read from the side menus", () => {
    for (const product of Object.keys(PRODUCT_SIDE_MENUS)) {
      expect(getProductSettingsItems(product).length).toBeGreaterThan(0);
    }

    expect(
      getProductSettingsItems("Incidents").map((item: MenuItem): string => {
        return item.title;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Incident Templates",
        "Postmortem Templates",
        "Incident Roles",
        "Incident Severity",
      ]),
    );
  });

  test.each(PRODUCTS_WITH_AI_SECTION)(
    "the %s menu's AI section holds its AI settings - the auto-remediation rules among them - and Settings no longer does",
    (product: string) => {
      const prefix: string = product === "Incidents" ? "INCIDENTS" : "ALERTS";

      expect(getProductAiItems(product)).toEqual(
        expect.arrayContaining([
          { title: "Settings", pageMapKey: `${prefix}_SETTINGS_AI` },
        ]),
      );
      // The rules are under the AI settings page's More settings now.
      expect(
        getProductAiItems(product).map((item: MenuItem): string => {
          return item.title;
        }),
      ).not.toContain("Auto Remediation Rules");
      expect(
        getProductSettingsItems(product).map((item: MenuItem): string => {
          return item.title;
        }),
      ).not.toContain("AI");
    },
  );
});

describe("the path checks", () => {
  test.each([
    "Configure incident roles in Incidents > Settings > Roles to start.",
    "Create them in Scheduled Maintenance → Settings → Templates.",
    "Add one under Monitors → Settings → Monitor Statuses.",
    // The AI settings page left Settings for the AI section.
    "Limits live under Incidents → Settings → AI.",
    "Raise or unset it under Alerts > Settings > AI to resume.",
  ])("refuse %s", (text: string) => {
    expect(findProductSettingsPathProblems(text)).toHaveLength(1);
  });

  test.each([
    "Create them in Incidents → Settings → Postmortem Templates.",
    "Create them in Scheduled Maintenance → Settings → Event Templates.",
    "Create them in Status Pages → Settings → Announcement Templates.",
    "Add one under Monitors → Settings → Monitor Status, then try again.",
    "Add one under Alerts → Settings → Alert Severity.",
    "Add custom fields in Users → Settings → Custom Fields.",
  ])("accept %s", (text: string) => {
    expect(findProductSettingsPathProblems(text)).toEqual([]);
  });

  test.each([
    "Limits live under Incidents → AI → Limits.",
    "Turn it on in Alerts > AI > Investigation.",
    "Set up a rule in Incidents → AI → Remediation Rules.",
    // The rules page folded into Settings: there is no such page any more.
    "Add one in Incidents → AI → Auto Remediation Rules.",
  ])("refuse %s", (text: string) => {
    expect(findProductAiPathProblems(text)).toHaveLength(1);
  });

  test.each([
    "Limits live under Incidents → AI → Settings.",
    "Raise or unset it under Alerts > AI > Settings to resume.",
    "Add one in Incidents → AI → Settings.",
    // Not a product's AI section: Project Settings has its own AI section.
    "Turn AI on in Project Settings → AI → AI Features.",
  ])("accept %s", (text: string) => {
    expect(findProductAiPathProblems(text)).toEqual([]);
  });
});

describe("paths in the Dashboard's copy", () => {
  test("name pages of the product's own Settings section", () => {
    const problems: Array<string> = SOURCES.flatMap(
      (source: { file: string; text: string }): Array<string> => {
        return findProductSettingsPathProblems(source.text).map(
          (problem: string): string => {
            return `${source.file}: ${problem}`;
          },
        );
      },
    );

    expect(problems).toEqual([]);
  });

  test("name pages of the product's own AI section", () => {
    const problems: Array<string> = SOURCES.flatMap(
      (source: { file: string; text: string }): Array<string> => {
        return findProductAiPathProblems(source.text).map(
          (problem: string): string => {
            return `${source.file}: ${problem}`;
          },
        );
      },
    );

    expect(problems).toEqual([]);
  });

  // The one sentence of the Dashboard that names the AI section today.
  test("the cluster's investigation confirmation sends people to Incidents → AI → Settings", () => {
    expect(
      readSource("Pages/Kubernetes/Utils/KubernetesAiAgentStatus.ts"),
    ).toContain("Limits live under Incidents → AI → Settings.");
  });

  test("no template dialog says templates are made in Project Settings", () => {
    const offenders: Array<string> = SOURCES.filter(
      (source: { file: string; text: string }): boolean => {
        return OLD_TEMPLATE_DIALOG_WORDS.test(source.text);
      },
    ).map((source: { file: string; text: string }): string => {
      return source.file;
    });

    expect(offenders).toEqual([]);
  });
});

/*
 * Create from Template on the incident, scheduled maintenance and
 * announcement lists: with no templates yet, the dialog names the page the
 * templates are made on, and its Create Template button opens that page -
 * the one the side menu links under that name.
 */
describe("the no-templates dialogs", () => {
  const DIALOGS: Array<{
    file: string;
    product: string;
    page: string;
  }> = [
    {
      file: "Components/Incident/IncidentsTable.tsx",
      product: "Incidents",
      page: "Incident Templates",
    },
    {
      file: "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
      product: "Scheduled Maintenance",
      page: "Event Templates",
    },
    {
      file: "Components/Announcement/AnnouncementsTable.tsx",
      product: "Status Pages",
      page: "Announcement Templates",
    },
  ];

  test.each(DIALOGS)(
    "$file names $product → Settings → $page and goes there",
    (dialog: { file: string; product: string; page: string }) => {
      const source: string = readSource(dialog.file);
      const start: number = source.indexOf("<NoTemplatesYetModal");

      expect(start).toBeGreaterThan(-1);

      const element: string = source.slice(
        start,
        source.indexOf("/>", source.indexOf("onClose=", start)) + 2,
      );

      expect(element).toContain(
        `${dialog.product} → Settings → ${dialog.page}.`,
      );

      const menuItem: MenuItem | undefined = getProductSettingsItems(
        dialog.product,
      ).find((item: MenuItem): boolean => {
        return item.title === dialog.page;
      });

      expect(menuItem?.pageMapKey).toBeTruthy();
      expect(element).toContain(`PageMap.${menuItem!.pageMapKey}`);
      expect(element).toMatch(/templatesRoute=/);

      // The old dead end: a notice whose only button closed it.
      expect(source).not.toMatch(/No \w+(?: \w+)? Templates`\}/);
    },
  );

  test("the postmortem pages have no such dialog: Apply Template is offered only with a template", () => {
    for (const file of [
      "Pages/Incidents/View/Postmortem.tsx",
      "Pages/Incidents/EpisodeView/Postmortem.tsx",
    ]) {
      const source: string = readSource(file);

      expect(source).not.toContain("No Postmortem Templates");
      expect(source).not.toContain("Project Settings");
      expect(source).toContain("getPostmortemCardButtons(");
      expect(source).toMatch(
        /hasTemplates: postmortemTemplates\.templates\.length > 0/,
      );
    }
  });
});
