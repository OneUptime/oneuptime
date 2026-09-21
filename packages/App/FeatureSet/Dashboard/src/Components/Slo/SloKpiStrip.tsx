import EventStatBar from "../EventView/EventStatBar";
import EventStatTile from "../EventView/EventStatTile";
import SloBudgetBar, { SLO_BUDGET_TIER_TEXT_CLASS } from "./SloBudgetBar";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import IconProp from "Common/Types/Icon/IconProp";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  formatDurationCompact,
  formatErrorBudgetRemainingOfTotal,
} from "Common/Utils/Slo/SloDuration";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import { getSloBudgetTier, SloBudgetTier } from "Common/Utils/Slo/SloHealth";
import {
  getSloBudgetRemainingText,
  getSloTargetText,
} from "Common/Utils/Slo/SloOverviewText";
import {
  getRollingWindowFill,
  getSliDeltaText,
  getSloBudgetRunway,
  isBurnRateAtOrAboveThreshold,
  isSliBelowTarget,
  SloBudgetRunway,
  SloBudgetRunwayKind,
  SloProjectionTone,
  SloRollingWindowFill,
} from "Common/Utils/Slo/SloProjection";
import {
  formatSloBurnRate,
  formatSloPercent,
  SLO_NOT_EVALUATED_TEXT,
} from "Common/Utils/Slo/SloWidgetFormat";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  slo: ServiceLevelObjective;
  /*
   * The lowest threshold among the SLO's ENABLED burn rate rules, or null.
   * The page already loads the rules for its sidebar, so it is passed in
   * rather than fetched a second time.
   */
  lowestEnabledBurnRateThreshold: number | null;
  now: Date;
  className?: string | undefined;
}

const EM_DASH: string = "—";

const RUNWAY_TONE_TEXT_CLASS: Record<SloProjectionTone, string> = {
  [SloProjectionTone.Neutral]: "text-gray-900",
  [SloProjectionTone.Good]: "text-emerald-700",
  [SloProjectionTone.Warning]: "text-amber-700",
  [SloProjectionTone.Danger]: "text-red-700",
};

/*
 * The SLO overview's four headline numbers, as the same hairline-divided
 * stat bar the incident overview uses: where the SLI is against its target,
 * how much error budget is left (with the SLO's own at-risk tick on the
 * bar), how fast it is burning, and how long it lasts at that pace.
 *
 * Every tile has an explicit not-evaluated state. The worker's state
 * columns are NULL until the first evaluation, and "0%" or a green bar in
 * that moment would assert a reliability claim nothing backs.
 */
const SloKpiStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const slo: ServiceLevelObjective = props.slo;

  // ---- SLI -----------------------------------------------------------------

  const sliText: string | null = formatSloPercent(slo.currentSliPercentage);
  const isBelowTarget: boolean = isSliBelowTarget({
    currentSliPercentage: slo.currentSliPercentage,
    targetPercentage: slo.targetPercentage,
  });

  const targetText: string | null = getSloTargetText(slo.targetPercentage);

  const sliDescription: string =
    sliText === null
      ? targetText
        ? `${targetText} · not evaluated yet`
        : SLO_NOT_EVALUATED_TEXT
      : getSliDeltaText({
          currentSliPercentage: slo.currentSliPercentage,
          targetPercentage: slo.targetPercentage,
        }) || "No target set";

  // ---- Error budget ----------------------------------------------------------

  const budgetText: string | null = getSloBudgetRemainingText(
    slo.errorBudgetRemainingPercentage,
  );

  const budgetTier: SloBudgetTier = getSloBudgetTier({
    errorBudgetRemainingPercentage: slo.errorBudgetRemainingPercentage,
    atRiskThresholdPercentage: slo.atRiskThresholdPercentage,
  });

  const windowFill: SloRollingWindowFill | null = getRollingWindowFill({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    targetPercentage: slo.targetPercentage,
    errorBudgetTotalSeconds: slo.errorBudgetTotalSeconds,
    multiMonitorMode: slo.multiMonitorMode,
  });

  let budgetFallbackText: string = SLO_NOT_EVALUATED_TEXT;

  if (budgetText !== null) {
    if (
      typeof slo.errorBudgetRemainingPercentage === "number" &&
      slo.errorBudgetRemainingPercentage < 0
    ) {
      budgetFallbackText = "Allowed downtime has been exceeded";
    } else if (slo.errorBudgetRemainingPercentage === 0) {
      budgetFallbackText = "All allowed downtime has been used";
    } else {
      budgetFallbackText = "Remaining share of the allowed downtime";
    }
  }

  const budgetDurationText: string =
    formatErrorBudgetRemainingOfTotal({
      remainingSeconds: slo.errorBudgetRemainingSeconds,
      totalSeconds: slo.errorBudgetTotalSeconds,
    }) ?? budgetFallbackText;

  /*
   * A young rolling window's budget is still growing, which is why its
   * percentage moves so much — say so right under the number that moves.
   */
  const budgetDescription: string =
    budgetText !== null && windowFill && windowFill.isNotYetFull
      ? `${budgetDurationText} · ${windowFill.label.toLowerCase()}`
      : budgetDurationText;

  // ---- Burn rate -------------------------------------------------------------

  const burnRateText: string | null = formatSloBurnRate(slo.currentBurnRate);

  const isAtOrAboveRuleThreshold: boolean = isBurnRateAtOrAboveThreshold({
    burnRate: slo.currentBurnRate,
    threshold: props.lowestEnabledBurnRateThreshold,
  });

  let burnRateClassName: string = "text-gray-900";

  if (isAtOrAboveRuleThreshold) {
    burnRateClassName = "text-red-700";
  } else if (
    typeof slo.currentBurnRate === "number" &&
    slo.currentBurnRate > 1
  ) {
    // Above 1x the budget runs out before the window ends, even if no rule fires yet.
    burnRateClassName = "text-amber-700";
  }

  const burnRateWindowText: string = formatDurationCompact(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
  );

  const burnRateDescription: string =
    burnRateText === null
      ? SLO_NOT_EVALUATED_TEXT
      : `Over the last ${burnRateWindowText} · 1× spends the budget exactly over the window`;

  // ---- Runway ----------------------------------------------------------------

  const runway: SloBudgetRunway = getSloBudgetRunway({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    timezone: slo.timezone,
    targetPercentage: slo.targetPercentage,
    multiMonitorMode: slo.multiMonitorMode,
    errorBudgetRemainingSeconds: slo.errorBudgetRemainingSeconds,
    currentBurnRate: slo.currentBurnRate,
    now: props.now,
  });

  const isRunwayPlaceholder: boolean =
    runway.kind === SloBudgetRunwayKind.NotEvaluated ||
    runway.kind === SloBudgetRunwayKind.NotProjected;

  return (
    <div data-testid="slo-kpi-strip" className={props.className || ""}>
      <EventStatBar columns={4} ariaLabel="Error budget">
        <EventStatTile
          variant="segment"
          id="slo-kpi-sli"
          label="SLI"
          icon={IconProp.Activity}
          value={
            sliText === null ? (
              <span className="text-gray-400">{EM_DASH}</span>
            ) : (
              <span
                className={isBelowTarget ? "text-red-700" : "text-gray-900"}
              >
                {sliText}
              </span>
            )
          }
          description={sliDescription}
        />

        <EventStatTile
          variant="segment"
          id="slo-kpi-budget"
          label="Error budget left"
          icon={IconProp.ChartPie}
          value={
            <div>
              <span className={SLO_BUDGET_TIER_TEXT_CLASS[budgetTier]}>
                {budgetText ?? EM_DASH}
              </span>
              <SloBudgetBar
                className="mb-1 mt-2"
                errorBudgetRemainingPercentage={
                  slo.errorBudgetRemainingPercentage
                }
                atRiskThresholdPercentage={slo.atRiskThresholdPercentage}
              />
            </div>
          }
          description={budgetDescription}
        />

        <EventStatTile
          variant="segment"
          id="slo-kpi-burn-rate"
          label="Burn rate"
          icon={IconProp.Fire}
          value={
            burnRateText === null ? (
              <span className="text-gray-400">{EM_DASH}</span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className={burnRateClassName}>{burnRateText}</span>
                {isAtOrAboveRuleThreshold ? (
                  <span
                    data-testid="slo-kpi-burn-rate-badge"
                    title={`The last ${burnRateWindowText}'s burn is at or above ${formatSloBurnRate(
                      props.lowestEnabledBurnRateThreshold,
                    )}, the lowest threshold among this SLO's enabled burn rate rules.`}
                  >
                    <StatusBadge
                      text="Rule threshold reached"
                      type={StatusBadgeType.Danger}
                    />
                  </span>
                ) : (
                  <></>
                )}
              </span>
            )
          }
          description={burnRateDescription}
        />

        <EventStatTile
          variant="segment"
          id="slo-kpi-runway"
          label="Budget runway"
          icon={IconProp.Clock}
          value={
            <span
              className={
                isRunwayPlaceholder
                  ? "text-gray-400"
                  : RUNWAY_TONE_TEXT_CLASS[runway.tone]
              }
            >
              {runway.value}
            </span>
          }
          description={runway.description}
        />
      </EventStatBar>
    </div>
  );
};

export default SloKpiStrip;
