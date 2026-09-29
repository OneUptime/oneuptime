import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  readDropdownIds,
  readScopeSelection,
  summarizeScope,
  toScope,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/AlertPolicyScopeFormFields";

/*
 * Alert policies are how a whole estate gets alerting from one form, and the
 * page that manages them is the only surface that offers it. The App suite
 * runs in a plain Node environment with no renderer and `App/tsconfig.json`
 * excludes FeatureSet/Dashboard, so nothing else notices a route that was
 * never registered, a menu entry that 404s, or a form that quietly dropped
 * the scope. This reads the sources, the way DeviceRolesPageWiring does, and
 * unit-tests the one pure module the page's scope editing rests on.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function readCode(relativePath: string): string {
  return squash(codeOnly(readSource(relativePath)));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = to ? source.indexOf(to, start + from.length) : -1;

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

const PAGE_ID: string = "NETWORK_DEVICE_SETTINGS_ALERT_POLICIES";
const PAGE_SOURCE: string = "Pages/NetworkDevice/Settings/AlertPolicies.tsx";

const SITE_A: string = "11111111-1111-4111-8111-111111111111";
const SITE_B: string = "22222222-2222-4222-8222-222222222222";
const ROLE_A: string = "33333333-3333-4333-8333-333333333333";
const LABEL_A: string = "44444444-4444-4444-8444-444444444444";
const LABEL_B: string = "55555555-5555-4555-8555-555555555555";
const LABEL_C: string = "66666666-6666-4666-8666-666666666666";

describe("the Alert Policies settings page is reachable", () => {
  test("it has a page id", () => {
    expect(readSource("Utils/PageMap.ts")).toContain(PAGE_ID);
  });

  test("its path lives in the device route dictionary, not the site one", () => {
    const routeMap: string = squash(readSource("Utils/RouteMap.ts"));

    const deviceRoutePaths: string = between(
      routeMap,
      "export const NetworkDeviceRoutePath",
      "export const ",
    );
    const siteRoutePaths: string = between(
      routeMap,
      "export const NetworkSiteRoutePath",
      "export const ",
    );

    expect(deviceRoutePaths).toContain(
      `[PageMap.${PAGE_ID}]: \`settings/alert-policies\``,
    );
    expect(siteRoutePaths).not.toContain(PAGE_ID);
  });

  test("its absolute route is built under network-devices", () => {
    const route: string = between(
      squash(readSource("Utils/RouteMap.ts")),
      `[PageMap.${PAGE_ID}]: new Route(`,
      "),",
    );

    expect(route).toContain("/network-devices/");
    expect(route).not.toContain("network-sites");
    expect(route).toContain(`NetworkDeviceRoutePath[PageMap.${PAGE_ID}]`);
  });

  test("the router registers it and renders the Alert Policies page", () => {
    const routes: string = readCode("Routes/NetworkDeviceRoutes.tsx");

    expect(routes).toContain("Pages/NetworkDevice/Settings/AlertPolicies");
    expect(routes).toContain(`NetworkDeviceRoutePath[ PageMap.${PAGE_ID} ]`);
    expect(routes).toContain(`RouteMap[ PageMap.${PAGE_ID} ] as Route`);
  });

  test("it has a breadcrumb, so the page knows where it sits", () => {
    const breadcrumbs: string = squash(
      readSource("Pages/NetworkDevice/Utils/Breadcrumbs.ts"),
    );

    expect(breadcrumbs).toContain(`PageMap.${PAGE_ID}`);
    expect(breadcrumbs).toContain('"Alert Policies"');
  });
});

describe("a policy is a definition, not a rule", () => {
  const sideMenu: string = squash(
    readSource("Components/Network/NetworkSideMenu.tsx"),
  );

  /*
   * A policy is the intent "alert on devices like these"; the engine that
   * provisions the monitors is what runs, and it is not something an
   * operator opens. Filing the page among the rules would tell them to look
   * for it under things that fire.
   */
  test("it is listed in the Settings section", () => {
    expect(between(sideMenu, 'title: "Settings"', "")).toContain(PAGE_ID);
  });

  test("it is not listed among the rules", () => {
    const rules: string = between(
      sideMenu,
      'title: "Rules"',
      'title: "Settings"',
    );

    expect(rules).toContain("NETWORK_DEVICE_SETTINGS_AUTO_IMPORT_RULES");
    expect(rules).not.toContain(PAGE_ID);
  });
});

