import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Databases product is a lazy-loaded route group like Cloud / Podman: a
 * product Layout (list, archived list, install guide, owner / label rules)
 * plus a per-database View layout with telemetry, activity and settings
 * pages. Every piece of that wiring fails silently rather than loudly:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a View page with no PageRoute is reachable from the side menu but 404s,
 *   - a locale missing the nav key falls back to the raw key string,
 *   - a page that queries telemetry without its key-set guard shows the
 *     whole project's telemetry as the database's own.
 *
 * The App suite runs in plain Node with no renderer and cannot import the
 * dashboard's route modules, so these are source-level invariants in the
 * VMwareProductWiring.test.ts style. Whitespace is squashed (or removed) so
 * Prettier can reflow without breaking them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

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

/** Every PageMap key the product is built from. */
const DATABASE_PAGE_KEYS: ReadonlyArray<string> = [
  "DATABASE_ROOT",
  "DATABASE_SERVERS",
  "DATABASE_ARCHIVED",
  "DATABASE_DOCUMENTATION",
  "DATABASE_SETTINGS_LABEL_RULES",
  "DATABASE_SETTINGS_LABEL_RULE_VIEW",
  "DATABASE_SETTINGS_OWNER_RULES",
  "DATABASE_SETTINGS_OWNER_RULE_VIEW",
  "DATABASE_SERVER_VIEW",
  "DATABASE_SERVER_VIEW_METRICS",
  "DATABASE_SERVER_VIEW_LOGS",
  "DATABASE_SERVER_VIEW_TRACES",
  "DATABASE_SERVER_VIEW_INCIDENTS",
  "DATABASE_SERVER_VIEW_ALERTS",
  "DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE",
  "DATABASE_SERVER_VIEW_FEED",
  "DATABASE_SERVER_VIEW_OWNERS",
  "DATABASE_SERVER_VIEW_ENDPOINTS",
  "DATABASE_SERVER_VIEW_SETTINGS",
  "DATABASE_SERVER_VIEW_DOCUMENTATION",
  "DATABASE_SERVER_VIEW_DELETE",
];

/** DATABASE_ROOT is the lazy-route mount (`/databases/*`), not a page. */
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> = DATABASE_PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "DATABASE_ROOT";
  },
);

/** Every View page module and the PageMap key whose PageRoute renders it. */
const VIEW_PAGES: ReadonlyArray<[string, string]> = [
  ["Overview.tsx", "DATABASE_SERVER_VIEW"],
  ["Metrics.tsx", "DATABASE_SERVER_VIEW_METRICS"],
  ["Logs.tsx", "DATABASE_SERVER_VIEW_LOGS"],
  ["Traces.tsx", "DATABASE_SERVER_VIEW_TRACES"],
  ["Incidents.tsx", "DATABASE_SERVER_VIEW_INCIDENTS"],
  ["Alerts.tsx", "DATABASE_SERVER_VIEW_ALERTS"],
  ["ScheduledMaintenance.tsx", "DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE"],
  ["Feed.tsx", "DATABASE_SERVER_VIEW_FEED"],
  ["Owners.tsx", "DATABASE_SERVER_VIEW_OWNERS"],
  ["Endpoints.tsx", "DATABASE_SERVER_VIEW_ENDPOINTS"],
  ["Settings.tsx", "DATABASE_SERVER_VIEW_SETTINGS"],
  ["Documentation.tsx", "DATABASE_SERVER_VIEW_DOCUMENTATION"],
  ["Delete.tsx", "DATABASE_SERVER_VIEW_DELETE"],
];

/** Product-level pages (rendered under Pages/Database/Layout.tsx). */
const PRODUCT_PAGES: ReadonlyArray<[Array<string>, string]> = [
  [["Databases.tsx"], "DATABASE_SERVERS"],
  [["Documentation.tsx"], "DATABASE_DOCUMENTATION"],
  [["Archived.tsx"], "DATABASE_ARCHIVED"],
  [["Settings", "OwnerRules.tsx"], "DATABASE_SETTINGS_OWNER_RULES"],
  [["Settings", "LabelRules.tsx"], "DATABASE_SETTINGS_LABEL_RULES"],
];

