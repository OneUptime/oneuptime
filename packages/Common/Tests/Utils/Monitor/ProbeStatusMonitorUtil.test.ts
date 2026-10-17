import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ProbeStatusMonitorResponse from "../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeStatusMonitorUtil, {
  ProbeStatusSource,
} from "../../../Utils/Monitor/ProbeStatusMonitorUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of the Probe Status monitor: which probes count, how, and
 * the sentences that explain an evaluation. The server evaluates with it
 * every minute and the monitor's page reads the evaluation back with it, so
 * both ends are held here at once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000000010",
);
const STEP_ID: ObjectID = new ObjectID("84000000-0000-4000-8000-000000000101");
const CHECKED_AT: Date = new Date("2026-09-21T12:00:00.000Z");

const FRANKFURT: string = "73000000-0000-4000-8000-000000000001";
const VIRGINIA: string = "73000000-0000-4000-8000-000000000002";
const SINGAPORE: string = "73000000-0000-4000-8000-000000000003";
const GLOBAL: string = "73000000-0000-4000-8000-000000000004";

function probe(
  id: string,
  name: string,
  connectionStatus: ProbeConnectionStatus | undefined,
  extra: Partial<ProbeStatusSource> = {},
): ProbeStatusSource {
  return {
    id: id,
    name: name,
    isGlobalProbe: false,
    connectionStatus: connectionStatus,
    lastAlive: new Date("2026-09-21T11:59:40.000Z"),
    ...extra,
  };
}

function build(
  probeIds: Array<string>,
  probes: Array<ProbeStatusSource>,
): ProbeStatusMonitorResponse {
  return ProbeStatusMonitorUtil.buildResponse({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    probeIds: probeIds,
    probes: probes,
    checkedAt: CHECKED_AT,
  });
}

describe("ProbeStatusMonitorUtil.isConnected", () => {
  test("connected only when the last tick stamped the probe Connected", () => {
    expect(
      ProbeStatusMonitorUtil.isConnected(ProbeConnectionStatus.Connected),
    ).toBe(true);
    expect(
      ProbeStatusMonitorUtil.isConnected(ProbeConnectionStatus.Disconnected),
    ).toBe(false);
  });

  test("a probe no tick has stamped yet is not connected, as its badge says", () => {
    expect(ProbeStatusMonitorUtil.isConnected(undefined)).toBe(false);
    expect(ProbeStatusMonitorUtil.isConnected(null)).toBe(false);
    expect(ProbeStatusMonitorUtil.isConnected("")).toBe(false);
    expect(ProbeStatusMonitorUtil.isConnected("Connected")).toBe(false);
  });
});

describe("ProbeStatusMonitorUtil.buildResponse", () => {
  test("names the step, the monitor and when it was checked", () => {
    const response: ProbeStatusMonitorResponse = build(
      [FRANKFURT],
      [probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected)],
    );

    expect(response.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(response.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(response.monitorStepId.toString()).toBe(STEP_ID.toString());
    expect(response.checkedAt).toBe(CHECKED_AT);
  });

  test("counts connected and disconnected probes", () => {
    const response: ProbeStatusMonitorResponse = build(
      [FRANKFURT, VIRGINIA, SINGAPORE],
      [
        probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected),
        probe(VIRGINIA, "N. Virginia", ProbeConnectionStatus.Disconnected),
        probe(SINGAPORE, "Singapore", undefined),
      ],
    );

    expect(response.connectedProbeCount).toBe(1);
    expect(response.disconnectedProbeCount).toBe(2);
    expect(
      response.probes.map((item: { isConnected: boolean }): boolean => {
        return item.isConnected;
      }),
    ).toEqual([true, false, false]);
  });

  test("keeps the step's order, not the order the probes were read in", () => {
    const response: ProbeStatusMonitorResponse = build(
      [SINGAPORE, FRANKFURT],
      [
        probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected),
        probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Connected),
      ],
    );

    expect(
      response.probes.map((item: { probeName: string }): string => {
        return item.probeName;
      }),
    ).toEqual(["Singapore", "Frankfurt"]);
  });

  test("a probe named twice, in any case, is counted once", () => {
    const response: ProbeStatusMonitorResponse = build(
      [FRANKFURT, FRANKFURT.toUpperCase(), FRANKFURT],
      [probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Disconnected)],
    );

    expect(response.probes).toHaveLength(1);
    expect(response.disconnectedProbeCount).toBe(1);
  });

  test("a probe the step names but nobody can read is missing, and counted neither way", () => {
    const response: ProbeStatusMonitorResponse = build(
      [FRANKFURT, SINGAPORE],
      [probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected)],
    );

    expect(response.missingProbeIds).toEqual([SINGAPORE]);
    expect(response.connectedProbeCount).toBe(1);
    expect(response.disconnectedProbeCount).toBe(0);
  });

  test("a probe that was read but not named is not watched", () => {
    const response: ProbeStatusMonitorResponse = build(
      [FRANKFURT],
      [
        probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected),
        probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Disconnected),
      ],
    );

    expect(response.probes).toHaveLength(1);
    expect(response.disconnectedProbeCount).toBe(0);
  });

  test("carries the global flag, the last heartbeat, and a name even when there is none", () => {
    const lastAlive: Date = new Date("2026-09-21T11:40:00.000Z");
    const response: ProbeStatusMonitorResponse = build(
      [GLOBAL, FRANKFURT],
      [
        probe(GLOBAL, "  ", ProbeConnectionStatus.Connected, {
          isGlobalProbe: true,
          lastAlive: lastAlive,
        }),
        probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected, {
          lastAlive: undefined,
        }),
      ],
    );

    expect(response.probes[0]).toEqual({
      probeId: GLOBAL,
      probeName: "Probe",
      isGlobalProbe: true,
      isConnected: true,
      lastAliveAt: lastAlive,
    });
    // Never heard from: no lastAliveAt at all, not an undefined one.
    expect(Object.keys(response.probes[1]!)).not.toContain("lastAliveAt");
  });

  test("an empty step watches nothing", () => {
    const response: ProbeStatusMonitorResponse = build([], []);

    expect(response.probes).toEqual([]);
    expect(response.connectedProbeCount).toBe(0);
    expect(response.disconnectedProbeCount).toBe(0);
    expect(response.missingProbeIds).toEqual([]);
  });
});

