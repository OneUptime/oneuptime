import ProbeService from "../../Services/ProbeService";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { InstallationHealthProbeBehind } from "../../../Types/InstallationHealth/InstallationHealth";
import ProbeBehindUtil, {
  ProbeBehindBy,
  ProbeBehindByUnit,
  ProbeBehindWork,
} from "../../../Types/Probe/ProbeBehind";
import { ServerAlertChannel } from "../../../Types/ServerSending/ServerAlerts";

/*
 * A global probe behind for this long raises the alarm in the server log
 * (alarmText): long past a probe that restarted and is catching up, and
 * still within the first few minutes of one that is handed nothing.
 */
export const GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS: number = 5 * 60 * 1000;

// What each kind of work is called in the alarm.
const WORK_WORDS: Record<ProbeBehindWork, string> = {
  [ProbeBehindWork.MonitorChecks]: "monitor checks",
  [ProbeBehindWork.DevicePolls]: "network device polls",
};

// How far behind, in the alarm's words: "11 hours".
const BEHIND_BY_WORDS: Record<
  ProbeBehindByUnit,
  { one: string; other: string }
> = {
  minute: { one: "minute", other: "minutes" },
  hour: { one: "hour", other: "hours" },
  day: { one: "day", other: "days" },
};

// The channels the master admins' outage notifications go by, in words.
const CHANNEL_WORDS: Record<ServerAlertChannel, string> = {
  [ServerAlertChannel.Push]: "push",
  [ServerAlertChannel.SMS]: "SMS",
  [ServerAlertChannel.Email]: "the Admin Notification Email",
};

/*
 * THE GLOBAL PROBES THAT ARE BEHIND: THEIR MONITORS CHECKED, OR THEIR
 * NETWORK DEVICES POLLED, LATER THAN THEIR INTERVAL (OneUptime issues
 * #9488, #9499).
 *
 * Read by what Probe:UpdateBehind keeps on each connected global probe
 * (Types/Probe/ProbeBehind): one entry a probe for each kind of work it is
 * behind on, with since when and how far. OneUptime Health lists them as
 * findings (App/API/AdminHealth), and the master admins are told when one
 * falls behind and when they all keep up again (Workers' ServerAlerts,
 * #9500): one reader, so the two never disagree about which probe is
 * behind.
 *
 * A probe that is not connected is never behind - Disconnected says more,
 * and the job keeps nothing for it. Global probes are few, so every
 * connected one is read and judged here rather than narrowed in SQL.
 *
 * One behind for GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS raises an alarm in the
 * server log too (alarmText, ProbeAlarmLog), each time ServerAlerts looks
 * while it lasts: on 27 November 2026 both of OneUptime Cloud's global
 * probes were behind within a minute and stayed behind for twelve hours,
 * and the outage notifications, which OneUptime Cloud sends only once its
 * operator turns them on, told nobody. The alarm says whether they do.
 */
