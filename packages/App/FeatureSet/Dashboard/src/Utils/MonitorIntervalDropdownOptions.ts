import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import MonitoringIntervalUtil from "Common/Utils/Monitor/MonitoringIntervalUtil";

const MonitoringInterval: Array<DropdownOption> = [
  {
    value: "* * * * *",
    label: "Every Minute",
  },
  {
    value: "*/2 * * * *",
    label: "Every 2 Minutes",
  },
  {
    value: "*/5 * * * *",
    label: "Every 5 Minutes",
  },
  {
    value: "*/10 * * * *",
    label: "Every 10 Minutes",
  },
  {
    value: "*/15 * * * *",
    label: "Every 15 Minutes",
  },
  {
    value: "*/30 * * * *",
    label: "Every 30 Minutes",
  },
  {
    value: "0 * * * *",
    label: "Every Hour",
  },
  {
    value: "0 0 * * *",
    label: "Every Day",
  },
  {
    value: "0 0 * * 0",
    label: "Every Week",
  },
];

/*
 * Monitor types the dashboard offers nothing faster than every 5 minutes:
 * a Synthetic monitor runs a browser session and a Custom Code monitor a
 * script on every check, and a certificate changes far more rarely than that.
 * Only the dashboard keeps to it. The API takes any interval of a minute or
 * more for every type, so a monitor of these types can already be on a
 * shorter one.
 */
export const MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER: ReadonlyArray<MonitorType> =
  [
    MonitorType.SyntheticMonitor,
    MonitorType.CustomJavaScriptCode,
    MonitorType.SSLCertificate,
  ];

// The intervals those types are not offered.
export const INTERVALS_SHORTER_THAN_5_MINUTES: ReadonlyArray<string> = [
  "* * * * *",
  "*/2 * * * *",
];

/*
 * Where a schedule's spacing is measured from, so that where an interval
 * sits in the list never depends on when the list was drawn.
 */
const CADENCE_REFERENCE: Date = new Date(Date.UTC(2026, 0, 5, 0, 0, 0));

const getCadenceSeconds: (interval: string) => number = (
  interval: string,
): number => {
  // An interval the scheduler cannot read is checked every minute.
  return MonitorCheckScheduleUtil.resolveCadenceSeconds({
    monitoringInterval: interval,
    from: CADENCE_REFERENCE,
  });
};

/*
 * The cron expression a stored interval means, as the options spell it: a
 * row written before intervals were normalized may still say "5m" for
 * "*\/5 * * * *". One the dashboard cannot read stays as it is. Undefined for
 * no interval at all.
 */
export const getMonitoringIntervalValue: (
  interval: string | null | undefined,
) => string | undefined = (
  interval: string | null | undefined,
): string | undefined => {
  const trimmed: string = (interval || "").trim();

  if (!trimmed) {
    return undefined;
  }

  return MonitoringIntervalUtil.toCronOrNull(trimmed) ?? trimmed;
};

/*
 * How an interval reads: the option's own label ("Every 5 Minutes"), or for
 * one the list does not have (a cron set through the API, Terraform or a
 * template) its schedule in words ("Every 3 minutes"). Undefined for no
 * interval at all.
 */
export const getMonitoringIntervalLabel: (
  interval: string | null | undefined,
) => string | undefined = (
  interval: string | null | undefined,
): string | undefined => {
  const value: string | undefined = getMonitoringIntervalValue(interval);

  if (!value) {
    return undefined;
  }

  const option: DropdownOption | undefined = MonitoringInterval.find(
    (item: DropdownOption): boolean => {
      return item.value === value;
    },
  );

  return option
    ? option.label
    : MonitorCheckScheduleUtil.describeInterval(value);
};

/*
 * The intervals a monitor (or a monitor template) of this type is offered,
 * shortest first: every interval, less the ones shorter than 5 minutes for
 * the types above. The create forms and the monitor's own Probes & Interval
 * page all read this, so a type is offered the same list everywhere.
 *
 * currentInterval is what the monitor has now. It is always on the list,
 * where its spacing puts it, even when the type is not offered it or the
 * list has no such option: a Synthetic monitor already checked every minute
 * (set through the API, or before the dashboard told types apart), or one on
 * a cron the list does not have. A dropdown whose value is not among its
 * options shows its placeholder, as if the monitor had no interval, and
 * offering only the shorter list would have nobody able to see what they
 * have. A create form passes nothing here: a new monitor is offered only
 * what its type is offered.
 */
export const getMonitoringIntervalOptions: (data: {
  monitorType: MonitorType | null | undefined;
  currentInterval?: string | null | undefined;
}) => Array<DropdownOption> = (data: {
  monitorType: MonitorType | null | undefined;
  currentInterval?: string | null | undefined;
}): Array<DropdownOption> => {
  const current: string | undefined = getMonitoringIntervalValue(
    data.currentInterval,
  );

  const isOfferedLongerOnly: boolean = Boolean(
    data.monitorType &&
      MONITOR_TYPES_OFFERED_5_MINUTES_OR_LONGER.includes(data.monitorType),
  );

  const options: Array<DropdownOption> = MonitoringInterval.filter(
    (option: DropdownOption): boolean => {
      if (option.value === current) {
        return true;
      }

      return !(
        isOfferedLongerOnly &&
        INTERVALS_SHORTER_THAN_5_MINUTES.includes(option.value as string)
      );
    },
  ).map((option: DropdownOption): DropdownOption => {
    return { ...option };
  });

  if (
    !current ||
    options.some((option: DropdownOption): boolean => {
      return option.value === current;
    })
  ) {
    return options;
  }

  const currentOption: DropdownOption = {
    value: current,
    label: MonitorCheckScheduleUtil.describeInterval(current),
  };

  const cadence: number = getCadenceSeconds(current);

  const position: number = options.findIndex(
    (option: DropdownOption): boolean => {
      return getCadenceSeconds(option.value as string) > cadence;
    },
  );

  if (position === -1) {
    options.push(currentOption);
  } else {
    options.splice(position, 0, currentOption);
  }

  return options;
};

export default MonitoringInterval;