describe("PageMap declares the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");

  test.each(DATABASE_PAGE_KEYS)(
    "%s is declared, value === name",
    (key: string) => {
      expect(pageMap).toContain(`${key} = "${key}"`);
    },
  );

  test("every DATABASE_ key is one this suite knows about", () => {
    /*
     * A key added without a row here would escape every assertion below
     * (route, mount, breadcrumb, side menu).
     */
    const declared: Array<string> = Array.from(
      pageMap.matchAll(/^\s*(DATABASE_[A-Z_]+)\s*=\s*"/gm),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();

    expect(declared).toEqual([...DATABASE_PAGE_KEYS].sort());
  });
});

describe("RouteMap gives every page a URL under /databases", () => {
  const routeMapRaw: string = readSource("Utils", "RouteMap.ts");
  const routeMap: string = squash(routeMapRaw);

  test.each(DATABASE_PAGE_KEYS)("%s has a route", (key: string) => {
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("the product is mounted at /dashboard/:projectId/databases/*", () => {
    expect(dense(routeMapRaw)).toContain(
      "[PageMap.DATABASE_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/databases/*`,)",
    );
    expect(dense(routeMapRaw)).toContain(
      "[PageMap.DATABASE_SERVERS]:newRoute(`/dashboard/${RouteParams.ProjectID}/databases`,)",
    );
  });

  test("every routed page resolves through DatabaseRoutePath", () => {
    for (const key of NAVIGABLE_PAGE_KEYS) {
      if (key === "DATABASE_SERVERS") {
        continue;
      }
      expect(dense(routeMapRaw)).toContain(
        `[PageMap.${key}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/databases/\${DatabaseRoutePath[PageMap.${key}]}\`,)`,
      );
    }
  });

  test.each([
    ["DATABASE_SERVER_VIEW_METRICS", "metrics"],
    ["DATABASE_SERVER_VIEW_LOGS", "logs"],
    ["DATABASE_SERVER_VIEW_TRACES", "traces"],
    ["DATABASE_SERVER_VIEW_INCIDENTS", "incidents"],
    ["DATABASE_SERVER_VIEW_ALERTS", "alerts"],
    ["DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE", "scheduled-maintenance"],
    ["DATABASE_SERVER_VIEW_FEED", "feed"],
    ["DATABASE_SERVER_VIEW_OWNERS", "owners"],
    ["DATABASE_SERVER_VIEW_ENDPOINTS", "endpoints"],
    ["DATABASE_SERVER_VIEW_SETTINGS", "settings"],
    ["DATABASE_SERVER_VIEW_DOCUMENTATION", "documentation"],
    ["DATABASE_SERVER_VIEW_DELETE", "delete"],
  ])("%s is the view's /%s tab", (key: string, segment: string) => {
    expect(dense(routeMapRaw)).toContain(
      `[PageMap.${key}]:\`\${RouteParams.ModelID}/${segment}\``,
    );
  });

  test("rule view paths extend their list paths and end in the rule id", () => {
    const routePathOf: (key: string) => string = (key: string): string => {
      const match: RegExpMatchArray | null = dense(routeMapRaw).match(
        new RegExp(`\\[PageMap\\.${key}\\]:\`([^\`]*)\`,`),
      );
      expect(match).not.toBeNull();
      return match![1]!;
    };

    for (const [list, view] of [
      ["DATABASE_SETTINGS_LABEL_RULES", "DATABASE_SETTINGS_LABEL_RULE_VIEW"],
      ["DATABASE_SETTINGS_OWNER_RULES", "DATABASE_SETTINGS_OWNER_RULE_VIEW"],
    ]) {
      expect(routePathOf(view!).startsWith(`${routePathOf(list!)}/`)).toBe(
        true,
      );
      expect(routePathOf(view!)).toMatch(/\$\{RouteParams\.ModelID\}$/);
    }
  });
});

describe("every route is actually mounted", () => {
  const routesRaw: string = readSource("Routes", "DatabaseRoutes.tsx");
  const routes: string = squash(routesRaw);

  test.each(NAVIGABLE_PAGE_KEYS)(
    "%s is rendered by a PageRoute",
    (key: string) => {
      expect(dense(routesRaw)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("the database view renders the Overview by default", () => {
    expect(routes).toContain(
      "<PageRoute index element={ <DatabaseServerOverview",
    );
  });

  test("the view pages are nested under the view layout, the list under the product layout", () => {
    expect(routes).toContain("element={<DatabaseServerViewLayout");
    expect(routes).toContain("element={<DatabaseLayout");
  });

  test.each(VIEW_PAGES)(
    "Pages/Database/View/%s exists and is imported by the routes file for %s",
    (file: string, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "Database", "View", file),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/Database/View/${file.replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routesRaw)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test.each(PRODUCT_PAGES)(
    "Pages/Database/%s exists and is routed for %s",
    (segments: Array<string>, key: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "Database", ...segments),
        ),
      ).toBe(true);
      expect(routes).toContain(
        `from "../Pages/Database/${segments.join("/").replace(/\.tsx$/, "")}"`,
      );
      expect(dense(routesRaw)).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("no View page on disk is left unrouted", () => {
    const onDisk: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, "Pages", "Database", "View"))
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
      "pageRoute={RouteMap[PageMap.DATABASE_SETTINGS_LABEL_RULE_VIEW]asRoute}ruleViewModelType={DatabaseServerLabelRule}",
    );
    expect(dense(routesRaw)).toContain(
      "pageRoute={RouteMap[PageMap.DATABASE_SETTINGS_OWNER_RULE_VIEW]asRoute}ruleViewModelType={DatabaseServerOwnerRule}",
    );
  });

  test("AllRoutes exports the product", () => {
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as DatabaseRoutes } from "./DatabaseRoutes";',
    );
  });

  test("App.tsx lazy-loads the product router and mounts it at the product root", () => {
    const app: string = squash(readSource("App.tsx"));

    expect(app).toContain("RouteMap[PageMap.DATABASE_ROOT]");
    expect(app).toContain("<DatabaseRoutes {...commonPageProps} />");
    expect(dense(readSource("App.tsx"))).toContain(
      'lazy(()=>{returnimport("./Routes/DatabaseRoutes");})',
    );
  });
});