export default class GlobalProbesBehind {
  public static async read(): Promise<Array<InstallationHealthProbeBehind>> {
    const probes: Array<Probe> = await ProbeService.findBy({
      query: {
        isGlobalProbe: true,
        connectionStatus: ProbeConnectionStatus.Connected,
      },
      select: {
        _id: true,
        name: true,
        checksLateSince: true,
        checksLastLateAt: true,
        checksLastLateDueAt: true,
        devicePollsLateSince: true,
        devicePollsLastLateAt: true,
        devicePollsLastLateDueAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    return GlobalProbesBehind.fromProbes(probes);
  }

  // Exported for tests: the entries for probes already read.
  public static fromProbes(
    probes: Array<Probe>,
  ): Array<InstallationHealthProbeBehind> {
    const behind: Array<InstallationHealthProbeBehind> = [];

    for (const probe of probes) {
      if (!probe.id) {
        continue;
      }

      for (const work of ProbeBehindUtil.getBehindWork(probe)) {
        const since: Date | null =
          work === ProbeBehindWork.DevicePolls
            ? ProbeBehindUtil.getDevicePollsBehindSince(probe)
            : ProbeBehindUtil.getBehindSince(probe);

        if (!since) {
          continue;
        }

        const behindByMs: number | null =
          work === ProbeBehindWork.DevicePolls
            ? ProbeBehindUtil.getDevicePollsBehindByMs(probe)
            : ProbeBehindUtil.getBehindByMs(probe);

        behind.push({
          id: probe.id.toString(),
          name: probe.name || "",
          since: since.toISOString(),
          work: work,
          behindByMs: behindByMs ?? undefined,
        });
      }
    }

    return behind;
  }

  /*
   * The entries that have been behind for GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS
   * at `now`, in the order read.
   */
  public static getAlarmEntries(data: {
    behind: Array<InstallationHealthProbeBehind>;
    now: Date;
  }): Array<InstallationHealthProbeBehind> {
    return data.behind.filter(
      (entry: InstallationHealthProbeBehind): boolean => {
        const since: number = Date.parse(entry.since);

        return (
          !Number.isNaN(since) &&
          data.now.getTime() - since >= GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS
        );
      },
    );
  }

  /*
   * How far behind an entry is, after its since when: ", behind by 11
   * hours", in the unit the dashboards say it in (getBehindByAmount), or
   * nothing while it is not known.
   */
  public static getBehindByText(entry: InstallationHealthProbeBehind): string {
    if (
      typeof entry.behindByMs !== "number" ||
      !Number.isFinite(entry.behindByMs) ||
      entry.behindByMs <= 0
    ) {
      return "";
    }

    const amount: ProbeBehindBy = ProbeBehindUtil.getBehindByAmount(
      entry.behindByMs,
    );
    const words: { one: string; other: string } = BEHIND_BY_WORDS[amount.unit];

    return `, behind by ${amount.count} ${amount.count === 1 ? words.one : words.other}`;
  }

  /*
   * The alarm's words, without the prefix ProbeAlarmLog puts before them, or
   * null while no global probe has been behind long enough. `channels`: the
   * ones the master admins' outage notifications about it can go by now
   * (ServerAlerts' getChannels); none says so, and where to turn them on.
   */
  public static getAlarmText(data: {
    behind: Array<InstallationHealthProbeBehind>;
    now: Date;
    channels: Array<ServerAlertChannel>;
  }): string | null {
    const entries: Array<InstallationHealthProbeBehind> =
      GlobalProbesBehind.getAlarmEntries(data);

    if (entries.length === 0) {
      return null;
    }

    const probes: string = entries
      .map((entry: InstallationHealthProbeBehind): string => {
        const name: string = entry.name.trim() || entry.id;
        const work: string =
          WORK_WORDS[entry.work || ProbeBehindWork.MonitorChecks];

        return `${name} on ${work} since ${entry.since}${GlobalProbesBehind.getBehindByText(entry)}`;
      })
      .join("; ");

    const told: string =
      data.channels.length > 0
        ? `Master admins are told by ${data.channels
            .map((channel: ServerAlertChannel): string => {
              return CHANNEL_WORDS[channel];
            })
            .join(", ")} (Outage Notifications).`
        : "No master admin is told: no Outage Notifications channel can carry it. Turn one on in the Admin Dashboard, under Settings > Emails.";

    const probeCount: number = new Set(
      entries.map((entry: InstallationHealthProbeBehind): string => {
        return entry.id;
      }),
    ).size;

    const subject: string =
      probeCount === 1
        ? "a global probe has been behind"
        : `${probeCount} global probes have been behind`;

    return `${subject} for ${GLOBAL_PROBES_BEHIND_ALARM_AFTER_MS / 60000} minutes or more: ${probes}. Their checks wait more than a minute past their time, so they run less often than set, or not at all. OneUptime Health in the Admin Dashboard lists them, and /metrics/probe-scheduling shows how the App replicas hand out probe work. ${told}`;
  }
}
