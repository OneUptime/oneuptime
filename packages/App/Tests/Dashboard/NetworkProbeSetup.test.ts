import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { ProbeConnectionStatus } from "Common/Models/DatabaseModels/Probe";
import {
  ALERTS_STEP_DESCRIPTION,
  ALERTS_STEP_DONE,
  ALERTS_STEP_TITLE,
  DEVICES_STEP_TITLE,
  NetworkProbeFacts,
  NetworkProbeSetup,
  NetworkProbeSetupKind,
  PROBE_CHECK_IN_WINDOW_IN_MS,
  PROBE_CONNECTED_STATUS,
  PROBE_STEP_CONNECTED_MANY,
  PROBE_STEP_CONNECTED_ONE,
  PROBE_STEP_DESCRIPTION,
  PROBE_STEP_SERVER_PROBE_NOTE,
  PROBE_STEP_TITLE,
  PROBE_STEP_WAITING,
  PROBE_WAITING_POLL_INTERVAL_IN_MS,
  getNetworkProbeSetup,
  isProbeConnected,
  shouldPollProbeSetup,
} from "../../FeatureSet/Dashboard/src/Components/Network/NetworkProbeSetup";

/*
 * The first step of the Network first-run path: is there a probe on the
 * project's own network yet? (Components/Network/NetworkProbeSetup.ts)
 *
 * A probe is what pings and walks every device, and it has to reach the
 * device: OneUptime's own probes are on the internet, where 10.0.0.2 is not.
 * The step says "add one", "run the one you added", or "connected", and the
 * page keeps asking while a probe has been added but has not checked in.
 */

const NOW: Date = new Date("2026-10-15T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function probe(overrides: Partial<NetworkProbeFacts> = {}): NetworkProbeFacts {
  return {
    id: "6f1c0a1e-0000-4000-8000-000000000001",
    name: "London office probe",
    connectionStatus: null,
    lastAlive: null,
    ...overrides,
  };
}

