import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewActionLink from "./SloOverviewActionLink";
import SloOverviewEmptyState from "./SloOverviewEmptyState";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { formatDurationCompact } from "Common/Utils/Slo/SloDuration";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import { isBurnRateAtOrAboveThreshold } from "Common/Utils/Slo/SloProjection";
import { formatSloBurnRate } from "Common/Utils/Slo/SloWidgetFormat";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  sloId: ObjectID;
  // Every rule of the SLO, enabled or not; the page loads them once for the whole overview.
  rules: Array<ServiceLevelObjectiveBurnRateRule>;
  currentBurnRate: number | undefined | null;
  error: string;
}

type GetRuleWindowTextFunction = (
  rule: ServiceLevelObjectiveBurnRateRule,
) => string;

const getRuleWindowText: GetRuleWindowTextFunction = (
  rule: ServiceLevelObjectiveBurnRateRule,
): string => {
  const windows: Array<string> = [];

  for (const minutes of [rule.longWindowInMinutes, rule.shortWindowInMinutes]) {
    if (typeof minutes === "number" && isFinite(minutes) && minutes > 0) {
      windows.push(formatDurationCompact(minutes * 60));
    }
  }

  if (windows.length === 0) {
    return "";
  }

  return ` over ${windows.join(" and ")}`;
};

type GetRatioBarClassFunction = (ratio: number) => string;

const getRatioBarClass: GetRatioBarClassFunction = (ratio: number): string => {
  if (ratio >= 1) {
    return "bg-red-500";
  }

  if (ratio >= 0.5) {
    return "bg-amber-500";
  }

  return "bg-gray-400";
};

/*
 * The SLO's alerting at a glance: each enabled burn rate rule's threshold,
 * what it raises, and how close the current burn is to it.
 *
 * The "now" bar compares the headline burn rate — measured over the last
 * hour — with each rule's threshold. A rule fires on its OWN long and short
 * windows, so this is an at-a-glance proximity, not a prediction; the
 * footnote says so rather than letting a full bar read as "firing".
 */
const SloBurnRateRulesSummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const rulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_BURN_RATE_RULES] as Route,
    { modelId: props.sloId },
  );

  // Fastest burn first: the page-now rule is the one to read first.
  const enabledRules: Array<ServiceLevelObjectiveBurnRateRule> = props.rules
    .filter((rule: ServiceLevelObjectiveBurnRateRule) => {
      return rule.isEnabled === true;
    })
    .sort(
      (
        a: ServiceLevelObjectiveBurnRateRule,
        b: ServiceLevelObjectiveBurnRateRule,
      ) => {
        return (b.burnRateThreshold || 0) - (a.burnRateThreshold || 0);
      },
    );

  const disabledCount: number = props.rules.length - enabledRules.length;

  const currentBurnRate: number | null =
    typeof props.currentBurnRate === "number" && isFinite(props.currentBurnRate)
      ? props.currentBurnRate
      : null;

  const burnRateWindowText: string = formatDurationCompact(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
  );

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (props.error) {
      return <p className="text-sm text-red-700">{props.error}</p>;
    }

    if (enabledRules.length === 0) {
      return (
        <SloOverviewEmptyState
          dataTestId="slo-burn-rules-empty"
          icon={IconProp.Fire}
          tone="warning"
          title="No enabled burn rate rules"
          description={
            disabledCount > 0
              ? `This SLO has ${disabledCount} disabled rule${
                  disabledCount === 1 ? "" : "s"
                }, so nothing alerts when it burns its error budget too fast.`
              : "Nothing alerts when this SLO burns its error budget too fast."
          }
          actions={
            <SloOverviewActionLink
              variant="secondary"
              title={disabledCount > 0 ? "Review rules" : "Add a rule"}
              icon={IconProp.Fire}
              to={rulesRoute}
            />
          }
        />
      );
    }

    return (
      <div>
        <ul
          aria-label="Enabled burn rate rules"
          className="divide-y divide-gray-100"
        >
          {enabledRules.map(
            (rule: ServiceLevelObjectiveBurnRateRule, index: number) => {
              const threshold: number | null =
                typeof rule.burnRateThreshold === "number" &&
                isFinite(rule.burnRateThreshold) &&
                rule.burnRateThreshold > 0
                  ? rule.burnRateThreshold
                  : null;

              const ratio: number =
                threshold !== null && currentBurnRate !== null
                  ? Math.max(0, Math.min(1, currentBurnRate / threshold))
                  : 0;

              const isAtThreshold: boolean = isBurnRateAtOrAboveThreshold({
                burnRate: currentBurnRate,
                threshold: threshold,
              });

              return (
                <li
                  key={rule._id?.toString() || `rule-${index}`}
                  data-testid="slo-burn-rule-row"
                  className="py-3 first:pt-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-gray-900">
                        {rule.name || "Unnamed rule"}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {threshold !== null
                          ? `At ${formatSloBurnRate(threshold)} or faster${getRuleWindowText(rule)}`
                          : "No threshold set — this rule never fires"}
                      </p>
                    </div>
                    {isAtThreshold ? (
                      <StatusBadge
                        text="At threshold"
                        type={StatusBadgeType.Danger}
                        className="flex-shrink-0"
                      />
                    ) : (
                      <></>
                    )}
                  </div>

                  {threshold !== null ? (
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        role="progressbar"
                        aria-label={`${rule.name || "Rule"}: current burn against its threshold`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(ratio * 100)}
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"
                      >
                        {ratio > 0 ? (
                          <div
                            className={`h-full rounded-full ${getRatioBarClass(ratio)}`}
                            style={{ width: `${ratio * 100}%` }}
                          ></div>
                        ) : (
                          <></>
                        )}
                      </div>
                      <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
                        {currentBurnRate === null
                          ? "—"
                          : `${formatSloBurnRate(currentBurnRate)} now`}
                      </span>
                    </div>
                  ) : (
                    <></>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {rule.shouldCreateIncident ? (
                      <StatusBadge
                        text="Declares incident"
                        type={StatusBadgeType.Neutral}
                      />
                    ) : (
                      <></>
                    )}
                    {rule.shouldCreateAlert ? (
                      <StatusBadge
                        text="Raises alert"
                        type={StatusBadgeType.Neutral}
                      />
                    ) : (
                      <></>
                    )}
                    {!rule.shouldCreateIncident && !rule.shouldCreateAlert ? (
                      <StatusBadge
                        text="Raises nothing"
                        type={StatusBadgeType.Warning}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                </li>
              );
            },
          )}
        </ul>

        <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
          {`"Now" is the burn over the last ${burnRateWindowText}; each rule fires on its own windows.`}
          {disabledCount > 0
            ? ` ${disabledCount} disabled rule${disabledCount === 1 ? " is" : "s are"} not shown.`
            : ""}
        </p>
      </div>
    );
  };

  return (
    <Card
      title="Burn rate rules"
      description="What alerts, and when, as this SLO spends its error budget."
      headerLayout="stacked"
      rightElement={<SloOverviewActionLink title="Manage" to={rulesRoute} />}
    >
      {getBody()}
    </Card>
  );
};

export default SloBurnRateRulesSummaryCard;
