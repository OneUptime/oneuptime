import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SNMP credential profiles move a device's credentials off the device row,
 * and the whole feature only exists if the page that manages them is
 * reachable and can add, edit and remove rows.
 *
 * None of that is expressible as a type and none of it is reachable from a
 * unit test: the App suite runs in a plain Node environment with no renderer,
 * and `App/tsconfig.json` excludes FeatureSet/Dashboard, so `npm run compile`
 * never type-checks these pages either. A half-finished wiring therefore
 * fails nowhere — it reaches the user as a menu entry that 404s.
 *
 * So this reads the sources, in the same way DeviceRolesPageWiring pins the
 * Device Roles page. Negative assertions read a comment-stripped copy,
 * because a comment explaining that something was removed necessarily
 * names it.
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

const PAGE_ID: string = "NETWORK_DEVICE_SETTINGS_SNMP_CREDENTIAL_PROFILES";
const PAGE_SOURCE: string =
  "Pages/NetworkDevice/Settings/SnmpCredentialProfiles.tsx";

describe("the SNMP Credentials settings page is reachable", () => {
  test("it has a page id", () => {
    expect(readSource("Utils/PageMap.ts")).toContain(PAGE_ID);
  });

  /*
   * Profiles belong to the DEVICE product: a profile is what a device is
   * walked with, and a site only carries one as a default for its devices.
   * The two route dictionaries sit next to each other in RouteMap and prefix
   * their pages with different URL segments, so filing it in the wrong one
   * produces a path that resolves nowhere.
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
      `[PageMap.${PAGE_ID}]: \`settings/snmp-credential-profiles\``,
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
    expect(route).toContain(`NetworkDeviceRoutePath[ PageMap.${PAGE_ID} ]`);
  });

  test("the router registers it and renders the SNMP Credentials page", () => {
    const routes: string = readCode("Routes/NetworkDeviceRoutes.tsx");

    expect(routes).toContain(
      "Pages/NetworkDevice/Settings/SnmpCredentialProfiles",
    );
    expect(routes).toContain(`NetworkDeviceRoutePath[ PageMap.${PAGE_ID} ]`);
    expect(routes).toContain(`RouteMap[ PageMap.${PAGE_ID} ] as Route`);
  });

  test("it has a breadcrumb, so the page knows where it sits", () => {
    const breadcrumbs: string = squash(
      readSource("Pages/NetworkDevice/Utils/Breadcrumbs.ts"),
    );

    expect(breadcrumbs).toContain(`PageMap.${PAGE_ID}`);
    expect(breadcrumbs).toContain('"SNMP Credentials"');
  });

  /*
   * The bulk action's "no profiles yet" modal links to this page precisely
   * where somebody discovers there is nothing to pick. A dead link there is
   * worse than none.
   */
  test("the bulk action's empty-state modal links to it", () => {
    expect(
      readCode(
        "Components/NetworkDevice/useBulkSnmpCredentialProfileActions.tsx",
      ),
    ).toContain(`PageMap.${PAGE_ID}`);
  });
});

describe("a credential profile is a definition, not a rule", () => {
  const sideMenu: string = squash(
    readSource("Components/Network/NetworkSideMenu.tsx"),
  );

  /*
   * The Rules section holds the things that FIRE and change data. A profile
   * is a named credential set other rows point at: it changes nothing on
   * its own, so it sits beside the OID Collection Templates, the other
   * "named set a device links to".
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

    // Anchor the slice, so a mis-sliced section cannot pass by being empty.
    expect(rules).toContain("NETWORK_DEVICE_SETTINGS_AUTO_IMPORT_RULES");
    expect(rules).not.toContain(PAGE_ID);
  });
});

describe("the profiles page is where profiles are managed", () => {
  const page: string = readCode(PAGE_SOURCE);

  test("profiles can be created, edited and deleted", () => {
    expect(page).toContain("modelType={NetworkSnmpCredentialProfile}");
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

  test("the table shows the columns an operator picks a profile by, never a secret", () => {
    for (const column of [
      "name: true",
      "description: true",
      "snmpVersion: true",
      "snmpPort: true",
      "createdAt: true",
    ]) {
      expect(columns).toContain(column);
    }

    for (const secret of [
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ]) {
      expect(columns).not.toContain(secret);
    }
  });

  /*
   * A profile has to be able to hold anything a device can, under the same
   * labels, revealed by the same v3 rules. The device forms, the discovery
   * scan form and this page all render the SAME field list from the shared
   * module, so the credential fields cannot drift apart between the five
   * places they are typed.
   */
  test("the credential fields come from the shared SNMP field module", () => {
    expect(page).toContain("getSnmpConfigFormFields");
    expect(formFields).toContain("getSnmpConfigFormFields(");
    expect(formFields).toContain('stepId: "credentials"');
    // Anchor the slice.
    expect(formFields).toContain("field: { name: true }");
    expect(formFields).toContain("field: { description: true }");
    // No hand-listed copy of the credential fields beside the shared ones.
    expect(formFields).not.toContain("snmpV3SecurityLevel: true");
    expect(formFields).not.toContain("snmpCommunityString: true");
  });

  /*
   * The resolution order is the one fact an operator needs to predict what
   * attaching a profile changes, and the delete refusal is the one surprise
   * they will otherwise hit. Both are said on the page, not only in the
   * help drawer.
   */
  test("the page copy explains the resolution order and the delete refusal", () => {
    const source: string = squash(readSource(PAGE_SOURCE));

    expect(source).toContain("its own credentials");
    expect(source).toContain("the profile on the device");
    expect(source).toContain("the profile on its site");
    expect(source).toContain("pinged only");
    expect(source).toContain("cannot be deleted");
  });
});
