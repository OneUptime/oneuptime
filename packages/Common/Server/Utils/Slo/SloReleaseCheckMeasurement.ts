import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  SloReleaseCheckMeasurement as SloReleaseCheckMeasurementResult,
  SloReleaseCheckOptions,
} from "../../../Utils/Slo/SloReleaseCheck";
import {
  SloEventSliResult,
  SloRequestCounts,
  computeEventBurnRate,
  computeEventSli,
  isRequestSliType,
} from "../../../Utils/Slo/SloRequestSli";
import SloUtil, {
  MonitorTimelineSet,
  TimeSliResult,
} from "../../../Utils/Slo/SloUtil";
import {
  fetchPerMonitorTimelines,
  getDowntimeStatuses,
} from "./SloMonitorTimelines";
import SloRequestCounting from "./SloRequestCounting";

/*
 * What the release check measures, over its last few minutes, for the SLO
 * it is asked about (Utils/Slo/SloReleaseCheck decides on it):
 *
 *   - a request SLO: its services' requests, counted from the spans as they
 *     are now - optionally only those of one service.version;
 *   - a Monitor Uptime SLO: its monitors' status timelines, measured as the
 *     evaluation worker measures them.
 *
 * Read as OneUptime: the caller was already allowed to read the SLO, and the
 * answer carries counts and a burn rate, never a span or a monitor's data.
 * An SLO that cannot be measured is refused with what to fix, so a rollout
 * tool stops on a clear error rather than on a guess.
 */

// The columns of the SLO the check reads.
export const SLO_RELEASE_CHECK_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  sliType: true;
  targetPercentage: true;
  sloStatus: true;
  deploymentsAllowed: true;
  currentErrorBudgetPolicyTierName: true;
  latencyThresholdInMilliseconds: true;
  requestFilter: true;
  multiMonitorMode: true;
  services: { _id: true };
  monitors: { _id: true };
  downtimeMonitorStatuses: { _id: true };
} = {
  _id: true,
  projectId: true,
  name: true,
  sliType: true,
  targetPercentage: true,
  sloStatus: true,
  deploymentsAllowed: true,
  currentErrorBudgetPolicyTierName: true,
  latencyThresholdInMilliseconds: true,
  // The same requests the SLO counts (#8444).
  requestFilter: true,
  multiMonitorMode: true,
  services: { _id: true },
  monitors: { _id: true },
  downtimeMonitorStatuses: { _id: true },
};

export const SLO_RELEASE_CHECK_MEASUREMENT_ERRORS: {
  target: string;
  notMeasured: string;
  noServices: string;
  noLatencyThreshold: string;
  noMonitors: string;
  versionForMonitors: string;
} = {
  target:
    "This SLO's target is outside the valid range - it must be greater than 0 and below 100 - so its burn rate cannot be measured. Set a target such as 99.9 first.",
  notMeasured:
    "This SLO's SLI type is not one OneUptime measures, so there is nothing to check. Choose Monitor Uptime, Request Success or Request Latency.",
  noServices:
    "This SLO measures requests, but no services are chosen, so there are no requests to check. Choose the services whose requests it measures first.",
  noLatencyThreshold:
    "This Request Latency SLO has no latency threshold, so no request can be checked as fast enough. Set its latency threshold first.",
  noMonitors:
    "No monitors are attached to this SLO, so there is nothing to check. Attach monitors, or add a monitor rule, first.",
  versionForMonitors:
    "serviceVersion picks out one release's requests, and this SLO measures monitor uptime, not requests. Leave serviceVersion out, or check a Request Success or Request Latency SLO.",
};

type IdsOfFunction = (
  items: Array<{ id: ObjectID | null }> | undefined,
) => Array<ObjectID>;

const idsOf: IdsOfFunction = (
  items: Array<{ id: ObjectID | null }> | undefined,
): Array<ObjectID> => {
  return (items || [])
    .map((item: { id: ObjectID | null }): ObjectID | null => {
      return item.id || null;
    })
    .filter((id: ObjectID | null): id is ObjectID => {
      return Boolean(id);
    });
};

