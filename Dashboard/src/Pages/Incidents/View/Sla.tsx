import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import IncidentSlaStatus from "Common/Types/Incident/IncidentSlaStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow, Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
  useCallback,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import IncidentSlaRule from "Common/Models/DatabaseModels/IncidentSlaRule";

interface SlaTimerProps {
  deadline: Date | undefined;
  startedAt: Date;
  isCompleted: boolean;
  completedAt?: Date;
  label: string;
  totalMinutes?: number;
}

const SlaTimer: FunctionComponent<SlaTimerProps> = (
  props: SlaTimerProps,
): ReactElement => {
  const [currentTime, setCurrentTime] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );

  useEffect(() => {
    if (props.isCompleted || !props.deadline) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setCurrentTime(OneUptimeDate.getCurrentDate());
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [props.isCompleted, props.deadline]);

  if (!props.deadline) {
    return (
      <div className="text-gray-400 text-sm">
        <span className="font-medium">{props.label}:</span> Not configured
      </div>
    );
  }

  const deadline: Date = props.deadline;
  const startedAt: Date = props.startedAt;

  // Calculate progress
  const totalDuration: number = OneUptimeDate.getDifferenceInMinutes(
    deadline,
    startedAt,
  );
  const elapsed: number = OneUptimeDate.getDifferenceInMinutes(
    props.isCompleted && props.completedAt ? props.completedAt : currentTime,
    startedAt,
  );
  const progressPercent: number = Math.min(
    100,
    Math.max(0, (elapsed / totalDuration) * 100),
  );

  // Calculate time remaining/overdue
  const referenceTime: Date =
    props.isCompleted && props.completedAt ? props.completedAt : currentTime;
  const diffMs: number = deadline.getTime() - referenceTime.getTime();
  const isOverdue: boolean = diffMs < 0;
  const absDiffMs: number = Math.abs(diffMs);

  const days: number = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));
  const hours: number = Math.floor(
    (absDiffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutes: number = Math.floor(
    (absDiffMs % (1000 * 60 * 60)) / (1000 * 60),
  );
  const seconds: number = Math.floor((absDiffMs % (1000 * 60)) / 1000);

  // Determine color based on progress
  let progressColor: string = "bg-green-500";
  let textColor: string = "text-green-600";

  if (props.isCompleted) {
    if (isOverdue) {
      progressColor = "bg-red-500";
      textColor = "text-red-600";
    } else {
      progressColor = "bg-green-500";
      textColor = "text-green-600";
    }
  } else if (isOverdue) {
    progressColor = "bg-red-500";
    textColor = "text-red-600";
  } else if (progressPercent >= 80) {
    progressColor = "bg-yellow-500";
    textColor = "text-yellow-600";
  }

  const formatTimeUnit = (value: number, unit: string): string => {
    return `${value}${unit}`;
  };

  const getTimeDisplay = (): string => {
    const parts: string[] = [];
    if (days > 0) {
      parts.push(formatTimeUnit(days, "d"));
    }
    if (hours > 0 || days > 0) {
      parts.push(formatTimeUnit(hours, "h"));
    }
    if (minutes > 0 || hours > 0 || days > 0) {
      parts.push(formatTimeUnit(minutes, "m"));
    }
    parts.push(formatTimeUnit(seconds, "s"));

    return parts.join(" ");
  };

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">{props.label}</span>
        <div className={`text-sm font-mono ${textColor} flex items-center`}>
          {!props.isCompleted && !isOverdue && (
            <Icon
              icon={IconProp.Clock}
              className="h-4 w-4 mr-1 animate-pulse"
            />
          )}
          {props.isCompleted ? (
            <span className="flex items-center">
              <Icon
                icon={isOverdue ? IconProp.Close : IconProp.CheckCircle}
                className="h-4 w-4 mr-1"
              />
              {isOverdue ? "Missed" : "Met"}
            </span>
          ) : isOverdue ? (
            <span className="flex items-center">
              <Icon icon={IconProp.Alert} className="h-4 w-4 mr-1" />
              Overdue by {getTimeDisplay()}
            </span>
          ) : (
            <span>{getTimeDisplay()} remaining</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-1000 ${progressColor}`}
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>

      {/* Deadline info */}
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>
          Started: {OneUptimeDate.getDateAsLocalFormattedString(startedAt)}
        </span>
        <span>
          Deadline: {OneUptimeDate.getDateAsLocalFormattedString(deadline)}
        </span>
      </div>

      {props.isCompleted && props.completedAt && (
        <div className="text-xs text-gray-500 mt-1">
          Completed:{" "}
          {OneUptimeDate.getDateAsLocalFormattedString(props.completedAt)}
        </div>
      )}
    </div>
  );
};

interface NoteReminderTimerProps {
  label: string;
  intervalMinutes: number | undefined;
  lastSentAt: Date | undefined;
  slaStartedAt: Date;
  isIncidentResolved: boolean;
}

const NoteReminderTimer: FunctionComponent<NoteReminderTimerProps> = (
  props: NoteReminderTimerProps,
): ReactElement => {
  const [currentTime, setCurrentTime] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );

  useEffect(() => {
    if (props.isIncidentResolved || !props.intervalMinutes) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setCurrentTime(OneUptimeDate.getCurrentDate());
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [props.isIncidentResolved, props.intervalMinutes]);

  if (!props.intervalMinutes) {
    return (
      <div className="text-gray-400 text-sm">
        <span className="font-medium">{props.label}:</span> Not configured
      </div>
    );
  }

  const intervalMs: number = props.intervalMinutes * 60 * 1000;
  const lastReference: Date = props.lastSentAt || props.slaStartedAt;
  const nextDue: Date = new Date(lastReference.getTime() + intervalMs);

  const diffMs: number = nextDue.getTime() - currentTime.getTime();
  const isOverdue: boolean = diffMs < 0;
  const absDiffMs: number = Math.abs(diffMs);

  const hours: number = Math.floor(absDiffMs / (1000 * 60 * 60));
  const minutes: number = Math.floor(
    (absDiffMs % (1000 * 60 * 60)) / (1000 * 60),
  );
  const seconds: number = Math.floor((absDiffMs % (1000 * 60)) / 1000);

  // Calculate progress within current interval
  const elapsedInInterval: number =
    currentTime.getTime() - lastReference.getTime();
  const progressPercent: number = Math.min(
    100,
    Math.max(0, (elapsedInInterval / intervalMs) * 100),
  );

  let progressColor: string = "bg-blue-500";
  let textColor: string = "text-blue-600";

  if (props.isIncidentResolved) {
    progressColor = "bg-gray-400";
    textColor = "text-gray-500";
  } else if (isOverdue) {
    progressColor = "bg-orange-500";
    textColor = "text-orange-600";
  } else if (progressPercent >= 80) {
    progressColor = "bg-yellow-500";
    textColor = "text-yellow-600";
  }

  const getTimeDisplay = (): string => {
    const parts: string[] = [];
    if (hours > 0) {
      parts.push(`${hours}h`);
    }
    if (minutes > 0 || hours > 0) {
      parts.push(`${minutes}m`);
    }
    parts.push(`${seconds}s`);
    return parts.join(" ");
  };

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">
          <Icon icon={IconProp.TextFile} className="h-4 w-4 inline mr-1" />
          {props.label}
        </span>
        <div className={`text-sm font-mono ${textColor} flex items-center`}>
          {props.isIncidentResolved ? (
            <span className="text-gray-500">Incident resolved</span>
          ) : isOverdue ? (
            <span className="flex items-center">
              <Icon icon={IconProp.Bell} className="h-4 w-4 mr-1 animate-bounce" />
              Note due now!
            </span>
          ) : (
            <span className="flex items-center">
              <Icon icon={IconProp.Clock} className="h-4 w-4 mr-1" />
              {getTimeDisplay()} until next
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-1000 ${progressColor}`}
          style={{ width: `${Math.min(100, progressPercent)}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>Interval: Every {props.intervalMinutes} min</span>
        {props.lastSentAt && (
          <span>
            Last: {OneUptimeDate.getDateAsLocalFormattedString(props.lastSentAt)}
          </span>
        )}
      </div>
    </div>
  );
};

interface SlaCardProps {
  sla: IncidentSla;
  rule: IncidentSlaRule | undefined;
}

const SlaCard: FunctionComponent<SlaCardProps> = (
  props: SlaCardProps,
): ReactElement => {
  const { sla, rule } = props;

  const getStatusColor = (status: IncidentSlaStatus | undefined): Color => {
    switch (status) {
      case IncidentSlaStatus.OnTrack:
        return Green;
      case IncidentSlaStatus.AtRisk:
        return Yellow;
      case IncidentSlaStatus.ResponseBreached:
      case IncidentSlaStatus.ResolutionBreached:
        return Red;
      case IncidentSlaStatus.Met:
        return Green;
      default:
        return Gray500;
    }
  };

  const getStatusIcon = (status: IncidentSlaStatus | undefined): IconProp => {
    switch (status) {
      case IncidentSlaStatus.OnTrack:
        return IconProp.CheckCircle;
      case IncidentSlaStatus.AtRisk:
        return IconProp.Alert;
      case IncidentSlaStatus.ResponseBreached:
      case IncidentSlaStatus.ResolutionBreached:
        return IconProp.Close;
      case IncidentSlaStatus.Met:
        return IconProp.CheckCircle;
      default:
        return IconProp.Info;
    }
  };

  const isIncidentResolved: boolean = Boolean(sla.resolvedAt);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mb-4">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {rule?.name || "SLA Rule"}
          </h3>
          {rule?.description && (
            <p className="text-sm text-gray-500 mt-1">{rule.description}</p>
          )}
        </div>
        <Pill
          color={getStatusColor(sla.status)}
          text={sla.status || "Unknown"}
          icon={getStatusIcon(sla.status)}
        />
      </div>

      {/* SLA Timers */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
          <Icon icon={IconProp.Clock} className="h-4 w-4 mr-2" />
          SLA Deadlines
        </h4>

        <SlaTimer
          label="Response Time"
          deadline={sla.responseDeadline}
          startedAt={sla.slaStartedAt!}
          isCompleted={Boolean(sla.respondedAt)}
          {...(sla.respondedAt ? { completedAt: sla.respondedAt } : {})}
          {...(rule?.responseTimeInMinutes ? { totalMinutes: rule.responseTimeInMinutes } : {})}
        />

        <SlaTimer
          label="Resolution Time"
          deadline={sla.resolutionDeadline}
          startedAt={sla.slaStartedAt!}
          isCompleted={Boolean(sla.resolvedAt)}
          {...(sla.resolvedAt ? { completedAt: sla.resolvedAt } : {})}
          {...(rule?.resolutionTimeInMinutes ? { totalMinutes: rule.resolutionTimeInMinutes } : {})}
        />
      </div>

      {/* Note Reminders */}
      {(rule?.internalNoteReminderIntervalInMinutes ||
        rule?.publicNoteReminderIntervalInMinutes) && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
            <Icon icon={IconProp.TextFile} className="h-4 w-4 mr-2" />
            Note Reminders
          </h4>

          <NoteReminderTimer
            label="Internal Note"
            intervalMinutes={rule?.internalNoteReminderIntervalInMinutes}
            lastSentAt={sla.lastInternalNoteReminderSentAt}
            slaStartedAt={sla.slaStartedAt!}
            isIncidentResolved={isIncidentResolved}
          />

          <NoteReminderTimer
            label="Public Note"
            intervalMinutes={rule?.publicNoteReminderIntervalInMinutes}
            lastSentAt={sla.lastPublicNoteReminderSentAt}
            slaStartedAt={sla.slaStartedAt!}
            isIncidentResolved={isIncidentResolved}
          />
        </div>
      )}

      {/* Timestamps */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center">
          <Icon icon={IconProp.Time} className="h-4 w-4 mr-2" />
          Timeline
        </h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">SLA Started:</span>
            <div className="font-medium">
              {sla.slaStartedAt
                ? OneUptimeDate.getDateAsLocalFormattedString(sla.slaStartedAt)
                : "N/A"}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Responded At:</span>
            <div className="font-medium">
              {sla.respondedAt
                ? OneUptimeDate.getDateAsLocalFormattedString(sla.respondedAt)
                : "Not yet"}
            </div>
          </div>
          <div>
            <span className="text-gray-500">Resolved At:</span>
            <div className="font-medium">
              {sla.resolvedAt
                ? OneUptimeDate.getDateAsLocalFormattedString(sla.resolvedAt)
                : "Not yet"}
            </div>
          </div>
          {rule?.atRiskThresholdInPercentage && (
            <div>
              <span className="text-gray-500">At-Risk Threshold:</span>
              <div className="font-medium">
                {rule.atRiskThresholdInPercentage}%
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const IncidentViewSla: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [slaRecords, setSlaRecords] = useState<IncidentSla[]>([]);
  const [slaRules, setSlaRules] = useState<Map<string, IncidentSlaRule>>(
    new Map(),
  );

  const fetchData: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      // Fetch SLA records for this incident
      const slaResponse: {
        data: IncidentSla[];
        count: number;
      } = await ModelAPI.getList<IncidentSla>({
        modelType: IncidentSla,
        query: {
          incidentId: modelId,
          projectId: projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          incidentSlaRuleId: true,
          responseDeadline: true,
          resolutionDeadline: true,
          status: true,
          respondedAt: true,
          resolvedAt: true,
          slaStartedAt: true,
          lastInternalNoteReminderSentAt: true,
          lastPublicNoteReminderSentAt: true,
          incidentSlaRule: {
            _id: true,
            name: true,
            description: true,
            responseTimeInMinutes: true,
            resolutionTimeInMinutes: true,
            atRiskThresholdInPercentage: true,
            internalNoteReminderIntervalInMinutes: true,
            publicNoteReminderIntervalInMinutes: true,
          },
        },
        sort: {
          slaStartedAt: SortOrder.Descending,
        },
      });

      setSlaRecords(slaResponse.data);

      // Extract rules from the response
      const rulesMap: Map<string, IncidentSlaRule> = new Map();
      for (const sla of slaResponse.data) {
        if (sla.incidentSlaRule && sla.incidentSlaRuleId) {
          rulesMap.set(
            sla.incidentSlaRuleId.toString(),
            sla.incidentSlaRule as IncidentSlaRule,
          );
        }
      }
      setSlaRules(rulesMap);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [modelId, projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (slaRecords.length === 0) {
    return (
      <Card
        title="SLA Tracking"
        description="View SLA status and deadlines for this incident. SLA rules are automatically applied when incidents are created."
      >
        <div className="text-center py-12">
          <Icon
            icon={IconProp.Clock}
            className="h-12 w-12 text-gray-400 mx-auto mb-4"
          />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No SLA Rules Applied
          </h3>
          <p className="text-gray-500 max-w-md mx-auto">
            No SLA rules matched this incident. Configure SLA rules in Settings
            to automatically track response and resolution times.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Fragment>
      <Card
        title="SLA Tracking"
        description="Real-time SLA status and deadlines for this incident. Timers update automatically."
        buttons={[
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            onClick: fetchData,
          },
        ]}
      >
        <div className="space-y-4">
          {slaRecords.map((sla: IncidentSla) => {
            const rule: IncidentSlaRule | undefined = sla.incidentSlaRuleId
              ? slaRules.get(sla.incidentSlaRuleId.toString())
              : undefined;

            return (
              <SlaCard
                key={sla._id?.toString()}
                sla={sla}
                rule={rule || (sla.incidentSlaRule as IncidentSlaRule)}
              />
            );
          })}
        </div>
      </Card>
    </Fragment>
  );
};

export default IncidentViewSla;
