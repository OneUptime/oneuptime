import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";

/*
 * What a monitor's Logs page says before its first check (#9124).
 *
 * It said "No logs found for this resource. Please check back later.": the
 * words of a search that missed, and no word of when "later" is. A monitor
 * that probes check is checked on its interval, so the page says when the
 * first check runs, and offers Probes & Interval - where the interval is
 * changed, and where a monitor no probe checks yet is given one. A
 * telemetry monitor is evaluated on its interval too, and has no such page.
 * Any other monitor (an incoming request, an email, a server's agent) is
 * checked when something reaches it, so the card's own description stands.
 *
 * A disabled monitor is not checked at all: the banner above the list says
 * so, and the list does not promise a check.
 */

export const MONITOR_LOGS_EMPTY_TITLE: string = translationKey("No checks yet");

export const MONITOR_LOGS_PROBES_LINK_TEST_ID: string =
  "monitor-logs-probes-and-interval";

const SECONDS_IN_MINUTE: number = 60;
const SECONDS_IN_HOUR: number = 60 * SECONDS_IN_MINUTE;
const SECONDS_IN_DAY: number = 24 * SECONDS_IN_HOUR;

export interface MonitorLogsEmptyStateInput {
  monitorId: ObjectID;
  monitorType: MonitorType;
  monitoringInterval?: string | null | undefined;
  isDisabled: boolean;
  translator: Translator;
  // When the sentence is written: the schedule's spacing is read from here.
  now?: Date | undefined;
}

/*
 * "The first check runs within 5 minutes.": the schedule's spacing, rounded
 * up to whole minutes, hours or days, so it is never sooner than the truth.
 */
export const getFirstCheckSentence: (data: {
  monitoringInterval?: string | null | undefined;
  translator: Translator;
  now?: Date | undefined;
}) => string = (data: {
  monitoringInterval?: string | null | undefined;
  translator: Translator;
  now?: Date | undefined;
}): string => {
  const cadenceSeconds: number = MonitorCheckScheduleUtil.resolveCadenceSeconds(
    {
      monitoringInterval: data.monitoringInterval,
      from: data.now || new Date(),
    },
  );

  if (cadenceSeconds < SECONDS_IN_HOUR) {
    return data.translator.translatePlural(
      {
        one: "The first check runs within {{count}} minute.",
        other: "The first check runs within {{count}} minutes.",
      },
      Math.max(1, Math.ceil(cadenceSeconds / SECONDS_IN_MINUTE)),
    );
  }

  if (cadenceSeconds < SECONDS_IN_DAY) {
    return data.translator.translatePlural(
      {
        one: "The first check runs within {{count}} hour.",
        other: "The first check runs within {{count}} hours.",
      },
      Math.ceil(cadenceSeconds / SECONDS_IN_HOUR),
    );
  }

  return data.translator.translatePlural(
    {
      one: "The first check runs within {{count}} day.",
      other: "The first check runs within {{count}} days.",
    },
    Math.ceil(cadenceSeconds / SECONDS_IN_DAY),
  );
};

export const getMonitorLogsEmptyState: (
  input: MonitorLogsEmptyStateInput,
) => EmptyStateOptions = (
  input: MonitorLogsEmptyStateInput,
): EmptyStateOptions => {
  const isProbeable: boolean = MonitorTypeHelper.isProbableMonitor(
    input.monitorType,
  );
  const isTelemetry: boolean = MonitorTypeHelper.isTelemetryMonitor(
    input.monitorType,
  );

  const actions: Array<TableEmptyStateAction> = [];

  if (isProbeable) {
    actions.push({
      title: "Probes & Interval",
      icon: IconProp.Signal,
      style: TableEmptyStateActionStyle.Link,
      dataTestId: MONITOR_LOGS_PROBES_LINK_TEST_ID,
      onClick: (): void => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
            { modelId: input.monitorId },
          ),
        );
      },
    });
  }

  const isOnASchedule: boolean =
    (isProbeable || isTelemetry) && !input.isDisabled;

  return {
    title: MONITOR_LOGS_EMPTY_TITLE,
    icon: IconProp.Logs,
    description: isOnASchedule
      ? getFirstCheckSentence({
          monitoringInterval: input.monitoringInterval,
          translator: input.translator,
          now: input.now,
        })
      : undefined,
    actions: actions,
  };
};
