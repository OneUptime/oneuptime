import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import AIAgentService from "Common/Server/Services/AIAgentService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import AIAgent, {
  AIAgentConnectionStatus,
} from "Common/Models/DatabaseModels/AIAgent";

/*
 * Staleness cutoff, chosen for exact parity with the historical in-process
 * check `OneUptimeDate.getDifferenceInMinutes(now, lastAlive) > 2`:
 * moment's diff-in-minutes truncates, so "difference > 2 minutes" was only
 * true once an agent was >= 3 whole minutes stale. The SQL predicate
 * `lastAlive <= now - 3 minutes` flips at exactly the same instant.
 */
const STALE_CUTOFF_IN_MINUTES: number = 3;

type FlipCandidate = {
  aiAgent: AIAgent;
  newStatus: AIAgentConnectionStatus;
};

RunCron(
  "AIAgent:UpdateConnectionStatus",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking AIAgent:UpdateConnectionStatus", {
      service: "workers",
    });

    const staleCutoff: Date = OneUptimeDate.getSomeMinutesAgo(
      STALE_CUTOFF_IN_MINUTES,
    );

    /*
     * Fetch ONLY the agents whose stored status disagrees with what their
     * lastAlive implies, instead of every AI agent row in the system every
     * minute. On a steady-state deployment both queries return zero rows —
     * the common case costs two indexed-predicate SELECTs and nothing else.
     *
     * A NULL connectionStatus (agent that never had one stamped) counts as
     * "disagrees" for both directions, mirroring the old in-process
     * comparison `aiAgent.connectionStatus !== computedStatus`. The
     * notify-owners hook (AIAgentService.onBeforeUpdate) independently skips
     * NULL→anything transitions, so no extra notifications are introduced.
     */
    const toDisconnect: Array<AIAgent> = await AIAgentService.findBy({
      query: {
        // Stale OR never seen at all.
        lastAlive: QueryHelper.lessThanEqualToOrNull(staleCutoff),
        connectionStatus: QueryHelper.notInOrNull([
          AIAgentConnectionStatus.Disconnected,
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

    const toConnect: Array<AIAgent> = await AIAgentService.findBy({
      query: {
        lastAlive: QueryHelper.greaterThan(staleCutoff),
        connectionStatus: QueryHelper.notInOrNull([
          AIAgentConnectionStatus.Connected,
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
     * An agent can appear in BOTH lists in one narrow case: its
     * connectionStatus is NULL (matches neither notInOrNull filter) and a
     * heartbeat landed between the two SELECTs, moving it from stale to
     * fresh. The connect query ran later, so its verdict is the fresher
     * one — drop the disconnect flip rather than writing both.
     */
    const toConnectIds: Set<string> = new Set(
      toConnect.map((aiAgent: AIAgent) => {
        return aiAgent.id?.toString() || "";
      }),
    );

    const flips: Array<FlipCandidate> = [
      ...toDisconnect
        .filter((aiAgent: AIAgent) => {
          return !toConnectIds.has(aiAgent.id?.toString() || "");
        })
        .map((aiAgent: AIAgent) => {
          return {
            aiAgent,
            newStatus: AIAgentConnectionStatus.Disconnected,
          };
        }),
      ...toConnect.map((aiAgent: AIAgent) => {
        return {
          aiAgent,
          newStatus: AIAgentConnectionStatus.Connected,
        };
      }),
    ];

    if (flips.length === 0) {
      return;
    }

    logger.debug(
      `Found ${toDisconnect.length} AI agent(s) to mark Disconnected and ${toConnect.length} to mark Connected`,
      { service: "workers" },
    );

    for (const flip of flips) {
      try {
        if (!flip.aiAgent.id) {
          continue;
        }

        /*
         * Full-pipeline update on purpose: the status flip is what fires
         * AIAgentService's hooks (owner notifications). Those hooks are the
         * expensive part, which is exactly why the queries above make sure
         * this only ever runs for agents that actually changed state.
         */
        await AIAgentService.updateOneById({
          id: flip.aiAgent.id,
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
          projectId: flip.aiAgent.projectId?.toString(),
        });
      }
    }
  },
);
