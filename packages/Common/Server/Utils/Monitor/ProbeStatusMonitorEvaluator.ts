import Monitor from "../../../Models/DatabaseModels/Monitor";
import Probe from "../../../Models/DatabaseModels/Probe";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepProbeStatusMonitorUtil } from "../../../Types/Monitor/MonitorStepProbeStatusMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ProbeStatusMonitorResponse from "../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
} from "../../../Utils/Monitor/MonitorPauseState";
import ProbeStatusMonitorUtil from "../../../Utils/Monitor/ProbeStatusMonitorUtil";
import MonitorService from "../../Services/MonitorService";
import ProbeService from "../../Services/ProbeService";
import ProjectService from "../../Services/ProjectService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MonitorResourceUtil from "./MonitorResource";

/*
 * Evaluates Probe Status monitors: for each step, the probes it watches as
 * the project may see them (ProbeStatusMonitorUtil.buildResponse), handed to
 * the same pipeline every monitor goes through (MonitorResourceUtil), which
 * changes the status, opens one incident or alert per outage and resolves it.
 *
 * Two callers. The ProbeStatusMonitor:CheckProbeStatus worker sweeps every
 * Probe Status monitor once a minute, so a monitor is right within a minute
 * whatever happened. And a probe's connection status flipping evaluates the
 * monitors watching it at once (ProbeService.onUpdateSuccess), so the
 * incident opens with the flip rather than up to a minute after it.
 *
 * Judged from the probe's Connection Status, never from its last heartbeat
 * directly: Probe:UpdateConnectionStatus already calls a probe Disconnected
 * only after three minutes of silence while OneUptime was listening, and
 * waits out OneUptime's own downtime (ProbeConnectionDowntimeGrace,
 * ReceivingCoverage). A restart shorter than that, or an upgrade of
 * OneUptime itself, never opens an incident.
 */
export default class ProbeStatusMonitorEvaluator {
  // A page of monitors read at a time when looking for watchers.
  public static readonly WATCHER_PAGE_SIZE: number = 100;

  public static readonly MONITOR_SELECT: Select<Monitor> = {
    _id: true,
    projectId: true,
    monitorType: true,
    monitorSteps: true,
    ...MONITOR_PAUSE_FLAGS_SELECT,
  };

  /*
   * The probes, of those named, that this project may watch: the global
   * probes and its own - the same split ProbeService makes for the probes a
   * monitor may run on. A probe of another project is never read, so naming
   * one tells this project nothing about it.
   */
  @CaptureSpan()
  public static async findWatchableProbes(data: {
    projectId: ObjectID;
    probeIds: Array<string>;
  }): Promise<Array<Probe>> {
    const probeIds: Array<ObjectID> =
      MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(data.probeIds)
        .filter((probeId: string): boolean => {
          return ObjectID.isValidUUID(probeId);
        })
        .map((probeId: string): ObjectID => {
          return new ObjectID(probeId);
        });

    if (probeIds.length === 0) {
      return [];
    }

    const select: Select<Probe> = {
      _id: true,
      name: true,
      isGlobalProbe: true,
      connectionStatus: true,
      lastAlive: true,
    };

    const [globalProbes, projectProbes]: [Array<Probe>, Array<Probe>] =
      await Promise.all([
        ProbeService.findBy({
          query: {
            _id: QueryHelper.any(probeIds),
            isGlobalProbe: true,
          },
          select: select,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        }),
        ProbeService.findBy({
          query: {
            _id: QueryHelper.any(probeIds),
            isGlobalProbe: false,
            projectId: data.projectId,
          },
          select: select,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        }),
      ]);

    return [...globalProbes, ...projectProbes];
  }

  /*
   * What each of the monitor's steps would be judged on now. A step that
   * names no probe, or none this project can still see, has nothing to
   * judge and yields nothing: the monitor keeps the status it has rather
   * than claiming that probes nobody can see are connected.
   */
  public static async buildResponses(data: {
    monitor: Monitor;
    checkedAt?: Date | undefined;
  }): Promise<Array<ProbeStatusMonitorResponse>> {
    const monitor: Monitor = data.monitor;

    if (!monitor.id || !monitor.projectId) {
      return [];
    }

    const responses: Array<ProbeStatusMonitorResponse> = [];

    for (const monitorStep of monitor.monitorSteps?.data
      ?.monitorStepsInstanceArray || []) {
      const probeIds: Array<string> =
        ProbeStatusMonitorEvaluator.getWatchedProbeIds(monitorStep);

      if (probeIds.length === 0 || !monitorStep.id) {
        continue;
      }

      const probes: Array<Probe> =
        await ProbeStatusMonitorEvaluator.findWatchableProbes({
          projectId: monitor.projectId,
          probeIds: probeIds,
        });

      if (probes.length === 0) {
        logger.debug(
          `Probe Status monitor ${monitor.id.toString()} watches no probe it can still see in step ${monitorStep.id.toString()}. Leaving its status as it is.`,
        );
        continue;
      }

      responses.push(
        ProbeStatusMonitorUtil.buildResponse({
          projectId: monitor.projectId,
          monitorId: monitor.id,
          monitorStepId: monitorStep.id,
          probeIds: probeIds,
          probes: probes.map((probe: Probe) => {
            return {
              id: probe.id?.toString() || "",
              name: probe.name,
              isGlobalProbe: probe.isGlobalProbe,
              connectionStatus: probe.connectionStatus,
              lastAlive: probe.lastAlive,
            };
          }),
          checkedAt: data.checkedAt || OneUptimeDate.getCurrentDate(),
        }),
      );
    }

    return responses;
  }

