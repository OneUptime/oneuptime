import GlobalProbesBehind, {
  GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS,
} from "../../../../Server/Utils/Probe/GlobalProbesBehind";
import { InstallationHealthProbeBehind } from "../../../../Types/InstallationHealth/InstallationHealth";
import { ProbeBehindWork } from "../../../../Types/Probe/ProbeBehind";
import { ServerAlertChannel } from "../../../../Types/ServerSending/ServerAlerts";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE ALARM IN THE SERVER LOG WHILE A GLOBAL PROBE HAS BEEN BEHIND FOR
 * MINUTES.
 *
 * On 27 November 2026 both of OneUptime Cloud's global probes were behind
 * from 04:10 UTC, handed none of the monitors they asked for, and stayed
 * so for twelve hours with nobody told. While a connected global probe has
 * been behind for five minutes or more, the alarm names it, what it is
 * behind on and since when, and says whether the master admins' outage
 * notifications tell anyone - and, when they cannot, where to turn them on.
 */

// GlobalProbesBehind reads the probes through it; these tests never do.
jest.mock("../../../../Server/Services/ProbeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

const NOW: Date = new Date("2026-11-27T04:15:00.000Z");

const US: InstallationHealthProbeBehind = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Probe US",
  since: "2026-11-27T04:10:00.000Z",
  work: ProbeBehindWork.MonitorChecks,
};

const EU: InstallationHealthProbeBehind = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Probe EU",
  since: "2026-11-27T04:09:30.000Z",
  work: ProbeBehindWork.MonitorChecks,
};

describe("GlobalProbesBehind's alarm", () => {
  test("five minutes behind: long past a probe catching up after a restart", () => {
    expect(GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS).toBe(5 * 60 * 1000);
  });

  test("nothing while no global probe is behind", () => {
    expect(
      GlobalProbesBehind.getAlarmText({
        behind: [],
        now: NOW,
        channels: [ServerAlertChannel.Push],
      }),
    ).toBeNull();
  });

  test("nothing while it has been behind for less than five minutes", () => {
    expect(
      GlobalProbesBehind.getAlarmText({
        behind: [{ ...US, since: "2026-11-27T04:10:01.000Z" }],
        now: NOW,
        channels: [ServerAlertChannel.Push],
      }),
    ).toBeNull();
  });

  test("names the probe, what it is behind on and since when, and how master admins are told", () => {
    expect(
      GlobalProbesBehind.getAlarmText({
        behind: [US],
        now: NOW,
        channels: [ServerAlertChannel.Push, ServerAlertChannel.SMS],
      }),
    ).toBe(
      "a global probe has been behind for 5 minutes or more: Probe US on monitor checks since 2026-11-27T04:10:00.000Z. Their checks wait more than a minute past their time, so they run less often than set, or not at all. OneUptime Health in the Admin Dashboard lists them, and /metrics/probe-scheduling shows how the App replicas hand out probe work. Master admins are told by push, SMS (Outage Notifications).",
    );
  });

  test("with no channel that can carry it, says nobody is told and where to turn one on", () => {
    const text: string | null = GlobalProbesBehind.getAlarmText({
      behind: [US],
      now: NOW,
      channels: [],
    });

    expect(text).toContain(
      "No master admin is told: no Outage Notifications channel can carry it. Turn one on in the Admin Dashboard, under Settings > Emails.",
    );
  });

  test("every probe behind long enough, each once, with each kind of work it is behind on", () => {
    const text: string | null = GlobalProbesBehind.getAlarmText({
      behind: [
        US,
        { ...US, work: ProbeBehindWork.DevicePolls },
        EU,
        // Behind for a minute only: not in the alarm.
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Probe Asia",
          since: "2026-11-27T04:14:00.000Z",
        },
      ],
      now: NOW,
      channels: [ServerAlertChannel.Email],
    });

    expect(text).toContain(
      "2 global probes have been behind for 5 minutes or more: Probe US on monitor checks since 2026-11-27T04:10:00.000Z; Probe US on network device polls since 2026-11-27T04:10:00.000Z; Probe EU on monitor checks since 2026-11-27T04:09:30.000Z.",
    );
    expect(text).not.toContain("Probe Asia");
    expect(text).toContain(
      "Master admins are told by the Admin Notification Email (Outage Notifications).",
    );
  });

  test("a probe with no name is named by its ID; an entry from before #9499 is behind on monitor checks", () => {
    const text: string | null = GlobalProbesBehind.getAlarmText({
      behind: [{ id: US.id, name: " ", since: US.since }],
      now: NOW,
      channels: [],
    });

    expect(text).toContain(
      `${US.id} on monitor checks since 2026-11-27T04:10:00.000Z`,
    );
  });

  test("a time it cannot read is never in the alarm", () => {
    expect(
      GlobalProbesBehind.getAlarmEntries({
        behind: [{ ...US, since: "not a time" }, EU],
        now: NOW,
      }),
    ).toEqual([EU]);
  });
});
