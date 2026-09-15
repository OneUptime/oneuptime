import { SloBudgetTier } from "Common/Utils/Slo/SloHealth";
import {
  getSloBudgetBarGeometry,
  SloBudgetBarGeometry,
} from "Common/Utils/Slo/SloProjection";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Tailwind classes per budget tier, as literal strings so the runtime
 * Tailwind scanner sees each one. The tier itself always comes from the
 * shared getSloBudgetTier with the SLO's own at-risk threshold, so these
 * colours cannot disagree with the status pill.
 */
export const SLO_BUDGET_TIER_BAR_CLASS: Record<SloBudgetTier, string> = {
  [SloBudgetTier.Healthy]: "bg-emerald-500",
  [SloBudgetTier.AtRisk]: "bg-amber-500",
  [SloBudgetTier.Exhausted]: "bg-red-500",
  [SloBudgetTier.Unknown]: "bg-gray-300",
};

export const SLO_BUDGET_TIER_TEXT_CLASS: Record<SloBudgetTier, string> = {
  [SloBudgetTier.Healthy]: "text-emerald-700",
  [SloBudgetTier.AtRisk]: "text-amber-700",
  [SloBudgetTier.Exhausted]: "text-red-700",
  [SloBudgetTier.Unknown]: "text-gray-400",
};

export interface ComponentProps {
  // SIGNED: below zero means overspent. The bar clamps; the number it describes does not.
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
  className?: string | undefined;
}

/*
 * The error budget as a bar, with a tick where the SLO turns At Risk.
 *
 * The old overview drew a 10rem bar with no marker, so "32% left" gave no
 * sense of how close the SLO was to its own warning line — and that line is
 * per SLO, so a reader cannot carry it in their head. The tick sits at the
 * SLO's threshold, and the fill turns amber exactly when it crosses it.
 *
 * An exhausted budget has no fill to draw, so the track itself turns red
 * rather than looking like a budget that is merely not loaded. A budget the
 * worker has not evaluated draws only a plain track: no fill, no marker,
 * nothing that reads as a claim.
 */
const SloBudgetBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const geometry: SloBudgetBarGeometry = getSloBudgetBarGeometry({
    errorBudgetRemainingPercentage: props.errorBudgetRemainingPercentage,
    atRiskThresholdPercentage: props.atRiskThresholdPercentage,
  });

  const thresholdText: string =
    formatSloPercent(geometry.atRiskThresholdPercentage) ||
    `${geometry.atRiskThresholdPercentage}%`;

  const remainingText: string =
    formatSloPercent(props.errorBudgetRemainingPercentage, 1) || "";

  let valueText: string = "Error budget not evaluated yet";

  if (geometry.isOverspent) {
    valueText = `Error budget overspent (${remainingText}); at risk at ${thresholdText} or less`;
  } else if (geometry.isEvaluated) {
    valueText = `${remainingText} of the error budget remaining; at risk at ${thresholdText} or less`;
  }

  const trackClassName: string =
    geometry.tier === SloBudgetTier.Exhausted ? "bg-red-100" : "bg-gray-100";

  return (
    <div
      data-testid="slo-budget-bar"
      className={`relative w-full ${props.className || ""}`}
    >
      <div
        role="progressbar"
        aria-label="Error budget remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          geometry.isEvaluated ? Math.round(geometry.fillPercent) : undefined
        }
        aria-valuetext={valueText}
        data-testid="slo-budget-bar-track"
        className={`h-2 w-full overflow-hidden rounded-full ${trackClassName}`}
      >
        {geometry.isEvaluated && geometry.fillPercent > 0 ? (
          <div
            data-testid="slo-budget-bar-fill"
            className={`h-full rounded-full transition-all duration-300 ${
              SLO_BUDGET_TIER_BAR_CLASS[geometry.tier]
            }`}
            style={{ width: `${geometry.fillPercent}%` }}
          ></div>
        ) : (
          <></>
        )}
      </div>
      {geometry.isEvaluated ? (
        <span
          data-testid="slo-budget-bar-marker"
          aria-hidden="true"
          title={`At risk at ${thresholdText} or less`}
          /*
           * The white ring cuts the tick out of whatever fill it sits on, so
           * it stays visible on green, amber and red alike (Theme.css maps
           * ring-white to the card surface in dark mode).
           */
          className="pointer-events-auto absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-500 ring-2 ring-white"
          style={{ left: `${geometry.markerPercent}%` }}
        ></span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SloBudgetBar;
