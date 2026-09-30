import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import RULE_CRITERIA_FIELDS_BY_MODEL from "Common/Types/Rules/RuleCriteriaFieldRegistry";

/*
 * The Queues product is a lazy-loaded route group like Databases: a product
 * Layout (list, archived list, install guide, owner / label rules) plus a
 * per-queue View layout with telemetry, owners, settings, documentation and
 * delete pages. Every piece of that wiring fails silently rather than
 * loudly:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a View page with no PageRoute is reachable from the side menu but 404s,
 *   - a page with no breadcrumb trail renders without breadcrumbs,
 *   - a locale missing the nav key falls back to the raw key string,
 *   - a rule form whose match criteria differ from the engine's legacy
 *     fields saves criteria the engine never reads.
 *
 * The App suite runs in plain Node with no renderer and cannot import the
 * dashboard's route modules, so these are source-level invariants in the
 * DatabaseProductWiring.test.ts style. Whitespace is squashed (or removed)
 * so Prettier can reflow without breaking them. The rendered behaviour is
 * pinned in Common/Tests/App/Dashboard/MessageQueue*.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

type ReadSourceFunction = (...segments: Array<string>) => string;

const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

type TransformFunction = (source: string) => string;

const squash: TransformFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

const dense: TransformFunction = (source: string): string => {
  return source.replace(/\s+/g, "");
};

const stripComments: TransformFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

/** Every PageMap key the product is built from (DESIGN.md section 1). */
const MESSAGE_QUEUE_PAGE_KEYS: ReadonlyArray<string> = [
  "MESSAGE_QUEUE_ROOT",
  "MESSAGE_QUEUES",
  "MESSAGE_QUEUES_ARCHIVED",
  "MESSAGE_QUEUES_DOCUMENTATION",
  "MESSAGE_QUEUES_SETTINGS_LABEL_RULES",
  "MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW",
  "MESSAGE_QUEUES_SETTINGS_OWNER_RULES",
  "MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW",
  "MESSAGE_QUEUE_VIEW",
  "MESSAGE_QUEUE_VIEW_TRACES",
  "MESSAGE_QUEUE_VIEW_METRICS",
  "MESSAGE_QUEUE_VIEW_OWNERS",
  "MESSAGE_QUEUE_VIEW_SETTINGS",
  "MESSAGE_QUEUE_VIEW_DELETE",
  "MESSAGE_QUEUE_VIEW_DOCUMENTATION",
];

/** MESSAGE_QUEUE_ROOT is the lazy-route mount (`/queues/*`), not a page. */
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> =
  MESSAGE_QUEUE_PAGE_KEYS.filter((key: string): boolean => {
    return key !== "MESSAGE_QUEUE_ROOT";
  });

/** Every View page module and the PageMap key whose PageRoute renders it. */
const VIEW_PAGES: ReadonlyArray<[string, string]> = [
  ["Overview.tsx", "MESSAGE_QUEUE_VIEW"],
  ["Traces.tsx", "MESSAGE_QUEUE_VIEW_TRACES"],
  ["Metrics.tsx", "MESSAGE_QUEUE_VIEW_METRICS"],
  ["Owners.tsx", "MESSAGE_QUEUE_VIEW_OWNERS"],
  ["Settings.tsx", "MESSAGE_QUEUE_VIEW_SETTINGS"],
  ["Documentation.tsx", "MESSAGE_QUEUE_VIEW_DOCUMENTATION"],
  ["Delete.tsx", "MESSAGE_QUEUE_VIEW_DELETE"],
];

/** Product-level pages (rendered under Pages/MessageQueue/Layout.tsx). */
const PRODUCT_PAGES: ReadonlyArray<[Array<string>, string]> = [
  [["MessageQueues.tsx"], "MESSAGE_QUEUES"],
  [["Documentation.tsx"], "MESSAGE_QUEUES_DOCUMENTATION"],
  [["Archived.tsx"], "MESSAGE_QUEUES_ARCHIVED"],
  [["Settings", "OwnerRules.tsx"], "MESSAGE_QUEUES_SETTINGS_OWNER_RULES"],
  [["Settings", "LabelRules.tsx"], "MESSAGE_QUEUES_SETTINGS_LABEL_RULES"],
];

/** The view's tabs and the URL segment each lives at. */
const VIEW_TAB_SEGMENTS: ReadonlyArray<[string, string]> = [
  ["MESSAGE_QUEUE_VIEW_TRACES", "traces"],
  ["MESSAGE_QUEUE_VIEW_METRICS", "metrics"],
  ["MESSAGE_QUEUE_VIEW_OWNERS", "owners"],
  ["MESSAGE_QUEUE_VIEW_SETTINGS", "settings"],
  ["MESSAGE_QUEUE_VIEW_DELETE", "delete"],
  ["MESSAGE_QUEUE_VIEW_DOCUMENTATION", "documentation"],
];

