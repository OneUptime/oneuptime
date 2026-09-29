import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The "Create Ping Monitor" button on a monitor-backed device's Overview and
 * Monitors pages deep-links the monitor create page with
 * `?networkDeviceId=<id>`. That link used to mean one thing: seed a Network
 * Device monitor with the Recommended Alert Pack. Right for an SNMP device —
 * a probe walks it, and the monitor decides what to alert on. Wrong for a
 * monitor-backed device: nothing polls it, the bound monitor IS its health,
 * and a Network Device monitor neither pings the address nor binds to the
 * device. The operator saved the monitor, landed on the monitor's page, and
 * the device carried on reading "Pending" (OneUptime/oneuptime#3447).
 *
 * The create page now branches on the device's monitoring method:
 *
 *   - SNMP keeps the Network Device shape, byte for byte.
 *   - Monitor-backed opens on the same Ping monitor discovery import and the
 *     bulk action build — through the shared builder, seeded by the shared
 *     resolver — attaches the device's OWN probe over the project defaults,
 *     and after the create BINDS the monitor to the device and lands on the
 *     device, where the result is visible.
 *
 * Every one of those is a prop, a branch or an await that a refactor can drop
 * without a type error. And two of them are about what happens INSIDE
 * onSuccess, which ModelForm does not await: a rejection there is swallowed,
 * so the bind has to sit in its own try and report its own failure.
 *
 * METHOD. The App suite runs in a plain Node environment with no React
 * renderer (see jest.config.json), so the page cannot be mounted. Comments
 * are stripped before anything is asserted — describing a rule in prose can
 * never satisfy a test that it is implemented — and whitespace is squashed so
 * Prettier may reflow freely. Slices assert their markers were found, because
 * a bare indexOf returning -1 makes a slice cover the whole file and every
 * assertion under it pass for the wrong reason. Same approach as
 * DiscoveryPingMonitorProvisioning.test.ts.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const CREATE_PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Monitor",
  "Create.tsx",
);

const DEVICE_MONITORS_CARD: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DeviceMonitorsCard.tsx",
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

/** The deep-link handler: the device read, the branch, and the SNMP shape. */
function deepLinkPreSeed(): string {
  return sliceBetween({
    code: readCode(CREATE_PAGE),
    from: "const preSeedFromNetworkDeviceLink",
    to: "const preSeedFromDetectionRuleLink",
  });
}

/** The monitor-backed branch: the Ping monitor the form opens on. */
function pingPreSeed(): string {
  return sliceBetween({
    code: readCode(CREATE_PAGE),
    from: "const preSeedPingMonitorForMonitorBackedDevice",
    to: "const preSeedFromNetworkDeviceLink",
  });
}

/** The helper onSuccess hands a device-linked monitor to. */
function bindHelper(): string {
  return sliceBetween({
    code: readCode(CREATE_PAGE),
    from: "const bindCreatedMonitorToDevice",
    to: "const fetchMonitorTemplate",
  });
}

/** The form's onSuccess prop, up to the next prop. */
function onSuccessHandler(): string {
  return sliceBetween({
    code: readCode(CREATE_PAGE),
    from: "onSuccess={(createdItem: Monitor) => {",
    to: "submitButtonText=",
  });
}

describe("the deep link reads what it needs to branch", () => {
  test("it selects the monitoring method, address and probe alongside the name", () => {
    /*
     * The method decides the branch; the address is what the Ping monitor
     * pings; the probe is the one that can reach the device. Selecting only
     * the name — as the SNMP-only version did — makes every device read as
     * SNMP, because the method parses NULL as SNMP.
     */
    expect(deepLinkPreSeed()).toContain(
      "select: { name: true, hostname: true, monitoringMethod: true, probeId: true, }",
    );
  });

  test("it branches through the shared parser, not a raw string compare", () => {
    // Rows written before the column existed hold NULL and must read as SNMP.
    expect(deepLinkPreSeed()).toContain(
      "NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)",
    );
  });

  test("the monitor-backed branch returns before the SNMP shape is built", () => {
    const code: string = deepLinkPreSeed();

    const branchAt: number = code.indexOf(
      "await preSeedPingMonitorForMonitorBackedDevice(",
    );
    const snmpShapeAt: number = code.indexOf(
      "monitorType: MonitorType.NetworkDevice",
    );

    expect(branchAt).toBeGreaterThan(-1);
    expect(snmpShapeAt).toBeGreaterThan(branchAt);
    expect(code.slice(branchAt, snmpShapeAt)).toContain("return;");
  });
});

