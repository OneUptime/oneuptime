import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import MonitorSummaryView from "./MonitorSummaryView";
import type { MonitorProbeItem, ProbeMonitorResponse } from "../api/monitors";

/*
 * This block is the only place in the app where a responder sees what the
 * probe actually measured. Everything else - the status pill, the incident,
 * the page that woke them up - is a verdict someone else computed; this is the
 * evidence. So the failure that matters here is not a crash, it is the summary
 * quietly leaving a measurement out and thereby contradicting the page.
 *
 * There are five renderers behind one component, chosen by monitorType, and
 * every one of them reads a field that the payload is allowed to omit. A
 * monitor that has never run, an agent too old to report memory, a ping that
 * timed out before it had a response time - all of them arrive as `undefined`
 * on a field the TypeScript type already says is optional, so nothing but a
 * test stops a future edit from rendering "NaN%" or "[object Object]" over the
 * top of it.
 *
 * The probe is faked at the boundary the component actually takes - an array
 * of MonitorProbeItem, exactly as fetchMonitorProbes returns it - rather than
 * by mocking anything, because there is nothing here to mock: this component
 * is pure rendering over that array.
 */

/**
 * A probe row carrying one monitoring log entry.
 *
 * `lastMonitoringLog` is a map, not a single response, and the component reads
 * whatever the first key holds; the key is spelled out per fixture rather than
 * defaulted so the tests about that lookup can vary it.
 */
function probeWith(
  response: ProbeMonitorResponse,
  overrides: Partial<MonitorProbeItem> = {},
): MonitorProbeItem {
  return {
    _id: "monitor-probe-1",
    probeId: "probe-1",
    probe: { _id: "probe-1", name: "US East" },
    lastMonitoringLog: { "probe-1": response },
    ...overrides,
  };
}

async function renderSummary(
  monitorType: string | undefined,
  probeItems: MonitorProbeItem[],
): Promise<void> {
  await render(
    <MonitorSummaryView monitorType={monitorType} probeItems={probeItems} />,
  );
}

const ONLINE_WEBSITE: ProbeMonitorResponse = {
  isOnline: true,
  responseCode: 200,
  responseTimeInMs: 342,
  monitorDestination: "https://api.example.com",
  monitoredAt: "2026-08-30T10:00:00.000Z",
};

describe("A monitor that has not reported anything yet", () => {
  test("says so rather than rendering an empty card", async () => {
    await renderSummary("Website", []);

    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
  });

  test("a probe row with no monitoring log at all is the same kind of nothing", async () => {
    /*
     * This is what a monitor that was created seconds ago looks like: the
     * probe has been assigned to it, so the row exists, but it has not run.
     */
    const probe: MonitorProbeItem = {
      _id: "monitor-probe-1",
      probeId: "probe-1",
      probe: { _id: "probe-1", name: "US East" },
    };

    await renderSummary("Website", [probe]);

    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
  });

  test("an empty monitoring log is not mistaken for a result", async () => {
    const probe: MonitorProbeItem = {
      _id: "monitor-probe-1",
      probeId: "probe-1",
      lastMonitoringLog: {},
    };

    await renderSummary("Website", [probe]);

    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
  });

  test("a log whose entry is missing does not render a blank summary", async () => {
    /*
     * A key with nothing under it reaches the same place as no key at all.
     * Without the nullish guard this renders every metric as "--" inside a
     * card that looks like a real reading.
     */
    const probe: MonitorProbeItem = {
      _id: "monitor-probe-1",
      lastMonitoringLog: { "probe-1": undefined } as unknown as Record<
        string,
        ProbeMonitorResponse
      >,
    };

    await renderSummary("Website", [probe]);

    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
    expect(screen.queryByText("Status Code")).toBeNull();
  });

  test("the log is read by position, not by probe id", async () => {
    /*
     * The server keys this map by the monitor step, not by the probe, so a
     * lookup of log[probeId] would find nothing on every real payload. The
     * first entry is the contract.
     */
    const probe: MonitorProbeItem = {
      _id: "monitor-probe-1",
      probeId: "probe-1",
      lastMonitoringLog: { "monitor-step-9f2": ONLINE_WEBSITE },
    };

    await renderSummary("Website", [probe]);

    expect(screen.getByText("200")).toBeTruthy();
  });
});