/** The product's static pages and their paths under /queues. */
const PRODUCT_PATHS: ReadonlyArray<[string, string]> = [
  ["MESSAGE_QUEUES_ARCHIVED", "archived"],
  ["MESSAGE_QUEUES_DOCUMENTATION", "documentation"],
  ["MESSAGE_QUEUES_SETTINGS_LABEL_RULES", "settings/label-rules"],
  [
    "MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW",
    "settings/label-rules/${RouteParams.ModelID}",
  ],
  ["MESSAGE_QUEUES_SETTINGS_OWNER_RULES", "settings/owner-rules"],
  [
    "MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW",
    "settings/owner-rules/${RouteParams.ModelID}",
  ],
];

describe("PageMap declares the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");

  test.each(MESSAGE_QUEUE_PAGE_KEYS)(
    "%s is declared, value === name",
    (key: string) => {
      expect(pageMap).toContain(`${key} = "${key}"`);
    },
  );

  test("every MESSAGE_QUEUE key is one this suite knows about", () => {
    /*
     * A key added without a row here would escape every assertion below
     * (route, mount, breadcrumb, side menu).
     */
    const declared: Array<string> = Array.from(
      pageMap.matchAll(/^\s*(MESSAGE_QUEUE[A-Z_]*)\s*=\s*"/gm),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();

    expect(declared).toEqual([...MESSAGE_QUEUE_PAGE_KEYS].sort());
  });

  test("no key reuses another product's prefix", () => {
    for (const key of MESSAGE_QUEUE_PAGE_KEYS) {
      expect(key.startsWith("MESSAGE_QUEUE")).toBe(true);
      expect(key).not.toMatch(/^(DATABASE|QUEUE|INVENTORY|VMWARE)_/);
    }
  });
});