describe("ProbeStatusMonitorUtil.describe", () => {
  const connected: ProbeStatusSource = probe(
    FRANKFURT,
    "Frankfurt",
    ProbeConnectionStatus.Connected,
  );

  test("one probe, connected or not, by name", () => {
    expect(
      ProbeStatusMonitorUtil.describe(build([FRANKFURT], [connected])),
    ).toBe("Frankfurt is connected.");
    expect(
      ProbeStatusMonitorUtil.describe(
        build(
          [SINGAPORE],
          [probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Disconnected)],
        ),
      ),
    ).toBe("Singapore is disconnected.");
  });

  test("several probes: how many are down and which", () => {
    expect(
      ProbeStatusMonitorUtil.describe(
        build(
          [FRANKFURT, VIRGINIA, SINGAPORE],
          [
            connected,
            probe(VIRGINIA, "N. Virginia", ProbeConnectionStatus.Disconnected),
            probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Disconnected),
          ],
        ),
      ),
    ).toBe("2 of 3 probes are disconnected: N. Virginia, Singapore.");

    expect(
      ProbeStatusMonitorUtil.describe(
        build(
          [FRANKFURT, SINGAPORE],
          [
            connected,
            probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Disconnected),
          ],
        ),
      ),
    ).toBe("1 of 2 probes is disconnected: Singapore.");
  });

  test("several probes, all up", () => {
    expect(
      ProbeStatusMonitorUtil.describe(
        build(
          [FRANKFURT, SINGAPORE],
          [
            connected,
            probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Connected),
          ],
        ),
      ),
    ).toBe("All 2 probes are connected.");
  });

  test("nothing left to watch says so instead of claiming health", () => {
    expect(ProbeStatusMonitorUtil.describe(build([SINGAPORE], []))).toBe(
      "This monitor watches no probe that still exists.",
    );
  });
});

