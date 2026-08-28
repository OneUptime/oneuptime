import { beforeAll, describe, expect, test } from "@jest/globals";
import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import fs from "fs";
import nodePath from "path";

/*
 * Security Events > Connections is the page that finally puts a Google
 * SecOps connector's poll health in the product.
 *
 * It exists because of an outage where it did not. A customer's connector
 * stopped polling and their GoogleSecOpsConnection row sat at
 * lastPolledAt = null, lastError = null for hours: the poller's own
 * error-recording write overflowed lastError's varchar(500) and threw, so
 * the two columns that were supposed to explain the outage were exactly
 * the ones the outage prevented from being written. Nobody could see
 * either field from the dashboard at all, so the only way to read them was
 * a raw SQL query against the customer's database.
 *
 * So two separate things are pinned here:
 *
 *  1. The wiring. Reaching the page at all takes six hand-written
 *     couplings (a PageMap key, a SecurityEventsRoutePath segment, an
 *     absolute RouteMap Route, a PageRoute in SecurityEventsRoutes.tsx, a
 *     nav tab, a breadcrumb) plus the Layout's ordered if-chain that
 *     decides which tab lights up. Every one of them fails SILENTLY: a
 *     renamed segment leaves the Events tab lit on the Connections page,
 *     or the breadcrumb trail empty, and nothing looks wrong on screen.
 *
 *  2. The content. lastPolledAt and lastError have to stay on the table,
 *     with "Never" on Last Polled, because their absence from the product
 *     is the whole reason this ticket happened. And the docs have to keep
 *     describing the page that actually shipped — they previously told the
 *     reader to open a "Security Events -> Google SecOps Connections" nav
 *     entry that never existed.
 *
 * Same deferred-import + browser-stub shape as
 * App/Tests/Dashboard/SecurityEventsSetupGuide.test.ts: Common/UI/Config
 * reads `window` at module load and RouteMap pulls it in transitively.
 * The .tsx sources are read as text rather than imported, because react is
 * a Dashboard dependency that App's own install never provides.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");
type Route = InstanceType<(typeof import("Common/Types/API/Route"))["default"]>;
type Link = import("Common/Types/Link").default;

let RouteMap: RouteMapModule["default"];
let RouteUtil: RouteMapModule["RouteUtil"];
let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];
let getSecurityEventsBreadcrumbs: (path: string) => Array<Link> | undefined;
let setNavigationLocation: (pathname: string) => void;

/*
 * Read as constants rather than inline literals: eslint's wrap-regex wants
 * an inline regex parenthesised and prettier wants the parentheses gone,
 * and the two rules fight forever over the same line.
 */