describe("RouteMap gives every page a URL under /queues", () => {
  const routeMapRaw: string = readSource("Utils", "RouteMap.ts");
  const routeMap: string = squash(routeMapRaw);

  test.each(MESSAGE_QUEUE_PAGE_KEYS)("%s has a route", (key: string) => {
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("the product is mounted at /dashboard/:projectId/queues/*", () => {
    expect(dense(routeMapRaw)).toContain(
      "[PageMap.MESSAGE_QUEUE_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/queues/*`,)",
    );
    expect(dense(routeMapRaw)).toContain(
      "[PageMap.MESSAGE_QUEUES]:newRoute(`/dashboard/${RouteParams.ProjectID}/queues`,)",
    );
  });

  test("every other routed page resolves through MessageQueueRoutePath", () => {
    for (const key of NAVIGABLE_PAGE_KEYS) {
      if (key === "MESSAGE_QUEUES") {
        continue;
      }
      expect(dense(routeMapRaw)).toContain(
        `[PageMap.${key}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/queues/\${MessageQueueRoutePath[PageMap.${key}]}\`,)`,
      );
    }
  });

  test("the queue view is the bare model id", () => {
    expect(dense(routeMapRaw)).toContain(
      "[PageMap.MESSAGE_QUEUE_VIEW]:`${RouteParams.ModelID}`",
    );
  });

  test.each(VIEW_TAB_SEGMENTS)(
    "%s is the view's /%s tab",
    (key: string, segment: string) => {
      expect(dense(routeMapRaw)).toContain(
        `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}\``,
      );
    },
  );

  test.each(PRODUCT_PATHS)(
    "%s lives at queues/%s",
    (key: string, relative: string) => {
      expect(dense(routeMapRaw)).toContain(`[PageMap.${key}]:\`${relative}\``);
    },
  );

  test("rule view paths extend their list paths and end in the rule id", () => {
    const routePathOf: (key: string) => string = (key: string): string => {
      const match: RegExpMatchArray | null = dense(routeMapRaw).match(
        new RegExp(`\\[PageMap\\.${key}\\]:\`([^\`]*)\`,`),
      );
      expect(match).not.toBeNull();
      return match![1]!;
    };

    for (const [list, view] of [
      [
        "MESSAGE_QUEUES_SETTINGS_LABEL_RULES",
        "MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW",
      ],
      [
        "MESSAGE_QUEUES_SETTINGS_OWNER_RULES",
        "MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW",
      ],
    ]) {
      expect(routePathOf(view!).startsWith(`${routePathOf(list!)}/`)).toBe(
        true,
      );
      expect(routePathOf(view!)).toMatch(/\$\{RouteParams\.ModelID\}$/);
    }
  });

  test("no other product owns the /queues slug", () => {
    const slugUsers: Array<string> = Array.from(
      routeMapRaw.matchAll(
        /\[PageMap\.([A-Z_]+)\]:\s*new Route\(\s*`\/dashboard\/\$\{RouteParams\.ProjectID\}\/queues[/`]/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(slugUsers.sort()).toEqual([...MESSAGE_QUEUE_PAGE_KEYS].sort());
  });
});

describe("every route is actually mounted", () => {
  const routesRaw: string = readSource("Routes", "MessageQueueRoutes.tsx");
  const routes: string = squash(routesRaw);

  test.each(NAVIGABLE_PAGE_KEYS)(
    "%s is rendered by a PageRoute",
    (key: string) => {
      expect(dense(routesRaw)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("the queue view renders the Overview by default", () => {
    expect(routes).toContain(
      "<PageRoute index element={ <MessageQueueOverview",
    );
  });

  test("the view pages are nested under the view layout, the list under the product layout", () => {
    expect(routes).toContain("element={<MessageQueueViewLayout");
    expect(routes).toContain("element={<MessageQueueLayout");
    expect(dense(routesRaw)).toContain(
      'path={MessageQueueRoutePath[PageMap.MESSAGE_QUEUE_VIEW]||""}element={<MessageQueueViewLayout{...props}/>}',
    );
    expect(dense(routesRaw)).toContain(
      '<PageRoutepath=""element={<MessageQueues{...props}pageRoute={RouteMap[PageMap.MESSAGE_QUEUES]asRoute}/>}',
    );
  });

  test.each(VIEW_PAGES)(
    "Pages/MessageQueue/View/%s exists and is imported by the routes file for %s",
    (file: string, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "MessageQueue", "View", file),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/MessageQueue/View/${file.replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routesRaw)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test.each(
    VIEW_TAB_SEGMENTS.map(([key]: [string, string]): string => {
      return key;
    }),
  )("%s is a one-segment tab of the view layout", (key: string) => {
    expect(dense(routesRaw)).toMatch(
      new RegExp(`RouteUtil\\.getLastPathForKey\\(PageMap\\.${key},?\\)`),
    );
  });

  test.each(PRODUCT_PAGES)(
    "Pages/MessageQueue/%s exists and is routed for %s",
    (segments: Array<string>, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "MessageQueue", ...segments),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/MessageQueue/${segments
          .join("/")
          .replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routesRaw)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("no View page on disk is left unrouted", () => {
    const onDisk: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, "Pages", "MessageQueue", "View"))
      .filter((file: string): boolean => {
        return (
          file.endsWith(".tsx") &&
          file !== "Layout.tsx" &&
          file !== "SideMenu.tsx"
        );
      })
      .sort();

    expect(onDisk).toEqual(
      VIEW_PAGES.map((entry: [string, string]): string => {
        return entry[0];
      }).sort(),
    );
  });

  test("the rule view routes pass their rule model", () => {
    expect(dense(routesRaw)).toContain(
      "pageRoute={RouteMap[PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW]asRoute}ruleViewModelType={MessageQueueLabelRule}",
    );
    expect(dense(routesRaw)).toContain(
      "pageRoute={RouteMap[PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW]asRoute}ruleViewModelType={MessageQueueOwnerRule}",
    );
    expect(routesRaw).toContain(
      'import MessageQueueLabelRule from "Common/Models/DatabaseModels/MessageQueueLabelRule";',
    );
    expect(routesRaw).toContain(
      'import MessageQueueOwnerRule from "Common/Models/DatabaseModels/MessageQueueOwnerRule";',
    );
  });

  test("the rule LIST routes do not pass a rule model (they would render as a view)", () => {
    for (const key of [
      "MESSAGE_QUEUES_SETTINGS_LABEL_RULES",
      "MESSAGE_QUEUES_SETTINGS_OWNER_RULES",
    ]) {
      expect(dense(routesRaw)).toContain(
        `pageRoute={RouteMap[PageMap.${key}]asRoute}/>`,
      );
    }
  });

  test("AllRoutes exports the product", () => {
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as MessageQueueRoutes } from "./MessageQueueRoutes";',
    );
  });

  test("App.tsx lazy-loads the product router and mounts it at the product root, beside Databases", () => {
    const appRaw: string = readSource("App.tsx");
    const app: string = squash(appRaw);

    expect(app).toContain("RouteMap[PageMap.MESSAGE_QUEUE_ROOT]");
    expect(app).toContain("<MessageQueueRoutes {...commonPageProps} />");
    expect(dense(appRaw)).toContain(
      'lazy(()=>{returnimport("./Routes/MessageQueueRoutes");})',
    );

    const databases: number = app.indexOf(
      "<DatabaseRoutes {...commonPageProps} />",
    );
    const queues: number = app.indexOf(
      "<MessageQueueRoutes {...commonPageProps} />",
    );
    expect(databases).toBeGreaterThan(-1);
    expect(queues).toBeGreaterThan(databases);
  });
});

describe("every navigable page has breadcrumbs", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "MessageQueueBreadcrumbs.ts"),
  );

  test.each(NAVIGABLE_PAGE_KEYS)("%s has a breadcrumb trail", (key: string) => {
    expect(breadcrumbs).toContain(`PageMap.${key},`);
  });

  test.each([
    ["MESSAGE_QUEUES", ["Project", "Queues"]],
    ["MESSAGE_QUEUES_ARCHIVED", ["Project", "Queues", "Archived"]],
    ["MESSAGE_QUEUES_DOCUMENTATION", ["Project", "Queues", "Documentation"]],
    [
      "MESSAGE_QUEUES_SETTINGS_LABEL_RULES",
      ["Project", "Queues", "Label Rules"],
    ],
    [
      "MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW",
      ["Project", "Queues", "Label Rules", "View Rule"],
    ],
    [
      "MESSAGE_QUEUES_SETTINGS_OWNER_RULES",
      ["Project", "Queues", "Owner Rules"],
    ],
    [
      "MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW",
      ["Project", "Queues", "Owner Rules", "View Rule"],
    ],
    ["MESSAGE_QUEUE_VIEW", ["Project", "Queues", "View Queue"]],
    [
      "MESSAGE_QUEUE_VIEW_TRACES",
      ["Project", "Queues", "View Queue", "Traces"],
    ],
    [
      "MESSAGE_QUEUE_VIEW_METRICS",
      ["Project", "Queues", "View Queue", "Metrics"],
    ],
    [
      "MESSAGE_QUEUE_VIEW_OWNERS",
      ["Project", "Queues", "View Queue", "Owners"],
    ],
    [
      "MESSAGE_QUEUE_VIEW_SETTINGS",
      ["Project", "Queues", "View Queue", "Settings"],
    ],
    [
      "MESSAGE_QUEUE_VIEW_DOCUMENTATION",
      ["Project", "Queues", "View Queue", "Documentation"],
    ],
    [
      "MESSAGE_QUEUE_VIEW_DELETE",
      ["Project", "Queues", "View Queue", "Delete Queue"],
    ],
  ])("%s reads %j", (key: string, titles: Array<string>) => {
    const start: number = breadcrumbs.indexOf(`PageMap.${key},`);
    expect(start).toBeGreaterThan(-1);
    const next: number = breadcrumbs.indexOf(
      "BuildBreadcrumbLinksByTitles(",
      start,
    );
    const entry: string = breadcrumbs.slice(
      start,
      next === -1 ? breadcrumbs.length : next,
    );
    // The entry's one title list, read whole: every title, in order.
    const list: RegExpMatchArray | null = entry.match(
      /\[\s*("[^"]*"(?:\s*,\s*"[^"]*")*)\s*,?\s*\]/,
    );
    expect(list).not.toBeNull();
    expect(JSON.parse(`[${list![1]!}]`)).toEqual(titles);
  });

  test("the breadcrumb module is exported from the barrel", () => {
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      'export * from "./MessageQueueBreadcrumbs";',
    );
  });

  test("both layouts read the Queues trail", () => {
    expect(readSource("Pages", "MessageQueue", "Layout.tsx")).toContain(
      "getMessageQueueBreadcrumbs(path)",
    );
    expect(readSource("Pages", "MessageQueue", "View", "Layout.tsx")).toContain(
      "getMessageQueueBreadcrumbs(path)",
    );
  });
});

