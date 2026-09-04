import MonitorService from "./MonitorService";
import MonitorTemplateService from "./MonitorTemplateService";
import NetworkAlertPolicyService from "./NetworkAlertPolicyService";
import NetworkDeviceService from "./NetworkDeviceService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import {
  AllowedActiveMonitorCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";
import NetworkAlertPolicyScope, {
  NetworkAlertPolicyScopeUtil,
} from "../../Types/NetworkDevice/NetworkAlertPolicyScope";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../Types/ObjectID";
import PartialEntity from "../../Types/Database/PartialEntity";
import PositiveNumber from "../../Types/PositiveNumber";
import NetworkDeviceMonitorTemplateUtil from "../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";

/*
 * The engine behind Network Alert Policies: the ONE place in the product
 * that creates or deletes a policy-owned Monitor.
 *
 * A policy is intent — "every device in these sites, with these roles, with
 * these labels, gets a Network Device monitor cloned from this template".
 * The monitors are the consequence, and they are billed and they own
 * incident history, so every path that could produce or destroy one funnels
 * through `reconcileDevice(projectId, deviceId)`. Device created, device
 * re-sited, device re-labelled, device archived, policy saved, policy
 * enabled, policy scope widened, the five-minute sweep — all of them end up
 * calling the same function for one device, under one Redis lock, and that
 * function computes:
 *
 *   DESIRED  every enabled policy of the project whose scope matches this
 *            device, PROVIDED the device is provisionable at all: not
 *            archived, not monitor-backed (a monitor-backed device's health
 *            IS a monitor's — a policy monitor on it would poll nothing),
 *            and carrying a probe (nothing polls a device without one, so a
 *            monitor on it would sit Pending forever and still be billed).
 *
 *   ACTUAL   the monitors whose provenance says a policy made them:
 *            `autoProvisionedNetworkDeviceId = this device AND
 *            networkAlertPolicyId IS NOT NULL`. Both halves matter. Without
 *            the first the engine would wander outside the device; without
 *            the second it would treat a hand-made monitor, or one an
 *            auto-import rule provisioned, as its own and delete it.
 *
 * and applies the difference. There is deliberately no "create the monitors
 * for a new policy" path and no "delete the monitors for a shrunk scope"
 * path: both are the same difference, computed per device, so the two can
 * never disagree about who owns what.
 *
 * WHAT THE ENGINE WILL NOT DO, ever:
 *
 *   - Touch a monitor another policy owns. Ownership is the PAIR
 *     (networkAlertPolicyId, monitorTemplateId): a monitor is policy P's
 *     current monitor only while it carries P's id AND the template P names
 *     right now. A monitor stamped with a different policy's id is left
 *     exactly where it is.
 *   - Delete a hand-made monitor. A Network Device monitor with no
 *     `networkAlertPolicyId` is not in ACTUAL at all, so a scope that shrinks
 *     away from a device deletes only the rows stamped with the policy that
 *     shrank.
 *   - Duplicate an unowned monitor. If a (device, template) monitor already
 *     exists without an owner — an auto-import rule's, or one a person built
 *     from the same template — the engine ADOPTS it by stamping its
 *     `networkAlertPolicyId`, rather than trying to create a second one and
 *     failing forever on Monitor's partial unique index on
 *     (autoProvisionedNetworkDeviceId, monitorTemplateId).
 *   - Rewrite a policy's scope. Stale ids in a scope simply match nothing;
 *     the engine reads the column and never writes it.
 *
 * WHY A LOCK PER DEVICE. Two policies matching one device, a device event
 * and the sweep, or two replicas of the sweep, all reconcile the SAME device
 * concurrently. Every decision here is check-then-write with no transaction
 * around it, so without the lock two passes both observe "no monitor yet"
 * and both create — one of them then failing on the unique index, or worse
 * both succeeding on different templates and each deleting the other's row
 * on the next pass. The lock is keyed on the device because the device is
 * what the difference is computed over.
 */

/*
 * Monitor writes one project's reconciliation may make before it stops and
 * leaves the rest to the next sweep.
 *
 * A monitor create runs the whole MonitorService pipeline — billing, plan
 * limits, operational status, labels, owners, SLOs, status pages, workflows,
 * realtime — so five hundred of them is already minutes of work. The cap is
 * per project per RUN rather than per policy, because the thing being
 * protected is the project's database and its bill, and three policies each
 * provisioning five hundred monitors is fifteen hundred billable rows from
 * one sweep tick.
 *
 * A capped run loses nothing: it stamps what it did, the next sweep recomputes
 * the same difference and continues, and `reconcileDevice` is idempotent.
 */
export const MAX_MONITORS_PER_POLICY_SYNC: number = 500;

/*
 * How many devices one update may reconcile INSIDE the request that wrote
 * them.
 *
 * A device write is usually one device — the Settings form, a discovery
 * import, a topology adoption — and reconciling it inline is what makes the
 * monitor appear before the operator's next page load. A BULK write is a
 * different animal: "move 1,200 devices to this site" or "archive the whole
 * warehouse" matches thousands of rows, and reconciling thousands of devices
 * inside an HTTP request would turn a one-statement update into an hour of
 * monitor provisioning while the caller waits. Past this many devices the
 * write returns immediately and the five-minute sweep converges the fleet.
 */
export const MAX_INLINE_RECONCILE_DEVICES: number = 5;

/*
 * The per-device lock. `Semaphore.lock` joins namespace and key with a dash,
 * so the Redis key is "NetworkAlertPolicy-NetworkAlertPolicy:Device:<id>";
 * the key itself is spelled in full so a `KEYS NetworkAlertPolicy:Device:*`
 * during an incident finds what an operator would expect it to.
 */
export const POLICY_DEVICE_LOCK_NAMESPACE: string = "NetworkAlertPolicy";

export function policyDeviceLockKey(deviceId: ObjectID | string): string {
  return `NetworkAlertPolicy:Device:${deviceId.toString()}`;
}

/*
 * Long enough for one device's difference (a handful of queries plus at most
 * a few monitor creates), short enough that a crashed worker does not block
 * a device for minutes. redis-semaphore refreshes a lock while it is held,
 * so this only bounds how long a DEAD holder's lock lingers.
 */
export const POLICY_DEVICE_LOCK_TIMEOUT_MS: number = 60 * 1000;

/*
 * One attempt, no queueing. Every caller of reconcileDevice is either
 * idempotent-and-repeated (the sweep) or fire-and-forget (a device hook), so
 * a device already being reconciled by somebody else needs no second pass
 * behind the first: that pass is computing the same difference from fresher
 * data than this one would.
 */
const POLICY_DEVICE_LOCK_ACQUIRE_ATTEMPTS: number = 1;

/*
 * A syntactically valid UUID that no row can carry, used to keep a scope kind
 * whose ids are ALL unusable matching nothing — see buildScopeDeviceQuery.
 * The nil UUID is the natural choice: it is well-formed, and
 * PrimaryGeneratedColumn("uuid") never produces it.
 */
const UNMATCHABLE_ID: string = "00000000-0000-0000-0000-000000000000";

// Devices and monitors read per statement while paging a policy's fleet.
const POLICY_SYNC_PAGE_SIZE: number = 500;

/*
 * The ceiling on how many devices ONE policy's forward pass will page
 * through before giving up on being exhaustive. It is not a correctness
 * bound — the pass is read-only until it finds a difference — but a run
 * bound: an unscoped policy on a 200,000-device estate must not spend a
 * whole sweep tick reading rows that are already correct. A pass that hits
 * it leaves `coveredDeviceCount` alone rather than stamping a number it
 * knows is short.
 */
export const MAX_DEVICES_SCANNED_PER_POLICY_SYNC: number = LIMIT_PER_PROJECT;