describe("every navigable page has breadcrumbs", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "DatabaseBreadcrumbs.ts"),
  );

  test.each(NAVIGABLE_PAGE_KEYS)("%s has a breadcrumb trail", (key: string) => {
    expect(breadcrumbs).toContain(`PageMap.${key},`);
  });

  test.each([
    ["DATABASE_SERVERS", ["Project", "Databases"]],
    ["DATABASE_SERVER_VIEW", ["Project", "Databases", "View Database"]],
    [
      "DATABASE_SERVER_VIEW_ENDPOINTS",
      ["Project", "Databases", "View Database", "Endpoints"],
    ],
    [
      "DATABASE_SERVER_VIEW_DELETE",
      ["Project", "Databases", "View Database", "Delete Database"],
    ],
    ["DATABASE_ARCHIVED", ["Project", "Databases", "Archived"]],
    [
      "DATABASE_SETTINGS_OWNER_RULE_VIEW",
      ["Project", "Databases", "Owner Rules", "View Rule"],
    ],
  ])("%s reads %j", (key: string, titles: Array<string>) => {
    const start: number = breadcrumbs.indexOf(`PageMap.${key},`);
    const entry: string = dense(
      breadcrumbs.slice(start, breadcrumbs.indexOf("]),", start)),
    );
    // The whole trail, in order, and nothing after its last title.
    expect(entry).toMatch(
      new RegExp(
        `\\[${dense(
          titles
            .map((title: string): string => {
              return `"${title}"`;
            })
            .join(","),
        )},?$`,
      ),
    );
  });

  test("the breadcrumb module is exported from the barrel", () => {
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      'export * from "./DatabaseBreadcrumbs";',
    );
  });

  test("both layouts read the Databases trail", () => {
    expect(readSource("Pages", "Database", "Layout.tsx")).toContain(
      "getDatabaseBreadcrumbs(path)",
    );
    expect(readSource("Pages", "Database", "View", "Layout.tsx")).toContain(
      "getDatabaseBreadcrumbs(path)",
    );
  });
});

