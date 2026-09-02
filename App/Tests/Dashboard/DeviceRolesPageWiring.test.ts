import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Device roles used to be a fixed TypeScript union, with the label, the
 * topology silhouette and the "is this a core device" flag hardcoded in three
 * separate modules. They are a per-project table now, and the whole feature
 * only exists if the page that manages that table is reachable and can add
 * and remove rows.
 *
 * None of that is expressible as a type and none of it is reachable from a
 * unit test: the App suite runs in a plain Node environment with no renderer,
 * and `App/tsconfig.json` excludes FeatureSet/Dashboard, so `npm run compile`
 * never type-checks these pages either. A half-finished wiring therefore
 * fails nowhere — it reaches the user as a menu entry that 404s, or a page
 * that lists roles nobody can add one to.
 *
 * So this reads the sources, in the same way OidCollectionTemplatePolicy
 * pins the OID Collection Templates page. Negative assertions read a
 * comment-stripped copy, because a comment explaining that something was
 * removed necessarily names it.
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

/* Squashed and comment-free: what most assertions below want. */
function readCode(relativePath: string): string {
  return squash(codeOnly(readSource(relativePath)));
}

/*
 * The slice of a source between one marker and the next. Used to ask
 * section-shaped questions — "is this in the Settings menu section", "is this
 * among the FORM fields rather than the table columns" — which a whole-file
 * `toContain` cannot answer, because the same identifier appears in both.
 */
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  /*
   * A marker that no longer exists would silently make every assertion
   * against the slice pass on an empty string, which is the one way a
   * source-reading test can rot into a no-op.
   */
  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = to ? source.indexOf(to, start + from.length) : -1;

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

const PAGE_ID: string = "NETWORK_DEVICE_SETTINGS_DEVICE_ROLES";

const DEVICE_FORM_SOURCES: ReadonlyArray<string> = [
  "Pages/NetworkDevice/Devices.tsx",
  "Pages/NetworkDevice/View/Settings.tsx",
  "Components/Topology/AddNeighborToMonitoringModal.tsx",
];

describe("the Device Roles settings page is reachable", () => {
  test("it has a page id", () => {
    expect(readSource("Utils/PageMap.ts")).toContain(PAGE_ID);
  });

  /*
   * Roles belong to the DEVICE product, not the SITE one — a role describes a
   * box, and a site is a place full of them. The two route dictionaries sit
   * next to each other in RouteMap and prefix their pages with different URL
   * segments, so filing it in the wrong one produces a path that resolves
   * nowhere while every other file in the chain looks correct.
   */
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
      `[PageMap.${PAGE_ID}]: \`settings/device-roles\``,
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
    // Built from the path dictionary, so the two can never disagree.
    expect(route).toContain(`NetworkDeviceRoutePath[PageMap.${PAGE_ID}]`);
  });

  test("the router registers it and renders the Device Roles page", () => {
    const routes: string = readCode("Routes/NetworkDeviceRoutes.tsx");

    expect(routes).toContain("Pages/NetworkDevice/Settings/DeviceRoles");
    expect(routes).toContain(`NetworkDeviceRoutePath[ PageMap.${PAGE_ID} ]`);
    expect(routes).toContain(`RouteMap[PageMap.${PAGE_ID}] as Route`);
  });

  test("it has a breadcrumb, so the page knows where it sits", () => {
    const breadcrumbs: string = squash(
      readSource("Pages/NetworkDevice/Utils/Breadcrumbs.ts"),
    );

    expect(breadcrumbs).toContain(`PageMap.${PAGE_ID}`);
    expect(breadcrumbs).toContain('"Device Roles"');
  });

  /*
   * The picker offers a link to this page precisely where somebody discovers
   * the role they want is missing. A dead link there is worse than none.
   */
  test("the shared role picker links to it", () => {
    expect(
      readCode("Components/NetworkDevice/DeviceRoleFormFields.ts"),
    ).toContain(`PageMap.${PAGE_ID}`);
  });
});

describe("a role is a definition, not a rule", () => {
  const sideMenu: string = squash(
    readSource("Components/Network/NetworkSideMenu.tsx"),
  );

  /*
   * Automation holds the RULES — auto import, site assignment, owners,
   * labels, links — things that fire and change data. A device role is a
   * vocabulary entry: it changes nothing on its own, it is what the rules and
   * the map refer to. Filing it under Automation would tell an operator to
   * look for it among things that run.
   */
  test("it is listed in the Settings section", () => {
    expect(between(sideMenu, 'title: "Settings"', "")).toContain(PAGE_ID);
  });

  test("it is not listed under Automation", () => {
    const automation: string = between(
      sideMenu,
      'title: "Automation"',
      'title: "Archive"',
    );

    // Anchor the slice, so a mis-sliced section cannot pass by being empty.
    expect(automation).toContain("NETWORK_DEVICE_SETTINGS_AUTO_IMPORT_RULES");
    expect(automation).not.toContain(PAGE_ID);
  });
});