describe("ProbeStatusMonitorUtil helpers", () => {
  test("joins names with commas, and nothing for no probes", () => {
    const response: ProbeStatusMonitorResponse = build(
      [FRANKFURT, SINGAPORE],
      [
        probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected),
        probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Connected),
      ],
    );

    expect(ProbeStatusMonitorUtil.joinProbeNames(response.probes)).toBe(
      "Frankfurt, Singapore",
    );
    expect(ProbeStatusMonitorUtil.joinProbeNames([])).toBe("");
    expect(ProbeStatusMonitorUtil.getConnectedProbes(response)).toHaveLength(2);
    expect(ProbeStatusMonitorUtil.getDisconnectedProbes(response)).toHaveLength(
      0,
    );
  });

  test("counts in words", () => {
    expect(ProbeStatusMonitorUtil.getProbeCountLabel(1)).toBe("1 probe");
    expect(ProbeStatusMonitorUtil.getProbeCountLabel(0)).toBe("0 probes");
    expect(ProbeStatusMonitorUtil.getProbeCountLabel(3)).toBe("3 probes");
  });

  test("every probe a monitor's steps watch, each once, in step order", () => {
    const first: MonitorStep = new MonitorStep();
    first.setProbeStatusMonitor({ probeIds: [SINGAPORE, FRANKFURT] });
    const second: MonitorStep = new MonitorStep();
    second.setProbeStatusMonitor({
      probeIds: [FRANKFURT.toUpperCase(), VIRGINIA],
    });
    const third: MonitorStep = new MonitorStep();

    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [first, second, third],
      defaultMonitorStatusId: ObjectID.generate(),
    };

    expect(ProbeStatusMonitorUtil.getWatchedProbeIds(steps)).toEqual([
      SINGAPORE,
      FRANKFURT,
      VIRGINIA,
    ]);
    expect(ProbeStatusMonitorUtil.getWatchedProbeIds(undefined)).toEqual([]);
    expect(
      ProbeStatusMonitorUtil.getWatchedProbeIds(new MonitorSteps()),
    ).toEqual([]);
  });
});

describe("ProbeStatusMonitorUtil.parseResponse", () => {
  test("reads back an evaluation stored as JSON, dates and ids included", () => {
    const stored: ProbeStatusMonitorResponse = build(
      [FRANKFURT, SINGAPORE],
      [
        probe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected, {
          isGlobalProbe: true,
        }),
        probe(SINGAPORE, "Singapore", ProbeConnectionStatus.Disconnected),
      ],
    );

    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse(JSON.parse(JSON.stringify(stored)));

    expect(parsed).not.toBeNull();
    expect(parsed!.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(parsed!.monitorStepId.toString()).toBe(STEP_ID.toString());
    expect(parsed!.checkedAt.toISOString()).toBe(CHECKED_AT.toISOString());
    expect(parsed!.connectedProbeCount).toBe(1);
    expect(parsed!.disconnectedProbeCount).toBe(1);
    expect(parsed!.probes[0]).toEqual({
      probeId: FRANKFURT,
      probeName: "Frankfurt",
      isGlobalProbe: true,
      isConnected: true,
      lastAliveAt: new Date("2026-09-21T11:59:40.000Z"),
    });
  });

  test("reads the { _type, value } shapes JSONFunctions writes", () => {
    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse({
        monitorId: { _type: "ObjectID", value: MONITOR_ID.toString() },
        probes: [
          {
            probeId: { _type: "ObjectID", value: FRANKFURT },
            probeName: "Frankfurt",
            isConnected: true,
            lastAliveAt: { _type: "DateTime", value: "2026-09-21T11:59:00Z" },
          },
        ],
        checkedAt: { _type: "DateTime", value: "2026-09-21T12:00:00Z" },
      });

    expect(parsed!.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(parsed!.probes[0]!.probeId).toBe(FRANKFURT);
    expect(parsed!.probes[0]!.lastAliveAt?.toISOString()).toBe(
      "2026-09-21T11:59:00.000Z",
    );
    expect(parsed!.checkedAt.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  test("recounts from the probes rather than trusting stored counts", () => {
    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse({
        probes: [
          { probeId: FRANKFURT, probeName: "Frankfurt", isConnected: false },
        ],
        connectedProbeCount: 5,
        disconnectedProbeCount: 0,
      });

    expect(parsed!.connectedProbeCount).toBe(0);
    expect(parsed!.disconnectedProbeCount).toBe(1);
  });

  test("skips a probe with no id, and keeps unknown fields out", () => {
    const parsed: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorUtil.parseResponse({
        probes: [
          { probeName: "No id", isConnected: true },
          "not a probe",
          null,
          {
            probeId: SINGAPORE,
            probeName: 42,
            isConnected: "yes",
            lastAliveAt: "not a date",
          },
        ],
        missingProbeIds: [VIRGINIA, 3, ""],
      });

    expect(parsed!.probes).toEqual([
      {
        probeId: SINGAPORE,
        probeName: "Probe",
        isGlobalProbe: false,
        isConnected: false,
      },
    ]);
    expect(parsed!.missingProbeIds).toEqual([VIRGINIA]);
    // No time at all reads as the epoch, which the view shows as "-".
    expect(parsed!.checkedAt.getTime()).toBe(0);
  });

  test("anything that is not a Probe Status evaluation is null", () => {
    for (const value of [
      undefined,
      null,
      "text",
      42,
      [],
      {},
      { probes: "none" },
      { probeId: FRANKFURT, isOnline: true },
    ]) {
      expect(ProbeStatusMonitorUtil.parseResponse(value)).toBeNull();
    }
  });
});