describe("the side menus reach the whole product", () => {
  test("the product side menu links to the list, archive, docs and rules", () => {
    const sideMenu: string = dense(
      readSource("Pages", "Database", "SideMenu.tsx"),
    );

    for (const key of [
      "DATABASE_SERVERS",
      "DATABASE_ARCHIVED",
      "DATABASE_DOCUMENTATION",
      "DATABASE_SETTINGS_OWNER_RULES",
      "DATABASE_SETTINGS_LABEL_RULES",
    ]) {
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
  });

  test("the database side menu links to every view page", () => {
    const sideMenu: string = dense(
      readSource("Pages", "Database", "View", "SideMenu.tsx"),
    );

    for (const [, key] of VIEW_PAGES) {
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]asRoute`);
    }
  });

  test("the activity badges count by the databaseServers relation", () => {
    const sideMenu: string = squash(
      readSource("Pages", "Database", "View", "SideMenu.tsx"),
    );

    expect(
      sideMenu.match(/databaseServers: new Includes\(\[props\.modelId\]\)/g),
    ).toHaveLength(3);
    expect(sideMenu).not.toContain("podmanHosts");
  });
});

describe("the navbar link exists in the Resources section", () => {
  const navBarRaw: string = readSource("Utils", "NavigationItems.tsx");
  const navBar: string = squash(navBarRaw);

  function entry(): string {
    const titleIndex: number = navBar.indexOf(
      't("navbar.items.databasesTitle"',
    );
    const start: number = navBar.lastIndexOf("{", titleIndex);
    return navBar.slice(start, navBar.indexOf("},", titleIndex) + 1);
  }

  test("there is a live, translated entry", () => {
    expect(dense(navBarRaw)).toContain('t("navbar.items.databasesTitle"');
    expect(dense(navBarRaw)).toContain('t("navbar.items.databasesDescription"');
    expect(squash(stripComments(navBarRaw))).toContain(
      't("navbar.items.databasesTitle"',
    );
  });

  test("it routes to the list and carries the Database icon", () => {
    expect(entry()).toContain("RouteMap[PageMap.DATABASE_SERVERS] as Route");
    expect(entry()).toContain(
      "activeRoute: RouteMap[PageMap.DATABASE_SERVERS]",
    );
    expect(entry()).toContain("icon: IconProp.Database");
  });

  test("it is a cross-platform catalog, not an Infrastructure product", () => {
    expect(entry()).toContain("category: resourcesCategory");
    expect(entry()).not.toContain("infrastructureCategory");
  });

  test('nothing in it contains "rum" or "k8s", which must each find one product', () => {
    expect(entry().toLowerCase()).not.toContain("rum");
    expect(entry().toLowerCase()).not.toContain("k8s");
  });

  test("it answers the searches people make for database engines", () => {
    for (const keyword of ["postgres", "mysql", "redis", "mongodb"]) {
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

  test("all 17 locale files are present", () => {
    expect(localeFiles.length).toBe(17);
  });

  test.each(localeFiles)(
    "%s carries the Databases nav keys",
    (file: string) => {
      const contents: Record<string, any> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );
      const items: Record<string, string> = contents["navbar"]?.["items"] || {};

      expect(typeof items["databasesTitle"]).toBe("string");
      expect(items["databasesTitle"]!.length).toBeGreaterThan(0);
      expect(typeof items["databasesDescription"]).toBe("string");
      expect(items["databasesDescription"]!.length).toBeGreaterThan(0);

      const text: string = `${items["databasesTitle"]} ${items["databasesDescription"]}`;
      expect(text.toLowerCase()).not.toContain("rum");
      expect(text.toLowerCase()).not.toContain("k8s");
    },
  );

  test.each(localeFiles)(
    "%s keeps the Databases keys right after the Services keys",
    (file: string) => {
      const lines: Array<string> = fs
        .readFileSync(path.join(LOCALES_DIR, file), "utf8")
        .split("\n");
      const servicesIndex: number = lines.findIndex((line: string): boolean => {
        return line.includes('"servicesDescription":');
      });
      expect(servicesIndex).toBeGreaterThan(-1);
      expect(lines[servicesIndex + 1]).toContain('"databasesTitle":');
      expect(lines[servicesIndex + 2]).toContain('"databasesDescription":');
    },
  );

  test("English says Databases and no other locale reuses the English description", () => {
    const english: Record<string, any> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    );
    expect(english["navbar"]["items"]["databasesTitle"]).toBe("Databases");

    for (const file of localeFiles) {
      if (file === "en.json") {
        continue;
      }
      const contents: Record<string, any> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );
      expect(contents["navbar"]["items"]["databasesDescription"]).not.toBe(
        english["navbar"]["items"]["databasesDescription"],
      );
    }
  });

  test("the English fallback in the nav item matches en.json", () => {
    const english: Record<string, any> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    );
    const navBar: string = squash(readSource("Utils", "NavigationItems.tsx"));

    expect(navBar).toContain(
      `"navbar.items.databasesDescription", "${english["navbar"]["items"]["databasesDescription"]}"`,
    );
  });
});

describe("the chip other products render for the databaseServers relation", () => {
  test("DatabaseServerElement links to the database view", () => {
    const chip: string = squash(
      readSource("Components", "DatabaseServer", "DatabaseServerElement.tsx"),
    );

    expect(chip).toContain("RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route");
    expect(chip).toContain("props.databaseServer._id");
    expect(chip).toContain("icon={IconProp.Database}");
    expect(chip).toContain("export default DatabaseServerElement");
  });

  test("DatabaseServersElement lists them with the chip", () => {
    const list: string = squash(
      readSource("Components", "DatabaseServer", "DatabaseServersElement.tsx"),
    );

    expect(list).toContain("<DatabaseServerElement");
    expect(list).toContain('noItemsMessage="No databases."');
  });
});

describe("the install guide embeds the real agent configuration", () => {
  test("the card renders the markdown builder with the selected key", () => {
    const card: string = squash(
      readSource("Components", "DatabaseServer", "DocumentationCard.tsx"),
    );

    expect(card).toContain("const DatabaseDocumentationCard");
    expect(card).toContain("getDatabaseAgentInstallationMarkdown({");
    expect(card).toContain("getDatabaseOwnCollectorMarkdown({");
    expect(card).toContain("apiKey: apiKeyValue");
    expect(card).toContain("RouteMap[PageMap.MONITOR_CREATE] as Route");
    expect(card).toContain("export default DatabaseDocumentationCard");
  });

  test("the builder takes the configs from the generated embed, not a paraphrase", () => {
    const builder: string = readSource(
      "Pages",
      "Database",
      "Utils",
      "DocumentationMarkdown.ts",
    );

    expect(builder).toContain('from "./DatabaseAgentConfigs"');
    expect(builder).toContain("DATABASE_AGENT_CONFIGS[data.engine]");
    expect(builder).toContain("DATABASE_AGENT_DOCKER_COMPOSE");
    expect(builder).toContain("ONEUPTIME_URL=${data.oneuptimeUrl}");
    expect(builder).toContain(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}",
    );
    expect(builder).not.toContain("<YOUR_API_KEY>");
  });
});

describe("no other product's concepts leaked into the Databases pages", () => {
  const databaseDir: string = path.join(DASHBOARD_SRC, "Pages", "Database");
  const TS_FILE_PATTERN: RegExp = /\.tsx?$/;

  function walk(directory: string): Array<string> {
    const out: Array<string> = [];
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute: string = path.join(directory, item.name);
      if (item.isDirectory()) {
        out.push(...walk(absolute));
      } else if (TS_FILE_PATTERN.test(item.name)) {
        out.push(absolute);
      }
    }
    return out;
  }

  const files: Array<string> = walk(databaseDir).filter((file: string) => {
    // The generated agent-config embed is YAML, not page code.
    return !file.endsWith("DatabaseAgentConfigs.ts");
  });

  test("there are Databases page sources to scan", () => {
    expect(files.length).toBeGreaterThan(25);
  });

  test.each(
    files.map((file: string): string => {
      return path.relative(databaseDir, file);
    }),
  )("%s carries no Podman / Cloud identifiers", (relative: string) => {
    const source: string = fs.readFileSync(
      path.join(databaseDir, relative),
      "utf8",
    );

    for (const forbidden of [
      "PodmanHost",
      "podmanHosts: new Includes",
      "PODMAN_",
      "CloudResource",
      "CLOUD_",
      "cloudPlatform",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("the pages use database- prefixed table and storage keys", () => {
    expect(readSource("Pages", "Database", "Databases.tsx")).toContain(
      'userPreferencesKey="database-servers-table"',
    );
    expect(readSource("Pages", "Database", "Archived.tsx")).toContain(
      'userPreferencesKey="database-archived-table"',
    );
    expect(readSource("Pages", "Database", "View", "Endpoints.tsx")).toContain(
      'userPreferencesKey="database-server-endpoints-table"',
    );
    expect(readSource("Pages", "Database", "View", "Overview.tsx")).toContain(
      '"database-overview-auto-refresh-interval"',
    );
    expect(readSource("Pages", "Database", "View", "Logs.tsx")).toContain(
      "`database-server-logs-${modelId.toString()}`",
    );
  });
});
