import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * OneUptime/oneuptime#3447: a host that answers ping but not SNMP imports as a
 * monitor-backed NetworkDevice — no probe, nothing polling it, by design. But
 * nothing was ever bound to report its health either, so it sat on "Pending"
 * with "No probe found", "0 / 0" interfaces and "Last Seen: Never" forever,
 * while the operator's own `ping -t` answered every time. Fourteen discovered
 * hosts meant fourteen hand-made monitors and fourteen device edits to escape.
 *
 * The fix is an opt-in on the Review dialog: create a Ping monitor per
 * ping-only host and bind it at device-create time. The properties below are
 * the ones that make it correct rather than merely present, and every one of
 * them is invisible in a screenshot:
 *
 *   - The monitor must be created BEFORE the device and its id carried onto
 *     the device. Binding afterwards would leave a window where the device is
 *     Pending, and would miss the create-time stamp that
 *     NetworkDeviceService.onCreateSuccess performs — the #3392 mechanism that
 *     makes the pill resolve without waiting for a status CHANGE.
 *   - The scan's own probe must be attached to the monitor. The project's
 *     default probes include GLOBAL probes on the public internet, which
 *     cannot reach an RFC1918 address — so a defaulted monitor would fail
 *     every check and drive the device to "Offline", which is a worse answer
 *     than "Pending" because it looks like a real outage.
 *   - A monitor created for a device whose own create then fails must be
 *     cleaned up, or a failed import silently leaves billable monitors behind.
 *   - The seed ids must be resolved ONCE, outside the loop. They describe the
 *     project, not a host; resolving per host turns a 14-host import into 56
 *     extra requests and reports a missing status 14 times.
 *   - It must be OFF by default. Monitors are billable and plan-limited.
 *
 * METHOD. The App suite runs in a plain Node environment with no React
 * renderer (see jest.config.json), so the dialog cannot be mounted and
 * clicked. Comments are stripped before anything is asserted — describing a
 * rule in prose can never satisfy a test that it is implemented — and
 * whitespace is squashed so Prettier may reflow freely. Slices assert their
 * markers were found, because a bare indexOf returning -1 makes a slice cover
 * the whole file and every assertion under it pass for the wrong reason. Same
 * approach as DiscoveryReviewLifecycleInvariants.test.ts.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const DISCOVERY_PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "Discovery.tsx",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(filePath: string): string {
  return stripComments(fs.readFileSync(filePath, "utf8")).replace(/\s+/g, " ");
}

function sliceBetween(data: {
  code: string;
  from: string;
  to: string;
}): string {
  const start: number = data.code.indexOf(data.from);
  const end: number = data.code.indexOf(data.to, start + 1);

  expect({ from: data.from, found: start > -1 }).toEqual({
    from: data.from,
    found: true,
  });
  expect({ to: data.to, after: end > start }).toEqual({
    to: data.to,
    after: true,
  });

  return data.code.slice(start, end);
}

/** The body of the import handler, up to the render return. */
function importSection(): string {
  return sliceBetween({
    code: readCode(DISCOVERY_PAGE),
    from: "const importSelectedDevices",
    to: "if (isLoading)",
  });
}

/** The per-host body of the import loop. */
function importLoop(): string {
  return sliceBetween({
    code: importSection(),
    from: "for (const entry of entriesToImport)",
    to: "setIsImporting(false)",
  });
}

describe("the ping-monitor option is opt-in", () => {
  test("it defaults to off", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    /*
     * A monitor is billable and plan-limited. Creating a batch of them has to
     * be something the operator turned on, never a side effect of recording
     * inventory.
     */
    expect(code).toContain(
      "const [createPingMonitors, setCreatePingMonitors] = useState<boolean>(false)",
    );
  });

  test("opening and closing a review both reset it", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    /*
     * Per-dialog, not per-page: opting a batch of IP phones into monitors says
     * nothing about the next scan, which may be a rack of switches.
     */
    const resets: number =
      code.split("setCreatePingMonitors(false)").length - 1;

    expect(resets).toBeGreaterThanOrEqual(2);
  });

  test("the control is rendered, and only when the scan found hosts it applies to", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    expect(code).toContain("noSnmpHostCount > 0 && (");
    expect(code).toContain(
      'dataTestId="discovered-device-create-ping-monitors"',
    );
  });

  test("the control is a Toggle, which does not disturb the row checkbox slices", () => {
    /*
     * DiscoveryReviewCopy and DiscoveryReviewLifecycleInvariants both anchor
     * slices on the FIRST "<CheckboxElement" in this page. A second one above
     * the row would silently retarget them, and their assertions would then
     * describe the wrong element while still going green.
     */
    const code: string = readCode(DISCOVERY_PAGE);

    expect(code.split("<CheckboxElement").length - 1).toBe(1);
    expect(code).toContain("<Toggle");
  });
});

describe("the monitor is created before the device and bound to it", () => {
  test("the monitor id is carried onto the device", () => {
    const loop: string = importLoop();

    /*
     * Binding at CREATE time is what makes NetworkDeviceService stamp the
     * monitor's current status onto the device immediately. Binding afterwards
     * leaves the device Pending until the monitor's next status CHANGE, which
     * on a healthy network may never come (#3392).
     */
    expect(loop).toContain("device.monitorId = provisionedMonitorId");
  });

  test("the monitor create happens before the device create", () => {
    const loop: string = importLoop();

    const monitorCreateAt: number = loop.indexOf("createPingMonitorForHost");
    const deviceCreateAt: number = loop.indexOf(
      "ModelAPI.create<NetworkDevice>",
    );

    expect(monitorCreateAt).toBeGreaterThan(-1);
    expect(deviceCreateAt).toBeGreaterThan(-1);
    expect(monitorCreateAt).toBeLessThan(deviceCreateAt);
  });

  test("only ping-only hosts get one", () => {
    const loop: string = importLoop();

    /*
     * An SNMP host is polled by its probe and has no use for a ping monitor;
     * creating one anyway would be a billable surprise.
     */
    expect(loop).toContain(
      "if (pingMonitorSeedIds && isPingOnlyDiscoveredHost(entry))",
    );
  });
});

