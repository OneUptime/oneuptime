import ProfileAggregationService, {
  StackShareResult,
} from "../../Services/ProfileAggregationService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import Profile from "../../../Models/AnalyticsModels/Profile";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProfileMonitor";
import { ProfileFunctionShareReading } from "../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import TelemetryCheckWindow from "../../../Types/Monitor/TelemetryCheckWindow";
import ObjectID from "../../../Types/ObjectID";
import {
  ProfileTypeActivity,
  narrowProfileTypesToOneUnit,
} from "../../../Utils/Profiles/ProfileTypes";

/*
 * THE PROFILES MONITOR'S "FUNCTION SHARE".
 *
 * How much of the monitor's window ran through code matching its function
 * text: the stacks with a frame containing it (function name or file, any
 * case), each counted once, against every stack of the window. The window
 * and the profiles are the monitor's own - its services, entities,
 * attributes, profile types and time window, the same query its Profile
 * Count runs - so the two criteria describe the same profiles.
 *
 * The profile types are narrowed to one unit first (the unit with the most
 * samples among them in the window): a service profiled by an SDK in
 * nanoseconds next to the eBPF agent's sample counts would otherwise add
 * one to the other.
 *
 * Read as root: the monitor's own project, by the telemetry worker.
 */
export default class ProfileMonitorShare {
  @CaptureSpan()
  public static async measure(data: {
    projectId: ObjectID;
    monitorStepProfileMonitor: MonitorStepProfileMonitor;
    evaluateUntil?: Date | undefined;
    /*
     * Whose profiles the reader may read: set for a person's preview of the
     * monitor; the telemetry worker reads the monitor's own project whole.
     */
    scope?: TelemetryReadScope | undefined;
  }): Promise<ProfileFunctionShareReading | null> {
    const functionName: string = MonitorStepProfileMonitorUtil.getFunctionName(
      data.monitorStepProfileMonitor,
    );

    if (!functionName) {
      return null;
    }

    let query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery(
      data.monitorStepProfileMonitor,
      data.evaluateUntil,
    );

    const window: InBetween<Date> = ProfileMonitorShare.getWindow(query, data);

    query.startTime = window;

    if (data.scope) {
      query = TelemetryReadScopeUtil.applyToQuery(
        query,
        "primaryEntityId",
        data.scope,
      );
    }

    const types: Array<string> =
      data.monitorStepProfileMonitor.profileTypes || [];

    if (types.length > 0 && !data.monitorStepProfileMonitor.profileType) {
      const requested: Array<ObjectID> =
        data.monitorStepProfileMonitor.telemetryServiceIds || [];
      const serviceFilter: TelemetryServiceFilter = data.scope
        ? TelemetryReadScopeUtil.toServiceFilter(
            data.scope,
            requested.length > 0 ? requested : undefined,
          )
        : requested.length > 0
          ? { serviceIds: requested }
          : {};

      const activity: Array<ProfileTypeActivity> =
        await ProfileAggregationService.getProfileTypeActivity({
          projectId: data.projectId,
          startTime: window.startValue,
          endTime: window.endValue,
          includesEnd: window.includesEnd,
          ...serviceFilter,
        });

      query.profileType = new Includes(
        narrowProfileTypesToOneUnit(types, activity),
      );
    }

    const share: StackShareResult =
      await ProfileAggregationService.getStackShare({
        projectId: data.projectId,
        frameText: functionName,
        profileQuery: query,
        startTime: window.startValue,
        endTime: window.endValue,
      });

    return {
      functionName,
      sharePercent: Math.round(share.sharePercent * 100) / 100,
      windowSampleCount: share.windowSampleCount,
    };
  }

  /*
   * The monitor's window: the one its query reads, which holds its start
   * and not its end (TelemetryCheckWindow) - kept as it is, so the share
   * reads the profiles the count reads - or, for a monitor with no window,
   * the last five minutes, so the share never reads the whole retention.
   */
  private static getWindow(
    query: Query<Profile>,
    data: { evaluateUntil?: Date | undefined },
  ): InBetween<Date> {
    const range: unknown = query.startTime;

    if (range instanceof InBetween) {
      return new InBetween<Date>(
        new Date(range.startValue as Date),
        new Date(range.endValue as Date),
        { includesEnd: range.includesEnd },
      );
    }

    return TelemetryCheckWindow.ofSeconds(300, data.evaluateUntil);
  }
}