describe("The summary a website, API or certificate monitor gets", () => {
  const STATUS_CODE_TYPES: string[] = ["Website", "API", "SSLCertificate"];

  STATUS_CODE_TYPES.forEach((monitorType: string) => {
    test(`a ${monitorType} monitor is summarised by its status code`, async () => {
      await renderSummary(monitorType, [probeWith(ONLINE_WEBSITE)]);

      expect(screen.getByText("Status Code")).toBeTruthy();
      expect(screen.getByText("200")).toBeTruthy();
    });
  });

  test("the response time, the verdict and the URL are all on screen", async () => {
    await renderSummary("Website", [probeWith(ONLINE_WEBSITE)]);

    expect(screen.getByText("Response Time")).toBeTruthy();
    expect(screen.getByText("342")).toBeTruthy();
    expect(screen.getByText("ms")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("https://api.example.com")).toBeTruthy();
  });

  test("a failing status code is reported as the number it was, not as an error", async () => {
    /*
     * 503 and 200 take different colours but the same slot. What must not
     * happen is the number being swallowed, because "the site returned 503"
     * and "the probe could not reach the site" are different pages.
     */
    await renderSummary("API", [
      probeWith({
        ...ONLINE_WEBSITE,
        isOnline: false,
        responseCode: 503,
        failureCause: "Service Unavailable",
      }),
    ]);

    expect(screen.getByText("503")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("Service Unavailable")).toBeTruthy();
  });

  test("an offline probe never claims to be online", async () => {
    await renderSummary("Website", [
      probeWith({ isOnline: false, responseCode: 200 }),
    ]);

    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText("Online")).toBeNull();
  });

  test("a response with no isOnline field at all is not read as online", async () => {
    /*
     * `isOnline` is optional, and an absent one is not evidence of health.
     * The falsy branch is the safe one and this pins it there.
     */
    await renderSummary("Website", [probeWith({ responseCode: 200 })]);

    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText("Online")).toBeNull();
  });

  test("a slow response is shown in seconds rather than four digits of milliseconds", async () => {
    await renderSummary("Website", [
      probeWith({ ...ONLINE_WEBSITE, responseTimeInMs: 1500 }),
    ]);

    expect(screen.getByText("1.50")).toBeTruthy();
    expect(screen.getByText("s")).toBeTruthy();
    expect(screen.queryByText("ms")).toBeNull();
  });

  test("a sub-millisecond precision reading is rounded, not printed raw", async () => {
    await renderSummary("Website", [
      probeWith({ ...ONLINE_WEBSITE, responseTimeInMs: 342.7 }),
    ]);

    expect(screen.getByText("343")).toBeTruthy();
    expect(screen.queryByText("342.7")).toBeNull();
  });

  test("a response time of zero is still a measurement", async () => {
    /*
     * 0 is falsy, so any `responseTimeInMs && ...` guard drops the card
     * entirely and the summary silently loses a real reading from a cached
     * or local endpoint.
     */
    await renderSummary("Website", [
      probeWith({ ...ONLINE_WEBSITE, responseTimeInMs: 0 }),
    ]);

    expect(screen.getByText("Response Time")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  test("a probe that never got a reply leaves out the cards it has no numbers for", async () => {
    await renderSummary("Website", [
      probeWith({
        isOnline: false,
        monitorDestination: "https://api.example.com",
        failureCause: "Connection timed out",
      }),
    ]);

    expect(screen.queryByText("Status Code")).toBeNull();
    expect(screen.queryByText("Response Time")).toBeNull();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Connection timed out")).toBeTruthy();
  });

  test("a destination that arrives as a typed object is unwrapped to its URL", async () => {
    /*
     * OneUptime serialises URL, Port and friends as { _type, value }. Printed
     * with the default object coercion this row reads "[object Object]",
     * which tells the responder nothing about which endpoint was probed.
     */
    await renderSummary("Website", [
      probeWith({
        ...ONLINE_WEBSITE,
        monitorDestination: {
          _type: "URL",
          value: "https://payments.example.com/health",
        } as unknown as string,
      }),
    ]);

    expect(
      screen.getByText("https://payments.example.com/health"),
    ).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
  });

  test("a failure cause that arrives as an object is still readable", async () => {
    await renderSummary("Website", [
      probeWith({
        ...ONLINE_WEBSITE,
        isOnline: false,
        failureCause: {
          message: "ECONNREFUSED",
        } as unknown as string,
      }),
    ]);

    expect(screen.getByText('{"message":"ECONNREFUSED"}')).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
  });

  test("a monitor with no timestamp does not render an empty Monitored At row", async () => {
    await renderSummary("Website", [
      probeWith({ isOnline: true, responseCode: 200 }),
    ]);

    expect(screen.queryByText("Monitored At")).toBeNull();
    expect(screen.queryByText("URL")).toBeNull();
  });

  test("a timestamp is formatted rather than printed as the wire value", async () => {
    /*
     * The exact rendering is locale- and timezone-dependent, so what is
     * asserted is the part that is not: the raw ISO string the API sent must
     * not reach the screen.
     */
    await renderSummary("Website", [probeWith(ONLINE_WEBSITE)]);

    expect(screen.getByText("Monitored At")).toBeTruthy();
    expect(screen.queryByText("2026-08-30T10:00:00.000Z")).toBeNull();
  });

  test("a timestamp that cannot be parsed is shown as sent instead of as Invalid Date", async () => {
    await renderSummary("Website", [
      probeWith({ ...ONLINE_WEBSITE, monitoredAt: "not a date" }),
    ]);

    expect(screen.getByText("not a date")).toBeTruthy();
    expect(screen.queryByText("Invalid Date")).toBeNull();
  });
});

describe("The summary a ping-family monitor gets", () => {
  const HOST_TYPES: string[] = ["Ping", "IP", "Port", "DNS", "Domain"];

  HOST_TYPES.forEach((monitorType: string) => {
    test(`a ${monitorType} monitor is summarised by host rather than by status code`, async () => {
      await renderSummary(monitorType, [
        probeWith({
          isOnline: true,
          responseTimeInMs: 12,
          monitorDestination: "10.0.0.5",
          responseCode: 200,
        }),
      ]);

      expect(screen.getByText("Host")).toBeTruthy();
      expect(screen.getByText("10.0.0.5")).toBeTruthy();

      /*
       * A ping has no HTTP status even when the payload carries one from a
       * previous monitor type, and showing it would invent an HTTP result for
       * a check that never made an HTTP request.
       */
      expect(screen.queryByText("Status Code")).toBeNull();
    });
  });

  test("a port monitor names the port beside the host", async () => {
    await renderSummary("Port", [
      probeWith({
        isOnline: true,
        monitorDestination: "db.internal",
        monitorDestinationPort: 5432,
      }),
    ]);

    expect(screen.getByText("db.internal:5432")).toBeTruthy();
  });

  test("a host with no port is not given a stray colon", async () => {
    await renderSummary("Ping", [
      probeWith({ isOnline: true, monitorDestination: "db.internal" }),
    ]);

    expect(screen.getByText("db.internal")).toBeTruthy();
    expect(screen.queryByText("db.internal:")).toBeNull();
  });

  test("an unreachable host reports offline with the reason", async () => {
    await renderSummary("Ping", [
      probeWith({
        isOnline: false,
        monitorDestination: "db.internal",
        failureCause: "Destination host unreachable",
        isTimeout: true,
      }),
    ]);

    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Destination host unreachable")).toBeTruthy();
    expect(screen.queryByText("Response Time")).toBeNull();
  });
});

describe("The summary a server monitor gets", () => {
  test("CPU, memory and the disk are reported as whole percentages", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        hostname: "web-01.internal",
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 41.4, cores: 8 },
          memoryMetrics: { percentUsed: 62.6, totalInGB: 16 },
          diskMetrics: [{ diskPath: "/", percentUsed: 12.2, totalInGB: 100 }],
        },
      }),
    ]);

    expect(screen.getByText("41")).toBeTruthy();
    expect(screen.getByText("63")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("web-01.internal")).toBeTruthy();
  });

  test("every mounted volume is reported, not only the first one", async () => {
    /*
     * THE regression this file exists for. A server agent reports one entry
     * per volume, and the summary used to read diskMetrics[0]. The box below
     * is the realistic shape of a disk page: root is fine, /var is full, and
     * root is the one that sorts first. Showing only root turns the one screen
     * a responder opens to confirm the page into a screen that denies it.
     */
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 9 },
          memoryMetrics: { percentUsed: 31 },
          diskMetrics: [
            { diskPath: "/", percentUsed: 12, totalInGB: 100 },
            { diskPath: "/var", percentUsed: 97, totalInGB: 50 },
          ],
        },
      }),
    ]);

    expect(screen.getByText("/")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("/var")).toBeTruthy();
    expect(screen.getByText("97")).toBeTruthy();
  });

  test("a third volume is not dropped either", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          diskMetrics: [
            { diskPath: "/", percentUsed: 10 },
            { diskPath: "/var", percentUsed: 20 },
            { diskPath: "/data", percentUsed: 99 },
          ],
        },
      }),
    ]);

    expect(screen.getByText("/data")).toBeTruthy();
    expect(screen.getByText("99")).toBeTruthy();
  });

  test("volumes the agent did not name are numbered so two of them can be told apart", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          diskMetrics: [{ percentUsed: 22 }, { percentUsed: 91 }],
        },
      }),
    ]);

    expect(screen.getByText("Disk 1")).toBeTruthy();
    expect(screen.getByText("22")).toBeTruthy();
    expect(screen.getByText("Disk 2")).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
  });

  test("a single unnamed volume is still just called Disk", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          diskMetrics: [{ percentUsed: 22 }],
        },
      }),
    ]);

    expect(screen.getByText("Disk")).toBeTruthy();
    expect(screen.queryByText("Disk 1")).toBeNull();
  });

  test("a volume that reported no usage shows a placeholder, not a zero", async () => {
    /*
     * "0%" is a claim about the volume. A missing reading is not, and on a
     * disk page the difference decides whether the responder goes looking.
     */
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 41 },
          memoryMetrics: { percentUsed: 62 },
          diskMetrics: [{ diskPath: "/", totalInGB: 100 }],
        },
      }),
    ]);

    expect(screen.getByText("/")).toBeTruthy();
    expect(screen.getAllByText("--")).toHaveLength(1);
    expect(screen.queryByText("0")).toBeNull();
  });

  test("an agent that reports no disks at all still leaves the disk slot on screen", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 41 },
          memoryMetrics: { percentUsed: 62 },
        },
      }),
    ]);

    expect(screen.getByText("Disk")).toBeTruthy();
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("an empty disk array is treated as no reading rather than as no disks", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 41 },
          memoryMetrics: { percentUsed: 62 },
          diskMetrics: [],
        },
      }),
    ]);

    expect(screen.getByText("Disk")).toBeTruthy();
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("a missing memory reading does not take CPU and disk down with it", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: true,
        basicInfrastructureMetrics: {
          cpuMetrics: { percentUsed: 41 },
          diskMetrics: [{ diskPath: "/", percentUsed: 12 }],
        },
      }),
    ]);

    expect(screen.getByText("41")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("an agent reporting nothing renders three placeholders and no numbers", async () => {
    /*
     * An older agent, or one that has just been installed, answers with the
     * envelope and no metrics inside it.
     */
    await renderSummary("Server", [
      probeWith({ isOnline: true, basicInfrastructureMetrics: {} }),
    ]);

    expect(screen.getAllByText("--")).toHaveLength(3);
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("Disk")).toBeTruthy();
  });

  test("a server with no hostname omits the row rather than labelling nothing", async () => {
    await renderSummary("Server", [
      probeWith({ isOnline: true, basicInfrastructureMetrics: {} }),
    ]);

    expect(screen.queryByText("Hostname")).toBeNull();
    expect(screen.queryByText("Last Ping")).toBeNull();
  });

  test("an agent that stopped reporting shows its failure cause", async () => {
    await renderSummary("Server", [
      probeWith({
        isOnline: false,
        hostname: "web-01.internal",
        failureCause: "No heartbeat for 5 minutes",
        basicInfrastructureMetrics: {},
      }),
    ]);

    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("No heartbeat for 5 minutes")).toBeTruthy();
  });
});