describe("the monitor is reachable and the failure paths are safe", () => {
  test("the scan's probe is attached rather than the project defaults", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    /*
     * Default probe attachment includes global probes on the public internet.
     * Pointed at 10.246.174.13 they fail every check, and the criteria then
     * drive the device to Offline — a worse dead end than Pending, because it
     * looks like a real outage rather than a missing binding.
     */
    const helper: string = sliceBetween({
      code: code,
      from: "async function createPingMonitorForHost",
      to: "async function deleteMonitorQuietly",
    });

    expect(helper).toContain("miscDataProps");
    expect(helper).toContain("probes: [data.scan.probeId.toString()]");
  });

  test("a monitor whose device then fails to create is cleaned up", () => {
    const loop: string = importLoop();

    /*
     * Otherwise a failed import leaves billable monitors behind, pointing at
     * devices that do not exist.
     */
    expect(loop).toContain("if (provisionedMonitorId)");
    expect(loop).toContain("deleteMonitorQuietly(provisionedMonitorId)");
  });

  test("the per-host failure path still records the import failure", () => {
    const loop: string = importLoop();

    // Cleanup must not swallow the error the operator needs to see.
    expect(loop).toContain("failures.push(");
  });

  test("cleanup cannot itself abort the import", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    const cleanup: string = sliceBetween({
      code: code,
      from: "async function deleteMonitorQuietly",
      to: "const NetworkDeviceDiscovery",
    });

    expect(cleanup).toContain("try {");
    expect(cleanup).toContain("catch");
  });
});

describe("the project-scoped seed ids are resolved once", () => {
  test("they are resolved before the loop, not inside it", () => {
    const section: string = importSection();

    const resolveAt: number = section.indexOf("PingMonitorSeedIds.resolve()");
    const loopAt: number = section.indexOf(
      "for (const entry of entriesToImport)",
    );

    expect(resolveAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(-1);

    /*
     * They describe the PROJECT, not a host. Resolving per host turns a
     * 14-host import into 56 extra requests and reports a missing monitor
     * status fourteen times over.
     */
    expect(resolveAt).toBeLessThan(loopAt);
  });

  test("they are only resolved when the run will actually use them", () => {
    const section: string = importSection();

    /*
     * An import with the toggle off, or one whose selection contains no
     * ping-only hosts, must not pay for four extra requests.
     */
    expect(section).toContain("const wantsPingMonitors: boolean =");
    expect(section).toContain("if (wantsPingMonitors)");
  });

  test("a project missing a status or severity fails the run once, with its own message", () => {
    const section: string = importSection();

    /*
     * Surfacing it as a per-host import failure would repeat the same
     * sentence once per host and bury the actual fix.
     */
    const guard: string = sliceBetween({
      code: section,
      from: "if (wantsPingMonitors)",
      to: "for (const entry of entriesToImport)",
    });

    expect(guard).toContain("setImportError(API.getFriendlyMessage(err))");
    expect(guard).toContain("return;");
  });
});

describe("a monitor is an enhancement to the import, not a precondition", () => {
  test("a monitor failure does not stop the device being imported", () => {
    const loop: string = importLoop();

    /*
     * A project on the free plan runs out of monitor quota partway through a
     * fourteen-host batch. Failing those hosts entirely would leave the
     * operator with neither the monitors nor the inventory they asked to
     * import — so the monitor create has its OWN try/catch inside the host's,
     * and the device create runs either way.
     */
    expect(loop).toContain("catch (monitorErr)");
    expect(loop).toContain("monitorFailures.push(");

    const monitorCatchAt: number = loop.indexOf("catch (monitorErr)");
    const deviceCreateAt: number = loop.indexOf(
      "ModelAPI.create<NetworkDevice>",
    );

    // The device create is AFTER the monitor's catch, so it still runs.
    expect(monitorCatchAt).toBeGreaterThan(-1);
    expect(deviceCreateAt).toBeGreaterThan(monitorCatchAt);
  });

  test("hosts that imported without their monitor are reported separately from hosts that did not import", () => {
    const section: string = importSection();

    /*
     * The two need different words: one set is in the inventory with nothing
     * reporting on it, the other is not in the inventory at all. Collapsing
     * them into one sentence tells the operator to retry an import that
     * already succeeded.
     */
    expect(section).toContain("const monitorFailures: Array<string> = []");
    expect(section).toContain("Imported, but no Ping monitor could be created");
  });

  test("a monitor-only problem still keeps the dialog open", () => {
    const section: string = importSection();

    /*
     * Reported through the same channel as import failures precisely so the
     * close-on-success gate does not fire — otherwise the message would show
     * for exactly as long as it took to disappear.
     */
    const foldIn: number = section.indexOf("failures.push( `Imported,");
    const gate: number = section.indexOf("if (failures.length > 0)");

    expect(foldIn).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(foldIn);
  });
});

describe("the dialog still tells the operator what a No SNMP host is", () => {
  test("the pill keeps its name", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    // DiscoveryReviewCopy pins this too; restating it here keeps the reword safe.
    expect(code).toContain("No SNMP");
  });

  test("the pill's tooltip points at the new option rather than only at manual work", () => {
    const code: string = readCode(DISCOVERY_PAGE);

    expect(code).toContain("Create a Ping monitor");
  });
});