describe("the side menus reach the whole product", () => {
  test("the product side menu links to the list, archive, docs and rules", () => {
    const sideMenu: string = dense(
      readSource("Pages", "MessageQueue", "SideMenu.tsx"),
    );

    for (const key of [
      "MESSAGE_QUEUES",
      "MESSAGE_QUEUES_ARCHIVED",
      "MESSAGE_QUEUES_DOCUMENTATION",
      "MESSAGE_QUEUES_SETTINGS_OWNER_RULES",
      "MESSAGE_QUEUES_SETTINGS_LABEL_RULES",
    ]) {
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
    // The rules sit in a Settings section that starts collapsed.
    expect(sideMenu).toContain('title:"Settings",defaultCollapsed:true');
  });

  test("the queue side menu links to every view page", () => {
    const sideMenu: string = dense(
      readSource("Pages", "MessageQueue", "View", "SideMenu.tsx"),
    );

    for (const [, key] of VIEW_PAGES) {
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
  });

  test("the queue side menu's sections are Basic, Observability, Settings, Advanced", () => {
    const sideMenu: string = dense(
      stripComments(
        readSource("Pages", "MessageQueue", "View", "SideMenu.tsx"),
      ),
    );
    const sections: Array<string> = Array.from(
      sideMenu.matchAll(/<SideMenuSectiontitle="([^"]+)">/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(sections).toEqual([
      "Basic",
      "Observability",
      "Settings",
      "Advanced",
    ]);
  });

  test("Delete is last, and marked dangerous", () => {
    const sideMenu: string = dense(
      readSource("Pages", "MessageQueue", "View", "SideMenu.tsx"),
    );
    const deleteIndex: number = sideMenu.indexOf(
      "RouteMap[PageMap.MESSAGE_QUEUE_VIEW_DELETE]",
    );

    for (const [, key] of VIEW_PAGES) {
      if (key !== "MESSAGE_QUEUE_VIEW_DELETE") {
        expect(sideMenu.indexOf(`RouteMap[PageMap.${key}]`)).toBeLessThan(
          deleteIndex,
        );
      }
    }
    expect(sideMenu.slice(deleteIndex)).toContain(
      'className="danger-on-hover"',
    );
  });
});

