import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import NetworkAlertPolicyService from "Common/Server/Services/NetworkAlertPolicyService";
import NetworkAlertPolicyEngineService, {
  MAX_MONITORS_PER_POLICY_SYNC,
  PolicyRunContext,
} from "Common/Server/Services/NetworkAlertPolicyEngineService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ObjectID from "Common/Types/ObjectID";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";

/*
 * The convergence half of Network Alert Policies.
 *
 * Every event that can change which devices a policy covers already
 * reconciles inline — a device created, re-sited, re-labelled, archived,
 * switched to monitor-backed or handed a probe; a policy saved, enabled or
 * re-scoped. This job exists for the three things that produce no event the
 * inline path can act on:
 *
 *   1. BULK WRITES. A device update that matched more than
 *      MAX_INLINE_RECONCILE_DEVICES rows deliberately reconciles nothing in
 *      the request — "move 1,200 devices into this site" must not become an
 *      hour of monitor provisioning while the caller waits. It returns, and
 *      this sweep converges the fleet.
 *   2. CAPPED RUNS. A project's reconciliation stops after
 *      MAX_MONITORS_PER_POLICY_SYNC monitor writes. What it did is stamped;
 *      the rest is this sweep's next tick, and the one after that.
 *   3. FAILURES THAT FIX THEMSELVES. A plan that could not hold another
 *      monitor and now can, a template restored, a Redis blip that cost a
 *      device its lock. Nothing re-fires the original event, so without a
 *      sweep those fleets would stay half-provisioned until somebody re-saved
 *      the policy.
 *
 * It is a recompute, not a queue: the engine derives the difference between
 * the policies and the devices from the rows themselves, so a sweep that
 * crashes halfway loses nothing and a sweep that runs twice does nothing the
 * second time.
 */

/*
 * Policies one tick will look at. Each is at least two queries even when it
 * has nothing to do, and a policy that DOES have work paces itself against
 * the project's own monitor budget, so this bounds the tick rather than the
 * work. Policies are a handful per project, so on any real install every
 * policy is reached every tick.
 */
const MAX_POLICIES_PER_RUN: number = 500;

// Wall-clock budget of one sweep, mirrored by the job's own timeoutInMS.
const SWEEP_TIMEOUT_MINUTES: number = 4;

/*
 * One sweep at a time, and a sweep that stops at its deadline (issue #8103).
 *
 * RunCron runs one copy of this job at a time across every worker replica
 * (CronLock): a tick that finds the previous sweep still going skips. A
 * sweep that provisions hundreds of monitors can still outlive its
 * five-minute schedule, so it stops between policies once its deadline has
 * passed - its time limit, or the run's lease lost - or once it has spent
 * SOFT_BUDGET_SHARE of its time limit, which leaves the policy in flight room
 * to finish. Either way the policies it did not reach are still the stalest
 * and lead the next sweep.
 *
 * The job used to take a Redis mutex of its own as well, from when RunCron
 * had no overlap guard. The lease now does that, and an overlap could only
 * repeat work: the engine's per-device lock keeps two sweeps from corrupting
 * each other's monitors.
 */
const SOFT_BUDGET_SHARE: number = 0.8;

/*
 * The policies this tick will sync, never-synced ones first.
 *
 * Two queries rather than one clever ORDER BY, for the reason
 * RecomputeStaleRollups spells out: `lastSyncAt IS NULL` is a policy that has
 * never provisioned anything — the one whose devices have NO monitors at all
 * — and Postgres sorts NULLs LAST in an ascending order, so a plain
 * `lastSyncAt ASC` would put it behind every policy that merely has a stale
 * stamp. Past MAX_POLICIES_PER_RUN policies a brand-new one would never reach
 * the front of the queue and would never provision at all.
 *
 * Disabled and template-less policies are left out entirely: neither
 * provisions anything, and a disabled policy's monitors are paused rather
 * than removed, so there is no difference for a sweep to apply. They are
 * reconciled the moment they are enabled again.
 */
