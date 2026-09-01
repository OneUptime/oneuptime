import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source-reading invariants for OID Collection Templates (issue #3507).
 *
 * House style for Dashboard tests: node env, never render React. These read
 * the source and assert the properties that are cheap to regress and
 * expensive to notice — a dead field silently reappearing, copy that promises
 * something the product does not do, or a bulk action that leaves a device in
 * a state the next poll quietly overwrites.
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

/*
 * Strip block and line comments before asserting on code. Several of the
 * checks below are "this dead field is gone", and the comment explaining WHY
 * it is gone necessarily names it — without this, documenting the fix would
 * fail the test that guards it.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("the criteria OID picker no longer reads the retired SNMP monitor's field", () => {
  const source: string = readSource(
    "Components/Form/Monitor/CriteriaFilter.tsx",
  );

  /*
   * THE regression this file exists for.
   *
   * `monitorStep.data.snmpMonitor.oids` belongs to the retired standalone
   * SNMP monitor type. A Network Device step never populates it, so for years
   * the OID dropdown was empty for every user, snmpMonitorOptions.oid was
   * never set, and both OID criteria returned no verdict server-side. The bug
   * was invisible precisely because an empty dropdown looks like "nothing
   * configured yet" rather than "this control is wired to a dead field".
   */
  test("does not source OID options from snmpMonitor.oids", () => {
    const code: string = squash(codeOnly(source));

    expect(code).not.toContain("snmpMonitor?.oids");
    expect(code).not.toContain("snmpMonitor.oids");
  });

  test("the dead-end empty-state copy is gone", () => {
    expect(codeOnly(source)).not.toContain(
      "Add an OID to the monitor configuration above",
    );
  });

  /*
   * The picker must compare canonical OIDs. ".1.3.6.1" and "1.3.6.1" are the
   * same object and operators type both; matching raw strings would leave a
   * saved criterion looking unselected.
   */
  test("normalizes OIDs rather than comparing raw strings", () => {
    expect(source).toContain("SnmpOidListUtil");
    expect(source).toContain("normalizeOid");
  });
});

describe("the OID editor warns only where the warning is true", () => {
  const source: string = readSource(
    "Components/Form/Monitor/SnmpMonitor/SnmpOidEditor.tsx",
  );

  /*
   * The advisory must go through getAlreadyCollectedBy, which deliberately
   * matches only the handful of interface columns with a genuine equivalent
   * metric series. In/out errors exist solely as a combined rate, discards
   * are parsed and dropped, and speed and admin status never become metrics —
   * for those, hand-typing the OID is the only thing that works, so a
   * hardcoded ifTable prefix here would talk operators out of their own data.
   */
  test("delegates the already-collected check instead of matching prefixes itself", () => {
    expect(source).toContain("getAlreadyCollectedBy");
    expect(codeOnly(source)).not.toContain('"1.3.6.1.2.1.2.2.1."');
  });

  test("validates through the shared util, so the client and server agree", () => {
    expect(source).toContain("SnmpOidListUtil");
  });
});

describe("clearing a device's template does not silently swap in a vendor profile", () => {
  const source: string = readSource(
    "Components/NetworkDevice/useBulkOidTemplateActions.tsx",
  );

  /*
   * Unlinking leaves a device with no template and (usually) an empty
   * snmpOids — which is EXACTLY the condition the vendor auto-apply keys off.
   * Without also turning the toggle off, the operator asks for "no template"
   * and the next poll silently gives them a different, unnamed one.
   */
  test("the clear action also turns the vendor auto-apply off", () => {
    expect(source).toContain("autoApplyVendorHealthTemplate");
    expect(squash(source)).toContain("autoApplyVendorHealthTemplate: false");
  });

  /*
   * Auto-imported devices already carry a vendor copy in snmpOids, and a
   * device entry wins over the template's on a shared OID — so adopting a
   * template without clearing leaves an invisible second source overriding it.
   */
  test("the set action can clear device-specific OIDs as part of adopting a template", () => {
    expect(squash(source)).toContain("snmpOids: []");
  });
});

describe("the templates page tells the truth about what needs an OID", () => {
  const source: string = readSource(
    "Pages/NetworkDevice/Settings/OidCollectionTemplates.tsx",
  );
  const squashed: string = squash(source);

  /*
   * The reporter of #3507 was about to hand-type a hundred per-port OIDs for
   * counters the interface walk already collects. If this sentence goes
   * missing, the page stops answering the question that prompted the issue.
   */
  test("leads with the fact that interfaces need no OIDs", () => {
    expect(squashed).toContain("You do not need OIDs for interfaces");
  });

  test("carries the Zabbix vocabulary the reporter arrived with", () => {
    expect(squashed).toContain("Zabbix");
    expect(squashed).toContain("Item");
  });

  /*
   * The wildcard fan-out is interface-only. Promising a Zabbix user that a
   * trigger prototype maps onto an OID criteria with Interface = * would be
   * the first thing they check and the first thing they find false.
   */
  test("does not promise an OID wildcard that does not exist", () => {
    expect(squashed).not.toContain("OID = *");
    expect(squashed).not.toContain("OID Value with a wildcard");
  });

  test("states the limits from the shared constants rather than hardcoding them", () => {
    expect(source).toContain("MAX_OIDS_PER_TEMPLATE");
    expect(source).toContain("MAX_DEVICE_SPECIFIC_OIDS");
  });
});

describe("the new settings page is reachable", () => {
  /*
   * A page nobody can navigate to is not shipped. This is the whole
   * registration chain, which spans five files that are easy to half-finish.
   */
  test("is a definition under Settings, not a rule under Automation", () => {
    const sideMenu: string = readSource(
      "Components/Network/NetworkSideMenu.tsx",
    );
    const settingsSection: string = squash(
      sideMenu.slice(sideMenu.indexOf('title: "Settings"')),
    );

    expect(settingsSection).toContain("NETWORK_DEVICE_SETTINGS_OID_TEMPLATES");
  });

  test("has a page id, a path, a route and a breadcrumb", () => {
    expect(readSource("Utils/PageMap.ts")).toContain(
      "NETWORK_DEVICE_SETTINGS_OID_TEMPLATES",
    );
    expect(readSource("Utils/RouteMap.ts")).toContain(
      "settings/oid-collection-templates",
    );
    expect(readSource("Routes/NetworkDeviceRoutes.tsx")).toContain(
      "NETWORK_DEVICE_SETTINGS_OID_TEMPLATES",
    );
    expect(readSource("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      "NETWORK_DEVICE_SETTINGS_OID_TEMPLATES",
    );
  });
});