describe("the navbar link exists in the Resources section", () => {
  const navBarRaw: string = readSource("Utils", "NavigationItems.tsx");
  const navBar: string = squash(navBarRaw);

  function entryAt(titleKey: string): string {
    const titleIndex: number = navBar.indexOf(`t("navbar.items.${titleKey}"`);
    const start: number = navBar.lastIndexOf("{", titleIndex);
    return navBar.slice(start, navBar.indexOf("},", titleIndex) + 1);
  }

  function entry(): string {
    return entryAt("queuesTitle");
  }

  test("there is a live, translated entry", () => {
    expect(dense(navBarRaw)).toContain(
      't("navbar.items.queuesTitle","Queues")',
    );
    expect(dense(navBarRaw)).toContain('t("navbar.items.queuesDescription"');
    expect(squash(stripComments(navBarRaw))).toContain(
      't("navbar.items.queuesTitle"',
    );
  });

  test("it routes to the list and carries the QueueList icon", () => {
    expect(entry()).toContain("RouteMap[PageMap.MESSAGE_QUEUES] as Route");
    expect(entry()).toContain("activeRoute: RouteMap[PageMap.MESSAGE_QUEUES]");
    expect(entry()).toContain("icon: IconProp.QueueList");
  });

  test("it is a cross-platform catalog, right after Databases", () => {
    expect(entry()).toContain("category: resourcesCategory");
    expect(entry()).not.toContain("infrastructureCategory");

    const databases: number = navBar.indexOf('t("navbar.items.databasesTitle"');
    const queues: number = navBar.indexOf('t("navbar.items.queuesTitle"');
    const rum: number = navBar.indexOf('t("navbar.items.rumTitle"');

    expect(databases).toBeGreaterThan(-1);
    expect(queues).toBeGreaterThan(databases);
    expect(rum).toBeGreaterThan(queues);
    // Nothing between the Databases entry and this one.
    expect(
      navBar
        .slice(databases, queues)
        .match(/t\("navbar\.items\.[a-zA-Z]+Title"/g),
    ).toHaveLength(1);
  });

  test('nothing in it contains "rum", "k8s", "kubernetes" or "error budget", which must each find one product', () => {
    const text: string = entry().toLowerCase();

    expect(text).not.toContain("rum");
    expect(text).not.toContain("k8s");
    expect(text).not.toContain("kubernetes");
    expect(text).not.toContain("error budget");
  });

  test("it answers the searches people make for brokers and queue problems", () => {
    for (const keyword of [
      "queue",
      "message queue",
      "kafka",
      "rabbitmq",
      "sqs",
      "service bus",
      "pub/sub",
      "topics",
      "consumer lag",
      "dead letter",
    ]) {
      expect(entry()).toContain(`"${keyword}"`);
    }
  });
});

describe("the navbar entry is translated everywhere", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  function readLocale(file: string): Record<string, any> {
    return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
  }

  test("all 17 locale files are present", () => {
    expect(localeFiles.length).toBe(17);
  });

  test.each(localeFiles)("%s carries the Queues nav keys", (file: string) => {
    const items: Record<string, string> =
      readLocale(file)["navbar"]?.["items"] || {};

    expect(typeof items["queuesTitle"]).toBe("string");
    expect(items["queuesTitle"]!.trim().length).toBeGreaterThan(0);
    expect(typeof items["queuesDescription"]).toBe("string");
    expect(items["queuesDescription"]!.trim().length).toBeGreaterThan(0);

    const text: string =
      `${items["queuesTitle"]} ${items["queuesDescription"]}`.toLowerCase();
    expect(text).not.toContain("rum");
    expect(text).not.toContain("k8s");
    expect(text).not.toContain("kubernetes");
  });

  test.each(localeFiles)(
    "%s keeps the Queues keys right after the Databases keys",
    (file: string) => {
      const lines: Array<string> = fs
        .readFileSync(path.join(LOCALES_DIR, file), "utf8")
        .split("\n");
      const databasesIndex: number = lines.findIndex(
        (line: string): boolean => {
          return line.includes('"databasesDescription":');
        },
      );
      expect(databasesIndex).toBeGreaterThan(-1);
      expect(lines[databasesIndex + 1]).toContain('"queuesTitle":');
      expect(lines[databasesIndex + 2]).toContain('"queuesDescription":');
      // And the Databases pair still follows the Services pair.
      expect(lines[databasesIndex - 2]).toContain('"servicesDescription":');
    },
  );

  /*
   * The Products menu shows each description under its title, and every
   * other product's is a sentence: it ends the way its neighbour's does —
   * "." in most locales, "。" in Japanese and Chinese, "।" in Hindi.
   */
  test.each(localeFiles)(
    "%s ends the Queues description like the Databases one beside it",
    (file: string) => {
      const items: Record<string, string> = readLocale(file)["navbar"]["items"];
      const ending: string = items["queuesDescription"]!.trim().slice(-1);
      expect([".", "。", "।"]).toContain(ending);
      expect(ending).toBe(items["databasesDescription"]!.trim().slice(-1));
    },
  );

  test("English says Queues with the design's description as a sentence, and no other locale reuses the English copy", () => {
    const english: Record<string, any> = readLocale("en.json");
    expect(english["navbar"]["items"]["queuesTitle"]).toBe("Queues");
    expect(english["navbar"]["items"]["queuesDescription"]).toBe(
      "Message queues and topics from your traces and brokers.",
    );

    for (const file of localeFiles) {
      if (file === "en.json") {
        continue;
      }
      const items: Record<string, string> = readLocale(file)["navbar"]["items"];
      expect(items["queuesDescription"]).not.toBe(
        english["navbar"]["items"]["queuesDescription"],
      );
      expect(items["queuesTitle"]).not.toBe("Queues");
    }
  });

  test("the English fallbacks in the nav item match en.json", () => {
    const english: Record<string, any> = readLocale("en.json");
    const navBar: string = squash(readSource("Utils", "NavigationItems.tsx"));

    expect(navBar).toContain(
      `"navbar.items.queuesTitle", "${english["navbar"]["items"]["queuesTitle"]}"`,
    );
    expect(navBar).toContain(
      `"navbar.items.queuesDescription", "${english["navbar"]["items"]["queuesDescription"]}"`,
    );
  });
});