async function selectPoliciesToSync(): Promise<Array<NetworkAlertPolicy>> {
  const neverSynced: Array<NetworkAlertPolicy> =
    await NetworkAlertPolicyService.findBy({
      query: {
        isEnabled: true,
        monitorTemplateId: QueryHelper.notNull(),
        lastSyncAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      limit: MAX_POLICIES_PER_RUN,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  const remaining: number = MAX_POLICIES_PER_RUN - neverSynced.length;

  if (remaining <= 0) {
    return neverSynced;
  }

  const stalest: Array<NetworkAlertPolicy> =
    await NetworkAlertPolicyService.findBy({
      query: {
        isEnabled: true,
        monitorTemplateId: QueryHelper.notNull(),
        lastSyncAt: QueryHelper.notNull(),
      },
      sort: {
        lastSyncAt: SortOrder.Ascending,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
      },
      limit: remaining,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  return [...neverSynced, ...stalest];
}

RunCron(
  "NetworkAlertPolicy:ReconcilePolicies",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      SWEEP_TIMEOUT_MINUTES,
    ),
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    const policies: Array<NetworkAlertPolicy> = await selectPoliciesToSync();

    if (policies.length === 0) {
      return;
    }

    /*
     * The monitor budget is per PROJECT per sweep, not per policy, so
     * three policies of one project share one context: what is being
     * protected is the project's database and its bill, and three policies
     * each provisioning five hundred monitors is fifteen hundred billable
     * rows from one tick. Sharing the context also shares the plan verdict,
     * which is what makes "a project on a plan without monitors gets one
     * clear message" true across all of its policies rather than per policy.
     */
    const contextByProjectId: Map<string, PolicyRunContext> = new Map<
      string,
      PolicyRunContext
    >();

    /*
     * Stopping early is safe and self-correcting: nothing is half-written,
     * and the policies left behind are still the stalest, so they lead the
     * next tick. Running past the time limit would instead leave a sweep
     * working on with no lease, beside the next one.
     */
    const softBudgetEndsAt: number =
      Date.now() +
      OneUptimeDate.convertMinutesToMilliseconds(SWEEP_TIMEOUT_MINUTES) *
        SOFT_BUDGET_SHARE;

    let synced: number = 0;

    for (const policy of policies) {
      if (!policy.id || !policy.projectId) {
        continue;
      }

      if (deadline.hasPassed() || Date.now() > softBudgetEndsAt) {
        logger.debug(
          `NetworkAlertPolicy:ReconcilePolicies - stopping after ${synced} of ${policies.length} policies — ${
            deadline.hasPassed()
              ? "the run's deadline has passed"
              : "out of time for this sweep"
          }. The rest are still the stalest and lead the next one.`,
        );

        break;
      }

      const projectIdString: string = policy.projectId.toString();

      let context: PolicyRunContext | undefined =
        contextByProjectId.get(projectIdString);

      if (!context) {
        context = NetworkAlertPolicyEngineService.createRunContext(
          new ObjectID(projectIdString),
          MAX_MONITORS_PER_POLICY_SYNC,
        );
        contextByProjectId.set(projectIdString, context);
      }

      /*
       * A project whose plan refused another monitor, or whose budget is
       * spent, is skipped for the REST of this sweep rather than retried
       * per policy — that is the whole point of stopping at the first plan
       * exception. syncPolicy still stamps the message on the policies it
       * reached before the stop.
       */
      if (context.isStopped || context.isTruncated) {
        continue;
      }

      try {
        await NetworkAlertPolicyEngineService.syncPolicy({
          policyId: policy.id,
          context: context,
        });

        synced++;
      } catch (err) {
        // One broken policy must never starve the rest of the sweep.
        logger.error(
          `NetworkAlertPolicy:ReconcilePolicies - Error syncing policy ${policy.id.toString()}: ${err}`,
          { projectId: projectIdString } as LogAttributes,
        );
      }
    }

    for (const [projectIdString, context] of contextByProjectId) {
      if (
        context.monitorsCreated === 0 &&
        context.monitorsDeleted === 0 &&
        context.monitorsAdopted === 0 &&
        context.monitorsPaused === 0 &&
        !context.isStopped
      ) {
        continue;
      }

      logger.info(
        `NetworkAlertPolicy:ReconcilePolicies - project ${projectIdString}: ${context.monitorsCreated} monitor(s) provisioned, ${context.monitorsAdopted} adopted, ${context.monitorsDeleted} removed, ${context.monitorsPaused} paused${
          context.isTruncated ? "; capped — the next tick will continue" : ""
        }${context.planException ? `; stopped: ${context.planException}` : ""}.`,
        { projectId: projectIdString } as LogAttributes,
      );
    }
  },
);