describe("isProbeConnected", () => {
  test("a probe the worker has stamped connected is connected", () => {
    expect(
      isProbeConnected(
        probe({ connectionStatus: PROBE_CONNECTED_STATUS }),
        NOW,
      ),
    ).toBe(true);
  });

  test("the stamp it reads is the model's own Connected status", () => {
    expect(PROBE_CONNECTED_STATUS).toBe(ProbeConnectionStatus.Connected);
  });

  test("a probe stamped disconnected but heard from a minute ago is connected", () => {
    expect(
      isProbeConnected(
        probe({
          connectionStatus: ProbeConnectionStatus.Disconnected,
          lastAlive: minutesAgo(1),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  test("a probe never heard from is not connected", () => {
    expect(isProbeConnected(probe(), NOW)).toBe(false);
  });

  test("a probe last heard from four minutes ago is not connected", () => {
    expect(isProbeConnected(probe({ lastAlive: minutesAgo(4) }), NOW)).toBe(
      false,
    );
  });

  test("the window ends at three minutes: just inside counts, the edge does not", () => {
    expect(
      isProbeConnected(
        probe({
          lastAlive: new Date(NOW.getTime() - PROBE_CHECK_IN_WINDOW_IN_MS + 1),
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isProbeConnected(
        probe({
          lastAlive: new Date(NOW.getTime() - PROBE_CHECK_IN_WINDOW_IN_MS),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("a heartbeat from the future (a skewed clock) counts as recent", () => {
    expect(isProbeConnected(probe({ lastAlive: minutesAgo(-10) }), NOW)).toBe(
      true,
    );
  });

  test("a heartbeat read back as a string is read as a date", () => {
    expect(
      isProbeConnected(probe({ lastAlive: minutesAgo(1).toISOString() }), NOW),
    ).toBe(true);
    expect(
      isProbeConnected(probe({ lastAlive: minutesAgo(30).toISOString() }), NOW),
    ).toBe(false);
  });

  test("a heartbeat that is not a date is no heartbeat", () => {
    expect(isProbeConnected(probe({ lastAlive: "not a date" }), NOW)).toBe(
      false,
    );
  });
});

describe("the check-in window agrees with the worker that stamps the status", () => {
  /*
   * Workers/Jobs/Probe/UpdateConnectionStatus marks a probe Disconnected
   * after three minutes of silence. The first-run step reads a recent
   * heartbeat as connected before that worker runs, so the two have to mean
   * the same three minutes, or the step would turn green for a probe the
   * rest of the product calls disconnected.
   */
  test("both are three minutes", () => {
    const worker: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Workers",
        "Jobs",
        "Probe",
        "UpdateConnectionStatus.ts",
      ),
      "utf8",
    );

    expect(worker).toContain("const STALE_CUTOFF_IN_MINUTES: number = 3;");
    expect(PROBE_CHECK_IN_WINDOW_IN_MS).toBe(3 * 60 * 1000);
  });
});

describe("getNetworkProbeSetup", () => {
  test("no probe: the step is still to do", () => {
    const setup: NetworkProbeSetup = getNetworkProbeSetup([], NOW);

    expect(setup.kind).toBe(NetworkProbeSetupKind.NoProbe);
    expect(setup.connected).toEqual([]);
    expect(setup.waiting).toEqual([]);
  });

  test("a probe added and never run: the step is waiting on it", () => {
    const added: NetworkProbeFacts = probe();
    const setup: NetworkProbeSetup = getNetworkProbeSetup([added], NOW);

    expect(setup.kind).toBe(NetworkProbeSetupKind.Waiting);
    expect(setup.waiting).toEqual([added]);
    expect(setup.connected).toEqual([]);
  });

  test("one probe checking in is enough, whatever else was added and never run", () => {
    const running: NetworkProbeFacts = probe({
      id: "6f1c0a1e-0000-4000-8000-000000000002",
      name: "Data centre probe",
      connectionStatus: PROBE_CONNECTED_STATUS,
    });
    const idle: NetworkProbeFacts = probe();
    const setup: NetworkProbeSetup = getNetworkProbeSetup([idle, running], NOW);

    expect(setup.kind).toBe(NetworkProbeSetupKind.Connected);
    expect(setup.connected).toEqual([running]);
    expect(setup.waiting).toEqual([idle]);
  });

  test("keeps the order the probes came in", () => {
    const first: NetworkProbeFacts = probe({
      id: "6f1c0a1e-0000-4000-8000-000000000003",
      name: "B probe",
      lastAlive: minutesAgo(1),
    });
    const second: NetworkProbeFacts = probe({
      id: "6f1c0a1e-0000-4000-8000-000000000004",
      name: "A probe",
      connectionStatus: PROBE_CONNECTED_STATUS,
    });

    expect(getNetworkProbeSetup([first, second], NOW).connected).toEqual([
      first,
      second,
    ]);
  });

  test("a row without an id is not a probe the step can offer to run", () => {
    const setup: NetworkProbeSetup = getNetworkProbeSetup(
      [probe({ id: "" })],
      NOW,
    );

    expect(setup.kind).toBe(NetworkProbeSetupKind.NoProbe);
    expect(setup.waiting).toEqual([]);
  });
});

describe("shouldPollProbeSetup", () => {
  test("asks again only while a probe is added and not running", () => {
    expect(shouldPollProbeSetup(getNetworkProbeSetup([probe()], NOW))).toBe(
      true,
    );
    expect(shouldPollProbeSetup(getNetworkProbeSetup([], NOW))).toBe(false);
    expect(
      shouldPollProbeSetup(
        getNetworkProbeSetup(
          [probe({ connectionStatus: PROBE_CONNECTED_STATUS })],
          NOW,
        ),
      ),
    ).toBe(false);
  });

  test("asks every ten seconds: green within seconds, free while it waits", () => {
    expect(PROBE_WAITING_POLL_INTERVAL_IN_MS).toBe(10 * 1000);
  });
});

describe("the step's words", () => {
  const EN: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const SENTENCES: Array<string> = [
    PROBE_STEP_TITLE,
    PROBE_STEP_DESCRIPTION,
    PROBE_STEP_WAITING,
    PROBE_STEP_CONNECTED_ONE,
    PROBE_STEP_SERVER_PROBE_NOTE,
    DEVICES_STEP_TITLE,
    ALERTS_STEP_TITLE,
    ALERTS_STEP_DESCRIPTION,
    ALERTS_STEP_DONE,
  ];

  test.each(SENTENCES)("%s is a Dashboard translation key", (text: string) => {
    expect(EN[text]).toBe(text);
  });

  test("the connected count is a plural, keyed by its other form", () => {
    expect(EN[PROBE_STEP_CONNECTED_MANY.other]).toBe(
      PROBE_STEP_CONNECTED_MANY.other,
    );
    expect(EN[`${PROBE_STEP_CONNECTED_MANY.other}_one`]).toBe(
      PROBE_STEP_CONNECTED_MANY.one,
    );
    expect(PROBE_STEP_CONNECTED_MANY.one).toContain("{{count}}");
    expect(PROBE_STEP_CONNECTED_MANY.other).toContain("{{count}}");
  });

  test("says why a probe on the internet will not do", () => {
    expect(PROBE_STEP_DESCRIPTION).toContain("inside your network");
    expect(PROBE_STEP_DESCRIPTION).toContain(
      "a probe on the internet cannot reach private addresses",
    );
  });

  test("the waiting and connected lines name the probe", () => {
    expect(PROBE_STEP_WAITING).toContain("{{name}}");
    expect(PROBE_STEP_CONNECTED_ONE).toContain("{{name}}");
  });
});