export default class SloReleaseCheckMeasurement {
  public static async measure(data: {
    slo: ServiceLevelObjective;
    options: SloReleaseCheckOptions;
    now: Date;
  }): Promise<SloReleaseCheckMeasurementResult> {
    const { slo, options, now } = data;
    const targetPercentage: number = Number(slo.targetPercentage);

    if (
      !Number.isFinite(targetPercentage) ||
      targetPercentage <= 0 ||
      targetPercentage >= 100
    ) {
      throw new BadDataException(SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.target);
    }

    const from: Date = new Date(
      now.getTime() - options.windowInMinutes * 60 * 1000,
    );

    if (isRequestSliType(slo.sliType)) {
      return await SloReleaseCheckMeasurement.measureRequests({
        slo: slo,
        options: options,
        targetPercentage: targetPercentage,
        from: from,
        to: now,
      });
    }

    if (slo.sliType !== SliType.MonitorUptime) {
      throw new BadDataException(
        SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.notMeasured,
      );
    }

    if (options.serviceVersion) {
      throw new BadDataException(
        SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.versionForMonitors,
      );
    }

    return await SloReleaseCheckMeasurement.measureMonitors({
      slo: slo,
      targetPercentage: targetPercentage,
      from: from,
      to: now,
    });
  }

  private static async measureRequests(data: {
    slo: ServiceLevelObjective;
    options: SloReleaseCheckOptions;
    targetPercentage: number;
    from: Date;
    to: Date;
  }): Promise<SloReleaseCheckMeasurementResult> {
    const serviceIds: Array<ObjectID> = idsOf(
      data.slo.services as Array<Service> | undefined,
    );

    if (serviceIds.length === 0) {
      throw new BadDataException(
        SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noServices,
      );
    }

    const threshold: number = Number(data.slo.latencyThresholdInMilliseconds);

    if (
      data.slo.sliType === SliType.RequestLatency &&
      (!Number.isFinite(threshold) || threshold < 1)
    ) {
      throw new BadDataException(
        SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noLatencyThreshold,
      );
    }

    const counts: SloRequestCounts =
      await SloRequestCounting.countRecentRequests({
        projectId: data.slo.projectId!,
        config: {
          sliType: data.slo.sliType as SliType,
          serviceIds: serviceIds,
          latencyThresholdInMilliseconds:
            data.slo.sliType === SliType.RequestLatency ? threshold : null,
          // The release is judged on the requests the SLO counts (#8444).
          requestFilter: data.slo.requestFilter,
        },
        range: { from: data.from, to: data.to },
        serviceVersion: data.options.serviceVersion,
      });

    const sli: SloEventSliResult = computeEventSli(counts);

    return {
      burnRate: computeEventBurnRate({
        counts: counts,
        targetPercentage: data.targetPercentage,
      }),
      sliPercentage: sli.totalEventCount > 0 ? sli.sliPercentage : null,
      goodRequestCount: sli.goodEventCount,
      totalRequestCount: sli.totalEventCount,
    };
  }

  private static async measureMonitors(data: {
    slo: ServiceLevelObjective;
    targetPercentage: number;
    from: Date;
    to: Date;
  }): Promise<SloReleaseCheckMeasurementResult> {
    const monitorIds: Array<ObjectID> = idsOf(
      data.slo.monitors as Array<Monitor> | undefined,
    );

    if (monitorIds.length === 0) {
      throw new BadDataException(
        SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noMonitors,
      );
    }

    const perMonitorTimelines: Array<MonitorTimelineSet> =
      await fetchPerMonitorTimelines({
        projectId: data.slo.projectId!,
        monitorIds: monitorIds,
        windowStart: data.from,
        windowEnd: data.to,
      });

    const downtimeStatuses: Array<MonitorStatus> = await getDowntimeStatuses({
      projectId: data.slo.projectId!,
      configuredStatusIds: idsOf(
        data.slo.downtimeMonitorStatuses as Array<MonitorStatus> | undefined,
      ),
    });

    const sli: TimeSliResult = SloUtil.computeTimeSli({
      perMonitorTimelines: perMonitorTimelines,
      downtimeStatuses: downtimeStatuses,
      window: { startDate: data.from, endDate: data.to },
      mode: data.slo.multiMonitorMode || SloMultiMonitorMode.AnyDown,
    });

    return {
      burnRate: SloUtil.computeBurnRate({
        badSeconds: sli.badSeconds,
        totalSeconds: sli.totalSeconds,
        targetPercentage: data.targetPercentage,
      }),
      sliPercentage: sli.totalSeconds > 0 ? sli.sliPercentage : null,
      measuredSeconds: sli.totalSeconds,
    };
  }
}
