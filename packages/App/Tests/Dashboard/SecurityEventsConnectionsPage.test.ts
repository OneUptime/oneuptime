import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "Common/Types/SecurityEvent/GoogleSecOpsRegion";
import fs from "fs";
import nodePath from "path";

/*
 * Security Events > Connections is the page that finally put a Google
 * SecOps connector's poll health in the product, and it is where every
 * managed connector, Google SecOps included, now lives in one list.
 *
 * It exists because of an outage where it did not. A customer's connector
 * stopped polling and their connection row sat at lastPolledAt = null,
 * lastError = null for hours: the poller's own error-recording write
 * overflowed lastError's varchar(500) and threw, so the two columns that
 * were supposed to explain the outage were exactly the ones the outage
 * prevented from being written. Nobody could see either field from the
 * dashboard at all, so the only way to read them was a raw SQL query
 * against the customer's database.
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
 *     ticket happened. Google SecOps moved from its own table and form into
 *     the shared ones, so what its form guaranteed (an explicit region pick
 *     from Google's list, a write-only key edited as JSON, Alerts fixed and
 *     Detections optional) is pinned where it now comes from: the catalog
 *     and the shared form. And the docs have to keep describing the page
 *     that actually shipped.
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
/* Fields fetched for row actions even when they are not visible columns. */
const SELECT_MORE_FIELDS_PATTERN: RegExp =
  /selectMoreFields=\{\{([\s\S]*?)\}\}/;
const LAST_ERROR_SELECTION_PATTERN: RegExp = /\blastError:\s*true/;
/* Matches the page import in SecurityEventsRoutes.tsx. */
const CONNECTIONS_PAGE_IMPORT_PATTERN: RegExp =
  /import\s+(\w+)\s+from\s+"\.\.\/Pages\/SecurityEvents\/Connections"/;
/* A catalog "json" field maps to the JSON code editor. */
const JSON_FIELD_TYPE_PATTERN: RegExp =
  /case "json":\s*return FormFieldSchemaType\.JSON;/;
/* Matches a backticked absolute dashboard path in the markdown docs. */
const DOC_DASHBOARD_PATH_PATTERN: RegExp =
  /`(\/dashboard\/[^`]*security-events[^`]*)`/g;
/* Matches a bold span in the markdown docs, capturing its text. */
const DOC_BOLD_SPAN_PATTERN: RegExp = /\*\*([^*]+)\*\*/g;
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
 * constant. The catalog and server deliberately consume one shared list,
 * while this test remains capable of catching a truncated or accidentally
 * broadened list in that source of truth.
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

const RESELLER_GATE_MESSAGE: string =
  "Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project.";

const REPO_ROOT: string = nodePath.join(__dirname, "..", "..", "..", "..");

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
  "Connections.tsx",
);
const connectionsTableSource: string = readDashboardSource(
  "Components",
  "SecurityEvents",
  "SecurityEventConnectionsTable.tsx",
);
const connectionFormSource: string = readDashboardSource(
  "Components",
  "SecurityEvents",
  "SecurityEventConnectionFormModal.tsx",
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
 * Pull a JSX array prop (`columns={[ ... ]}`) out of a source by bracket
 * depth. Reading the props as text is deliberate — see the header comment —
 * but a naive `indexOf("]}")` would stop at the first nested array, so
 * count instead.
 */
function extractArrayProp(source: string, propName: string): string {
  const marker: string = `${propName}={[`;
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`The source has no "${propName}" array prop`);
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
 * Split a columns array into one entry per column, so an assertion about
 * `noValueMessage` is anchored to the column it belongs to rather than to
 * the file as a whole.
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

/*
 * Isolate one self-closing control before checking attributes. Source-wide
 * assertions could borrow `disabled`, `value` or `onChange` from the other
 * checkbox and let the two controls silently swap their semantics.
 */
function extractCheckboxByMarker(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`No control marked "${marker}"`);
  }

  const start: number = source.lastIndexOf("<CheckboxElement", markerIndex);
  const end: number = source.indexOf("/>", markerIndex);

  if (start === -1 || end === -1) {
    throw new Error(`Unbalanced CheckboxElement for "${marker}"`);
  }

  return source.slice(start, end + 2);
}

