import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import PartialEntity from "Common/Types/Database/PartialEntity";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ProbeBehindUtil, {
  ProbeLateChecks,
  ProbeLateDevicePolls,
} from "Common/Types/Probe/ProbeBehind";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProbeService from "Common/Server/Services/ProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ProbeStatusMonitorEvaluator from "Common/Server/Utils/Monitor/ProbeStatusMonitorEvaluator";
import logger from "Common/Server/Utils/Logger";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";

/*
 * SAYING WHEN A PROBE IS BEHIND: ITS MONITORS CHECKED, OR ITS NETWORK
 * DEVICES POLLED, LATER THAN THEIR INTERVAL (OneUptime issues #9488, #9499).
 *
 * Every minute, for every connected probe: when its longest-waiting check
 * was due, by the claim's own rule of what may be checked
 * (MonitorProbeService.getOldestWaitingCheckDueAt, one short index range
 * per probe), and the same for the network devices it polls
 * (NetworkDeviceService.getOldestWaitingPollDueAt); and from each, what
 * Types/Probe/ProbeBehind keeps on the probe - the first and the latest
 * reading that found a check, or a poll, waiting more than a minute past
 * its time. The probe's page in the Dashboard, the probe lists, the Admin
 * Dashboard's OneUptime Health, Probe Status monitors and the master
 * admins' notifications read those.
 *
 * A probe that is not connected keeps nothing: Disconnected says more, and
 * a probe that comes back starts again from on time. Writes only what
 * changed, without hooks (no owner notification, no audit entry, no version
 * bump): bookkeeping nobody but OneUptime writes. A probe that falls behind
 * or catches up has the Probe Status monitors that watch it evaluated at
 * once (#9501), as a probe that connects or disconnects does.
 *
 * One read failing never costs the other: a probe whose device polls could
 * not be read this minute keeps what it had of them, and its monitors are
 * read all the same.
 */

export const PROBE_BEHIND_JOB_NAME: string = "Probe:UpdateBehind";

type ProbeWithLateWork = Pick<
  Probe,
  | "id"
  | "checksLateSince"
  | "checksLastLateAt"
  | "devicePollsLateSince"
  | "devicePollsLastLateAt"
>;

/*
 * Each probe's longest-waiting due time, or null when the read failed: the
 * probes then keep what they had of that work this minute.
 */
const readOldestDueAt: (data: {
  work: string;
  read: () => Promise<Map<string, Date | null>>;
}) => Promise<Map<string, Date | null> | null> = async (data: {
  work: string;
  read: () => Promise<Map<string, Date | null>>;
}): Promise<Map<string, Date | null> | null> => {
  try {
    return await data.read();
  } catch (err) {
    logger.error(
      `${PROBE_BEHIND_JOB_NAME}: could not read how long the probes' ${data.work} have waited; they keep what they had until the next reading.`,
    );
    logger.error(err);
    return null;
  }
};

const writeLateWork: (data: {
  probeId: ObjectID;
  lateChecks?: ProbeLateChecks | undefined;
  latePolls?: ProbeLateDevicePolls | undefined;
}) => Promise<void> = async (data: {
  probeId: ObjectID;
  lateChecks?: ProbeLateChecks | undefined;
  latePolls?: ProbeLateDevicePolls | undefined;
}): Promise<void> => {
  /*
   * Set by name: a null is how a time is cleared, and a model's Date
   * column is typed without one.
   */
  const update: PartialEntity<Probe> = {};

  if (data.lateChecks) {
    (update as Record<string, unknown>)["checksLateSince"] =
      data.lateChecks.checksLateSince;
    (update as Record<string, unknown>)["checksLastLateAt"] =
      data.lateChecks.checksLastLateAt;
  }

  if (data.latePolls) {
    (update as Record<string, unknown>)["devicePollsLateSince"] =
      data.latePolls.devicePollsLateSince;
    (update as Record<string, unknown>)["devicePollsLastLateAt"] =
      data.latePolls.devicePollsLastLateAt;
  }

  await ProbeService.updateColumnsByIdWithoutHooks({
    id: data.probeId,
    data: update,
    skipUpdateDateColumn: true,
  });
};

