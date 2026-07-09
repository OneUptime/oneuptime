import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
  projectId: ObjectID;
}

interface PolicyOverview {
  levels: number;
  timeToFinalLevelMinutes: number;
  repeatEnabled: boolean;
  repeatCount: number;
  scheduleNames: Array<string>;
  teamNames: Array<string>;
  userNames: Array<string>;
  levelsWithNoResponders: number;
}

// Compact human duration, e.g. "immediately", "5 min", "1 hr 30 min".
const formatDuration: (minutes: number) => string = (
  minutes: number,
): string => {
  if (!minutes || minutes <= 0) {
    return "0 min";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours: number = Math.floor(minutes / 60);
  const remaining: number = minutes % 60;
  if (remaining === 0) {
    return hours === 1 ? "1 hr" : `${hours} hrs`;
  }
  return `${hours} hr ${remaining} min`;
};

const OnCallPolicySummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [overview, setOverview] = useState<PolicyOverview | null>(null);

  const loadData: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const [rulesResult, userJoins, teamJoins, scheduleJoins, policy]: [
        ListResult<OnCallDutyPolicyEscalationRule>,
        ListResult<OnCallDutyPolicyEscalationRuleUser>,
        ListResult<OnCallDutyPolicyEscalationRuleTeam>,
        ListResult<OnCallDutyPolicyEscalationRuleSchedule>,
        OnCallDutyPolicy | null,
      ] = await Promise.all([
        ModelAPI.getList<OnCallDutyPolicyEscalationRule>({
          modelType: OnCallDutyPolicyEscalationRule,
          query: {
            onCallDutyPolicyId: props.onCallDutyPolicyId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            escalateAfterInMinutes: true,
            order: true,
          },
          sort: { order: SortOrder.Ascending },
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleUser>({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicyEscalationRuleId: true,
            user: { _id: true, name: true, email: true },
          },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleTeam>({
          modelType: OnCallDutyPolicyEscalationRuleTeam,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicyEscalationRuleId: true,
            team: { _id: true, name: true },
          },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
          modelType: OnCallDutyPolicyEscalationRuleSchedule,
          query: { onCallDutyPolicyId: props.onCallDutyPolicyId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicyEscalationRuleId: true,
            onCallDutyPolicySchedule: { _id: true, name: true },
          },
          sort: {},
        }),
        ModelAPI.getItem<OnCallDutyPolicy>({
          modelType: OnCallDutyPolicy,
          id: props.onCallDutyPolicyId,
          select: {
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
          },
        }),
      ]);

      /*
       * Time from trigger until the final level is engaged: the sum of the wait
       * times of every level except the last (the last level's wait governs the
       * repeat, not another level).
       */
      const orderedRules: Array<OnCallDutyPolicyEscalationRule> =
        rulesResult.data;
      let timeToFinalLevelMinutes: number = 0;
      for (let i: number = 0; i < orderedRules.length - 1; i++) {
        timeToFinalLevelMinutes += Math.max(
          0,
          orderedRules[i]!.escalateAfterInMinutes || 0,
        );
      }

      /*
       * Distinct responders per type, plus the set of rules that have at least
       * one responder (to flag levels that would notify no one).
       */
      const scheduleNamesById: Record<string, string> = {};
      const teamNamesById: Record<string, string> = {};
      const userNamesById: Record<string, string> = {};
      const rulesWithResponders: Set<string> = new Set<string>();

      for (const join of scheduleJoins.data) {
        const id: string = join.onCallDutyPolicySchedule?.id?.toString() || "";
        if (id) {
          scheduleNamesById[id] =
            join.onCallDutyPolicySchedule?.name?.toString() ||
            "On-call schedule";
        }
        const ruleId: string =
          join.onCallDutyPolicyEscalationRuleId?.toString() || "";
        if (ruleId) {
          rulesWithResponders.add(ruleId);
        }
      }
      for (const join of teamJoins.data) {
        const id: string = join.team?.id?.toString() || "";
        if (id) {
          teamNamesById[id] = join.team?.name?.toString() || "Team";
        }
        const ruleId: string =
          join.onCallDutyPolicyEscalationRuleId?.toString() || "";
        if (ruleId) {
          rulesWithResponders.add(ruleId);
        }
      }
      for (const join of userJoins.data) {
        const id: string = join.user?.id?.toString() || "";
        if (id) {
          userNamesById[id] =
            join.user?.name?.toString() ||
            join.user?.email?.toString() ||
            "User";
        }
        const ruleId: string =
          join.onCallDutyPolicyEscalationRuleId?.toString() || "";
        if (ruleId) {
          rulesWithResponders.add(ruleId);
        }
      }

      const levelsWithNoResponders: number = orderedRules.filter(
        (rule: OnCallDutyPolicyEscalationRule) => {
          return !rulesWithResponders.has(rule.id?.toString() || "");
        },
      ).length;

      setOverview({
        levels: orderedRules.length,
        timeToFinalLevelMinutes,
        repeatEnabled: Boolean(policy?.repeatPolicyIfNoOneAcknowledges),
        repeatCount: policy?.repeatPolicyIfNoOneAcknowledgesNoOfTimes || 0,
        scheduleNames: Object.values(scheduleNamesById),
        teamNames: Object.values(teamNamesById),
        userNames: Object.values(userNamesById),
        levelsWithNoResponders,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await loadData();
  }, []);

  // A single quiet metric cell in the supporting stat strip.
  const getMetric: (params: {
    icon: IconProp;
    label: string;
    value: string;
  }) => ReactElement = (params: {
    icon: IconProp;
    label: string;
    value: string;
  }): ReactElement => {
    return (
      <div className="bg-white px-4 py-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <Icon icon={params.icon} className="h-3.5 w-3.5 text-gray-400" />
          <span className="truncate">{params.label}</span>
        </div>
        <div className="mt-2 truncate text-xl font-semibold leading-none text-gray-900">
          {params.value}
        </div>
      </div>
    );
  };

  // One responder category (schedules / teams / users) with its chips.
  const getResponderGroup: (params: {
    icon: IconProp;
    iconColor: string;
    label: string;
    names: Array<string>;
  }) => ReactElement = (params: {
    icon: IconProp;
    iconColor: string;
    label: string;
    names: Array<string>;
  }): ReactElement => {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 sm:w-40 sm:pt-0.5">
          <Icon
            icon={params.icon}
            className={`h-3.5 w-3.5 ${params.iconColor}`}
          />
          {params.label}
          <span className="text-gray-300">·</span>
          <span className="tabular-nums text-gray-500">
            {params.names.length}
          </span>
        </span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {params.names.map((name: string, i: number) => {
            return (
              <span
                key={`${params.label}-${i}`}
                className="inline-flex items-center rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
              >
                {name}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="flex w-full justify-center py-10">
          <ComponentLoader />
        </div>
      );
    }

    if (error) {
      return <ErrorMessage message={error} onRefreshClick={loadData} />;
    }

    if (!overview) {
      return <></>;
    }

    if (overview.levels === 0) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-8 text-center">
          <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600">
            This policy has no escalation rules yet, so triggering it will not
            page anyone. Open the{" "}
            <span className="font-semibold text-gray-900">Escalation</span> tab
            to add the first level.
          </p>
        </div>
      );
    }

    const totalResponders: number =
      overview.scheduleNames.length +
      overview.teamNames.length +
      overview.userNames.length;
    const hasResponders: boolean = totalResponders > 0;
    const timeToFinalValue: string =
      overview.levels <= 1
        ? "—"
        : overview.timeToFinalLevelMinutes > 0
          ? formatDuration(overview.timeToFinalLevelMinutes)
          : "Instant";

    return (
      <div>
        {/* Hero narrative — the confident, read-it-in-five-seconds summary. */}
        <p className="mb-6 text-base leading-relaxed text-gray-600">
          When this policy is triggered, it works through{" "}
          <span className="font-semibold text-gray-900">
            {overview.levels}{" "}
            {overview.levels === 1 ? "escalation level" : "escalation levels"}
          </span>
          {hasResponders ? (
            <>
              {" "}
              and can page up to{" "}
              <span className="font-semibold text-gray-900">
                {totalResponders}{" "}
                {totalResponders === 1 ? "responder" : "responders"}
              </span>
              .{" "}
            </>
          ) : (
            <>
              , but{" "}
              <span className="font-semibold text-amber-700">
                no responders are assigned yet
              </span>
              .{" "}
            </>
          )}
          The first level is notified immediately;{" "}
          {overview.levels > 1 ? (
            overview.timeToFinalLevelMinutes > 0 ? (
              <>
                if no one acknowledges, the alert climbs to the final level
                after{" "}
                <span className="font-semibold text-gray-900">
                  {formatDuration(overview.timeToFinalLevelMinutes)}
                </span>
                .{" "}
              </>
            ) : (
              <>
                if no one acknowledges, every remaining level is engaged{" "}
                <span className="font-semibold text-gray-900">right away</span>.{" "}
              </>
            )
          ) : (
            <>there are no further levels to escalate to. </>
          )}
          {overview.repeatEnabled && overview.repeatCount > 0 ? (
            <>
              If it is still unacknowledged, the whole policy repeats up to{" "}
              <span className="font-semibold text-gray-900">
                {overview.repeatCount} more{" "}
                {overview.repeatCount === 1 ? "time" : "times"}
              </span>{" "}
              before stopping.
            </>
          ) : (
            <>
              If it is still unacknowledged after the final level, escalation
              stops.
            </>
          )}
        </p>

        {/* Supporting metrics — a quiet, segmented stat strip. */}
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-4">
          {getMetric({
            icon: IconProp.List,
            label: "Levels",
            value: `${overview.levels}`,
          })}
          {getMetric({
            icon: IconProp.User,
            label: "Responders",
            value: `${totalResponders}`,
          })}
          {getMetric({
            icon: IconProp.Clock,
            label: "To final level",
            value: timeToFinalValue,
          })}
          {getMetric({
            icon: IconProp.Reload,
            label: "Repeats",
            value:
              overview.repeatEnabled && overview.repeatCount > 0
                ? `${overview.repeatCount}×`
                : "None",
          })}
        </div>

        {/* Responders — a refined, well-grouped list with integrated coverage note. */}
        {hasResponders ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="mb-3.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Who gets paged
              </span>
              <span className="text-xs font-medium tabular-nums text-gray-500">
                {totalResponders} total
              </span>
            </div>
            <div className="space-y-3.5">
              {overview.scheduleNames.length > 0 &&
                getResponderGroup({
                  icon: IconProp.Calendar,
                  iconColor: "text-indigo-500",
                  label: "On-call",
                  names: overview.scheduleNames,
                })}
              {overview.teamNames.length > 0 &&
                getResponderGroup({
                  icon: IconProp.Team,
                  iconColor: "text-violet-500",
                  label: "Teams",
                  names: overview.teamNames,
                })}
              {overview.userNames.length > 0 &&
                getResponderGroup({
                  icon: IconProp.User,
                  iconColor: "text-gray-500",
                  label: "Users",
                  names: overview.userNames,
                })}
            </div>
            {overview.levelsWithNoResponders > 0 ? (
              <div className="mt-4 flex items-start gap-2 border-t border-amber-200/70 pt-3 text-xs leading-relaxed text-amber-700">
                <Icon
                  icon={IconProp.Alert}
                  className="mt-px h-3.5 w-3.5 flex-shrink-0 text-amber-500"
                />
                <span>
                  <span className="font-semibold">
                    {overview.levelsWithNoResponders}{" "}
                    {overview.levelsWithNoResponders === 1 ? "level" : "levels"}
                  </span>{" "}
                  along the way{" "}
                  {overview.levelsWithNoResponders === 1 ? "has" : "have"} no
                  responders and will notify no one when reached.
                </span>
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2.5">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
              />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  No responders are assigned
                </p>
                <p className="mt-1 text-sm leading-relaxed text-amber-700">
                  This policy will not page anyone when it is triggered. Add
                  on-call schedules, teams, or users on the Escalation tab.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header — plain title, no icon box (matches the standard Card). */}
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">
          Policy at a glance
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          A quick snapshot of how this on-call policy responds when it is
          triggered.
        </p>
      </div>

      {/* Body */}
      <div className="p-6">{getBody()}</div>
    </div>
  );
};

export default OnCallPolicySummary;