  public static getWatchedProbeIds(monitorStep: MonitorStep): Array<string> {
    return MonitorStepProbeStatusMonitorUtil.normalizeProbeIds(
      monitorStep.data?.probeStatusMonitor?.probeIds,
    );
  }

  /*
   * Evaluates one monitor, step by step. Throws what the pipeline throws -
   * a monitor that was archived meanwhile, a per-monitor lock another
   * evaluation holds - for the caller to log: the sweep comes back to it a
   * minute later either way.
   */
  @CaptureSpan()
  public static async evaluateMonitor(monitor: Monitor): Promise<void> {
    if (
      monitor.monitorType &&
      monitor.monitorType !== MonitorType.ProbeStatus
    ) {
      return;
    }

    if (MonitorPauseState.isPaused(monitor)) {
      return;
    }

    const responses: Array<ProbeStatusMonitorResponse> =
      await ProbeStatusMonitorEvaluator.buildResponses({ monitor: monitor });

    for (const response of responses) {
      await MonitorResourceUtil.monitorResource(response);
    }
  }

  /*
   * Evaluates one monitor by id, as it is stored now: a monitor just
   * created, or one whose probes were just changed, shows the answer at
   * once instead of on the next minute's sweep.
   */
  @CaptureSpan()
  public static async evaluateMonitorById(monitorId: ObjectID): Promise<void> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: monitorId,
      select: ProbeStatusMonitorEvaluator.MONITOR_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!monitor || monitor.monitorType !== MonitorType.ProbeStatus) {
      return;
    }

    await ProbeStatusMonitorEvaluator.evaluateMonitor(monitor);
  }

  /*
   * The Probe Status monitors, checked right now, that watch this probe. A
   * project's own probe can only be watched from its project; a global probe
   * from any. The probe id lives in each monitor's step JSON, so the
   * candidates are paged through and filtered here - Probe Status monitors
   * are few, and this runs only when a probe's status flips.
   */
  @CaptureSpan()
  public static async findMonitorsWatchingProbe(probe: {
    probeId: ObjectID;
    projectId?: ObjectID | undefined;
    isGlobalProbe?: boolean | undefined;
  }): Promise<Array<Monitor>> {
    if (!probe.isGlobalProbe && !probe.projectId) {
      return [];
    }

    const query: Query<Monitor> = {
      ...MonitorService.getEnabledMonitorQuery(),
      monitorType: MonitorType.ProbeStatus,
      project: { ...ProjectService.getActiveProjectStatusQuery() },
    };

    if (!probe.isGlobalProbe && probe.projectId) {
      query.projectId = probe.projectId;
    }

    const probeKey: string = probe.probeId.toString().toLowerCase();
    const watchers: Array<Monitor> = [];
    let cursor: ObjectID | undefined = undefined;

    for (;;) {
      const page: Array<Monitor> = await MonitorService.findBy({
        query: {
          ...query,
          ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
        },
        select: ProbeStatusMonitorEvaluator.MONITOR_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: 0,
        limit: ProbeStatusMonitorEvaluator.WATCHER_PAGE_SIZE,
        props: {
          isRoot: true,
        },
      });

      for (const monitor of page) {
        const watchesProbe: boolean = (
          monitor.monitorSteps?.data?.monitorStepsInstanceArray || []
        ).some((monitorStep: MonitorStep): boolean => {
          return ProbeStatusMonitorEvaluator.getWatchedProbeIds(
            monitorStep,
          ).some((probeId: string): boolean => {
            return probeId.toLowerCase() === probeKey;
          });
        });

        if (watchesProbe) {
          watchers.push(monitor);
        }
      }

      const lastId: ObjectID | null | undefined = page[page.length - 1]?.id;

      if (
        page.length < ProbeStatusMonitorEvaluator.WATCHER_PAGE_SIZE ||
        !lastId
      ) {
        break;
      }

      cursor = lastId;
    }

    return watchers;
  }

  /*
   * A probe's connection status just flipped: evaluate every monitor
   * watching it now. Never throws - the flip itself (and the notifications
   * that go with it) must not fail because one monitor could not be
   * evaluated; the minute sweep catches anything missed here.
   */
  @CaptureSpan()
  public static async evaluateMonitorsWatchingProbe(
    probeId: ObjectID,
  ): Promise<void> {
    try {
      const probe: Probe | null = await ProbeService.findOneById({
        id: probeId,
        select: {
          _id: true,
          projectId: true,
          isGlobalProbe: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!probe) {
        return;
      }

      const monitors: Array<Monitor> =
        await ProbeStatusMonitorEvaluator.findMonitorsWatchingProbe({
          probeId: probeId,
          projectId: probe.projectId,
          isGlobalProbe: probe.isGlobalProbe,
        });

      for (const monitor of monitors) {
        try {
          await ProbeStatusMonitorEvaluator.evaluateMonitor(monitor);
        } catch (err) {
          logger.error(
            `Error evaluating Probe Status monitor ${monitor.id?.toString()} after probe ${probeId.toString()} changed status`,
          );
          logger.error(err);
        }
      }
    } catch (err) {
      logger.error(
        `Error finding the Probe Status monitors watching probe ${probeId.toString()}`,
      );
      logger.error(err);
    }
  }
}
