import { beforeAll, describe, expect, test } from "@jest/globals";
import GoogleSecOpsConnection from "Common/Models/DatabaseModels/GoogleSecOpsConnection";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "Common/Types/SecurityEvent/GoogleSecOpsRegion";
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
 *     side-menu item, a breadcrumb) plus the Layout's side-menu wiring.
 *     Every one of them fails SILENTLY: a renamed segment leaves a broken
 *     Connections link or an empty breadcrumb trail, and nothing looks
 *     wrong on screen until someone tries to navigate there.
 *
 *  2. The content. lastPolledAt and lastError have to stay accessible,
 *     with "Never" on Last Polled and a View Error action for failures,
 *     because their absence from the product is the whole reason this
 *     ticket happened. And the docs have to keep
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

/* Matches the `field: { columnName: true }` head of a form field / column. */
const FIELD_HEAD_PATTERN: RegExp = /field:\s*\{\s*(\w+):\s*true/g;
/* Matches `title: "..."` inside a single extracted entry. */
const TITLE_PATTERN: RegExp = /title:\s*"([^"]*)"/;
/* Matches `stepId: "..."` inside a single extracted form field. */
const STEP_ID_PATTERN: RegExp = /stepId:\s*"([^"]+)"/;
/* Matches the simple `{ title, id }` entries in the formSteps array. */
const FORM_STEP_PATTERN: RegExp =
  /\{\s*title:\s*"([^"]+)",\s*id:\s*"([^"]+)"\s*,?\s*\}/g;
/* Fields fetched for row actions even when they are not visible columns. */
const SELECT_MORE_FIELDS_PATTERN: RegExp =
  /selectMoreFields=\{\{([\s\S]*?)\}\}/;
const LAST_ERROR_SELECTION_PATTERN: RegExp = /\blastError:\s*true/;
/* The model defaults mirrored by ModelTable's create form. */
const CREATE_INITIAL_VALUES_PATTERN: RegExp =
  /createInitialValues=\{\{([\s\S]*?)\}\}/;
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

/*
 * Pin Google's published endpoint prefixes independently of the shared
 * constant. The page and server deliberately consume one shared list, while
 * this test remains capable of catching a truncated or accidentally broadened
 * list in that source of truth.
 */
const DOCUMENTED_GOOGLE_SECOPS_REGIONS: Array<string> = [
  "us",
  "eu",
  "europe",
  "africa-south1",
  "asia-east1",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
  "europe-central2",
  "europe-west12",
  "europe-west2",
  "europe-west3",
  "europe-west6",
  "europe-west9",
  "me-central1",
  "me-central2",
  "me-west1",
  "northamerica-northeast2",
  "southamerica-east1",
];

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
const sideMenuSource: string = readDashboardSource(
  "Pages",
  "SecurityEvents",
  "SideMenu.tsx",
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

interface FormStep {
  title: string;
  id: string;
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

function stepIdOf(entry: FieldEntry): string {
  const match: RegExpMatchArray | null = STEP_ID_PATTERN.exec(entry.body);

  if (!match) {
    throw new Error(`Form field "${entry.columnName}" has no stepId`);
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

/*
 * Isolate one self-closing control before checking attributes. Source-wide
 * assertions could borrow `disabled`, `value` or `onChange` from the other
 * checkbox and let the two controls silently swap their semantics.
 */
function extractControlByTestId(source: string, dataTestId: string): string {
  const marker: string = `dataTestId="${dataTestId}"`;
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`No control with dataTestId "${dataTestId}"`);
  }

  const start: number = source.lastIndexOf("<CheckboxElement", markerIndex);
  const end: number = source.indexOf("/>", markerIndex);

  if (start === -1 || end === -1) {
    throw new Error(`Unbalanced CheckboxElement for "${dataTestId}"`);
  }

  return source.slice(start, end + 2);
}

const formFieldEntries: Array<FieldEntry> = splitFieldEntries(
  extractArrayProp(connectionsPageSource, "formFields"),
);
const formSteps: Array<FormStep> = Array.from(
  extractArrayProp(connectionsPageSource, "formSteps").matchAll(
    FORM_STEP_PATTERN,
  ),
).map((match: RegExpMatchArray): FormStep => {
  return {
    title: match[1] as string,
    id: match[2] as string,
  };
});
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

  test("the page is in the Integrations side-menu section", () => {
    expect(sideMenuSource).toContain('title: "Integrations"');
    expect(sideMenuSource).toContain('title: "Connections"');
    expect(sideMenuSource).toContain(
      "RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route",
    );
  });

  test("the layout renders the Security Events side menu", () => {
    expect(layoutSource).toContain('import SideMenu from "./SideMenu"');
    expect(layoutSource).toContain("sideMenu={<SideMenu />}");
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
  test("polling attempts stay visible while errors move to row actions", () => {
    expect(columnNames).toContain("lastPolledAt");
    expect(columnNames).not.toContain("lastError");

    expect(titleOf(getEntry(columnEntries, "lastPolledAt"))).toBe(
      "Last Polled",
    );
    expect(actionButtonsBlock).toContain('title: "View Error"');
  });

  test("the row action can fetch the error without a Last Error column", () => {
    const selectedFields: RegExpMatchArray | null =
      SELECT_MORE_FIELDS_PATTERN.exec(connectionsPageSource);

    expect(selectedFields).not.toBeNull();
    expect(selectedFields![1]).toMatch(LAST_ERROR_SELECTION_PATTERN);
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

  test("Region is a required dropdown backed by the shared endpoint allowlist", () => {
    const regionField: FieldEntry = getEntry(formFieldEntries, "region");

    expect(regionField.body).toContain(
      "fieldType: FormFieldSchemaType.Dropdown",
    );
    expect(regionField.body).not.toContain(
      "fieldType: FormFieldSchemaType.Text",
    );
    expect(regionField.body).toContain("required: true");
    expect(regionField.body).toContain(
      "dropdownOptions: googleSecOpsRegionOptions",
    );
    expect(regionField.body).toContain('placeholder: "Select a region"');

    expect(connectionsPageSource).toContain(
      'import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "Common/Types/SecurityEvent/GoogleSecOpsRegion"',
    );
    expect(connectionsPageSource).toContain(
      "GOOGLE_SECOPS_SUPPORTED_REGIONS.map",
    );
    expect(connectionsPageSource).toContain("value: region");
    expect(connectionsPageSource).toContain("label: region");

    expect([...GOOGLE_SECOPS_SUPPORTED_REGIONS]).toEqual(
      DOCUMENTED_GOOGLE_SECOPS_REGIONS,
    );
    expect(new Set(GOOGLE_SECOPS_SUPPORTED_REGIONS).size).toBe(
      GOOGLE_SECOPS_SUPPORTED_REGIONS.length,
    );
  });

  test("Alerts are fixed while Detections controls the persisted scope", () => {
    const scopeField: FieldEntry = getEntry(
      formFieldEntries,
      "includeNonAlertingDetections",
    );

    expect(titleOf(scopeField)).toBe("Data to import");
    expect(scopeField.body).toContain(
      "fieldType: FormFieldSchemaType.CustomComponent",
    );
    expect(scopeField.body).not.toContain(
      "fieldType: FormFieldSchemaType.Toggle",
    );
    expect(scopeField.body).toContain("getCustomElement:");
    expect(scopeField.body).toContain('aria-label="Data to import"');
    expect(scopeField.body).toContain('role="group"');
    expect(scopeField.body).toContain(
      "values.includeNonAlertingDetections === true",
    );

    const alertsCheckbox: string = extractControlByTestId(
      scopeField.body,
      "google-secops-alerts-checkbox",
    );
    expect(alertsCheckbox).toContain('ariaLabel="Alerts"');
    expect(alertsCheckbox).toContain("disabled={true}");
    expect(alertsCheckbox).toContain("readOnly={true}");
    expect(alertsCheckbox).toContain("initialValue={true}");
    expect(alertsCheckbox).toContain("value={true}");

    const detectionsCheckbox: string = extractControlByTestId(
      scopeField.body,
      "google-secops-detections-checkbox",
    );
    expect(detectionsCheckbox).toContain('ariaLabel="Detections"');
    expect(detectionsCheckbox).not.toContain("disabled=");
    expect(detectionsCheckbox).not.toContain("readOnly=");
    expect(detectionsCheckbox).toContain(
      "initialValue={includeNonAlertingDetections}",
    );
    expect(detectionsCheckbox).toContain(
      "value={includeNonAlertingDetections}",
    );
    expect(detectionsCheckbox).toContain("fieldProps.onChange?.(value)");
  });

  test("new connections retain alerts-only as their explicit default", () => {
    const initialValues: RegExpMatchArray | null =
      CREATE_INITIAL_VALUES_PATTERN.exec(connectionsPageSource);

    expect(initialValues).not.toBeNull();
    expect(initialValues![1]).toContain("includeNonAlertingDetections: false");
  });

  test("the form has the exact ordered Google SecOps workflow", () => {
    expect(formSteps).toEqual([
      { title: "Basic Info", id: "basic-info" },
      { title: "Google SecOps", id: "google-secops" },
      { title: "Polling", id: "polling" },
    ]);
  });

  test("every form step id is unique", () => {
    const stepIds: Array<string> = formSteps.map((step: FormStep) => {
      return step.id;
    });

    expect(new Set(stepIds).size).toBe(stepIds.length);
  });

  test("every form field is assigned to its exact workflow step", () => {
    expect(
      formFieldEntries.map((entry: FieldEntry) => {
        return { field: entry.columnName, stepId: stepIdOf(entry) };
      }),
    ).toEqual([
      { field: "name", stepId: "basic-info" },
      { field: "region", stepId: "google-secops" },
      { field: "instanceResourceName", stepId: "google-secops" },
      { field: "serviceAccountJson", stepId: "google-secops" },
      { field: "includeNonAlertingDetections", stepId: "polling" },
      { field: "isEnabled", stepId: "basic-info" },
      { field: "pollIntervalInMinutes", stepId: "polling" },
    ]);
  });

  test("every field uses a declared step and every step contains fields", () => {
    const declaredStepIds: Set<string> = new Set(
      formSteps.map((step: FormStep) => {
        return step.id;
      }),
    );
    const assignedStepIds: Array<string> = formFieldEntries.map(stepIdOf);

    for (const assignedStepId of assignedStepIds) {
      expect(declaredStepIds.has(assignedStepId)).toBe(true);
    }

    for (const declaredStepId of declaredStepIds) {
      expect(assignedStepIds).toContain(declaredStepId);
    }
  });

  test("the Google SecOps step remains usable when credentials are hidden on edit", () => {
    const serviceAccountField: FieldEntry = getEntry(
      formFieldEntries,
      "serviceAccountJson",
    );

    expect(stepIdOf(serviceAccountField)).toBe("google-secops");
    expect(serviceAccountField.body).toContain("doNotShowWhenEditing: true");

    const visibleConnectionFields: Array<string> = formFieldEntries
      .filter((entry: FieldEntry) => {
        return (
          stepIdOf(entry) === "google-secops" &&
          !entry.body.includes("doNotShowWhenEditing: true")
        );
      })
      .map((entry: FieldEntry) => {
        return entry.columnName;
      });

    expect(visibleConnectionFields).toEqual(["region", "instanceResourceName"]);
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

  test("the docs direct readers to View Error in Actions instead of a table column", () => {
    const columnSummary: string = docsSource
      .slice(docsSource.indexOf("The connections list shows "))
      .split("\n")[0] as string;

    expect(columnSummary).not.toContain("**Last Error**");
    expect(columnSummary).toContain("When a connection has an error");
    expect(columnSummary).toContain("**View Error**");
    expect(columnSummary).toContain("**Actions** column");
    expect(docsSource).not.toContain("**View Full Error**");
    expect(docsSource).not.toContain("The table shows a short preview");
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