describe("the policies page is where policies are managed", () => {
  const page: string = readCode(PAGE_SOURCE);

  test("policies can be created, edited and deleted", () => {
    expect(page).toContain("modelType={NetworkAlertPolicy}");
    expect(page).toContain("isCreateable={true}");
    expect(page).toContain("isEditable={true}");
    expect(page).toContain("isDeleteable={true}");
  });

  const columns: string = between(page, "columns={[", "formSteps={[");
  const formFields: string = between(
    page,
    "formFields={[",
    "showRefreshButton",
  );

  test("the table shows the scope, the switch and all four of the engine's stamps", () => {
    for (const column of [
      "name: true",
      "scope: true",
      "isEnabled: true",
      "coveredDeviceCount: true",
      "lastSyncAt: true",
      "templateSyncedAt: true",
      "createdAt: true",
    ]) {
      expect(columns).toContain(column);
    }

    // The last error is shown against the row, not only logged.
    expect(page).toContain("lastSyncError: true");
    expect(columns).toContain("lastSyncError");
  });

  /*
   * The template column is CONDITIONAL, and that is the design rather than an
   * accident, so this pins both halves of it.
   *
   * `monitorTemplate` carries the MonitorTemplate read permissions, not the
   * policy's own: a granular reader can hold ReadNetworkAlertPolicy and not
   * ReadMonitorTemplate. Selecting a relation such a caller cannot read fails
   * the WHOLE list request rather than blanking one cell, so asking for the
   * column unconditionally would turn their Alert Policies page into an error
   * — which is exactly why the auto-import rules page gates its own template
   * column the same way, in getReadableMonitorTemplateColumn.
   *
   * The failure mode this guards is therefore not "the column is optional",
   * it is "the column quietly stopped existing for anyone": hence the
   * assertions on the permitted shape, on the gate it hangs off, and on the
   * spread that actually puts it in the table.
   */
  test("the template column exists for a reader who may read templates, and is spread into the table", () => {
    const gate: string = between(
      page,
      "const canReadMonitorTemplate",
      "const monitorTemplateColumn",
    );

    expect(gate).toContain("PermissionGate.canReadColumn(");
    expect(gate).toContain('"monitorTemplate"');

    const column: string = between(
      page,
      "const monitorTemplateColumn",
      "return (",
    );

    expect(column).toContain("canReadMonitorTemplate");
    expect(column).toContain(
      "field: { monitorTemplate: { templateName: true } }",
    );
    /*
     * Without selectedProperty the table's cell key is the relation itself,
     * so the cell renders "[object Object]" and the CSV export falls through
     * to raw JSON. Same line, same reason, as the auto-import rules page.
     */
    expect(column).toContain('selectedProperty: "templateName"');

    expect(columns).toContain(
      "...(monitorTemplateColumn ? [monitorTemplateColumn] : [])",
    );
  });

  /*
   * The form edits the ONE jsonb scope column directly, through a custom
   * element, so create and edit share a code path and there is no
   * onBeforeCreate mapping that edit would silently lack.
   */
  test("the form edits the template, the switch and the scope as one object", () => {
    expect(formFields).toContain("field: { name: true }");
    expect(formFields).toContain("field: { description: true }");
    expect(formFields).toContain("field: { isEnabled: true }");
    expect(formFields).toContain("field: { scope: true }");
    expect(formFields).toContain("FormFieldSchemaType.CustomComponent");
    expect(formFields).toContain("AlertPolicyScopeEditor");
    expect(page).not.toContain("onBeforeCreate");
  });

  /*
   * The template FIELD is gated on the same permission as the template
   * column, for the same reason — the create form would otherwise select a
   * relation the caller cannot read. The server still requires a template, so
   * a caller without the field is refused on save with a sentence, which is a
   * far better outcome than a form that appears to work and silently drops
   * the one column that decides what every provisioned monitor watches.
   */
  test("the template field is required, and behind the same permission as the column", () => {
    const templateField: string = between(
      formFields,
      "canReadMonitorTemplate",
      "field: { scope: true }",
    );

    expect(templateField).toContain("field: { monitorTemplate: true }");
    expect(templateField).toContain("required: true");
    expect(templateField).toContain(
      'placeholder: "Select a Network Device template"',
    );
  });

  /*
   * The server refuses anything but a Network Device template, so the
   * picker lists only those — and lists them itself rather than through a
   * dropdownModal that would offer every template type.
   */
  test("the template picker lists Network Device templates only", () => {
    expect(page).toContain("monitorType: MonitorType.NetworkDevice");
    expect(page).toContain(
      "fetchDropdownOptions: fetchNetworkDeviceMonitorTemplates",
    );
  });

  test("the scope editor is backed by the sites, roles and labels tables", () => {
    const editor: string = between(
      page,
      "const AlertPolicyScopeEditor",
      "async function findOrCreateRecommendedTemplate",
    );

    expect(editor).toContain("modelType={NetworkSite}");
    expect(editor).toContain("modelType={NetworkDeviceRole}");
    expect(editor).toContain("modelType={Label}");
    expect(editor).toContain("isMultiSelect={true}");
  });

  /*
   * THE point of the empty state: alerting on a whole estate is one click.
   * It resolves the project's seed ids the way every Ping-monitor surface
   * does, finds or creates the template by marker through the shared util,
   * creates the policy, and refreshes the table.
   */
  test("the empty state creates the recommended policy through the shared bootstrap util", () => {
    expect(page).toContain("noItemsMessage={ <RecommendedPolicyEmptyState");
    expect(page).toContain("PingMonitorSeedIds.resolve()");
    expect(page).toContain(
      "NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate(",
    );
    expect(page).toContain(
      "NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate(",
    );
    expect(page).toContain(
      "NetworkAlertPolicyBootstrapUtil.buildRecommendedPolicy(",
    );
    expect(page).toContain("refreshToggle={refreshToggle}");
    // The pair is billable, so it is confirmed before anything is created.
    expect(page).toContain("<ConfirmModal");
  });

  /*
   * Three things an operator must not have to infer.
   *
   * The bill: one unscoped policy turns a whole estate into billable monitors
   * from one form submit, so the page says one-monitor-per-device, says it
   * counts towards the plan, and puts a number on the reach before creating
   * anything — as an upper bound, because the engine skips monitor-backed
   * devices and devices with no probe and an exact-looking number that
   * undershoots teaches people to ignore it.
   *
   * The ping-only device: four of the pack's five items read an SNMP walk,
   * and a device with no credentials is pinged rather than walked, so those
   * four are never evaluated on it. Copy that lists interface alerting
   * without that caveat promises alerting the device cannot produce.
   *
   * The delete: it takes the policy's provisioned monitors with it, and the
   * row's delete confirmation is the table's generic one — it cannot be given
   * this model's particular consequence — so the card has to carry it, where
   * it is still on screen beside the delete buttons.
   */
  test("the copy is honest about the bill, a ping-only device and the delete", () => {
    const source: string = squash(readSource(PAGE_SOURCE));

    expect(source).toContain("one Network Device monitor per matching device");
    expect(source).toContain("counts towards your plan");
    expect(source).toContain("which is the most this can provision");
    expect(source).toContain("only the reachability item can fire");
    expect(source).toContain("deleting one deletes them");
  });
});