describe("an SNMP device still gets the Network Device shape", () => {
  test("it seeds the Network Device type", () => {
    expect(deepLinkPreSeed()).toContain(
      "monitorType: MonitorType.NetworkDevice",
    );
  });

  test("it references the device in the step", () => {
    expect(deepLinkPreSeed()).toContain("networkDeviceId: networkDeviceId");
  });

  test("it seeds the Recommended Alert Pack", () => {
    expect(deepLinkPreSeed()).toContain(
      "NetworkDeviceAlertPackUtil.buildCriteriaInstances(",
    );
  });

  test("an unreadable device falls back to the SNMP shape, as before", () => {
    /*
     * The guard is `device &&` — a device that could not be read is not
     * assumed monitor-backed. That is the pre-branch behaviour: a generic
     * Network Device monitor, which the operator can still retype.
     */
    expect(deepLinkPreSeed()).toContain(
      "if ( device && NetworkDeviceMonitoringMethodUtil.isMonitorBacked(",
    );
  });
});

describe("a monitor-backed device gets the shared Ping monitor", () => {
  test("it is built by the shared builder, with the device-page origin", () => {
    /*
     * One builder for every provisioning surface is what lets an operator
     * treat every provisioned monitor the same way; the origin is the only
     * sentence that differs, and it says where the monitor came from.
     */
    expect(pingPreSeed()).toContain("buildPingMonitorForAddress({");
    expect(pingPreSeed()).toContain("origin: PingMonitorOrigin.DevicePage");
  });

  test("it is pointed at the device's address and named after the device", () => {
    expect(pingPreSeed()).toContain("address: data.device.hostname");
    expect(pingPreSeed()).toContain("deviceName: data.device.name");
  });

  test("its seed ids come from the shared resolver", () => {
    expect(pingPreSeed()).toContain("PingMonitorSeedIds.resolve()");
  });

  test("a project missing a status or severity replaces the form with the resolver's message", () => {
    /*
     * PingMonitorSeedIdsUnavailableError messages name the fix. Swallowing
     * them here would open a form whose criteria step cannot be completed.
     */
    expect(pingPreSeed()).toContain(
      "catch (err) { setError(API.getFriendlyMessage(err)); return; }",
    );
  });

  test("the form opens as a Ping monitor on the shared interval", () => {
    expect(pingPreSeed()).toContain("monitorType: MonitorType.Ping");
    expect(pingPreSeed()).toContain(
      "monitorSteps: monitor.monitorSteps!.toJSON()",
    );
    expect(pingPreSeed()).toContain(
      "monitoringInterval: PING_MONITOR_INTERVAL",
    );
  });

  test("it does not seed the SNMP alert pack", () => {
    // Interface-down and health-OID criteria are meaningless for a ping.
    expect(pingPreSeed()).not.toContain("NetworkDeviceAlertPackUtil");
  });

  test("it remembers which device to bind", () => {
    expect(pingPreSeed()).toContain(
      "bindToNetworkDeviceId.current = new ObjectID(data.networkDeviceId)",
    );
  });
});

describe("the device's own probe wins over the project defaults", () => {
  test("the device's probe is recorded apart from the defaults", () => {
    /*
     * loadProbes and the pre-seed run concurrently; writing the device's
     * probe into defaultProbeIds would race the probe list's own write, and
     * whichever finished last would silently win the form.
     */
    expect(pingPreSeed()).toContain(
      "setDeviceProbeIds( data.device.probeId ? [data.device.probeId.toString()] : null, )",
    );
    expect(pingPreSeed()).not.toContain("setDefaultProbeIds(");
  });

  test("the merge prefers the device's probe, once the probe list has loaded it", () => {
    const code: string = readCode(CREATE_PAGE);

    /*
     * BasicForm drops an initial value that is not among the options and
     * submits probes: [] — "attach no probes" to the server. So the pin
     * holds only when the loaded options carry the device's probe; a failed
     * load falls through to the defaults, or to no selection at all.
     */
    expect(code).toContain(
      "const pinnedDeviceProbes: Array<string> | null = deviceProbeIds && deviceProbeIds.every((probeId: string): boolean => { return probeOptions.some((option: DropdownOption): boolean => { return option.value === probeId; }); }) ? deviceProbeIds : null;",
    );
    expect(code).toContain(
      "const seededProbes: Array<string> | null = pinnedDeviceProbes ?? defaultProbeIds;",
    );
    expect(code).toContain(
      "seededProbes ? { ...initialValues, probes: seededProbes } : initialValues",
    );
  });
});

