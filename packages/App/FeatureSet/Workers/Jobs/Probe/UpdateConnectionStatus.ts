import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ProbeService from "Common/Server/Services/ProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";

/*
 * Staleness cutoff, chosen for exact parity with the historical in-process
 * check `OneUptimeDate.getDifferenceInMinutes(now, lastAlive) > 2`:
 * moment's diff-in-minutes truncates, so "difference > 2 minutes" was only
 * true once a probe was >= 3 whole minutes stale. The SQL predicate
 * `lastAlive <= now - 3 minutes` flips at exactly the same instant.
 */
const STALE_CUTOFF_IN_MINUTES: number = 3;

type FlipCandidate = {
  probe: Probe;
  newStatus: ProbeConnectionStatus;
};

RunCron(
  "Probe:UpdateConnectionStatus",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking Probe:UpdateConnectionStatus", {
      service: "workers",
    });

    const staleCutoff: Date = OneUptimeDate.getSomeMinutesAgo(
      STALE_CUTOFF_IN_MINUTES,
    );

    /*
     * Fetch ONLY the probes whose stored status disagrees with what their
     * lastAlive implies, instead of every probe row in the system every
     * minute. On a steady-state deployment both queries return zero rows —
     * the common case costs two indexed-predicate SELECTs and nothing else.
     *
     * A NULL connectionStatus (probe that never had one stamped) counts as
     * "disagrees" for both directions, mirroring the old in-process
     * comparison `probe.connectionStatus !== computedStatus`. The
     * notify-owners hook (ProbeService.onBeforeUpdate) independently skips
     * NULL→anything transitions, so no extra notifications are introduced.
     */
    const toDisconnect: Array<Probe> = await ProbeService.findBy({
      query: {
        // Stale OR never seen at all.
        lastAlive: QueryHelper.lessThanEqualToOrNull(staleCutoff),
        connectionStatus: QueryHelper.notInOrNull([
          ProbeConnectionStatus.Disconnected,
        ]),
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const toConnect: Array<Probe> = await ProbeService.findBy({
      query: {
        lastAlive: QueryHelper.greaterThan(staleCutoff),
        connectionStatus: QueryHelper.notInOrNull([
          ProbeConnectionStatus.Connected,
        ]),
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    /*
     * A probe can appear in BOTH lists in one narrow case: its
     * connectionStatus is NULL (matches neither notInOrNull filter) and a
     * heartbeat landed between the two SELECTs, moving it from stale to
     * fresh. The connect query ran later, so its verdict is the fresher
     * one — drop the disconnect flip rather than writing both.
     */
    const toConnectIds: Set<string> = new Set(
      toConnect.map((probe: Probe) => {
        return probe.id?.toString() || "";
      }),
    );

    const flips: Array<FlipCandidate> = [
      ...toDisconnect
        .filter((probe: Probe) => {
          return !toConnectIds.has(probe.id?.toString() || "");
        })
        .map((probe: Probe) => {
          return {
            probe,
            newStatus: ProbeConnectionStatus.Disconnected,
          };
        }),
      ...toConnect.map((probe: Probe) => {
        return {
          probe,
          newStatus: ProbeConnectionStatus.Connected,
        };
      }),
    ];

    if (flips.length === 0) {
      return;
    }

    logger.debug(
      `Found ${toDisconnect.length} probe(s) to mark Disconnected and ${toConnect.length} to mark Connected`,
      { service: "workers" },
    );

    for (const flip of flips) {
      try {
        if (!flip.probe.id) {
          continue;
        }

        /*
         * Full-pipeline update on purpose: the status flip is what fires
         * ProbeService's hooks (owner notifications, monitor status
         * refresh). Those hooks are the expensive part, which is exactly
         * why the queries above make sure this only ever runs for probes
         * that actually changed state.
         */
        await ProbeService.updateOneById({
          id: flip.probe.id,
          data: {
            connectionStatus: flip.newStatus,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (error) {
        logger.error(error, {
          service: "workers",
          projectId: flip.probe.projectId?.toString(),
        });
      }
    }
  },
);