describe("AlertPolicyScopeFormFields", () => {
  describe("summarizeScope", () => {
    test("an empty, blank or absent scope is every device", () => {
      expect(summarizeScope({})).toBe("All devices");
      expect(summarizeScope(undefined)).toBe("All devices");
      expect(summarizeScope(null)).toBe("All devices");
      expect(summarizeScope("")).toBe("All devices");
      expect(summarizeScope({ siteIds: [""], labelIds: null })).toBe(
        "All devices",
      );
    });

    test("counts each kind that is filled in, singular and plural", () => {
      expect(summarizeScope({ siteIds: [SITE_A, SITE_B] })).toBe("2 sites");
      expect(
        summarizeScope({
          siteIds: [SITE_A, SITE_B],
          networkDeviceRoleIds: [ROLE_A],
        }),
      ).toBe("2 sites, 1 role");
      expect(
        summarizeScope({
          networkDeviceRoleIds: [ROLE_A],
          labelIds: [LABEL_A, LABEL_B, LABEL_C],
        }),
      ).toBe("1 role, 3 labels");
    });

    // A duplicated id must not read as two sites.
    test("counts after deduplication", () => {
      expect(summarizeScope({ siteIds: [SITE_A, SITE_A, ` ${SITE_A} `] })).toBe(
        "1 site",
      );
    });
  });

  describe("readScopeSelection", () => {
    test("reads a stored scope into three lists, filling absent kinds", () => {
      expect(readScopeSelection({ siteIds: [SITE_A] })).toEqual({
        siteIds: [SITE_A],
        networkDeviceRoleIds: [],
        labelIds: [],
      });
    });

    // The form seeds an untouched custom field with "".
    test("reads a blank create-form value as nothing selected", () => {
      expect(readScopeSelection("")).toEqual({
        siteIds: [],
        networkDeviceRoleIds: [],
        labelIds: [],
      });
      expect(readScopeSelection(undefined)).toEqual({
        siteIds: [],
        networkDeviceRoleIds: [],
        labelIds: [],
      });
    });
  });

  describe("toScope", () => {
    test("stores the canonical, deduplicated form", () => {
      expect(
        toScope({
          siteIds: [SITE_A, SITE_A],
          networkDeviceRoleIds: [],
          labelIds: [` ${LABEL_A}`, ""],
        }),
      ).toEqual({
        siteIds: [SITE_A],
        networkDeviceRoleIds: [],
        labelIds: [LABEL_A],
      });
    });
  });

  describe("readDropdownIds", () => {
    test("accepts nothing, one value, a list of values and a list of options", () => {
      expect(readDropdownIds(null)).toEqual([]);
      expect(readDropdownIds(undefined)).toEqual([]);
      expect(readDropdownIds([])).toEqual([]);
      expect(readDropdownIds(SITE_A)).toEqual([SITE_A]);
      expect(readDropdownIds([SITE_A, SITE_B])).toEqual([SITE_A, SITE_B]);
      expect(
        readDropdownIds([
          { label: "Warehouse", value: SITE_A },
          { label: "Office", value: SITE_B },
        ]),
      ).toEqual([SITE_A, SITE_B]);
    });

    test("drops blanks and duplicates", () => {
      expect(readDropdownIds([SITE_A, "", SITE_A, "  "])).toEqual([SITE_A]);
    });
  });
});
