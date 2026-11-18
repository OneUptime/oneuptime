import ProbeService from "../../Services/ProbeService";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { InstallationHealthProbeBehind } from "../../../Types/InstallationHealth/InstallationHealth";
import ProbeBehindUtil, {
  ProbeBehindWork,
} from "../../../Types/Probe/ProbeBehind";

/*
 * THE GLOBAL PROBES THAT ARE BEHIND: THEIR MONITORS CHECKED, OR THEIR
 * NETWORK DEVICES POLLED, LATER THAN THEIR INTERVAL (OneUptime issues
 * #9488, #9499).
 *
 * Read by what Probe:UpdateBehind keeps on each connected global probe
 * (Types/Probe/ProbeBehind): one entry a probe for each kind of work it is
 * behind on, with since when. OneUptime Health lists them as findings
 * (App/API/AdminHealth), and the master admins are told when one falls
 * behind and when they all keep up again (Workers' ServerAlerts, #9500):
 * one reader, so the two never disagree about which probe is behind.
 *
 * A probe that is not connected is never behind - Disconnected says more,
 * and the job keeps nothing for it. Global probes are few, so every
 * connected one is read and judged here rather than narrowed in SQL.
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
        devicePollsLateSince: true,
        devicePollsLastLateAt: true,
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

        behind.push({
          id: probe.id.toString(),
          name: probe.name || "",
          since: since.toISOString(),
          work: work,
        });
      }
    }

    return behind;
  }
}