export const updateProbesBehind: (options?: {
  now?: Date | undefined;
}) => Promise<void> = async (options?: {
  now?: Date | undefined;
}): Promise<void> => {
  const now: Date = options?.now || OneUptimeDate.getCurrentDate();

  const connected: Array<ProbeWithLateWork> = await ProbeService.findBy({
    query: {
      connectionStatus: ProbeConnectionStatus.Connected,
    },
    select: {
      _id: true,
      checksLateSince: true,
      checksLastLateAt: true,
      devicePollsLateSince: true,
      devicePollsLastLateAt: true,
    },
    skip: 0,
    limit: LIMIT_MAX,
    props: {
      isRoot: true,
    },
  });

  const probeIds: Array<ObjectID> = connected
    .map((probe: ProbeWithLateWork): ObjectID | undefined => {
      return probe.id || undefined;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });

  const oldestCheckDueAt: Map<string, Date | null> | null =
    probeIds.length > 0
      ? await readOldestDueAt({
          work: "monitor checks",
          read: (): Promise<Map<string, Date | null>> => {
            return MonitorProbeService.getOldestWaitingCheckDueAt({
              probeIds: probeIds,
              dueAt: now,
            });
          },
        })
      : new Map<string, Date | null>();

  const oldestPollDueAt: Map<string, Date | null> | null =
    probeIds.length > 0
      ? await readOldestDueAt({
          work: "network device polls",
          read: (): Promise<Map<string, Date | null>> => {
            return NetworkDeviceService.getOldestWaitingPollDueAt({
              probeIds: probeIds,
              dueAt: now,
            });
          },
        })
      : new Map<string, Date | null>();

  for (const probe of connected) {
    if (!probe.id) {
      continue;
    }

    const probeId: string = probe.id.toString();

    const lateChecks: ProbeLateChecks | undefined = oldestCheckDueAt
      ? ProbeBehindUtil.next({
          state: probe,
          isLate: ProbeBehindUtil.isCheckLate({
            oldestDueAt: oldestCheckDueAt.get(probeId),
            now: now,
          }),
          now: now,
        })
      : undefined;

    const latePolls: ProbeLateDevicePolls | undefined = oldestPollDueAt
      ? ProbeBehindUtil.lateChecksAsDevicePolls(
          ProbeBehindUtil.next({
            state: ProbeBehindUtil.devicePollsAsLateChecks(probe),
            isLate: ProbeBehindUtil.isCheckLate({
              oldestDueAt: oldestPollDueAt.get(probeId),
              now: now,
            }),
            now: now,
          }),
        )
      : undefined;

    const haveChecksChanged: boolean = Boolean(
      lateChecks && ProbeBehindUtil.hasChanged(probe, lateChecks),
    );
    const havePollsChanged: boolean = Boolean(
      latePolls &&
        ProbeBehindUtil.hasChanged(
          ProbeBehindUtil.devicePollsAsLateChecks(probe),
          ProbeBehindUtil.devicePollsAsLateChecks(latePolls),
        ),
    );

    if (!haveChecksChanged && !havePollsChanged) {
      continue;
    }

    try {
      await writeLateWork({
        probeId: probe.id,
        lateChecks: haveChecksChanged ? lateChecks : undefined,
        latePolls: havePollsChanged ? latePolls : undefined,
      });
    } catch (err) {
      logger.error(
        `${PROBE_BEHIND_JOB_NAME}: could not keep whether probe ${probeId} is behind; the next reading tries again.`,
      );
      logger.error(err);
      continue;
    }

    const wasBehind: boolean = ProbeBehindUtil.isProbeBehind(probe);
    const isBehind: boolean = ProbeBehindUtil.isProbeBehind({
      ...probe,
      ...(haveChecksChanged ? lateChecks : {}),
      ...(havePollsChanged ? latePolls : {}),
    });

    /*
     * Fell behind, or caught up: the Probe Status monitors watching it are
     * judged now, not up to a minute from now (never throws).
     */
    if (wasBehind !== isBehind) {
      await ProbeStatusMonitorEvaluator.evaluateMonitorsWatchingProbe(probe.id);
    }
  }

  // Not connected: nothing kept, of either.
  const disconnected: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const column of ["checksLateSince", "devicePollsLateSince"] as const) {
    const probes: Array<ProbeWithLateWork> = await ProbeService.findBy({
      query: {
        connectionStatus: QueryHelper.notInOrNull([
          ProbeConnectionStatus.Connected,
        ]),
        [column]: QueryHelper.notNull(),
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const probe of probes) {
      if (probe.id) {
        disconnected.set(probe.id.toString(), probe.id);
      }
    }
  }

  for (const probeId of disconnected.values()) {
    try {
      await writeLateWork({
        probeId: probeId,
        lateChecks: ProbeBehindUtil.cleared(),
        latePolls: ProbeBehindUtil.clearedDevicePolls(),
      });
    } catch (err) {
      logger.error(
        `${PROBE_BEHIND_JOB_NAME}: could not clear whether probe ${probeId.toString()} is behind; the next reading tries again.`,
      );
      logger.error(err);
    }
  }
};

RunCron(
  PROBE_BEHIND_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    await updateProbesBehind();
  },
);