/* Matches `if (path.includes("...")) { return "..."; }` in source order. */
const TAB_RULE_PATTERN: RegExp =
  /path\.includes\(\s*"([^"]+)"\s*\)\s*\)\s*\{\s*return\s+"([^"]+)"/g;
/* Matches the `field: { columnName: true }` head of a form field / column. */
const FIELD_HEAD_PATTERN: RegExp = /field:\s*\{\s*(\w+):\s*true/g;
/* Matches `title: "..."` inside a single extracted entry. */
const TITLE_PATTERN: RegExp = /title:\s*"([^"]*)"/;
/* Matches the page import in SecurityEventsRoutes.tsx. */
const CONNECTIONS_PAGE_IMPORT_PATTERN: RegExp =
  /import\s+(\w+)\s+from\s+"\.\.\/Pages\/SecurityEvents\/GoogleSecOpsConnections"/;
/* Matches a backticked absolute dashboard path in the markdown docs. */
const DOC_DASHBOARD_PATH_PATTERN: RegExp =
  /`(\/dashboard\/[^`]*security-events[^`]*)`/g;
/* Matches `DISABLE_QUEUE_WORKERS=<value>` as an assignment, not in prose. */
const DISABLE_QUEUE_WORKERS_PATTERN: RegExp =
  /^DISABLE_QUEUE_WORKERS=(\S*)\s*$/m;
/* Matches the top-level `worker:` block opener in the Helm values file. */
const HELM_WORKER_BLOCK_PATTERN: RegExp = /^worker:\s*$/m;
/* Matches `  enabled: <value>` two spaces deep inside a Helm block. */
const HELM_ENABLED_PATTERN: RegExp = /^ {2}enabled:\s*(\S+)\s*$/m;
/* Matches the start of the next top-level key in the Helm values file. */
const HELM_TOP_LEVEL_PATTERN: RegExp = /^[A-Za-z_]/m;

const REPO_ROOT: string = nodePath.join(__dirname, "..", "..", "..");

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readDashboardSource(...relativeParts: Array<string>): string {
  return fs.readFileSync(
    nodePath.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );
}

const connectionsPageSource: string = readDashboardSource(
  "Pages",
  "SecurityEvents",
  "GoogleSecOpsConnections.tsx",
);
const navTabsSource: string = readDashboardSource(
  "Components",
  "SecurityEvents",
  "SecurityEventsNavTabs.tsx",
);
const layoutSource: string = readDashboardSource(
  "Pages",
  "SecurityEvents",
  "Layout.tsx",
);
const routesSource: string = readDashboardSource(
  "Routes",
  "SecurityEventsRoutes.tsx",
);
const docsSource: string = fs.readFileSync(
  nodePath.join(
    __dirname,
    "../../FeatureSet/Docs/Content/en/integrations/google-secops.md",
  ),
  "utf8",
);
const configExampleEnv: string = fs.readFileSync(
  nodePath.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const helmValuesYaml: string = fs.readFileSync(
  nodePath.join(REPO_ROOT, "HelmChart/Public/oneuptime/values.yaml"),
  "utf8",
);

/*
 * Pull a JSX array prop (`columns={[ ... ]}`) out of the page text by
 * bracket depth. Reading the props as text is deliberate — see the header
 * comment — but a naive `indexOf("]}")` would stop at the first nested
 * array, so count instead.
 */
function extractArrayProp(source: string, propName: string): string {
  const marker: string = `${propName}={[`;
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      `GoogleSecOpsConnections.tsx has no "${propName}" array prop`,
    );
  }

  const arrayStart: number = source.indexOf("[", markerIndex);
  let depth: number = 0;

  for (let index: number = arrayStart; index < source.length; index++) {
    const character: string = source[index] as string;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;

      if (depth === 0) {
        return source.slice(arrayStart, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced brackets in the "${propName}" array prop`);
}

interface FieldEntry {
  columnName: string;
  body: string;
}

/*
 * Split a formFields/columns array into one entry per column, so an
 * assertion about `noValueMessage` or `doNotShowWhenEditing` is anchored
 * to the field it belongs to rather than to the file as a whole.
 */
function splitFieldEntries(arrayBlock: string): Array<FieldEntry> {
  const heads: Array<RegExpMatchArray> = Array.from(
    arrayBlock.matchAll(FIELD_HEAD_PATTERN),
  );

  return heads.map((head: RegExpMatchArray, index: number): FieldEntry => {
    const start: number = head.index as number;
    const next: RegExpMatchArray | undefined = heads[index + 1];
    const end: number = next ? (next.index as number) : arrayBlock.length;

    return {
      columnName: head[1] as string,
      body: arrayBlock.slice(start, end),
    };
  });
}

function titleOf(entry: FieldEntry): string {
  const match: RegExpMatchArray | null = TITLE_PATTERN.exec(entry.body);

  if (!match) {
    throw new Error(`Column "${entry.columnName}" has no title`);
  }

  return match[1] as string;
}

function getEntry(entries: Array<FieldEntry>, columnName: string): FieldEntry {
  const entry: FieldEntry | undefined = entries.find(
    (candidate: FieldEntry) => {
      return candidate.columnName === columnName;
    },
  );

  if (!entry) {
    throw new Error(`No entry for column "${columnName}"`);
  }

  return entry;
}

const formFieldEntries: Array<FieldEntry> = splitFieldEntries(
  extractArrayProp(connectionsPageSource, "formFields"),
);
const columnEntries: Array<FieldEntry> = splitFieldEntries(
  extractArrayProp(connectionsPageSource, "columns"),
);
const actionButtonsBlock: string = extractArrayProp(
  connectionsPageSource,
  "actionButtons",
);

const formFieldColumnNames: Array<string> = formFieldEntries.map(
  (entry: FieldEntry) => {
    return entry.columnName;
  },
);
const columnNames: Array<string> = columnEntries.map((entry: FieldEntry) => {
  return entry.columnName;
});

const connectionModel: GoogleSecOpsConnection = new GoogleSecOpsConnection();
const accessControl: Dictionary<ColumnAccessControl> =
  connectionModel.getColumnAccessControlForAllColumns();

interface TabRule {
  literal: string;
  tab: string;
}

/*
 * The Layout decides the active tab with an ordered if-chain of substring
 * matches, so the answer depends on which rule comes FIRST. Replay the
 * chain in source order rather than asserting the individual literals.
 */
const tabRules: Array<TabRule> = Array.from(
  layoutSource.matchAll(TAB_RULE_PATTERN),
).map((match: RegExpMatchArray): TabRule => {
  return { literal: match[1] as string, tab: match[2] as string };
});

function activeTabFor(path: string): string {
  for (const rule of tabRules) {
    if (path.includes(rule.literal)) {
      return rule.tab;
    }
  }

  // The chain's fall-through, asserted separately below.
  return "events";
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  /*
   * Node 26 ships real sessionStorage/localStorage globals and plain
   * assignment over them throws inside jest's vm context; defining the
   * property works on every version.
   */
  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/RouteMap"
  );

  RouteMap = routeMapModule.default;
  RouteUtil = routeMapModule.RouteUtil;
  SecurityEventsRoutePath = routeMapModule.SecurityEventsRoutePath;
  PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
    .default;
  RouteParams = (
    await import("../../FeatureSet/Dashboard/src/Utils/RouteParams")
  ).default;
  getSecurityEventsBreadcrumbs = (
    await import(
      "../../FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs"
    )
  ).getSecurityEventsBreadcrumbs;

  /*
   * The breadcrumb resolver walks the LIVE location to build ancestor
   * links, so a trail can only be produced with a concrete URL in place.
   */
  const Navigation: typeof import("Common/UI/Utils/Navigation").default = (
    await import("Common/UI/Utils/Navigation")
  ).default;

  setNavigationLocation = (pathname: string): void => {
    Navigation.setLocation({
      pathname: pathname,
      search: "",
      hash: "",
      state: null,
      key: "test",
    });
  };
});

describe("Security events connections page wiring", () => {
  test("the page key exists and has a route path segment", () => {
    expect(PageMap.SECURITY_EVENTS_CONNECTIONS).toBeTruthy();
    expect(SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_CONNECTIONS]).toBe(
      "connections",
    );
  });

  test("the key resolves to an absolute route under security-events", () => {
    const route: Route | undefined =
      RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS];

    expect(route).toBeDefined();
    expect(route!.toString()).toBe(
      `/dashboard/${RouteParams.ProjectID}/security-events/connections`,
    );
  });

  test("the route is registered in SecurityEventsRoutes", () => {
    /*
     * Derive the imported identifier instead of hardcoding it: the point
     * is that the PageRoute renders the component this file imports, not
     * that either happens to be spelled a particular way.
     */
    const importMatch: RegExpMatchArray | null =
      CONNECTIONS_PAGE_IMPORT_PATTERN.exec(routesSource);

    expect(importMatch).not.toBeNull();

    const componentName: string = importMatch![1] as string;

    // The import has to point at a file that is actually on disk.
    expect(
      fs.existsSync(
        nodePath.join(
          DASHBOARD_SRC,
          "Pages",
          "SecurityEvents",
          "GoogleSecOpsConnections.tsx",
        ),
      ),
    ).toBe(true);

    const registration: string | undefined = routesSource
      .split("<PageRoute")
      .find((block: string) => {
        return block.includes(
          "SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_CONNECTIONS]",
        );
      });

    expect(registration).toBeDefined();
    expect(registration).toContain(`<${componentName}`);
    expect(registration).toContain(
      "RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route",
    );
  });

  test("the page has a nav tab pointing at the connections route", () => {
    expect(navTabsSource).toContain('key: "connections"');
    expect(navTabsSource).toContain('label: "Connections"');
    expect(navTabsSource).toContain(
      "RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route",
    );
  });

  /*
   * The tab key is a union type, so a tab whose key is not a member of it
   * is a compile error rather than a silent failure - but the union is
   * edited by hand in the same file, so pin the membership too.
   */
  test('"connections" is a member of the SecurityEventsTabKey union', () => {
    const unionBlock: string = navTabsSource.slice(
      navTabsSource.indexOf("export type SecurityEventsTabKey"),
      navTabsSource.indexOf(
        ";",
        navTabsSource.indexOf("export type SecurityEventsTabKey"),
      ),
    );

    expect(unionBlock).toContain('"connections"');
  });

  /*
   * The layout highlights a tab by substring-matching the live path. A
   * renamed route segment would leave the Connections page open with the
   * Events tab lit, so the literal it matches has to stay a suffix of the
   * real route.
   */
  test("the layout's active-tab match follows the real route", () => {
    const route: string =
      RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS]!.toString();

    const connectionsRule: TabRule | undefined = tabRules.find(
      (rule: TabRule) => {
        return rule.tab === "connections";
      },
    );

    expect(connectionsRule).toBeDefined();
    expect(connectionsRule!.literal).toBe("/security-events/connections");
    expect(route.endsWith(connectionsRule!.literal)).toBe(true);
    expect(activeTabFor(route)).toBe("connections");
  });

  test("the page has a breadcrumb trail", () => {
    const pattern: string = RouteUtil.getRouteString(
      PageMap.SECURITY_EVENTS_CONNECTIONS,
    );

    setNavigationLocation(pattern.replace(RouteParams.ProjectID, "proj-1"));

    const trail: Array<Link> | undefined =
      getSecurityEventsBreadcrumbs(pattern);

    expect(trail).toBeDefined();
    expect(
      trail!.map((link: Link) => {
        return link.title;
      }),
    ).toEqual(["Project", "Security Events", "Connections"]);
  });
});

describe("Security events connections route shape", () => {
  test('the "connections" segment is unique among security events routes', () => {
    const segments: Array<string> = Object.keys(SecurityEventsRoutePath).map(
      (key: string) => {
        return SecurityEventsRoutePath[key] as string;
      },
    );

    const connectionsSegments: Array<string> = segments.filter(
      (segment: string) => {
        return segment === "connections";
      },
    );

    // Two keys mapping to the same segment would make one page unreachable.
    expect(connectionsSegments).toEqual(["connections"]);
  });

  /*
   * getActiveSecurityEventsTab matches substrings in a fixed order, so a
   * future segment that CONTAINS "/security-events/connections" (say
   * "connections/history") placed after it in the chain would render with
   * the Connections tab lit. Replay the real chain over every real route.
   */
  test("the ordered if-chain cannot mis-match connections against another route", () => {
    expect(tabRules.length).toBeGreaterThan(0);

    const resolved: Dictionary<string> = {};

    for (const key of Object.keys(SecurityEventsRoutePath)) {
      resolved[key] = activeTabFor(RouteUtil.getRouteString(key));
    }

    for (const key of Object.keys(resolved)) {
      if (key === PageMap.SECURITY_EVENTS_CONNECTIONS) {
        expect(resolved[key]).toBe("connections");
      } else {
        // No other Security Events route may light the Connections tab.
        expect(resolved[key]).not.toBe("connections");
      }
    }

    // And the bare product route still falls through to Events.
    expect(resolved[PageMap.SECURITY_EVENTS]).toBe("events");
    expect(layoutSource).toContain('return "events"');
  });
});

describe("Security events connections page content", () => {
  test("it renders a ModelTable of GoogleSecOpsConnection", () => {
    expect(connectionsPageSource).toContain(
      'import ModelTable from "Common/UI/Components/ModelTable/ModelTable"',
    );
    expect(connectionsPageSource).toContain(
      'import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection"',
    );
    expect(connectionsPageSource).toContain(
      "<ModelTable<GoogleSecOpsConnection>",
    );
    expect(connectionsPageSource).toContain(
      "modelType={GoogleSecOpsConnection}",
    );
  });

  /*
   * The reason this ticket happened. Before this page existed there was no
   * way to see either of these fields in the product, so a connector that
   * had never polled looked identical to one polling happily and the only
   * readout was a raw SQL query against the customer's database.
   */
  test("both poller-health columns are on the table", () => {
    expect(columnNames).toContain("lastPolledAt");
    expect(columnNames).toContain("lastError");

    expect(titleOf(getEntry(columnEntries, "lastPolledAt"))).toBe(
      "Last Polled",
    );
    expect(titleOf(getEntry(columnEntries, "lastError"))).toBe("Last Error");
  });

  /*
   * A blank Last Polled cell reads as "nothing to report", i.e. healthy,
   * when it means the exact opposite: the poller has never run for this
   * connection. "Never" is the word that makes the outage legible.
   */
  test('Last Polled says "Never" rather than rendering blank', () => {
    expect(getEntry(columnEntries, "lastPolledAt").body).toContain(
      'noValueMessage: "Never"',
    );
  });

  test("the service account key is write-only on the form", () => {
    const serviceAccountField: FieldEntry = getEntry(
      formFieldEntries,
      "serviceAccountJson",
    );

    expect(serviceAccountField.body).toContain("doNotShowWhenEditing: true");
  });

  test("rotating the service account key has its own action", () => {
    expect(actionButtonsBlock).toContain(
      'title: "Update Service Account JSON"',
    );
    // The action writes through ModelAPI in a modal of its own.
    expect(connectionsPageSource).toContain("<BasicFormModal");
    expect(connectionsPageSource).toContain(
      "ModelAPI.updateById<GoogleSecOpsConnection>",
    );
  });

  /*
   * The page's write-only treatment is only correct because the MODEL says
   * so. If serviceAccountJson ever becomes readable or stops being
   * encrypted, doNotShowWhenEditing turns from a necessity into a
   * usability bug and the page should be revisited - so cross-check the
   * decorator rather than trusting the page's comment about it.
   */
  test("the model really does declare serviceAccountJson unreadable and encrypted", () => {
    const control: ColumnAccessControl = accessControl[
      "serviceAccountJson"
    ] as ColumnAccessControl;

    expect(control).toBeDefined();
    expect(control.read).toEqual([]);
    expect(
      connectionModel.getTableColumnMetadata("serviceAccountJson").encrypted,
    ).toBe(true);
    // Rotation has to remain legal, or the action button is a dead end.
    expect(control.update.length).toBeGreaterThan(0);
  });

  /*
   * Poller-owned columns have create: [] and update: [], so a form field
   * for one would be stripped or 403 on submit - a form control that
   * silently never saves. Derived from the model's own ColumnAccessControl
   * so a newly added poller-owned column is covered the day it lands.
   */
  test("no poller-owned column is offered as a form field", () => {
    const readOnlyColumns: Array<string> = Object.keys(accessControl).filter(
      (columnName: string) => {
        const control: ColumnAccessControl = accessControl[
          columnName
        ] as ColumnAccessControl;

        return control.create.length === 0 && control.update.length === 0;
      },
    );

    // Sanity: the derivation actually catches the three we know about.
    expect(readOnlyColumns).toEqual(
      expect.arrayContaining(["lastPolledAt", "lastError", "cursor"]),
    );

    for (const columnName of readOnlyColumns) {
      expect(formFieldColumnNames).not.toContain(columnName);
    }

    // The user-owned columns are still offered, so this is not vacuous.
    expect(formFieldColumnNames).toEqual(
      expect.arrayContaining([
        "name",
        "region",
        "instanceResourceName",
        "serviceAccountJson",
        "isEnabled",
        "pollIntervalInMinutes",
      ]),
    );
  });
});

describe("Google SecOps integration docs", () => {
  /*
   * The docs were the other half of this failure: they sent the reader to
   * "Security Events -> Google SecOps Connections", a nav entry that never
   * existed, so the health fields looked unreachable even in principle.
   */
  test("the docs name the nav path that actually ships", () => {
    expect(docsSource).toContain("**Security Events → Connections**");
    expect(docsSource).not.toContain(
      "Security Events → Google SecOps Connections",
    );
  });

  /*
   * The docs print an absolute URL. Compare it against the resolved route
   * with only the project-id parameter allowed to differ - the docs write
   * it as {projectId} where RouteMap uses :projectId.
   */
  test("the absolute route the docs print is the real route", () => {
    const docPaths: Array<string> = Array.from(
      docsSource.matchAll(DOC_DASHBOARD_PATH_PATTERN),
    ).map((match: RegExpMatchArray) => {
      return (match[1] as string).replace("{projectId}", RouteParams.ProjectID);
    });

    expect(docPaths.length).toBeGreaterThan(0);

    const realRoutes: Array<string> = Object.keys(SecurityEventsRoutePath).map(
      (key: string) => {
        return RouteUtil.getRouteString(key);
      },
    );

    for (const docPath of docPaths) {
      expect(realRoutes).toContain(docPath);
    }

    expect(docPaths).toContain(
      RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS]!.toString(),
    );
  });

  /*
   * The docs promise a specific health readout by column title. Read the
   * titles off the page rather than restating them, so a renamed or
   * dropped column fails here instead of quietly making the docs wrong.
   */
  test("every column the docs promise is on the page", () => {
    const titles: Array<string> = columnEntries.map(titleOf);

    expect(titles.length).toBeGreaterThan(0);

    for (const title of titles) {
      expect(docsSource).toContain(`**${title}**`);
    }

    // And the rotate action the docs point at is the button's real title.
    expect(docsSource).toContain("**Update Service Account JSON**");
  });

  /*
   * The "Last Polled is Never and Last Error is empty" troubleshooting
   * step - the exact symptom in this ticket - tells the reader what the
   * shipped defaults are. Those claims are only useful while they match
   * the files they describe, so read the files.
   */
  test("the DISABLE_QUEUE_WORKERS guidance matches config.example.env", () => {
    const shipped: RegExpMatchArray | null =
      DISABLE_QUEUE_WORKERS_PATTERN.exec(configExampleEnv);

    expect(shipped).not.toBeNull();
    expect(shipped![1]).toBe("false");
    expect(docsSource).toContain(
      `set \`DISABLE_QUEUE_WORKERS=${shipped![1]}\``,
    );
    expect(docsSource).toContain("`config.example.env` default");
  });

  test("the Helm worker guidance matches values.yaml", () => {
    const blockStart: RegExpMatchArray | null =
      HELM_WORKER_BLOCK_PATTERN.exec(helmValuesYaml);

    expect(blockStart).not.toBeNull();

    const afterWorker: string = helmValuesYaml.slice(
      (blockStart!.index as number) + blockStart![0]!.length,
    );
    /*
     * Stop at the next top-level key, so `enabled:` can only be read from
     * the worker block itself and never borrowed from a later service.
     */
    const nextTopLevelKey: number = afterWorker.search(HELM_TOP_LEVEL_PATTERN);
    const workerBlock: string =
      nextTopLevelKey === -1
        ? afterWorker
        : afterWorker.slice(0, nextTopLevelKey);
    const enabled: RegExpMatchArray | null =
      HELM_ENABLED_PATTERN.exec(workerBlock);

    expect(enabled).not.toBeNull();
    expect(enabled![1]).toBe("false");

    // The docs tell the reader to turn it on, and say it ships off.
    expect(docsSource).toContain("`worker.enabled: true`");
    expect(docsSource).toContain(`which is \`${enabled![1]}\` by default`);
  });
});