describe("the rule forms match exactly what the rule engines evaluate", () => {
  /*
   * The match-criteria step's fields, as StaticRuleCriteriaRuntimeCoverage
   * reads them: `field: { x: true }` followed (before the next stepId) by
   * `stepId: "match-criteria"`.
   */
  function matchCriteriaFields(source: string): Array<string> {
    return Array.from(
      source.matchAll(
        /field\s*:\s*\{\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*true\s*,?\s*\}\s*,(?:(?!stepId\s*:)[\s\S])*?stepId\s*:\s*["']match-criteria["']/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
  }

  function legacyFields(engineFile: string): Array<string> {
    const source: string = fs.readFileSync(
      path.join(COMMON_ROOT, "Server", "Services", engineFile),
      "utf8",
    );
    const match: RegExpMatchArray | null = source.match(
      /legacyFields\s*:\s*\[([\s\S]*?)\]/,
    );
    expect(match).not.toBeNull();
    return Array.from(match![1]!.matchAll(/"([A-Za-z0-9]+)"/g)).map(
      (field: RegExpMatchArray): string => {
        return field[1]!;
      },
    );
  }

  const EXPECTED: Array<string> = [
    "messageQueueLabels",
    "messageQueueNamePattern",
    "messageQueueDescriptionPattern",
    "messageQueueSystemPattern",
  ];

  test.each([
    [
      "LabelRules.tsx",
      "MessageQueueLabelRule",
      "LabelRuleTable",
      "MessageQueueLabelRuleEngineService.ts",
    ],
    [
      "OwnerRules.tsx",
      "MessageQueueOwnerRule",
      "RuleTable",
      "MessageQueueOwnerRuleEngineService.ts",
    ],
  ])(
    "Settings/%s lists exactly the %s engine's legacy fields, in order",
    (file: string, model: string, table: string, engine: string) => {
      const source: string = readSource(
        "Pages",
        "MessageQueue",
        "Settings",
        file,
      );

      expect(matchCriteriaFields(source)).toEqual(EXPECTED);
      expect(legacyFields(engine)).toEqual(EXPECTED);
      expect(
        RULE_CRITERIA_FIELDS_BY_MODEL[
          model as keyof typeof RULE_CRITERIA_FIELDS_BY_MODEL
        ],
      ).toEqual(EXPECTED);

      // One table, for this model, with the view wiring RuleViewPagesWiring reads.
      expect(dense(source)).toContain(
        `<${table}<${model}>modelType={${model}}`,
      );
      expect(dense(source)).toContain(
        `viewRuleId={RuleViewPageUtil.getViewRuleId(props,${model})}`,
      );
      expect(source).toMatch(/id\s*:\s*"match-criteria"/);
      // The help keeps a Match Criteria heading, which the shared help replaces.
      expect(source).toMatch(/^### Match Criteria$/m);
    },
  );

  test("each rule page lists and views its own PageMap keys", () => {
    const label: string = dense(
      readSource("Pages", "MessageQueue", "Settings", "LabelRules.tsx"),
    );
    const owner: string = dense(
      readSource("Pages", "MessageQueue", "Settings", "OwnerRules.tsx"),
    );

    expect(label).toContain(
      "RuleViewPageUtil.getListRoute(PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES,)",
    );
    expect(label).toContain(
      "RuleViewPageUtil.getRuleViewRoute(PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW,",
    );
    expect(owner).toContain(
      "RuleViewPageUtil.getListRoute(PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES,)",
    );
    expect(owner).toContain(
      "RuleViewPageUtil.getRuleViewRoute(PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW,",
    );
  });
});

describe("the pages follow the house idioms", () => {
  test("the list keeps manual creation, reads 'Create Queue' and shows the guide only while empty", () => {
    const source: string = squash(
      readSource("Pages", "MessageQueue", "MessageQueues.tsx"),
    );

    expect(source).toContain("<ModelTable<MessageQueue>");
    expect(source).toContain("isCreateable={true}");
    // ModelTable's create button is "Create " + the singular name.
    expect(source).toContain('singularName="Queue"');
    expect(source).toContain(
      "query={mergeFiltersIntoQuery({ isArchived: false })}",
    );
    expect(source).toContain(
      "{count === 0 && ( <MessageQueueDocumentationCard",
    );
    expect(source).toContain("RouteMap[PageMap.MESSAGE_QUEUE_VIEW] as Route");
  });

  test("the create form offers the catalog's systems and asks for a namespace only when it is part of the identity", () => {
    const source: string = dense(
      stripComments(readSource("Pages", "MessageQueue", "MessageQueues.tsx")),
    );

    expect(source).toContain(
      "constSYSTEM_OPTIONS:Array<MessageQueueOption>=getMessagingSystemOptions();",
    );
    expect(source).toContain("dropdownOptions:SYSTEM_OPTIONS");
    expect(source).toContain(
      "showIf:(values:FormValues<MessageQueue>):boolean=>{returnisNamespaceScopedMessagingSystem(values.messagingSystem);},required:false,",
    );
    /*
     * Never required, even for Service Bus: the emulator's and a custom
     * domain's spans key on a queue without a namespace, which the server
     * accepts from a person too.
     */
    expect(source).not.toContain(
      "required:(values:FormValues<MessageQueue>):boolean=>{returnisNamespaceScopedMessagingSystem(values.messagingSystem);}",
    );
    expect(source).toContain("validateMessageQueueDestination(values)");
    expect(source).toContain("validateMessageQueueNamespace(values)");
  });

  test("the Archived list sends View to the queue's own page", () => {
    const source: string = dense(
      stripComments(readSource("Pages", "MessageQueue", "Archived.tsx")),
    );

    expect(source).toContain("query={{isArchived:true,}}");
    expect(source).toContain(
      "onViewPage={(item:MessageQueue):Promise<Route>=>{returnPromise.resolve(RouteUtil.populateRouteParams(RouteMap[PageMap.MESSAGE_QUEUE_VIEW]asRoute,",
    );
    expect(source).not.toContain("viewPageRoute");
    expect(source).toContain("isCreateable={false}");
  });

  test("Settings edits name, description and labels and archives — with no retention card", () => {
    const source: string = readSource(
      "Pages",
      "MessageQueue",
      "View",
      "Settings.tsx",
    );
    const code: string = squash(stripComments(source));

    expect(code).toContain("<CardModelDetail<MessageQueue>");
    expect(code).toContain("<ArchiveResourceCard<MessageQueue>");
    expect(code).toContain('singularName="queue"');
    expect(code).toContain("RouteMap[PageMap.MESSAGE_QUEUES] as Route");
    expect(code).toContain("const { id } = useParams();");
    expect(code).not.toContain("TelemetryResourceRetentionSettings");
    for (const field of ["name: true", "description: true", "labels: true"]) {
      expect(code).toContain(field);
    }
    expect(code).toContain("refreshMessageQueueHeader();");
    /*
     * No length rule on the name: a queue is named after its destination,
     * which can be one character, and the form re-checks the prefilled name
     * on every save.
     */
    expect(code).not.toContain("minLength");
  });

  test("Delete warns that discovered queues come back and returns to the list", () => {
    const code: string = squash(
      stripComments(readSource("Pages", "MessageQueue", "View", "Delete.tsx")),
    );

    expect(code).toContain("<ModelDelete modelType={MessageQueue}");
    expect(code).toContain("RouteMap[PageMap.MESSAGE_QUEUES] as Route");
    expect(code).toContain("title={MESSAGE_QUEUE_DELETE_WARNING}");
    expect(code).toContain("Navigation.getLastParamAsObjectID(1)");
  });

  test("Owners uses the queue owner models on messageQueueId", () => {
    const code: string = squash(
      stripComments(readSource("Pages", "MessageQueue", "View", "Owners.tsx")),
    );

    expect(code).toContain(
      "<OwnersCard<MessageQueueOwnerUser, MessageQueueOwnerTeam>",
    );
    expect(code).toContain('resourceIdField="messageQueueId"');
    expect(code).toContain('resourceDisplayName="queue"');
  });

  test("the view layout guards on the queue identifier and refreshes its header", () => {
    const code: string = squash(
      stripComments(readSource("Pages", "MessageQueue", "View", "Layout.tsx")),
    );

    expect(code).toContain("select: { _id: true, queueIdentifier: true }");
    expect(code).toContain("setIsMissing(!isMessageQueueFound(item));");
    expect(code).toContain(
      "<ErrorMessage message={MESSAGE_QUEUE_NOT_FOUND_MESSAGE} />",
    );
    expect(code).toContain("refreshToken={headerRefreshToken}");
    expect(code).toContain('modelNameField="name"');
  });

  test("the Documentation tab renders the queue's own guide through ResourceDocumentationCard", () => {
    const code: string = squash(
      stripComments(
        readSource("Pages", "MessageQueue", "View", "Documentation.tsx"),
      ),
    );

    expect(code).toContain("<ResourceDocumentationCard");
    expect(code).toContain(
      "getMessageQueueDocumentationMarkdown(vars, target)",
    );
    for (const column of [
      "messagingSystem: true",
      "destinationName: true",
      "brokerScope: true",
      "brokerAddress: true",
      "queueIdentifier: true",
    ]) {
      expect(code).toContain(column);
    }
  });

  test("the guides render markdown only through the lazy viewer", () => {
    for (const file of [
      ["Pages", "MessageQueue", "Utils", "MessageQueueDocumentationCard.tsx"],
      ["Pages", "MessageQueue", "View", "Documentation.tsx"],
      ["Pages", "MessageQueue", "Documentation.tsx"],
      ["Pages", "MessageQueue", "MessageQueues.tsx"],
    ]) {
      const source: string = readSource(...file);
      expect(source).not.toMatch(/Markdown\.tsx\/MarkdownViewer/);
    }
  });

  test("the pages use message-queue prefixed table and preference keys", () => {
    expect(readSource("Pages", "MessageQueue", "MessageQueues.tsx")).toContain(
      'userPreferencesKey="message-queues-table"',
    );
    expect(readSource("Pages", "MessageQueue", "Archived.tsx")).toContain(
      'userPreferencesKey="message-queues-archived-table"',
    );
    expect(
      readSource("Pages", "MessageQueue", "Settings", "LabelRules.tsx"),
    ).toContain('userPreferencesKey="message-queue-label-rules-table"');
    expect(
      readSource("Pages", "MessageQueue", "Settings", "OwnerRules.tsx"),
    ).toContain('userPreferencesKey="message-queue-owner-rules-table"');
  });
});

describe("no other product's concepts leaked into the Queues scaffold", () => {
  /*
   * The pages this track owns (the Overview / Traces / Metrics tabs and
   * Components/MessageQueue are another's). Copied from the Databases
   * product, so a leftover identifier would point a Queues page at a
   * database.
   */
  const SCAFFOLD_FILES: ReadonlyArray<Array<string>> = [
    ["Pages", "MessageQueue", "Layout.tsx"],
    ["Pages", "MessageQueue", "SideMenu.tsx"],
    ["Pages", "MessageQueue", "MessageQueues.tsx"],
    ["Pages", "MessageQueue", "Archived.tsx"],
    ["Pages", "MessageQueue", "Documentation.tsx"],
    ["Pages", "MessageQueue", "Settings", "LabelRules.tsx"],
    ["Pages", "MessageQueue", "Settings", "OwnerRules.tsx"],
    ["Pages", "MessageQueue", "View", "Layout.tsx"],
    ["Pages", "MessageQueue", "View", "SideMenu.tsx"],
    ["Pages", "MessageQueue", "View", "Owners.tsx"],
    ["Pages", "MessageQueue", "View", "Settings.tsx"],
    ["Pages", "MessageQueue", "View", "Delete.tsx"],
    ["Pages", "MessageQueue", "View", "Documentation.tsx"],
    ["Pages", "MessageQueue", "Utils", "DocumentationMarkdown.ts"],
    ["Pages", "MessageQueue", "Utils", "MessageQueuePresentation.ts"],
    ["Pages", "MessageQueue", "Utils", "MessageQueueViewOutletContext.ts"],
    ["Pages", "MessageQueue", "Utils", "MessageQueueDocumentationCard.tsx"],
    ["Routes", "MessageQueueRoutes.tsx"],
    ["Utils", "Breadcrumbs", "MessageQueueBreadcrumbs.ts"],
  ];

  test.each(
    SCAFFOLD_FILES.map((segments: Array<string>): string => {
      return segments.join("/");
    }),
  )("%s carries no Database / Serverless identifiers", (file: string) => {
    const code: string = stripComments(readSource(...file.split("/")));

    for (const forbidden of [
      "DatabaseServer",
      "DATABASE_",
      "dbSystem",
      "getDatabase",
      "ServerlessFunction",
      "SERVERLESS_",
      "database-",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});
