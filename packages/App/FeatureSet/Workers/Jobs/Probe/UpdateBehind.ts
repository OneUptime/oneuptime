import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import PartialEntity from "Common/Types/Database/PartialEntity";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ProbeBehindUtil, {
  ProbeLateChecks,
} from "Common/Types/Probe/ProbeBehind";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import ProbeService from "Common/Server/Services/ProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";

/*
 * SAYING WHEN A PROBE IS BEHIND: ITS MONITORS CHECKED LATER THAN THEIR
 * INTERVAL (OneUptime issue #9488).
 *
 * Every minute, for every connected probe: when its longest-waiting check
 * was due, by the claim's own rule of what may be checked
 * (MonitorProbeService.getOldestWaitingCheckDueAt, one short index range
 * per probe), and from that what Types/Probe/ProbeBehind keeps on the
 * probe - the first and the latest reading that found a check waiting more
 * than a minute past its check time. The probe's page in the Dashboard, the
 * probe lists and the Admin Dashboard's OneUptime Health read those.
 *
 * A probe that is not connected keeps nothing: Disconnected says more, and
 * a probe that comes back starts again from on time. Writes only what
 * changed, without hooks (no owner notification, no audit entry, no version
 * bump): bookkeeping nobody but OneUptime writes.
 */

export const PROBE_BEHIND_JOB_NAME: string = "Probe:UpdateBehind";

type ProbeWithLateChecks = Pick<
  Probe,
  "id" | "checksLateSince" | "checksLastLateAt"
>;

const writeLateChecks: (data: {
  probeId: ObjectID;
  lateChecks: ProbeLateChecks;
}) => Promise<void> = async (data: {
  probeId: ObjectID;
  lateChecks: ProbeLateChecks;
}): Promise<void> => {
  /*
   * Set by name: a null is how a time is cleared, and a model's Date
   * column is typed without one.
   */
  const update: PartialEntity<Probe> = {};

  (update as Record<string, unknown>)["checksLateSince"] =
    data.lateChecks.checksLateSince;
  (update as Record<string, unknown>)["checksLastLateAt"] =
    data.lateChecks.checksLastLateAt;

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

  const connected: Array<ProbeWithLateChecks> = await ProbeService.findBy({
    query: {
      connectionStatus: ProbeConnectionStatus.Connected,
    },
    select: {
      _id: true,
      checksLateSince: true,
      checksLastLateAt: true,
    },
    skip: 0,
    limit: LIMIT_MAX,
    props: {
      isRoot: true,
    },
  });

  const probeIds: Array<ObjectID> = connected
    .map((probe: ProbeWithLateChecks): ObjectID | undefined => {
      return probe.id || undefined;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });

  const oldestDueAt: Map<string, Date | null> =
    probeIds.length > 0
      ? await MonitorProbeService.getOldestWaitingCheckDueAt({
          probeIds: probeIds,
          dueAt: now,
        })
      : new Map<string, Date | null>();

  for (const probe of connected) {
    if (!probe.id) {
      continue;
    }

    const lateChecks: ProbeLateChecks = ProbeBehindUtil.next({
      state: probe,
      isLate: ProbeBehindUtil.isCheckLate({
        oldestDueAt: oldestDueAt.get(probe.id.toString()),
        now: now,
      }),
      now: now,
    });

    if (!ProbeBehindUtil.hasChanged(probe, lateChecks)) {
      continue;
    }

    try {
      await writeLateChecks({ probeId: probe.id, lateChecks: lateChecks });
    } catch (err) {
      logger.error(
        `${PROBE_BEHIND_JOB_NAME}: could not keep whether probe ${probe.id.toString()} is behind; the next reading tries again.`,
      );
      logger.error(err);
    }
  }

  // Not connected: nothing kept.
  const disconnected: Array<ProbeWithLateChecks> = await ProbeService.findBy({
    query: {
      connectionStatus: QueryHelper.notInOrNull([
        ProbeConnectionStatus.Connected,
      ]),
      checksLateSince: QueryHelper.notNull(),
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

  for (const probe of disconnected) {
    if (!probe.id) {
      continue;
    }

    try {
      await writeLateChecks({
        probeId: probe.id,
        lateChecks: ProbeBehindUtil.cleared(),
      });
    } catch (err) {
      logger.error(
        `${PROBE_BEHIND_JOB_NAME}: could not clear whether probe ${probe.id.toString()} is behind; the next reading tries again.`,
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
