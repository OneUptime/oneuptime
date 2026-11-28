import GlobalProbesBehind, {
  GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS,
} from "../../../../Server/Utils/Probe/GlobalProbesBehind";
import ProbeService from "../../../../Server/Services/ProbeService";
import Probe from "../../../../Models/DatabaseModels/Probe";
import { InstallationHealthProbeBehind } from "../../../../Types/InstallationHealth/InstallationHealth";
import ObjectID from "../../../../Types/ObjectID";
import { ProbeBehindWork } from "../../../../Types/Probe/ProbeBehind";
import { ServerAlertChannel } from "../../../../Types/ServerSending/ServerAlerts";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE ALARM IN THE SERVER LOG WHILE A GLOBAL PROBE HAS BEEN BEHIND FOR
 * MINUTES.
 *
 * On 27 November 2026 both of OneUptime Cloud's global probes were behind
 * from 04:10 UTC, handed none of the monitors they asked for, and stayed
 * so for twelve hours with nobody told. While a connected global probe has
 * been behind for five minutes or more, the alarm names it, what it is
 * behind on, since when and how far, and says whether the master admins'
 * outage notifications tell anyone - and, when they cannot, where to turn
 * them on.
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

/*
 * HOW FAR BEHIND, IN THE ALARM.
 *
 * Since when alone read the same for a probe a minute late and for one
 * handed nothing to check for twelve hours. Each entry carries how long its
 * longest-waiting check, or device poll, had waited past its time at the
 * latest reading, and the alarm says it in the unit the dashboards' "Behind
 * by 15 minutes" picks (ProbeBehindUtil.getBehindByAmount).
 */
describe("how far behind, in GlobalProbesBehind's alarm", () => {
  const SECOND: number = 1000;
  const MINUTE: number = 60 * SECOND;
  const HOUR: number = 60 * MINUTE;

  test("says how far behind each probe's work runs, in the unit the dashboards say it in", () => {
    const text: string | null = GlobalProbesBehind.getAlarmText({
      behind: [
        { ...US, behindByMs: 11 * HOUR + 50 * MINUTE },
        { ...US, work: ProbeBehindWork.DevicePolls, behindByMs: 61 * SECOND },
        { ...EU, behindByMs: 3 * 24 * HOUR },
      ],
      now: NOW,
      channels: [],
    });

    expect(text).toContain(
      "2 global probes have been behind for 5 minutes or more: Probe US on monitor checks since 2026-11-27T04:10:00.000Z, behind by 11 hours; Probe US on network device polls since 2026-11-27T04:10:00.000Z, behind by 1 minute; Probe EU on monitor checks since 2026-11-27T04:09:30.000Z, behind by 3 days.",
    );
  });

  test("says since when only while how far is not known", () => {
    expect(GlobalProbesBehind.getBehindByText(US)).toBe("");

    for (const behindByMs of [0, -5 * MINUTE, Number.NaN]) {
      expect(GlobalProbesBehind.getBehindByText({ ...US, behindByMs })).toBe(
        "",
      );
    }

    expect(
      GlobalProbesBehind.getBehindByText({ ...US, behindByMs: 15 * MINUTE }),
    ).toBe(", behind by 15 minutes");
    expect(
      GlobalProbesBehind.getBehindByText({ ...US, behindByMs: 90 * MINUTE }),
    ).toBe(", behind by 1 hour");
  });

  test("an entry read from a probe carries how far behind that work runs", () => {
    const probe: Probe = new Probe();
    probe.id = new ObjectID(US.id);
    probe.name = US.name;
    // Late at readings fifteen minutes apart; the last found a check due seven minutes before.
    probe.checksLateSince = new Date("2026-11-27T04:00:00.000Z");
    probe.checksLastLateAt = new Date("2026-11-27T04:15:00.000Z");
    probe.checksLastLateDueAt = new Date("2026-11-27T04:08:00.000Z");
    // Behind on its devices too, with no due time kept yet.
    probe.devicePollsLateSince = new Date("2026-11-27T04:05:00.000Z");
    probe.devicePollsLastLateAt = new Date("2026-11-27T04:15:00.000Z");

    const entries: Array<InstallationHealthProbeBehind> =
      GlobalProbesBehind.fromProbes([probe]);

    expect(entries).toEqual([
      {
        id: US.id,
        name: "Probe US",
        since: "2026-11-27T04:00:00.000Z",
        work: ProbeBehindWork.MonitorChecks,
        behindByMs: 7 * MINUTE,
      },
      {
        id: US.id,
        name: "Probe US",
        since: "2026-11-27T04:05:00.000Z",
        work: ProbeBehindWork.DevicePolls,
      },
    ]);
    expect(entries[1]!.behindByMs).toBeUndefined();
  });

  test("reads when each global probe's longest-waiting check and device poll were due", async () => {
    const findBy: Mock = ProbeService.findBy as unknown as Mock;
    findBy.mockResolvedValueOnce([] as never);

    await GlobalProbesBehind.read();

    expect(findBy.mock.calls[0]![0]).toMatchObject({
      select: {
        checksLateSince: true,
        checksLastLateAt: true,
        checksLastLateDueAt: true,
        devicePollsLateSince: true,
        devicePollsLastLateAt: true,
        devicePollsLastLateDueAt: true,
      },
    });
  });
});
