import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * An alert policy provisions monitors on the devices its scope matches, and
 * the engine reconciles them: it re-creates what is missing and deletes what
 * the scope no longer covers. So a monitor a policy owns is not the
 * operator's to edit. Change its criteria by hand and the next reconcile
 * puts them back; delete it and it reappears.
 *
 * Nothing on the monitor's own page says this. The device Overview's monitor
 * list is where an operator meets these monitors, so it is where the fact has
 * to be disclosed — otherwise the product silently overrules them and looks
 * broken while doing it.
 *
 * The second half of the file pins HOW the disclosure gets its data, which is
 * the part that would break silently: the card reads the foreign key, never
 * the policy row. `networkAlertPolicy` is a relation with no
 * `canReadOnRelationQuery`, so selecting it one relation deep on a Monitor
 * query throws at runtime, and no type error would warn you first.
 *
 * These are configuration objects handed to React, and the App suite has no
 * renderer, so this reads the sources with comments stripped and whitespace
 * squashed, the way its neighbours do.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

const CARD: string = readCode(
  "Components",
  "NetworkDevice",
  "DeviceMonitorsCard.tsx",
);

const LOOKUP: string = readCode(
  "Components",
  "NetworkDevice",
  "DeviceMonitorLookupUtil.ts",
);

describe("a policy-owned monitor says so on the device page", () => {
  test("the row is only rendered for a monitor a policy owns", () => {
    expect(CARD).toContain("monitor.networkAlertPolicyId &&");
  });

  /*
   * The disclosure has to tell the operator what to do instead, not merely
   * that something else is involved. "Managed by an alert policy" alone
   * leaves them to discover by experiment that their edit was reverted.
   */
  test("it names the policy as the thing to edit", () => {
    expect(CARD).toContain("Managed by an alert policy");
    expect(CARD).toContain("Edit the policy rather than this monitor");
  });
});

describe("the disclosure reads the key, not the policy row", () => {
  /*
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * Selecting the relation would throw "Column networkAlertPolicy on Monitor
   * does not support read on relation query" the first time a device page
   * with monitors is opened — at runtime, in production, with nothing at
   * build time to catch it. The id column is selectable and is all the card
   * needs.
   */
  test("the monitor lookup selects the foreign key", () => {
    expect(LOOKUP).toContain("networkAlertPolicyId: true");
  });

  test("neither file selects the policy relation itself", () => {
    for (const source of [LOOKUP, CARD]) {
      expect(source).not.toContain("networkAlertPolicy: {");
    }
  });
});

describe("the empty state is honest about what polling already gives you", () => {
  /*
   * A probe-polled device with no monitors is not unmonitored: its probe
   * pings it on schedule and it has a status. The old copy said the device
   * was "polled and inventoried", which promised SNMP inventory to a
   * credential-less device that only ever gets pinged. The distinction
   * matters because it is the reason a monitor is optional here at all.
   */
  test("it separates having a status from raising an incident", () => {
    expect(CARD).toContain("already pings it on schedule");
    expect(CARD).toContain("turns a failure into an incident");
  });

  /*
   * ...and it points at the policy, because covering a fleet one device at a
   * time is the problem alert policies exist to solve.
   */
  test("it offers the fleet-wide route as well as the one-device one", () => {
    expect(CARD).toContain("alert policy under Network settings");
  });

  /*
   * The monitor-backed branch must keep saying the opposite, and must not be
   * softened by the change above: such a device has NO probe polling it, and
   * telling its operator that a probe is already pinging it sends them
   * looking for a probe the device is designed never to have.
   */
  test("a monitor-backed device is still told nothing is polling it", () => {
    expect(CARD).toContain("it is not polled by a probe at all");
  });
});