describe("The summary every other monitor type falls back to", () => {
  const GENERIC_TYPES: string[] = [
    "IncomingRequest",
    "SyntheticMonitor",
    "CustomJavaScriptCode",
    "Logs",
    "Metrics",
    "Traces",
    "Manual",
  ];

  GENERIC_TYPES.forEach((monitorType: string) => {
    test(`a ${monitorType} monitor gets the plain online-or-offline summary`, async () => {
      await renderSummary(monitorType, [
        probeWith({ isOnline: true, responseTimeInMs: 25 }),
      ]);

      expect(screen.getByText("Online")).toBeTruthy();
      expect(screen.getByText("25")).toBeTruthy();
      expect(screen.queryByText("Status Code")).toBeNull();
      expect(screen.queryByText("CPU")).toBeNull();
      expect(screen.queryByText("Host")).toBeNull();
    });
  });

  test("a monitor type the app has never heard of still renders", async () => {
    /*
     * The server adds monitor types faster than the app ships. An unknown one
     * must not blank the card the responder came here for.
     */
    await renderSummary("QuantumEntanglement", [
      probeWith({ isOnline: false, failureCause: "Decoherence" }),
    ]);

    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Decoherence")).toBeTruthy();
  });

  test("a monitor with no type at all renders too", async () => {
    await renderSummary(undefined, [probeWith({ isOnline: true })]);

    expect(screen.getByText("Online")).toBeTruthy();
  });
});