const columnEntries: Array<FieldEntry> = splitFieldEntries(
  extractArrayProp(connectionsTableSource, "columns"),
);
const actionButtonsBlock: string = extractArrayProp(
  connectionsTableSource,
  "actionButtons",
);

const columnNames: Array<string> = columnEntries.map((entry: FieldEntry) => {
  return entry.columnName;
});

/*
 * The model columns the shared form offers by name. Provider-specific
 * fields are namespaced (`[configFieldName(...)]`) and never match a model
 * column, so they are not in this list.
 */
const formFieldColumnNames: Array<string> = Array.from(
  connectionFormSource.matchAll(FIELD_HEAD_PATTERN),
).map((match: RegExpMatchArray): string => {
  return match[1] as string;
});

const connectionModel: SecurityEventConnection = new SecurityEventConnection();
const accessControl: Dictionary<ColumnAccessControl> =
  connectionModel.getColumnAccessControlForAllColumns();

const googleSecOps: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.GoogleSecOps,
  ) as SecurityEventConnectorDefinition;

function googleConfigField(key: string): ConnectorField {
  const field: ConnectorField | undefined = googleSecOps.configFields.find(
    (candidate: ConnectorField): boolean => {
      return candidate.key === key;
    },
  );

  if (!field) {
    throw new Error(`Google SecOps has no config field "${key}"`);
  }

  return field;
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
          "Connections.tsx",
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

  test("the retired Google SecOps page is gone and nothing routes to it", () => {
    expect(
      fs.existsSync(
        nodePath.join(
          DASHBOARD_SRC,
          "Pages",
          "SecurityEvents",
          "GoogleSecOpsConnections.tsx",
        ),
      ),
    ).toBe(false);
    expect(routesSource).not.toContain("GoogleSecOps");
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
  test("the page is the reseller gate in front of the shared connections table", () => {
    expect(connectionsPageSource).toContain(
      'import SecurityEventConnectionsTable from "../../Components/SecurityEvents/SecurityEventConnectionsTable"',
    );
    expect(connectionsPageSource).toContain(
      "props.currentProject?.reseller?.enableTelemetryFeatures === false",
    );
    expect(connectionsPageSource).toContain(RESELLER_GATE_MESSAGE);
    expect(connectionsPageSource).toContain(
      "return <SecurityEventConnectionsTable />;",
    );
    // One list: no second, provider-specific table next to the shared one.
    expect(connectionsPageSource).not.toContain("<ModelTable");
    expect(connectionsPageSource).not.toContain("GoogleSecOps");

    expect(connectionsTableSource).toContain(
      "<ModelTable<SecurityEventConnection>",
    );
    expect(connectionsTableSource).toContain(
      "modelType={SecurityEventConnection}",
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
    expect(connectionsTableSource).toContain('title="Last Error"');
    expect(connectionsTableSource).toContain('label="Copy Error"');
    expect(connectionsTableSource).toContain('aria-label="Full error message"');
  });

  test("the row action can fetch the error without a Last Error column", () => {
    const selectedFields: RegExpMatchArray | null =
      SELECT_MORE_FIELDS_PATTERN.exec(connectionsTableSource);

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

  test("Google SecOps is a provider of the shared catalog with the identity its events already carry", () => {
    expect(googleSecOps).toBeDefined();
    expect(googleSecOps.title).toBe("Google SecOps");
    // The dedupe scope and telemetry service of every event already imported.
    expect(googleSecOps.vendorName).toBe("Google");
    expect(googleSecOps.productName).toBe("Google SecOps");
    expect(googleSecOps.docsPath).toBe("/docs/integrations/google-secops");
    expect(googleSecOps.importedRecordName).toBe("detection");
  });

  test("Region is a required dropdown backed by the shared endpoint allowlist, with no default", () => {
    const region: ConnectorField = googleConfigField("region");

    expect(region.type).toBe("dropdown");
    expect(region.required).toBe(true);
    expect(region.placeholder).toBe("Select a region");
    /*
     * No default: a preselected "us" would let a tenant elsewhere save the
     * wrong regional endpoint without noticing. The form only seeds values
     * a field declares.
     */
    expect(region.defaultValue).toBeUndefined();
    expect(connectionFormSource).toContain(
      "if (field.defaultValue !== undefined)",
    );
    expect(region.options).toEqual(
      GOOGLE_SECOPS_SUPPORTED_REGIONS.map((value: string) => {
        return { label: value, value };
      }),
    );

    expect([...GOOGLE_SECOPS_SUPPORTED_REGIONS]).toEqual(
      DOCUMENTED_GOOGLE_SECOPS_REGIONS,
    );
    expect(new Set(GOOGLE_SECOPS_SUPPORTED_REGIONS).size).toBe(
      GOOGLE_SECOPS_SUPPORTED_REGIONS.length,
    );
  });

  test("the service account key is a write-only secret edited as JSON", () => {
    expect(
      googleSecOps.secretFields.map((field: ConnectorField) => {
        return { key: field.key, type: field.type, required: field.required };
      }),
    ).toEqual([{ key: "serviceAccountJson", type: "json", required: true }]);
    expect(
      googleSecOps.configFields.some((field: ConnectorField): boolean => {
        return field.key === "serviceAccountJson";
      }),
    ).toBe(false);

    // Secrets render by type; a json secret is the JSON editor, never text.
    expect(connectionFormSource).toContain(
      "fieldType: secretFieldTypeFor(field)",
    );
    expect(connectionFormSource).toMatch(JSON_FIELD_TYPE_PATTERN);
    // Stored secrets are never read back, so editing never requires them.
    expect(connectionFormSource).toContain(
      "required: isEditing ? false : field.required",
    );
    expect(connectionFormSource).toContain('{ placeholder: "Unchanged" }');
  });

  test("Alerts are fixed while Detections controls the persisted scope", () => {
    expect(googleSecOps.supportsAlertingOnlyToggle).toBe(true);
    expect(googleSecOps.alertingOnlyControl).toEqual(
      expect.objectContaining({
        title: "Data to import",
        alertingLabel: "Alerts",
        nonAlertingLabel: "Detections",
        alertingOnlySummary: "Alerts only",
        withNonAlertingSummary: "Alerts and detections",
      }),
    );

    expect(connectionFormSource).toContain("<AlertingOnlyControlInput");
    expect(connectionFormSource).toContain(
      'aria-label={props.control.title} className="space-y-3" role="group"',
    );
    // The generic toggle steps aside for a provider with its own control.
    expect(connectionFormSource).toContain("!selected.alertingOnlyControl");

    const alertsCheckbox: string = extractCheckboxByMarker(
      connectionFormSource,
      "}-alerting-checkbox`",
    );
    expect(alertsCheckbox).toContain("ariaLabel={props.control.alertingLabel}");
    expect(alertsCheckbox).toContain("disabled={true}");
    expect(alertsCheckbox).toContain("readOnly={true}");
    expect(alertsCheckbox).toContain("initialValue={true}");
    expect(alertsCheckbox).toContain("value={true}");

    const detectionsCheckbox: string = extractCheckboxByMarker(
      connectionFormSource,
      "}-non-alerting-checkbox`",
    );
    expect(detectionsCheckbox).toContain(
      "ariaLabel={props.control.nonAlertingLabel}",
    );
    expect(detectionsCheckbox).not.toContain("disabled=");
    expect(detectionsCheckbox).not.toContain("readOnly=");
    expect(detectionsCheckbox).toContain("initialValue={includeNonAlerting}");
    expect(detectionsCheckbox).toContain("value={includeNonAlerting}");
    // Checking Detections stores alertingOnly=false: the inverse, never a copy.
    expect(detectionsCheckbox).toContain(
      "props.fieldProps.onChange?.(!checked)",
    );
    expect(connectionFormSource).toContain(
      "const includeNonAlerting: boolean = !props.alertingOnly;",
    );
  });

  test("new connections retain alerts-only as their explicit default", () => {
    expect(connectionFormSource).toContain(
      'initialValues["alertingOnly"] = true;',
    );
    expect(connectionFormSource).toContain(
      'alertingOnly: values["alertingOnly"] !== false',
    );
  });

  test("the edit form's inline test sends the unsaved Data to import choice", () => {
    expect(connectionFormSource).toContain(
      'body["alertingOnly"] = submission.alertingOnly;',
    );
  });

  test("rotating credentials has its own action", () => {
    expect(actionButtonsBlock).toContain('title: "Update credentials"');
    expect(connectionsTableSource).toContain(
      "setFormModal({ connection: item, credentialsOnly: true })",
    );
    // The action writes through ModelAPI with only the secrets.
    expect(connectionFormSource).toContain(
      "ModelAPI.updateById<SecurityEventConnection>",
    );
    expect(connectionFormSource).toContain(
      "return { secrets: JSON.stringify(submission.secrets) };",
    );
  });

  /*
   * The form's write-only treatment is only correct because the MODEL says
   * so. If secrets ever become readable or stop being encrypted, "Leave
   * blank to keep the stored value" turns from a necessity into a
   * usability bug and the form should be revisited - so cross-check the
   * decorator rather than trusting the form's comment about it.
   */
  test("the model really does declare secrets unreadable and encrypted", () => {
    const control: ColumnAccessControl = accessControl[
      "secrets"
    ] as ColumnAccessControl;

    expect(control).toBeDefined();
    expect(control.read).toEqual([]);
    expect(connectionModel.getTableColumnMetadata("secrets").encrypted).toBe(
      true,
    );
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

    // Sanity: the derivation actually catches the ones we know about.
    expect(readOnlyColumns).toEqual(
      expect.arrayContaining(["lastPolledAt", "lastError", "cursor"]),
    );

    for (const columnName of readOnlyColumns) {
      expect(formFieldColumnNames).not.toContain(columnName);
    }

    // The user-owned columns are still offered, so this is not vacuous.
    expect(formFieldColumnNames).toEqual(
      expect.arrayContaining([
        "provider",
        "name",
        "description",
        "pollIntervalInMinutes",
        "isEnabled",
        "alertingOnly",
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

    /*
     * And the rotate action the docs point at is the button's real title.
     * The retired Google SecOps table called it "Update Service Account
     * JSON"; the shared table has one rotate action for every provider.
     */
    expect(actionButtonsBlock).toContain('title: "Update credentials"');
    expect(docsSource).toContain("**Update credentials**");
    expect(docsSource).not.toContain("**Update Service Account JSON**");
  });

  /*
   * The summary sentence lists the columns in the order the table renders
   * them, and only those. The retired table had Scope and Region columns;
   * a summary that still promised them would send the reader to a column
   * that is not there.
   */
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

    const columnSentence: string = columnSummary.slice(
      0,
      columnSummary.indexOf("When a connection has an error"),
    );
    const promisedColumns: Array<string> = Array.from(
      columnSentence.matchAll(DOC_BOLD_SPAN_PATTERN),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(promisedColumns).toEqual(columnEntries.map(titleOf));
  });

  /*
   * Every control, run-detail label and Health state the docs name in bold
   * is read off the component that renders it, so a renamed button or label
   * breaks here instead of leaving the docs pointing at something the page
   * no longer shows. The old page's "Google SecOps Connections" card is the
   * example: the docs sent readers to it long after the card was gone.
   */
  test("the controls, run details and Health states the docs name are the ones that ship", () => {
    const testModalSource: string = readDashboardSource(
      "Components",
      "SecurityEvents",
      "ConnectionTestModal.tsx",
    );
    const diagnosticsSource: string = readDashboardSource(
      "Components",
      "SecurityEvents",
      "SecurityEventConnectionDiagnostics.tsx",
    );
    const runDetailsSource: string = readDashboardSource(
      "Components",
      "SecurityEvents",
      "SecurityEventConnectionRunDetails.tsx",
    );
    const diagnosticsUtilSource: string = readDashboardSource(
      "Components",
      "SecurityEvents",
      "SecurityEventConnectionDiagnosticsUtil.ts",
    );

    interface ShippedLabel {
      label: string;
      source: string;
      rendered: string;
    }

    const shipped: Array<ShippedLabel> = [
      {
        label: "Add connection",
        source: connectionsTableSource,
        rendered: 'title: "Add connection"',
      },
      ...[
        "View Error",
        "Test connection",
        "Run now",
        "Diagnostics",
        "Edit",
      ].map((title: string): ShippedLabel => {
        return {
          label: title,
          source: actionButtonsBlock,
          rendered: `title: "${title}"`,
        };
      }),
      {
        label: "Copy Error",
        source: connectionsTableSource,
        rendered: 'label="Copy Error"',
      },
      {
        label: "Test before saving",
        source: connectionFormSource,
        rendered: 'title: "Test before saving"',
      },
      {
        label: "Test these settings",
        source: testModalSource,
        rendered: '"Test these settings"',
      },
      {
        label: `Preview ${googleSecOps.importedRecordName}s`,
        source: diagnosticsSource,
        rendered: "title={`Preview ${recordName}s`}",
      },
      {
        label: "Import this time range",
        source: diagnosticsSource,
        rendered: 'title="Import this time range"',
      },
      {
        label: "Copy diagnostics",
        source: runDetailsSource,
        rendered: 'label="Copy diagnostics"',
      },
      {
        label: "View events in this time range",
        source: runDetailsSource,
        rendered: "View events in this time range",
      },
      {
        label: "Requested window (UTC)",
        source: runDetailsSource,
        rendered: "Requested window (UTC)",
      },
      {
        label: "Window read by this poll",
        source: runDetailsSource,
        rendered: "Window read by this poll",
      },
      {
        label: "Next scheduled poll reads",
        source: runDetailsSource,
        rendered: "Next scheduled poll reads",
      },
      {
        label: `Returned by ${googleSecOps.title}`,
        source: runDetailsSource,
        rendered: "[`Returned by ${providerTitle}`, result.fetchedCount]",
      },
      {
        label: "Imported into OneUptime",
        source: runDetailsSource,
        rendered: '["Imported into OneUptime", result.ingestedCount]',
      },
      {
        label: "Already imported",
        source: runDetailsSource,
        rendered: '"Already imported",',
      },
      {
        label: "Rejected",
        source: runDetailsSource,
        rendered: '["Rejected", result.rejectedCount]',
      },
      {
        label: "Failed",
        source: runDetailsSource,
        rendered: '["Failed", result.failedCount]',
      },
      {
        label: "Provider details",
        source: runDetailsSource,
        rendered: ">Provider details</h4>",
      },
      {
        label: "Time basis read",
        source: diagnosticsUtilSource,
        rendered: 'basis: "Time basis read"',
      },
      {
        label: "Returned by each pass",
        source: diagnosticsUtilSource,
        rendered: 'sourceCounts: "Returned by each pass"',
      },
      {
        label: "Creation lag",
        source: diagnosticsUtilSource,
        rendered: 'creationLag: "Creation lag"',
      },
      ...[
        "Last poll succeeded",
        "Polling, no events imported yet",
        "No records returned",
        "Partial import",
        "Catching up",
        "Last poll failed",
        "Poll overdue",
        "Schedule paused",
        "Waiting for first poll",
      ].map((state: string): ShippedLabel => {
        return {
          label: state,
          source: diagnosticsUtilSource,
          rendered: `"${state}"`,
        };
      }),
    ];

    for (const entry of shipped) {
      expect({
        label: entry.label,
        rendered: entry.source.includes(entry.rendered),
        documented: docsSource.includes(`**${entry.label}**`),
      }).toEqual({ label: entry.label, rendered: true, documented: true });
    }

    // The create flow names the provider the way the picker lists it.
    expect(docsSource).toContain(
      `select **Add connection**, choose **${googleSecOps.title}**`,
    );
    expect(docsSource).not.toContain("**Google SecOps Connections** card");
    expect(docsSource).not.toContain("**Scope**");
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
