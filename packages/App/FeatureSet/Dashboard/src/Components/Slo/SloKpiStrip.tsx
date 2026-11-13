import EventStatBar from "../EventView/EventStatBar";
import EventStatTile from "../EventView/EventStatTile";
import SloBudgetBar, { SLO_BUDGET_TIER_TEXT_CLASS } from "./SloBudgetBar";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import IconProp from "Common/Types/Icon/IconProp";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import {
  SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES,
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
} from "Common/Utils/Slo/SloEvaluation";
import { getSloBudgetTier, SloBudgetTier } from "Common/Utils/Slo/SloHealth";
import { getSloBudgetRemainingText } from "Common/Utils/Slo/SloOverviewText";
import {
  getRollingWindowFill,
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
import {
  getInlineSeparator,
  SentenceOptions,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getErrorBudgetRemainingOfTotalInLanguage,
  getRollingWindowFillTextInLanguage,
  getSliDeltaTextInLanguage,
  getSloBudgetRemainingTextInLanguage,
  getSloBudgetRunwayTextInLanguage,
  SloBudgetRunwayText,
} from "./SloOverviewTextInLanguage";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  slo: ServiceLevelObjective;
  /*
   * The lowest threshold among the SLO's ENABLED burn rate rules that the
   * last hour can speak for - those that look back no longer than
   * SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES - or null. The page
   * already loads the rules for its sidebar, so it is passed in rather than
   * fetched a second time.
   */
  lowestEnabledBurnRateThreshold: number | null;
  now: Date;
  className?: string | undefined;
}

const EM_DASH: string = "—";

/*
 * The tiles' notes are drawn and nothing else, so each value in them (a
 * "99.9%", a "1h") is set apart from the words around it: in an Arabic note
 * a figure keeps its place in the sentence.
 */
const NOTE_OPTIONS: SentenceOptions = { setsValuesApart: true };

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
  const translator: Translator = useTranslator();
  const slo: ServiceLevelObjective = props.slo;

  // ---- SLI -----------------------------------------------------------------

  // Every figure on the strip is written the reader's way: "99,874 %" in German.
  const sliText: string | null = formatSloPercent(
    slo.currentSliPercentage,
    undefined,
    translator,
  );
  const isBelowTarget: boolean = isSliBelowTarget({
    currentSliPercentage: slo.currentSliPercentage,
    targetPercentage: slo.targetPercentage,
  });

  const targetText: string | null = formatSloPercent(
    slo.targetPercentage,
    undefined,
    translator,
  );

  const sliDescription: string =
    sliText === null
      ? targetText
        ? translator.translateTemplate(
            "Target {{target}} · not evaluated yet",
            {
              target: targetText,
            },
            NOTE_OPTIONS,
          )
        : translator.translateTemplate(SLO_NOT_EVALUATED_TEXT)
      : getSliDeltaTextInLanguage(
          {
            currentSliPercentage: slo.currentSliPercentage,
            targetPercentage: slo.targetPercentage,
          },
          translator,
          NOTE_OPTIONS,
        ) || translator.translateTemplate("No target set");

  // ---- Error budget ----------------------------------------------------------

  const budgetText: string | null = getSloBudgetRemainingTextInLanguage(
    getSloBudgetRemainingText(slo.errorBudgetRemainingPercentage, translator),
    translator,
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

  let budgetFallbackText: string = translator.translateTemplate(
    SLO_NOT_EVALUATED_TEXT,
  );

  if (budgetText !== null) {
    if (
      typeof slo.errorBudgetRemainingPercentage === "number" &&
      slo.errorBudgetRemainingPercentage < 0
    ) {
      budgetFallbackText = translator.translateTemplate(
        "Allowed downtime has been exceeded",
      );
    } else if (slo.errorBudgetRemainingPercentage === 0) {
      budgetFallbackText = translator.translateTemplate(
        "All allowed downtime has been used",
      );
    } else {
      budgetFallbackText = translator.translateTemplate(
        "Remaining share of the allowed downtime",
      );
    }
  }

  const budgetDurationText: string =
    getErrorBudgetRemainingOfTotalInLanguage(
      {
        remainingSeconds: slo.errorBudgetRemainingSeconds,
        totalSeconds: slo.errorBudgetTotalSeconds,
      },
      translator,
      NOTE_OPTIONS,
    ) ?? budgetFallbackText;

  /*
   * A young rolling window's budget is still growing, which is why its
   * percentage moves so much — say so right under the number that moves.
   */
  const budgetDescription: string =
    budgetText !== null && windowFill && windowFill.isNotYetFull
      ? `${budgetDurationText}${getInlineSeparator(
          translator.language,
        )}${getRollingWindowFillTextInLanguage(windowFill, translator, {
          afterOtherWords: true,
        })}`
      : budgetDurationText;

  // ---- Burn rate -------------------------------------------------------------

  const burnRateText: string | null = formatSloBurnRate(
    slo.currentBurnRate,
    translator,
  );

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

  const burnRateWindowText: string = formatDurationCompactInLanguage(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
    translator.language,
  );

  // A rule that looks back further is not compared with the last hour.
  const comparableLongWindowText: string = formatDurationCompactInLanguage(
    SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES * 60,
    translator.language,
  );

  /*
   * The "1×" is a burn rate like the one above it, so it is written by the
   * same formatter: "1×" in English, Persian's "۱" with its "×" on the same
   * side as every other burn rate on the page. Written in the words, a
   * Persian "۱×" in a sentence read right to left was drawn "×۱" (#6924).
   */
  const sustainableBurnRateText: string =
    formatSloBurnRate(1, translator) || "1×";

  const burnRateDescription: string =
    burnRateText === null
      ? translator.translateTemplate(SLO_NOT_EVALUATED_TEXT)
      : translator.translateTemplate(
          "Over the last {{window}} · {{rate}} spends the budget exactly over the window",
          { window: burnRateWindowText, rate: sustainableBurnRateText },
          NOTE_OPTIONS,
        );

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

  const runwayText: SloBudgetRunwayText = getSloBudgetRunwayTextInLanguage(
    {
      runway: runway,
      errorBudgetRemainingSeconds: slo.errorBudgetRemainingSeconds,
      windowDays: slo.windowDays,
    },
    translator,
    NOTE_OPTIONS,
  );

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
                    title={translator.translateTemplate(
                      "The burn over the last {{window}} is at or above {{threshold}}, the lowest threshold among this SLO's enabled burn rate rules that look back {{longWindow}} or less.",
                      {
                        window: burnRateWindowText,
                        threshold:
                          formatSloBurnRate(
                            props.lowestEnabledBurnRateThreshold,
                            translator,
                          ) || "",
                        longWindow: comparableLongWindowText,
                      },
                    )}
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
              {runwayText.value}
            </span>
          }
          description={runwayText.description}
        />
      </EventStatBar>
    </div>
  );
};

export default SloKpiStrip;