describe("the created monitor is bound to the device", () => {
  test("onSuccess hands a device-linked monitor to the bind helper instead of the monitor view", () => {
    const handler: string = onSuccessHandler();

    const bindAt: number = handler.indexOf("bindCreatedMonitorToDevice(");
    const monitorViewAt: number = handler.indexOf(
      "RouteMap[PageMap.MONITOR_VIEW] as Route",
    );

    expect(bindAt).toBeGreaterThan(-1);
    expect(monitorViewAt).toBeGreaterThan(bindAt);
    // The device path returns; it must not fall through to the monitor view.
    expect(handler.slice(bindAt, monitorViewAt)).toContain("return;");
  });

  test("the revenue event still fires, before the branch", () => {
    const handler: string = onSuccessHandler();

    const captureAt: number = handler.indexOf(
      "UiAnalytics.captureRevenueEvent(",
    );
    const bindAt: number = handler.indexOf("bindCreatedMonitorToDevice(");

    expect(captureAt).toBeGreaterThan(-1);
    expect(captureAt).toBeLessThan(bindAt);
  });

  test("the bind sits inside a try, because ModelForm does not await onSuccess", () => {
    const helper: string = bindHelper();

    const tryAt: number = helper.indexOf("try {");
    const bindAt: number = helper.indexOf("await bindMonitorToDevice({");
    const catchAt: number = helper.indexOf("catch (err)");

    expect(tryAt).toBeGreaterThan(-1);
    expect(bindAt).toBeGreaterThan(tryAt);
    expect(catchAt).toBeGreaterThan(bindAt);
  });

  test("the bind gates the page the way loading does", () => {
    const code: string = readCode(CREATE_PAGE);

    expect(bindHelper()).toContain("setIsBinding(true)");
    expect(code).toContain("(isLoading || isLoadingProbes || isBinding) && (");
    expect(code).toContain(
      "{!isLoading && !isLoadingProbes && !isBinding && !error && (",
    );
  });

  test("a bound monitor lands on the device, where the result is visible", () => {
    /*
     * Binding re-stamps the device with the monitor's current status, so
     * the device page shows the pill resolving; the monitor page shows
     * nothing about the device at all.
     */
    expect(bindHelper()).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route",
    );
    expect(bindHelper()).toContain("modelId: data.deviceId");
  });

  test("a failed bind says so, says where to finish by hand, and keeps the monitor", () => {
    const helper: string = bindHelper();
    const catchAt: number = helper.indexOf("catch (err)");

    expect(catchAt).toBeGreaterThan(-1);

    const failure: string = helper.slice(catchAt);

    expect(failure).toContain("setIsBinding(false)");
    expect(failure).toContain(
      "The monitor was created but could not be bound to the device",
    );
    expect(failure).toContain("Bind it under the device's Settings → Monitor.");
    /*
     * The operator reviewed and saved this monitor on purpose. Deleting it
     * because the bind failed — as the bulk action does for monitors nobody
     * looked at — would throw that work away.
     */
    expect(bindHelper()).not.toContain("deleteMonitorQuietly");
  });

  test("every other path still lands on the monitor view", () => {
    expect(onSuccessHandler()).toContain(
      "RouteMap[PageMap.MONITOR_VIEW] as Route",
    );
    expect(onSuccessHandler()).toContain("modelId: createdItem._id");
  });
});

describe("the device page's button is the link the create page branches on", () => {
  test("it carries the device id as the query param the create page reads", () => {
    const card: string = readCode(DEVICE_MONITORS_CARD);

    expect(card).toContain("?networkDeviceId=${props.networkDeviceId}");
    expect(readCode(CREATE_PAGE)).toContain(
      'Navigation.getQueryStringByName("networkDeviceId")',
    );
  });

  test("its copy promises what the create page now does", () => {
    const card: string = readCode(DEVICE_MONITORS_CARD);

    expect(card).toContain("binds it to the device for you");
    expect(card).toContain("Create Ping Monitor");
  });
});