describe("Choosing between probes", () => {
  const EAST: MonitorProbeItem = {
    _id: "monitor-probe-east",
    probeId: "probe-east",
    probe: { _id: "probe-east", name: "US East" },
    lastMonitoringLog: {
      "probe-east": {
        isOnline: true,
        responseCode: 200,
        responseTimeInMs: 120,
      },
    },
  };

  const WEST: MonitorProbeItem = {
    _id: "monitor-probe-west",
    probeId: "probe-west",
    probe: { _id: "probe-west", name: "EU West" },
    lastMonitoringLog: {
      "probe-west": {
        isOnline: false,
        responseCode: 502,
        responseTimeInMs: 8000,
      },
    },
  };

  test("a single probe gets no picker to choose it with", async () => {
    await renderSummary("Website", [EAST]);

    expect(screen.queryByText("US East")).toBeNull();
    expect(screen.getByText("200")).toBeTruthy();
  });

  test("two probes are both offered, and the first one is what is shown", async () => {
    await renderSummary("Website", [EAST, WEST]);

    expect(screen.getByText("US East")).toBeTruthy();
    expect(screen.getByText("EU West")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.queryByText("502")).toBeNull();
  });

  test("picking the second probe shows what that probe measured", async () => {
    /*
     * This is the whole point of the picker: one region failing while another
     * succeeds is the difference between "the site is down" and "one probe
     * lost its route", and the responder can only tell by switching.
     */
    await renderSummary("Website", [EAST, WEST]);

    await fireEvent.press(screen.getByText("EU West"));

    expect(screen.getByText("502")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText("200")).toBeNull();
  });

  test("pressing the probe that is already selected leaves it selected", async () => {
    await renderSummary("Website", [EAST, WEST]);

    await fireEvent.press(screen.getByText("EU West"));
    await fireEvent.press(screen.getByText("EU West"));

    expect(screen.getByText("502")).toBeTruthy();
  });

  test("switching back returns to the first probe's reading", async () => {
    await renderSummary("Website", [EAST, WEST]);

    await fireEvent.press(screen.getByText("EU West"));
    await fireEvent.press(screen.getByText("US East"));

    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.queryByText("502")).toBeNull();
  });

  test("probes with no name are offered by position", async () => {
    const first: MonitorProbeItem = {
      _id: "monitor-probe-a",
      lastMonitoringLog: { a: { isOnline: true, responseCode: 200 } },
    };
    const second: MonitorProbeItem = {
      _id: "monitor-probe-b",
      lastMonitoringLog: { b: { isOnline: false, responseCode: 500 } },
    };

    await renderSummary("Website", [first, second]);

    expect(screen.getByText("Probe 1")).toBeTruthy();

    await fireEvent.press(screen.getByText("Probe 2"));

    expect(screen.getByText("500")).toBeTruthy();
  });

  test("a selected probe that disappears on refresh does not blank the card", async () => {
    /*
     * The probe list is refetched on pull-to-refresh, and a probe can be
     * unassigned from the monitor between two fetches. The selected index
     * then points past the end of the array; the card falls back to the last
     * probe it still has rather than rendering nothing.
     */
    await renderSummary("Website", [EAST, WEST]);

    await fireEvent.press(screen.getByText("EU West"));
    expect(screen.getByText("502")).toBeTruthy();

    await screen.rerender(
      <MonitorSummaryView monitorType="Website" probeItems={[EAST]} />,
    );

    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.queryByText("No monitoring data available yet.")).toBeNull();
  });

  test("a probe list that empties entirely falls back to the empty state", async () => {
    await renderSummary("Website", [EAST, WEST]);

    await screen.rerender(
      <MonitorSummaryView monitorType="Website" probeItems={[]} />,
    );

    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
  });
});
