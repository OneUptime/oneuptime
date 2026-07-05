import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

export enum ReminderRuleScope {
  Incident = "Incident",
  Alert = "Alert",
}

export interface ComponentProps {
  nextReminderAt?: Date | string | undefined | null;
  severityId?: ObjectID | undefined;
  scope: ReminderRuleScope;
  remindersEnabled?: boolean | undefined;
}

interface MatchableRule {
  reminderIntervalInMinutes: number | undefined;
  severityIds: Array<string>;
}

/*
 * Mirrors the server-side matching in IncidentReminderRuleService.findMatchingRule:
 * first enabled rule (by order) whose severity list is empty or contains this severity.
 */
const getMatchingIntervalInMinutes: (
  rules: Array<MatchableRule>,
  severityId: ObjectID | undefined,
) => number | null = (
  rules: Array<MatchableRule>,
  severityId: ObjectID | undefined,
): number | null => {
  for (const rule of rules) {
    if (rule.severityIds.length > 0) {
      if (!severityId) {
        continue;
      }

      if (!rule.severityIds.includes(severityId.toString())) {
        continue;
      }
    }

    return rule.reminderIntervalInMinutes || null;
  }

  return null;
};

const TimeUnit: FunctionComponent<{
  value: number;
  label: string;
  pad?: boolean;
}> = (props: { value: number; label: string; pad?: boolean }): ReactElement => {
  return (
    <div className="flex flex-col items-center">
      <span className="text-2xl font-semibold leading-none tabular-nums text-gray-900">
        {props.pad ? String(props.value).padStart(2, "0") : props.value}
      </span>
      <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {props.label}
      </span>
    </div>
  );
};

const Separator: FunctionComponent = (): ReactElement => {
  return (
    <span
      aria-hidden="true"
      className="text-2xl font-semibold leading-none text-gray-300"
    >
      :
    </span>
  );
};

const NextReminderCountdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());
  const [intervalInMinutes, setIntervalInMinutes] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted: boolean = true;

    const fetchIntervalInMinutes: () => Promise<void> =
      async (): Promise<void> => {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          return;
        }

        let matchableRules: Array<MatchableRule> = [];

        if (props.scope === ReminderRuleScope.Incident) {
          const rules: ListResult<IncidentReminderRule> =
            await ModelAPI.getList<IncidentReminderRule>({
              modelType: IncidentReminderRule,
              query: {
                projectId: projectId,
                isEnabled: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                reminderIntervalInMinutes: true,
                incidentSeverities: {
                  _id: true,
                },
              },
              sort: {
                order: SortOrder.Ascending,
              },
            });

          matchableRules = rules.data.map(
            (rule: IncidentReminderRule): MatchableRule => {
              return {
                reminderIntervalInMinutes: rule.reminderIntervalInMinutes,
                severityIds: (rule.incidentSeverities || []).map(
                  (severity: IncidentSeverity): string => {
                    return severity.id?.toString() || "";
                  },
                ),
              };
            },
          );
        } else {
          const rules: ListResult<AlertReminderRule> =
            await ModelAPI.getList<AlertReminderRule>({
              modelType: AlertReminderRule,
              query: {
                projectId: projectId,
                isEnabled: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                reminderIntervalInMinutes: true,
                alertSeverities: {
                  _id: true,
                },
              },
              sort: {
                order: SortOrder.Ascending,
              },
            });

          matchableRules = rules.data.map(
            (rule: AlertReminderRule): MatchableRule => {
              return {
                reminderIntervalInMinutes: rule.reminderIntervalInMinutes,
                severityIds: (rule.alertSeverities || []).map(
                  (severity: AlertSeverity): string => {
                    return severity.id?.toString() || "";
                  },
                ),
              };
            },
          );
        }

        if (isMounted) {
          setIntervalInMinutes(
            getMatchingIntervalInMinutes(matchableRules, props.severityId),
          );
        }
      };

    fetchIntervalInMinutes().catch(() => {
      // The countdown still works without the progress bar.
    });

    return () => {
      isMounted = false;
    };
  }, [props.scope, props.severityId?.toString()]);

  if (!props.nextReminderAt) {
    return (
      <div className="text-sm text-gray-500">
        {props.remindersEnabled === false
          ? "Reminders are disabled, so no reminder is scheduled."
          : "No reminder is currently scheduled."}
      </div>
    );
  }

  const targetDate: Date = OneUptimeDate.fromString(props.nextReminderAt);
  const formattedTargetDate: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(targetDate, false);

  const remainingSeconds: number = Math.floor(
    (targetDate.getTime() - now.getTime()) / 1000,
  );

  if (remainingSeconds <= 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center space-x-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500"></span>
          </span>
          <span className="text-sm font-medium text-amber-700">
            Due now &mdash; the next reminder will be sent shortly.
          </span>
        </div>
        <div className="text-xs text-gray-500">
          Was scheduled for {formattedTargetDate}
        </div>
      </div>
    );
  }

  const days: number = Math.floor(remainingSeconds / 86400);
  const hours: number = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes: number = Math.floor((remainingSeconds % 3600) / 60);
  const seconds: number = remainingSeconds % 60;

  const totalSeconds: number = intervalInMinutes ? intervalInMinutes * 60 : 0;
  const elapsedPercent: number =
    totalSeconds > 0
      ? Math.min(
          100,
          Math.max(0, ((totalSeconds - remainingSeconds) / totalSeconds) * 100),
        )
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start space-x-1.5">
        {days > 0 && (
          <>
            <TimeUnit value={days} label={days === 1 ? "day" : "days"} />
            <Separator />
          </>
        )}
        <TimeUnit value={hours} label="hrs" pad={true} />
        <Separator />
        <TimeUnit value={minutes} label="min" pad={true} />
        <Separator />
        <TimeUnit value={seconds} label="sec" pad={true} />
      </div>

      {intervalInMinutes ? (
        <div className="max-w-md">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-valuenow={Math.round(elapsedPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${Math.round(elapsedPercent)}% of the reminder interval has elapsed`}
          >
            <div
              className="h-2 rounded-full bg-indigo-600 transition-all duration-1000 ease-linear"
              style={{ width: `${elapsedPercent}%` }}
            ></div>
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-gray-500">
            <span>
              Repeats every{" "}
              {OneUptimeDate.getHoursAndMinutesFromMinutes(intervalInMinutes)}
            </span>
            <span>{Math.round(elapsedPercent)}% elapsed</span>
          </div>
        </div>
      ) : (
        <></>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <svg
          className="h-3.5 w-3.5 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Scheduled for {formattedTargetDate}
      </div>
    </div>
  );
};

export default NextReminderCountdown;