/*
 * Everything one reconciliation run shares.
 *
 * A "run" is one sweep tick's work for one project, or one device write's
 * inline work, or one policy save. Holding the project's policies, its
 * templates and its plan verdict here is what stops a 500-device sync from
 * asking the same three questions 500 times — and, more importantly, what
 * makes "stop at the first plan exception" possible at all: the verdict is
 * remembered, so a project whose plan does not allow another monitor
 * produces ONE message on its policies instead of 500 identical failures.
 */
export interface PolicyRunContext {
  projectId: ObjectID;
  // Loaded lazily, once, and only when something actually needs them.
  policies: Array<NetworkAlertPolicy> | null;
  templatesById: Map<string, MonitorTemplate | null>;
  /*
   * The plan's answer to "may this project have another monitor", and
   * whether it has been asked yet. `planException` being set is terminal for
   * the run: `isStopped` goes with it.
   */
  planChecked: boolean;
  planException: string | null;
  isStopped: boolean;
  // Writes made, against MAX_MONITORS_PER_POLICY_SYNC.
  monitorBudget: number;
  monitorsWritten: number;
  monitorsCreated: number;
  monitorsAdopted: number;
  monitorsDeleted: number;
  monitorsPaused: number;
  // True once the budget stopped the run short of a complete difference.
  isTruncated: boolean;
  /*
   * Non-plan failures, verbatim and in order. The first one is what reaches
   * `lastSyncError`; the rest are logged. Bounded so a pathological run
   * cannot grow this without limit.
   */
  failures: Array<string>;
}

const MAX_RECORDED_FAILURES_PER_RUN: number = 20;

/*
 * What a policy's monitors are keyed by, everywhere in this file: the policy
 * that owns them AND the template that policy names right now. A monitor
 * carrying the policy's id but a template the policy no longer names is a
 * leftover from the policy's previous template and is removed — that is how
 * "re-point a policy at a different template" re-clones the fleet.
 */
function ownershipKey(
  policyId: ObjectID | string,
  monitorTemplateId: ObjectID | string,
): string {
  return `${policyId.toString()}:${monitorTemplateId.toString()}`;
}

/*
 * The scope columns the matcher needs, plus the columns that decide whether a
 * device is provisionable at all. `labels` is a relation, so it has to be
 * asked for by name or it arrives undefined and every label-scoped policy
 * silently matches nothing.
 */
const RECONCILE_DEVICE_SELECT: Select<NetworkDevice> = {
  _id: true,
  projectId: true,
  name: true,
  hostname: true,
  siteId: true,
  networkDeviceRoleId: true,
  isArchived: true,
  monitoringMethod: true,
  probeId: true,
  labels: {
    _id: true,
  },
};

class NetworkAlertPolicyEngineServiceClass {
  /*
   * A fresh run. `monitorBudget` is per project per run — see
   * MAX_MONITORS_PER_POLICY_SYNC.
   */
  public createRunContext(
    projectId: ObjectID,
    monitorBudget: number = MAX_MONITORS_PER_POLICY_SYNC,
  ): PolicyRunContext {
    return {
      projectId: projectId,
      policies: null,
      templatesById: new Map<string, MonitorTemplate | null>(),
      planChecked: false,
      planException: null,
      isStopped: false,
      monitorBudget: monitorBudget,
      monitorsWritten: 0,
      monitorsCreated: 0,
      monitorsAdopted: 0,
      monitorsDeleted: 0,
      monitorsPaused: 0,
      isTruncated: false,
      failures: [],
    };
  }