describe("the roles page is the place people add and remove roles", () => {
  const page: string = readCode("Pages/NetworkDevice/Settings/DeviceRoles.tsx");

  /*
   * THE point of the feature. The eleven seeded defaults are a starting set,
   * not the vocabulary: an estate with PoS terminals and SD-WAN edges has to
   * be able to add them, and one that runs no storage has to be able to drop
   * that row. A read-only list of the same eleven roles would be the old
   * hardcoded union with extra steps.
   */
  test("roles can be created, edited and deleted", () => {
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

  /*
   * The key is the role's identity: it is what SNMP classification matches
   * against, which is why renaming "Wireless AP" to "Access Point" keeps
   * every access point pointing at the same row. It is derived from the name
   * on create and never changes afterwards — so it is shown, and it is
   * searchable, but offering it as a form field would let somebody edit the
   * one field the classifier joins on and silently orphan every device
   * already classified into that role.
   */
  test("the server-derived key is shown but is not an editable field", () => {
    expect(columns).toContain("field: { key: true }");
    // Anchor the slice, so a mis-sliced block cannot pass by being empty.
    expect(formFields).toContain("field: { name: true }");
    expect(formFields).not.toContain("key: true");
  });

  test("the fields that change behaviour are editable", () => {
    for (const field of [
      "name: true",
      "description: true",
      "order: true",
      "topologyShape: true",
      "isCoreLayer: true",
      "isSnmpWalkable: true",
    ]) {
      expect(formFields).toContain(field);
    }
  });

  /*
   * Shapes are geometry, not taxonomy — adding one means writing the path
   * that draws it — so they stay a closed union and the picker names them
   * from the shared list rather than repeating it here.
   */
  test("the shape picker reads the shared option list", () => {
    expect(page).toContain("TOPOLOGY_SHAPE_OPTIONS");
  });
});

describe("every device form picks a role the same way", () => {
  /*
   * Three forms create or edit a device's role: the create modal on the
   * Devices list, the edit form on a device's Settings page, and the
   * adopt-a-neighbour modal on the topology map. They drifted trivially
   * easily while roles were a constant each one imported and re-shaped; now
   * that the options come from a table, a form that hand-lists roles would
   * show an operator a set their project does not have.
   */
  test("each of the three forms uses the shared picker helpers", () => {
    for (const relativePath of DEVICE_FORM_SOURCES) {
      const source: string = readCode(relativePath);

      expect(source).toContain("DeviceRoleFormFields");
      expect(source).toContain("DEVICE_ROLE_FIELD_TITLE");
      expect(source).toContain("DEVICE_ROLE_FIELD_DESCRIPTION");
      expect(source).toContain("DEVICE_ROLE_FIELD_PLACEHOLDER");
    }
  });

  test("each of the three forms is backed by the roles table, not an option list", () => {
    for (const relativePath of DEVICE_FORM_SOURCES) {
      const source: string = readCode(relativePath);

      expect(source).toContain("dropdownModal: DEVICE_ROLE_DROPDOWN_MODAL");
      // The relation, not the deprecated free-text column.
      expect(source).toContain("networkDeviceRole: true");
      expect(source).not.toContain("dropdownOptions: DEVICE_ROLE");
    }
  });

  /*
   * "wirelessAccessPoint" is the tell. It is a key nobody would ever type
   * into a label, so its presence in the code of a form means that form is
   * building its own option list out of the old union again.
   */
  test("no form hand-lists the built-in role keys", () => {
    for (const relativePath of DEVICE_FORM_SOURCES) {
      const source: string = readCode(relativePath);

      expect(source).not.toContain("wirelessAccessPoint");
      expect(source).not.toContain("loadBalancer");
    }
  });

  /*
   * The adopt-a-neighbour modal is the one form that opens pre-filled, and
   * the role it pre-fills with is a ROW now — a form cannot resolve a key to
   * a row, so the draft carries the id and the modal seeds the relation
   * field with it.
   */
  test("the adopt-a-neighbour modal seeds the relation from the draft's role id", () => {
    const modal: string = readCode(
      "Components/Topology/AddNeighborToMonitoringModal.tsx",
    );

    expect(modal).toContain(
      'values["networkDeviceRole"] = draft.networkDeviceRoleId',
    );
  });
});

describe("the old hardcoded option list is gone for good", () => {
  /*
   * DEVICE_ROLE_OPTIONS was the static list built at import time from the
   * fixed union. It is deleted, and a surviving import of it would not fail
   * the build — FeatureSet/Dashboard is excluded from `npm run compile` — it
   * would fail at runtime, in whichever page still reached for it.
   */
  function dashboardSourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...dashboardSourceFiles(fullPath));
        continue;
      }

      if (/\.tsx?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  test("nothing in the Dashboard source still references it", () => {
    const files: Array<string> = dashboardSourceFiles(DASHBOARD_SRC);

    const offenders: Array<string> = files.filter((file: string): boolean => {
      const raw: string = fs.readFileSync(file, "utf8");

      // Cheap check first; only a hit is worth the cost of stripping comments.
      return (
        raw.includes("DEVICE_ROLE_OPTIONS") &&
        codeOnly(raw).includes("DEVICE_ROLE_OPTIONS")
      );
    });

    // The walk itself has to have found something, or the filter proves nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  test("the helper module exports the model-backed picker instead", () => {
    const helpers: string = readCode(
      "Components/NetworkDevice/DeviceRoleFormFields.ts",
    );

    expect(helpers).toContain("DEVICE_ROLE_DROPDOWN_MODAL");
    expect(helpers).toContain("NetworkDeviceRole");
    expect(helpers).not.toContain("DEVICE_ROLE_OPTIONS");
  });
});