  /**
   * THE mutation path. Brings one device's policy-owned monitors in line
   * with the project's policies, under the device's own Redis lock.
   *
   * Never throws for an ordinary failure: a device create must not fail
   * because a template was deleted or Redis is down. Failures are recorded
   * on the run context (and reach `lastSyncError` when the caller is a
   * policy sync); the next sweep recomputes the same difference.
   */
  @CaptureSpan()
  public async reconcileDevice(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    context?: PolicyRunContext | undefined;
  }): Promise<PolicyRunContext> {
    const context: PolicyRunContext =
      data.context || this.createRunContext(data.projectId);

    if (context.isStopped) {
      return context;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: policyDeviceLockKey(data.deviceId),
        namespace: POLICY_DEVICE_LOCK_NAMESPACE,
        lockTimeout: POLICY_DEVICE_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: POLICY_DEVICE_LOCK_ACQUIRE_ATTEMPTS,
      });
    } catch (error) {
      /*
       * Somebody else is reconciling this device right now (or Redis is
       * unavailable). Both are safely skippable: the other pass computes the
       * same difference from fresher data, and the sweep runs again in five
       * minutes. Debug, not error — under a busy sweep this is the normal
       * outcome of a device event landing mid-pass.
       */
      logger.debug(
        `NetworkAlertPolicy engine: could not lock device ${data.deviceId.toString()} for reconciliation; another pass holds it (or Redis is unavailable): ${error}`,
      );

      return context;
    }

    try {
      await this.reconcileDeviceUnderLock({
        projectId: data.projectId,
        deviceId: data.deviceId,
        context: context,
      });
    } catch (error) {
      this.recordFailure(
        context,
        `Could not reconcile device ${data.deviceId.toString()}: ${error}`,
      );
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.error(
          `NetworkAlertPolicy engine: failed to release the lock on device ${data.deviceId.toString()}: ${error}`,
        );
      }
    }

    return context;
  }

  /**
   * Reconcile a handful of devices in one run — what a device write does
   * inline. Callers that may have written more than
   * MAX_INLINE_RECONCILE_DEVICES devices must not call this; the sweep is
   * for them.
   */
  @CaptureSpan()
  public async reconcileDevices(data: {
    projectId: ObjectID;
    deviceIds: Array<ObjectID>;
    context?: PolicyRunContext | undefined;
  }): Promise<PolicyRunContext> {
    const context: PolicyRunContext =
      data.context || this.createRunContext(data.projectId);

    for (const deviceId of data.deviceIds) {
      if (context.isStopped) {
        break;
      }

      await this.reconcileDevice({
        projectId: data.projectId,
        deviceId: deviceId,
        context: context,
      });
    }

    return context;
  }

  private async reconcileDeviceUnderLock(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    context: PolicyRunContext;
  }): Promise<void> {
    const context: PolicyRunContext = data.context;

    /*
     * Read fresh under the lock, never from the caller's snapshot: the whole
     * point of the lock is that the difference is computed from the state
     * that is true right now.
     */
    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: {
        _id: data.deviceId,
        projectId: data.projectId,
      },
      select: RECONCILE_DEVICE_SELECT,
      props: {
        isRoot: true,
      },
    });

    const actualMonitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        autoProvisionedNetworkDeviceId: data.deviceId,
        // The second half of "a policy made this". See the file header.
        networkAlertPolicyId: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        networkAlertPolicyId: true,
        monitorTemplateId: true,
        disableActiveMonitoring: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * A device that is gone — or that never was in this project — keeps no
     * policy monitors.
     *
     * NetworkDeviceService.onBeforeDelete removes them before the device row
     * goes, so this branch should be unreachable through the ordinary path;
     * and for a HARD delete Monitor's RESTRICT foreign key would refuse
     * outright. What makes it reachable at all is a SOFT delete, which
     * stamps deletedAt without touching the foreign key: the device stops
     * being readable and its monitors are left behind. The cleanup is scoped
     * to the same (project, device) pair the monitors were read under, so it
     * can never reach further than the device that vanished.
     */
    if (!device) {
      await this.deleteMonitors({
        projectId: data.projectId,
        monitors: actualMonitors,
        context: context,
        reason: `device ${data.deviceId.toString()} no longer exists`,
      });

      return;
    }

    const isProvisionable: boolean = this.isDeviceProvisionable(device);

    /*
     * Not provisionable: archived, monitor-backed, or without a probe.
     * EVERY policy-owned monitor goes, including a paused one belonging to a
     * disabled policy — a device whose health is now a bound monitor's has
     * no use for a Network Device monitor at all, and leaving one behind
     * would keep billing for a monitor nothing can ever feed. Turning the
     * device back into a probe-polled one re-provisions it, because the
     * method write reconciles it again.
     */
    if (!isProvisionable) {
      await this.deleteMonitors({
        projectId: data.projectId,
        monitors: actualMonitors,
        context: context,
        reason: this.describeUnprovisionable(device),
      });

      return;
    }

    const policies: Array<NetworkAlertPolicy> =
      await this.getProjectPolicies(context);

    const policiesById: Map<string, NetworkAlertPolicy> = new Map<
      string,
      NetworkAlertPolicy
    >();

    for (const policy of policies) {
      if (policy.id) {
        policiesById.set(policy.id.toString(), policy);
      }
    }

    const deviceScope: {
      siteId: string | null;
      networkDeviceRoleId: string | null;
      labelIds: Array<string>;
    } = this.toScopeDevice(device);

    // DESIRED: enabled, template-carrying policies whose scope covers this device.
    const desiredByOwnershipKey: Map<
      string,
      { policy: NetworkAlertPolicy; monitorTemplateId: ObjectID }
    > = new Map<
      string,
      { policy: NetworkAlertPolicy; monitorTemplateId: ObjectID }
    >();

    for (const policy of policies) {
      if (!policy.id || !policy.isEnabled || !policy.monitorTemplateId) {
        continue;
      }

      if (
        !NetworkAlertPolicyScopeUtil.matchesDevice(policy.scope, deviceScope)
      ) {
        continue;
      }

      desiredByOwnershipKey.set(
        ownershipKey(policy.id, policy.monitorTemplateId),
        {
          policy: policy,
          monitorTemplateId: policy.monitorTemplateId,
        },
      );
    }

    const satisfiedOwnershipKeys: Set<string> = new Set<string>();
    const monitorsToDelete: Array<Monitor> = [];
    const monitorsToPause: Array<Monitor> = [];

    for (const monitor of actualMonitors) {
      const policyId: ObjectID | undefined = monitor.networkAlertPolicyId;

      if (!policyId) {
        // The query asked for NOT NULL; belt and braces against a stale row.
        continue;
      }

      const owner: NetworkAlertPolicy | undefined = policiesById.get(
        policyId.toString(),
      );

      /*
       * The owning policy is gone (deleted, and this monitor outlived the
       * delete's own cleanup). Nothing owns it any more, and nobody will
       * ever tear it down if this pass does not.
       */
      if (!owner) {
        monitorsToDelete.push(monitor);
        continue;
      }

      const key: string = monitor.monitorTemplateId
        ? ownershipKey(policyId, monitor.monitorTemplateId)
        : "";

      if (key && desiredByOwnershipKey.has(key)) {
        satisfiedOwnershipKeys.add(key);
        continue;
      }

      /*
       * A DISABLED policy's monitors survive. Disabling is a pause, not a
       * teardown — the operator's way to stop alerting on a fleet for an
       * afternoon without losing every monitor's incident history and
       * without re-provisioning (and re-billing) hundreds of rows when they
       * switch it back on. What disabling DOES do is stop the monitors
       * running, which is `disableActiveMonitoring` (honoured by the walk
       * fan-out), asserted here so a monitor that missed the transition
       * write still ends up paused.
       *
       * A template-less policy — only reachable through the FK's SET NULL
       * backstop, since the template delete guard refuses the delete — is
       * treated identically: there is nothing to provision from, so nothing
       * is provisioned and nothing is destroyed.
       */
      const isPausedOwner: boolean =
        !owner.isEnabled || !owner.monitorTemplateId;

      const stillMatchesOwnerScope: boolean =
        NetworkAlertPolicyScopeUtil.matchesDevice(owner.scope, deviceScope);

      const carriesOwnerTemplate: boolean = Boolean(
        owner.monitorTemplateId &&
          monitor.monitorTemplateId &&
          owner.monitorTemplateId.toString() ===
            monitor.monitorTemplateId.toString(),
      );

      if (
        isPausedOwner &&
        stillMatchesOwnerScope &&
        (carriesOwnerTemplate || !owner.monitorTemplateId)
      ) {
        if (!monitor.disableActiveMonitoring) {
          monitorsToPause.push(monitor);
        }

        continue;
      }

      /*
       * What is left is a monitor this policy no longer wants on this
       * device: the scope shrank away from it, or the policy was re-pointed
       * at a different template and this row is the old template's. Either
       * way it is stamped with THIS policy's id, which is the only thing
       * that makes it safe to delete.
       */
      monitorsToDelete.push(monitor);
    }

    await this.deleteMonitors({
      projectId: data.projectId,
      monitors: monitorsToDelete,
      context: context,
      reason: `device ${device.id?.toString()} is no longer covered by the owning policy`,
    });

    await this.pauseMonitors({
      projectId: data.projectId,
      monitors: monitorsToPause,
      context: context,
    });

    for (const desired of desiredByOwnershipKey.values()) {
      if (context.isStopped) {
        return;
      }

      const key: string = ownershipKey(
        desired.policy.id!,
        desired.monitorTemplateId,
      );

      if (satisfiedOwnershipKeys.has(key)) {
        continue;
      }

      await this.provisionMonitor({
        context: context,
        device: device,
        policy: desired.policy,
        monitorTemplateId: desired.monitorTemplateId,
      });
    }
  }

  /*
   * Give one device one policy's monitor: adopt the (device, template)
   * monitor that already exists without an owner, or create it.
   *
   * ADOPTION, not duplication, and the reason is Monitor's partial unique
   * index on (autoProvisionedNetworkDeviceId, monitorTemplateId). An
   * auto-import rule provisioned from the same template, or a person built a
   * monitor from it by hand, and that row already occupies the pair. A
   * create would fail on the index on this pass and on every pass after it,
   * so the policy would report a failure forever while a perfectly good
   * monitor for exactly the right thing sat next to it. Stamping the policy
   * id onto it is what "this policy covers this device" actually means.
   */
  private async provisionMonitor(data: {
    context: PolicyRunContext;
    device: NetworkDevice;
    policy: NetworkAlertPolicy;
    monitorTemplateId: ObjectID;
  }): Promise<void> {
    const context: PolicyRunContext = data.context;

    /*
     * Peeked, not consumed. Nothing has been written yet, and the two ways
     * this method can return without writing — an unusable template, a plan
     * refusal — must not spend a unit of a budget they never used.
     */
    if (!this.hasMonitorBudget(context)) {
      return;
    }

    const unowned: Monitor | null = await MonitorService.findOneBy({
      query: {
        projectId: context.projectId,
        autoProvisionedNetworkDeviceId: data.device.id!,
        monitorTemplateId: data.monitorTemplateId,
        networkAlertPolicyId: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (unowned && unowned.id) {
      if (!this.takeMonitorBudget(context)) {
        return;
      }

      await this.adoptMonitor({
        context: context,
        monitorId: unowned.id,
        policy: data.policy,
      });

      return;
    }

    const template: MonitorTemplate | null = await this.getMonitorTemplate({
      context: context,
      monitorTemplateId: data.monitorTemplateId,
    });

    if (!template) {
      this.recordFailure(
        context,
        `Monitor template ${data.monitorTemplateId.toString()} is missing or is not a Network Device template, so policy "${data.policy.name || data.policy.id?.toString()}" could not provision a monitor.`,
      );

      return;
    }

    /*
     * Asked once per run, BEFORE the first create, so a project whose plan
     * cannot hold another monitor gets one sentence on its policies rather
     * than one failure per device.
     */
    if (await this.stopIfPlanRefusesAnotherMonitor(context)) {
      return;
    }

    if (!this.takeMonitorBudget(context)) {
      return;
    }

    try {
      const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: template,
        networkDevice: data.device,
      });

      /*
       * The stamp that makes this monitor the policy's. Written on the
       * create rather than in a follow-up update because a monitor that
       * exists for a moment without its owner is a monitor the next pass
       * would ADOPT — harmless — but also one a concurrent pass of a
       * different policy could adopt, which would not be.
       */
      monitor.networkAlertPolicyId = new ObjectID(data.policy.id!.toString());

      await MonitorService.create({
        data: monitor,
        props: {
          isRoot: true,
          tenantId: context.projectId,
        },
      });

      context.monitorsCreated++;
    } catch (error) {
      /*
       * A create can fail for two very different reasons, and telling them
       * apart is the whole of prerequisite 5.
       *
       * If the PLAN now refuses another monitor, every remaining create in
       * this run would fail identically: stop, and let the one message reach
       * every policy the run stamps. The verdict is re-asked rather than
       * pattern-matched out of the error text, so the classification cannot
       * drift when MonitorService rewords its refusal.
       *
       * Otherwise this is one device's problem — a lost race on the unique
       * index, a name collision, a template that stopped validating — so
       * record it and carry on with the rest of the fleet.
       */
      if (await this.stopIfPlanRefusesAnotherMonitor(context, true)) {
        return;
      }

      const adopted: boolean = await this.adoptAfterCreateRace({
        context: context,
        device: data.device,
        policy: data.policy,
        monitorTemplateId: data.monitorTemplateId,
      });

      if (adopted) {
        return;
      }

      this.recordFailure(
        context,
        `Could not provision a monitor for device ${data.device.id?.toString()} from policy "${data.policy.name || data.policy.id?.toString()}": ${error}`,
      );
    }
  }

  /*
   * The unique index is the final race backstop: if another writer created
   * the (device, template) monitor between our look and our create, the row
   * that exists is the one the policy wanted. Claim it if it is unowned,
   * count it as satisfied if it is already ours, and leave it alone if some
   * other policy got there first (which the one-policy-per-template rule
   * makes unreachable, but which must never turn into a delete).
   */
  private async adoptAfterCreateRace(data: {
    context: PolicyRunContext;
    device: NetworkDevice;
    policy: NetworkAlertPolicy;
    monitorTemplateId: ObjectID;
  }): Promise<boolean> {
    const existing: Monitor | null = await MonitorService.findOneBy({
      query: {
        projectId: data.context.projectId,
        autoProvisionedNetworkDeviceId: data.device.id!,
        monitorTemplateId: data.monitorTemplateId,
      },
      select: {
        _id: true,
        networkAlertPolicyId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!existing || !existing.id) {
      return false;
    }

    if (!existing.networkAlertPolicyId) {
      await this.adoptMonitor({
        context: data.context,
        monitorId: existing.id,
        policy: data.policy,
      });

      return true;
    }

    return (
      existing.networkAlertPolicyId.toString() === data.policy.id!.toString()
    );
  }

  private async adoptMonitor(data: {
    context: PolicyRunContext;
    monitorId: ObjectID;
    policy: NetworkAlertPolicy;
  }): Promise<void> {
    /*
     * A provenance stamp, not an operational change: no hooks, no workflow,
     * no realtime event, no audit row. The monitor keeps doing exactly what
     * it was doing; all that changes is who is answerable for it.
     */
    await MonitorService.updateColumnsByIdWithoutHooks({
      id: data.monitorId,
      data: {
        networkAlertPolicyId: new ObjectID(data.policy.id!.toString()),
      },
    });

    data.context.monitorsAdopted++;

    logger.debug(
      `NetworkAlertPolicy engine: adopted existing monitor ${data.monitorId.toString()} into policy "${data.policy.name || data.policy.id?.toString()}" rather than creating a duplicate.`,
    );
  }

  /**
   * Bring one policy's whole fleet in line: every device its scope matches
   * gets a monitor, and every monitor it owns whose device no longer matches
   * loses one. This is what the five-minute sweep runs, and what a policy
   * save runs for the policy that was saved.
   *
   * Stamps the four engine columns the settings table reads, so a policy
   * that has been failing since Tuesday says so where the operator is.
   */
  @CaptureSpan()
  public async syncPolicy(data: {
    policyId: ObjectID;
    context?: PolicyRunContext | undefined;
    /*
     * True when the caller has just re-pointed the policy at a DIFFERENT
     * template, so a clean complete pass leaves every monitor the policy
     * owns freshly cloned from the template it names now — which is exactly
     * what `templateSyncedAt` claims. Never set on an ordinary sweep: a
     * sweep that changes nothing has not re-synced anything from a template.
     */
    stampTemplateSyncedOnCleanPass?: boolean | undefined;
  }): Promise<PolicyRunContext | null> {
    const policy: NetworkAlertPolicy | null =
      await NetworkAlertPolicyService.findOneBy({
        query: {
          _id: data.policyId,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          isEnabled: true,
          monitorTemplateId: true,
          scope: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!policy || !policy.id || !policy.projectId) {
      // Deleted between the hook and here; its monitors went with it.
      return null;
    }

    /*
     * A run context carries a project's monitor budget and its plan verdict,
     * so using one that belongs to a different project would spend the wrong
     * project's budget and — worse — could read a plan refusal as this
     * project's. The sweep groups policies by project, so this only fires on
     * a caller mistake; it is corrected rather than trusted.
     */
    const context: PolicyRunContext =
      data.context &&
      data.context.projectId.toString() === policy.projectId.toString()
        ? data.context
        : this.createRunContext(policy.projectId);

    /*
     * A disabled or template-less policy provisions nothing and tears down
     * nothing (see the paused branch in reconcileDeviceUnderLock). Its
     * monitors are paused by the transition that disabled it, and stamping
     * lastSyncAt here is honest: the engine did look, and the answer was
     * "nothing to do".
     */
    if (!policy.isEnabled || !policy.monitorTemplateId) {
      await this.stampPolicy({
        policyId: policy.id,
        lastSyncAt: OneUptimeDate.getCurrentDate(),
        lastSyncError: null,
      });

      return context;
    }

    const scannedDeviceIds: Set<string> = new Set<string>();
    let coveredDeviceCount: number = 0;
    let isScanComplete: boolean = true;

    try {
      const forwardPass: { coveredDeviceCount: number; isComplete: boolean } =
        await this.provisionForMatchingDevices({
          policy: policy,
          context: context,
          scannedDeviceIds: scannedDeviceIds,
        });

      coveredDeviceCount = forwardPass.coveredDeviceCount;
      isScanComplete = forwardPass.isComplete;

      await this.reconcileOrphanedPolicyMonitors({
        policy: policy,
        context: context,
        confirmedDeviceIds: isScanComplete ? scannedDeviceIds : null,
      });
    } catch (error) {
      this.recordFailure(
        context,
        `Could not sync policy "${policy.name || policy.id.toString()}": ${error}`,
      );
    }

    const isCleanCompletePass: boolean =
      isScanComplete &&
      !context.isTruncated &&
      !context.isStopped &&
      context.failures.length === 0;

    await this.stampPolicy({
      policyId: policy.id,
      lastSyncAt: OneUptimeDate.getCurrentDate(),
      lastSyncError: context.planException || context.failures[0] || null,
      /*
       * Only from a pass that actually counted the whole fleet. A truncated
       * pass knows its number is short, and a short number beside a scope
       * sentence reads as "the policy lost devices", which is worse than the
       * previous pass's number staying put for five minutes.
       */
      coveredDeviceCount: isScanComplete ? coveredDeviceCount : undefined,
      /*
       * ...and only when the pass rebuilt the fleet from a template the
       * policy had just been re-pointed at, with nothing adopted (an adopted
       * monitor was built by somebody else and its criteria are not this
       * template's). Pushing a template EDIT onto an existing fleet is
       * MonitorTemplateService.syncLinkedMonitors' job; it stamps this
       * column through onMonitorTemplateSynced.
       */
      templateSyncedAt:
        data.stampTemplateSyncedOnCleanPass &&
        isCleanCompletePass &&
        context.monitorsAdopted === 0
          ? OneUptimeDate.getCurrentDate()
          : undefined,
    });

    return context;
  }

  /*
   * Forward pass: every device the scope matches, paged by `_id`.
   *
   * `_id` keyset paging rather than skip/offset because the pass WRITES —
   * provisioning a monitor does not move a device row, but archiving one
   * during the pass does remove it from the result set, and an offset page
   * then steps over a device that was never looked at. A keyset resumes from
   * the last id seen, so a row leaving the set behind the cursor costs
   * nothing.
   *
   * The monitors for a whole page are read in ONE query, so a fleet that is
   * already correct — the overwhelmingly common case, five minutes after the
   * last sweep — costs two statements per five hundred devices and takes no
   * per-device lock at all.
   */
  private async provisionForMatchingDevices(data: {
    policy: NetworkAlertPolicy;
    context: PolicyRunContext;
    scannedDeviceIds: Set<string>;
  }): Promise<{ coveredDeviceCount: number; isComplete: boolean }> {
    const monitorTemplateId: ObjectID = data.policy.monitorTemplateId!;
    const deviceQuery: Query<NetworkDevice> = this.buildScopeDeviceQuery({
      projectId: data.context.projectId,
      scope: data.policy.scope,
    });

    let cursor: ObjectID | null = null;
    let coveredDeviceCount: number = 0;
    let scanned: number = 0;

    for (;;) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: cursor
          ? { ...deviceQuery, _id: QueryHelper.greaterThan(cursor) }
          : deviceQuery,
        select: RECONCILE_DEVICE_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: POLICY_SYNC_PAGE_SIZE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (devices.length === 0) {
        return { coveredDeviceCount: coveredDeviceCount, isComplete: true };
      }

      cursor = devices[devices.length - 1]!.id;
      scanned += devices.length;

      /*
       * `monitoringMethod` is free text whose NULL, "" and legacy "SNMP" all
       * mean Probe, so it cannot be filtered in SQL without writing a
       * predicate that would silently drop every pre-ping-first row. Filtered
       * here instead, over one page at a time.
       */
      const provisionableDevices: Array<NetworkDevice> = devices.filter(
        (device: NetworkDevice): boolean => {
          return this.isDeviceProvisionable(device);
        },
      );

      coveredDeviceCount += provisionableDevices.length;

      for (const device of provisionableDevices) {
        if (device.id) {
          data.scannedDeviceIds.add(device.id.toString());
        }
      }

      const deviceIdsMissingMonitor: Array<ObjectID> =
        await this.findDevicesMissingPolicyMonitor({
          projectId: data.context.projectId,
          policyId: data.policy.id!,
          monitorTemplateId: monitorTemplateId,
          devices: provisionableDevices,
        });

      for (const deviceId of deviceIdsMissingMonitor) {
        if (data.context.isStopped || data.context.isTruncated) {
          return {
            coveredDeviceCount: coveredDeviceCount,
            isComplete: false,
          };
        }

        await this.reconcileDevice({
          projectId: data.context.projectId,
          deviceId: deviceId,
          context: data.context,
        });
      }

      if (devices.length < POLICY_SYNC_PAGE_SIZE) {
        return { coveredDeviceCount: coveredDeviceCount, isComplete: true };
      }

      if (scanned >= MAX_DEVICES_SCANNED_PER_POLICY_SYNC) {
        logger.debug(
          `NetworkAlertPolicy engine: policy ${data.policy.id?.toString()} stopped scanning after ${scanned} devices; the next sweep continues.`,
        );

        return { coveredDeviceCount: coveredDeviceCount, isComplete: false };
      }
    }
  }

  /*
   * Which of these devices do NOT already carry this policy's current
   * monitor. One statement for the whole page; only the answers get the
   * per-device lock and the full difference.
   */
  private async findDevicesMissingPolicyMonitor(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    monitorTemplateId: ObjectID;
    devices: Array<NetworkDevice>;
  }): Promise<Array<ObjectID>> {
    const deviceIds: Array<ObjectID> = data.devices.flatMap(
      (device: NetworkDevice): Array<ObjectID> => {
        return device.id ? [device.id] : [];
      },
    );

    if (deviceIds.length === 0) {
      return [];
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        networkAlertPolicyId: data.policyId,
        monitorTemplateId: data.monitorTemplateId,
        autoProvisionedNetworkDeviceId: QueryHelper.any(deviceIds),
      },
      select: {
        _id: true,
        autoProvisionedNetworkDeviceId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const covered: Set<string> = new Set<string>();

    for (const monitor of monitors) {
      if (monitor.autoProvisionedNetworkDeviceId) {
        covered.add(monitor.autoProvisionedNetworkDeviceId.toString());
      }
    }

    return deviceIds.filter((deviceId: ObjectID): boolean => {
      return !covered.has(deviceId.toString());
    });
  }

  /*
   * Reverse pass: the policy's own monitors, paged by `_id`, looking for the
   * ones whose device the forward pass did NOT confirm — a device that left
   * the scope, was archived, went monitor-backed or lost its probe. These
   * are the deletes a shrinking scope produces, and they are computed from
   * the MONITORS rather than from the devices because the set of monitors a
   * policy owns is bounded by what it provisioned, while "every device that
   * no longer matches" is the whole estate.
   *
   * `confirmedDeviceIds` is the forward pass's answer, and it is only
   * trustworthy when that pass was exhaustive. When it was not, every
   * monitor's device is re-evaluated instead — slower, and correct.
   */
  private async reconcileOrphanedPolicyMonitors(data: {
    policy: NetworkAlertPolicy;
    context: PolicyRunContext;
    confirmedDeviceIds: Set<string> | null;
  }): Promise<void> {
    let cursor: ObjectID | null = null;

    for (;;) {
      if (data.context.isStopped || data.context.isTruncated) {
        return;
      }

      const baseQuery: Query<Monitor> = {
        projectId: data.context.projectId,
        networkAlertPolicyId: data.policy.id!,
      };

      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: cursor
          ? { ...baseQuery, _id: QueryHelper.greaterThan(cursor) }
          : baseQuery,
        select: {
          _id: true,
          autoProvisionedNetworkDeviceId: true,
          monitorTemplateId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: POLICY_SYNC_PAGE_SIZE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (monitors.length === 0) {
        return;
      }

      cursor = monitors[monitors.length - 1]!.id;

      const deviceIdsToRecheck: Array<ObjectID> =
        await this.findMonitorDevicesNeedingRecheck({
          policy: data.policy,
          context: data.context,
          monitors: monitors,
          confirmedDeviceIds: data.confirmedDeviceIds,
        });

      for (const deviceId of deviceIdsToRecheck) {
        if (data.context.isStopped || data.context.isTruncated) {
          return;
        }

        await this.reconcileDevice({
          projectId: data.context.projectId,
          deviceId: deviceId,
          context: data.context,
        });
      }

      if (monitors.length < POLICY_SYNC_PAGE_SIZE) {
        return;
      }
    }
  }

  private async findMonitorDevicesNeedingRecheck(data: {
    policy: NetworkAlertPolicy;
    context: PolicyRunContext;
    monitors: Array<Monitor>;
    confirmedDeviceIds: Set<string> | null;
  }): Promise<Array<ObjectID>> {
    const monitorTemplateId: string = data.policy.monitorTemplateId!.toString();
    const candidates: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const monitor of data.monitors) {
      const deviceId: ObjectID | undefined =
        monitor.autoProvisionedNetworkDeviceId;

      if (!deviceId) {
        /*
         * A policy-stamped monitor with no device provenance cannot be
         * reconciled by device, and deleting it on a guess would destroy a
         * monitor the engine cannot prove is its own. Report it instead: it
         * takes a hand-written UPDATE to produce, and the operator should
         * see that it happened.
         */
        this.recordFailure(
          data.context,
          `Monitor ${monitor.id?.toString()} carries policy "${data.policy.name || data.policy.id?.toString()}" but no device provenance; it was left untouched.`,
        );

        continue;
      }

      /*
       * A monitor from the policy's PREVIOUS template always needs the full
       * per-device difference, even for a device the forward pass confirmed:
       * the forward pass only asked whether the CURRENT template's monitor
       * exists.
       */
      const carriesCurrentTemplate: boolean =
        monitor.monitorTemplateId?.toString() === monitorTemplateId;

      if (
        carriesCurrentTemplate &&
        data.confirmedDeviceIds &&
        data.confirmedDeviceIds.has(deviceId.toString())
      ) {
        continue;
      }

      candidates.set(deviceId.toString(), deviceId);
    }

    if (candidates.size === 0) {
      return [];
    }

    /*
     * When the forward pass was exhaustive its set is the whole answer:
     * anything not in it has already failed the scope or provisionability
     * test, so it goes straight to reconcileDevice without a second read.
     */
    if (data.confirmedDeviceIds) {
      return Array.from(candidates.values());
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId: data.context.projectId,
        _id: QueryHelper.any(Array.from(candidates.values())),
      },
      select: RECONCILE_DEVICE_SELECT,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const stillCovered: Set<string> = new Set<string>();

    for (const device of devices) {
      if (!device.id || !this.isDeviceProvisionable(device)) {
        continue;
      }

      if (
        NetworkAlertPolicyScopeUtil.matchesDevice(
          data.policy.scope,
          this.toScopeDevice(device),
        )
      ) {
        stillCovered.add(device.id.toString());
      }
    }

    const needsRecheck: Array<ObjectID> = [];

    for (const [deviceIdString, deviceId] of candidates) {
      if (!stillCovered.has(deviceIdString)) {
        needsRecheck.push(deviceId);
      }
    }

    return needsRecheck;
  }

  /**
   * Every monitor a policy owns, removed as root, paged — what
   * NetworkAlertPolicyService.onBeforeDelete calls before the row goes.
   *
   * As ROOT, deliberately. These monitors are system-managed: the API cannot
   * create the `networkAlertPolicyId` column and cannot update it, so the
   * operator deleting the policy never chose to own them individually.
   * Making the delete depend on their monitor-delete permission would leave
   * a project with orphaned, still-billed monitors and a policy row that no
   * longer explains them.
   *
   * The SET NULL foreign key stays a backstop for a row this never reached,
   * not the mechanism: a monitor that loses its policy id that way becomes
   * an ordinary auto-provisioned monitor rather than a dangling reference.
   */
  @CaptureSpan()
  public async deleteMonitorsOwnedByPolicy(data: {
    projectId: ObjectID;
    policyId: ObjectID;
  }): Promise<number> {
    let deleted: number = 0;
    let previousFirstMonitorId: string = "";

    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          networkAlertPolicyId: data.policyId,
        },
        select: {
          _id: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: POLICY_SYNC_PAGE_SIZE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (monitors.length === 0) {
        return deleted;
      }

      const monitorIds: Array<ObjectID> = monitors.flatMap(
        (monitor: Monitor): Array<ObjectID> => {
          return monitor.id ? [monitor.id] : [];
        },
      );

      if (monitorIds.length === 0) {
        return deleted;
      }

      /*
       * Deleted by id AND still keyed on the policy, so a row that changed
       * owner between the read and the delete is left alone. Always from the
       * front of the set rather than at an offset: each batch shrinks it.
       */
      await MonitorService.deleteBy({
        query: {
          _id: QueryHelper.any(monitorIds),
          projectId: data.projectId,
          networkAlertPolicyId: data.policyId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      deleted += monitorIds.length;

      if (monitors.length < POLICY_SYNC_PAGE_SIZE) {
        return deleted;
      }

      /*
       * The page is always read from the front, because each batch is
       * supposed to shrink the set. If the same first row comes back the set
       * did NOT shrink, and reading it again would spin a worker forever
       * rather than delete anything. Stop and say so.
       */
      const firstMonitorId: string = monitorIds[0]!.toString();

      if (firstMonitorId === previousFirstMonitorId) {
        logger.error(
          `NetworkAlertPolicy engine: could not delete the monitors of policy ${data.policyId.toString()}; the set stopped shrinking at ${monitorIds.length} row(s).`,
        );

        return deleted;
      }

      previousFirstMonitorId = firstMonitorId;
    }
  }

  /**
   * The policy-owned monitors of a set of devices, removed as root — what
   * NetworkDeviceService.onBeforeDelete calls before the devices go.
   *
   * Monitor's provenance foreign key is RESTRICT, so a policy monitor left
   * behind would make the device delete fail outright. Root for the same
   * reason as the policy delete: nobody chose these monitors individually,
   * so nobody should need permission on them individually to delete the
   * device they describe.
   */
  @CaptureSpan()
  public async deletePolicyMonitorsForDevices(data: {
    projectId: ObjectID;
    deviceIds: Array<ObjectID>;
  }): Promise<number> {
    if (data.deviceIds.length === 0) {
      return 0;
    }

    let deleted: number = 0;
    let previousFirstMonitorId: string = "";

    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          autoProvisionedNetworkDeviceId: QueryHelper.any(data.deviceIds),
          networkAlertPolicyId: QueryHelper.notNull(),
        },
        select: {
          _id: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: POLICY_SYNC_PAGE_SIZE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (monitors.length === 0) {
        return deleted;
      }

      const monitorIds: Array<ObjectID> = monitors.flatMap(
        (monitor: Monitor): Array<ObjectID> => {
          return monitor.id ? [monitor.id] : [];
        },
      );

      if (monitorIds.length === 0) {
        return deleted;
      }

      await MonitorService.deleteBy({
        query: {
          _id: QueryHelper.any(monitorIds),
          projectId: data.projectId,
          // Still policy-owned at delete time, never a hand-made monitor.
          networkAlertPolicyId: QueryHelper.notNull(),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      deleted += monitorIds.length;

      if (monitors.length < POLICY_SYNC_PAGE_SIZE) {
        return deleted;
      }

      // Same no-progress guard as deleteMonitorsOwnedByPolicy.
      const firstMonitorId: string = monitorIds[0]!.toString();

      if (firstMonitorId === previousFirstMonitorId) {
        logger.error(
          `NetworkAlertPolicy engine: could not delete the policy-owned monitors of ${data.deviceIds.length} device(s); the set stopped shrinking at ${monitorIds.length} row(s).`,
        );

        return deleted;
      }

      previousFirstMonitorId = firstMonitorId;
    }
  }

  /**
   * Disabling a policy pauses its monitors; enabling one resumes them.
   *
   * `disableActiveMonitoring` is what the Network Device walk fan-out reads
   * before it feeds a monitor, so a paused monitor stops producing criteria
   * verdicts, incidents and alerts while keeping its history, its
   * dependencies and its id. That is what makes disabling reversible in a
   * way deleting is not.
   *
   * Paged by the flag itself: each page writes the rows it read, so the
   * matching set shrinks every pass and the loop terminates without a
   * cursor. Through updateBy, not a raw column write, so workflows, realtime
   * and audit see the pause exactly as they would an operator's.
   */
  @CaptureSpan()
  public async setPolicyMonitorsPaused(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    isPaused: boolean;
  }): Promise<number> {
    let updated: number = 0;

    for (;;) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          networkAlertPolicyId: data.policyId,
          disableActiveMonitoring: !data.isPaused,
        },
        select: {
          _id: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: POLICY_SYNC_PAGE_SIZE,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (monitors.length === 0) {
        return updated;
      }

      const monitorIds: Array<ObjectID> = monitors.flatMap(
        (monitor: Monitor): Array<ObjectID> => {
          return monitor.id ? [monitor.id] : [];
        },
      );

      if (monitorIds.length === 0) {
        return updated;
      }

      const written: number = await MonitorService.updateBy({
        query: {
          _id: QueryHelper.any(monitorIds),
          projectId: data.projectId,
          networkAlertPolicyId: data.policyId,
        },
        data: {
          disableActiveMonitoring: data.isPaused,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      updated += monitorIds.length;

      /*
       * The page is re-read on the flag, so a page that wrote nothing would
       * be read again forever. Only reachable if the write is being refused
       * or reverted by something else; stop and say so rather than spin.
       */
      if (written === 0) {
        logger.error(
          `NetworkAlertPolicy engine: could not ${
            data.isPaused ? "pause" : "resume"
          } ${monitorIds.length} monitor(s) of policy ${data.policyId.toString()}; giving up on this pass.`,
        );

        return updated;
      }
    }
  }

  /**
   * The template's configuration has just been pushed onto every monitor
   * cloned from it (MonitorTemplateService's explicit Sync). If a policy
   * provisions from that template, its fleet is now in step with it — which
   * is precisely what `templateSyncedAt` means to the settings table.
   *
   * Never throws: a failure to stamp a bookkeeping column must not fail the
   * sync the operator asked for.
   */
  @CaptureSpan()
  public async onMonitorTemplateSynced(data: {
    monitorTemplateId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    try {
      const policies: Array<NetworkAlertPolicy> =
        await NetworkAlertPolicyService.findBy({
          query: {
            projectId: data.projectId,
            monitorTemplateId: data.monitorTemplateId,
          },
          select: {
            _id: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      for (const policy of policies) {
        if (!policy.id) {
          continue;
        }

        await this.stampPolicy({
          policyId: policy.id,
          templateSyncedAt: OneUptimeDate.getCurrentDate(),
        });
      }
    } catch (error) {
      logger.error(
        `NetworkAlertPolicy engine: could not stamp templateSyncedAt for monitor template ${data.monitorTemplateId.toString()}: ${error}`,
      );
    }
  }

  /*
   * The four engine columns, written without hooks.
   *
   * Not through updateOneById, and that is load-bearing rather than a
   * performance choice: NetworkAlertPolicyService.onUpdateSuccess calls the
   * engine, so a stamp made through the ordinary update path would sync the
   * policy, which would stamp it, which would sync it. `undefined` fields
   * are left out entirely, so a truncated pass does not overwrite the
   * previous pass's coveredDeviceCount with a number it knows is short.
   */
  private async stampPolicy(data: {
    policyId: ObjectID;
    lastSyncAt?: Date | undefined;
    lastSyncError?: string | null | undefined;
    coveredDeviceCount?: number | undefined;
    templateSyncedAt?: Date | undefined;
  }): Promise<void> {
    const columns: Record<string, unknown> = {};

    if (data.lastSyncAt !== undefined) {
      columns["lastSyncAt"] = data.lastSyncAt;
    }

    if (data.lastSyncError !== undefined) {
      columns["lastSyncError"] = data.lastSyncError;
    }

    if (data.coveredDeviceCount !== undefined) {
      columns["coveredDeviceCount"] = data.coveredDeviceCount;
    }

    if (data.templateSyncedAt !== undefined) {
      columns["templateSyncedAt"] = data.templateSyncedAt;
    }

    if (Object.keys(columns).length === 0) {
      return;
    }

    try {
      await NetworkAlertPolicyService.updateColumnsByIdWithoutHooks({
        id: data.policyId,
        data: columns as PartialEntity<NetworkAlertPolicy>,
      });
    } catch (error) {
      logger.error(
        `NetworkAlertPolicy engine: could not stamp policy ${data.policyId.toString()}: ${error}`,
      );
    }
  }

  /*
   * The SQL half of the scope. Sites, roles and labels are plain columns (and
   * one join table), so they filter in Postgres; provisionability does not,
   * and is filtered per page by the caller.
   *
   * Ids that are not UUIDs are dropped rather than sent to Postgres, where
   * `uuid = 'not-an-id'` is a statement error that would take the whole
   * sweep down. A scope is validated at write, so this only fires for a row
   * hand-edited in the database — and "match nothing" is exactly what a
   * meaningless id should do.
   *
   * A kind whose ids are ALL unusable is not the same as a kind with no ids:
   * the empty kind matches every device, so dropping the last id of a kind
   * would silently widen the policy to the whole estate. Such a kind is
   * given an id that cannot exist instead, so it keeps matching nothing.
   */
  private buildScopeDeviceQuery(data: {
    projectId: ObjectID;
    scope: NetworkAlertPolicyScope | null | undefined;
  }): Query<NetworkDevice> {
    const scope: NetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize(data.scope);

    const query: Query<NetworkDevice> = {
      projectId: data.projectId,
      isArchived: false,
      // A device nothing polls can carry no monitor worth billing for.
      probeId: QueryHelper.notNull(),
    };

    const siteIds: Array<ObjectID> | null = this.toQueryableIds(scope.siteIds);

    if (siteIds) {
      query.siteId = QueryHelper.any(siteIds);
    }

    const roleIds: Array<ObjectID> | null = this.toQueryableIds(
      scope.networkDeviceRoleIds,
    );

    if (roleIds) {
      query.networkDeviceRoleId = QueryHelper.any(roleIds);
    }

    const labelIds: Array<ObjectID> | null = this.toQueryableIds(
      scope.labelIds,
    );

    if (labelIds) {
      query.labels = labelIds;
    }

    return query;
  }

  /*
   * null when the kind is empty (it matches everything and adds no clause);
   * otherwise the kind's usable ids, or one impossible id when none of them
   * are usable.
   */
  private toQueryableIds(
    ids: Array<string> | undefined,
  ): Array<ObjectID> | null {
    if (!ids || ids.length === 0) {
      return null;
    }

    const usable: Array<ObjectID> = ids
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    if (usable.length === 0) {
      return [new ObjectID(UNMATCHABLE_ID)];
    }

    return usable;
  }

  /*
   * The three questions that decide whether a device may carry a policy
   * monitor at all. All three are about the DEVICE, never about the policy:
   * a policy cannot make a monitor-backed device pollable.
   */
  private isDeviceProvisionable(device: NetworkDevice): boolean {
    if (device.isArchived) {
      return false;
    }

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
    ) {
      return false;
    }

    return Boolean(device.probeId);
  }

  private describeUnprovisionable(device: NetworkDevice): string {
    if (device.isArchived) {
      return `device ${device.id?.toString()} is archived`;
    }

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
    ) {
      return `device ${device.id?.toString()} is monitor-backed`;
    }

    return `device ${device.id?.toString()} has no probe`;
  }

  private toScopeDevice(device: NetworkDevice): {
    siteId: string | null;
    networkDeviceRoleId: string | null;
    labelIds: Array<string>;
  } {
    return {
      siteId: device.siteId?.toString() || null,
      networkDeviceRoleId: device.networkDeviceRoleId?.toString() || null,
      labelIds: (device.labels || []).flatMap(
        (label: { id?: ObjectID | null }): Array<string> => {
          return label.id ? [label.id.toString()] : [];
        },
      ),
    };
  }

  /*
   * Every non-deleted policy of the project, enabled or not, read once per
   * run. The disabled ones are needed as much as the enabled ones: they are
   * what tells "a monitor whose owner paused it" (keep) apart from "a
   * monitor whose owner is gone" (delete).
   */
  private async getProjectPolicies(
    context: PolicyRunContext,
  ): Promise<Array<NetworkAlertPolicy>> {
    if (context.policies) {
      return context.policies;
    }

    const policies: Array<NetworkAlertPolicy> =
      await NetworkAlertPolicyService.findBy({
        query: {
          projectId: context.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          isEnabled: true,
          monitorTemplateId: true,
          scope: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    context.policies = policies;

    return policies;
  }

  /*
   * The template, read once per run and re-checked against the project and
   * the type every time it is loaded. A policy's template was validated when
   * the policy was saved, but it can be edited, and the engine clones it as
   * ROOT — so nothing here trusts the policy's word for what it points at.
   */
  private async getMonitorTemplate(data: {
    context: PolicyRunContext;
    monitorTemplateId: ObjectID;
  }): Promise<MonitorTemplate | null> {
    const key: string = data.monitorTemplateId.toString();

    if (data.context.templatesById.has(key)) {
      return data.context.templatesById.get(key) || null;
    }

    const template: MonitorTemplate | null =
      await MonitorTemplateService.findOneBy({
        query: {
          _id: data.monitorTemplateId,
          projectId: data.context.projectId,
          monitorType: MonitorType.NetworkDevice,
        },
        select: {
          _id: true,
          projectId: true,
          monitorType: true,
          monitorName: true,
          monitorDescription: true,
          monitorSteps: true,
          monitoringInterval: true,
          minimumProbeAgreement: true,
          customFields: true,
          labels: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    data.context.templatesById.set(key, template);

    return template;
  }

  /*
   * Prerequisite 5, and the reason it is a precheck rather than an error
   * handler: a project on a plan that cannot hold another monitor would
   * otherwise produce one failed create per device — five hundred identical
   * log lines and a lastSyncError that says nothing about the plan. Asked
   * once per run, remembered, and terminal.
   *
   * `force` re-asks after a create failed, so the free-plan ceiling reached
   * DURING a run (the precheck passed at 9 of 10 monitors) stops the run at
   * the first refusal instead of at the five hundredth.
   */
  private async stopIfPlanRefusesAnotherMonitor(
    context: PolicyRunContext,
    force: boolean = false,
  ): Promise<boolean> {
    if (context.isStopped) {
      return true;
    }

    if (context.planChecked && !force) {
      return false;
    }

    context.planChecked = true;

    if (!IsBillingEnabled) {
      return false;
    }

    let exception: string | null = null;

    try {
      const currentPlan: CurrentPlan = await ProjectService.getCurrentPlan(
        context.projectId,
      );

      if (currentPlan.isSubscriptionUnpaid) {
        exception =
          "This project's subscription is unpaid, so no monitors can be provisioned. Update the payment method and settle the outstanding invoices, and the next sync will provision them.";
      } else if (currentPlan.plan === PlanType.Free) {
        const monitorCount: PositiveNumber = await MonitorService.countBy({
          query: {
            projectId: context.projectId,
            monitorType: QueryHelper.any(
              MonitorTypeHelper.getActiveMonitorTypes(),
            ),
          },
          props: {
            isRoot: true,
          },
        });

        if (monitorCount.toNumber() >= AllowedActiveMonitorCountInFreePlan) {
          exception = `This project has reached the free plan's limit of ${AllowedActiveMonitorCountInFreePlan} active monitors, so alert policies cannot provision more. Upgrade the plan and the next sync will provision them.`;
        }
      }
    } catch (error) {
      /*
       * The billing lookup itself failed. That is NOT a plan refusal — a
       * Stripe blip must not stop a fleet from being provisioned — so it is
       * recorded as an ordinary failure and the run carries on.
       */
      this.recordFailure(
        context,
        `Could not read the project's plan before provisioning monitors: ${error}`,
      );

      return false;
    }

    if (!exception) {
      return false;
    }

    context.planException = exception;
    context.isStopped = true;

    logger.warn(
      `NetworkAlertPolicy engine: stopping this run for project ${context.projectId.toString()} — ${exception}`,
      { projectId: context.projectId.toString() } as LogAttributes,
    );

    return true;
  }

  /*
   * Is there budget left? Marks the run truncated when there is not, so
   * callers stop provisioning rather than stop dead: what has been written
   * stays written, the policy is stamped, and the next sweep continues.
   */
  private hasMonitorBudget(context: PolicyRunContext): boolean {
    if (context.monitorsWritten >= context.monitorBudget) {
      context.isTruncated = true;

      return false;
    }

    return true;
  }

  // ...and spend one unit of it, immediately before a write.
  private takeMonitorBudget(context: PolicyRunContext): boolean {
    if (!this.hasMonitorBudget(context)) {
      return false;
    }

    context.monitorsWritten++;

    return true;
  }

  private async deleteMonitors(data: {
    projectId: ObjectID;
    monitors: Array<Monitor>;
    context: PolicyRunContext;
    reason: string;
  }): Promise<void> {
    for (const monitor of data.monitors) {
      if (!monitor.id) {
        continue;
      }

      if (!this.takeMonitorBudget(data.context)) {
        return;
      }

      try {
        /*
         * Keyed on the policy id the row was read with as well as on the
         * row's own id, so a monitor that changed hands between the read and
         * the delete is left to whoever owns it now.
         */
        await MonitorService.deleteBy({
          query: {
            _id: monitor.id,
            projectId: data.projectId,
            networkAlertPolicyId: monitor.networkAlertPolicyId!,
          },
          limit: 1,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        data.context.monitorsDeleted++;

        logger.debug(
          `NetworkAlertPolicy engine: deleted policy-owned monitor ${monitor.id.toString()} because ${data.reason}.`,
        );
      } catch (error) {
        this.recordFailure(
          data.context,
          `Could not delete policy-owned monitor ${monitor.id.toString()} (${data.reason}): ${error}`,
        );
      }
    }
  }

  private async pauseMonitors(data: {
    projectId: ObjectID;
    monitors: Array<Monitor>;
    context: PolicyRunContext;
  }): Promise<void> {
    for (const monitor of data.monitors) {
      if (!monitor.id) {
        continue;
      }

      if (!this.takeMonitorBudget(data.context)) {
        return;
      }

      try {
        await MonitorService.updateBy({
          query: {
            _id: monitor.id,
            projectId: data.projectId,
            networkAlertPolicyId: monitor.networkAlertPolicyId!,
          },
          data: {
            disableActiveMonitoring: true,
          },
          limit: 1,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        data.context.monitorsPaused++;
      } catch (error) {
        this.recordFailure(
          data.context,
          `Could not pause policy-owned monitor ${monitor.id.toString()}: ${error}`,
        );
      }
    }
  }

  private recordFailure(context: PolicyRunContext, message: string): void {
    logger.error(`NetworkAlertPolicy engine: ${message}`, {
      projectId: context.projectId.toString(),
    } as LogAttributes);

    if (context.failures.length >= MAX_RECORDED_FAILURES_PER_RUN) {
      return;
    }

    context.failures.push(message);
  }
}

export default new NetworkAlertPolicyEngineServiceClass();
