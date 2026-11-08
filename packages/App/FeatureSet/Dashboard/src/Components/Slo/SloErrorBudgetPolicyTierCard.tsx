import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewActionLink from "./SloOverviewActionLink";
import {
  POLICY_TIER_BUDGET_LEFT_TEMPLATE,
  POLICY_TIER_ENTERED_TEMPLATE,
  SloCurrentPolicyTier,
  getSloCurrentPolicyTier,
} from "./SloPolicyTier";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import Route from "Common/Types/API/Route";
import { Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatSloPolicyTierThreshold } from "Common/Utils/Slo/SloErrorBudgetPolicy";
import { getSloPolicyTierColor } from "Common/Utils/Slo/SloStatusColor";
import React, { FunctionComponent, ReactElement } from "react";

export const SLO_POLICY_TIER_CARD_TEST_ID: string = "slo-overview-policy-tier";

export interface ComponentProps {
  sloId: ObjectID;
  slo: ServiceLevelObjective;
  // Every tier of the SLO's policy; the page loads them once for the whole overview.
  tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>;
  className?: string | undefined;
}

/*
 * Literal class names per tone, so the runtime Tailwind scanner sees each
 * one, built only from classes Theme.css already remaps for dark mode - the
 * hero's own status tiles.
 */
const ICON_TILE_CLASS_NAMES: Record<"danger" | "warning", string> = {
  danger: "bg-red-50 text-red-700",
  warning: "bg-yellow-50 text-yellow-700",
};

/*
 * THE TIER OF ITS ERROR BUDGET POLICY THE SLO IS IN, ON ITS OVERVIEW.
 *
 * What the team agreed to do now is what everyone who opens the SLO should
 * read first, so it sits right under the summary: the tier's name, the
 * budget left it applies at, since when the SLO is in it, and what the team
 * does there, as the tier's Markdown. It is coloured as its tier is
 * everywhere (getSloPolicyTierColor): red for the tier of an exhausted
 * budget, yellow for any other, and links to the policy itself.
 *
 * Drawn only while the SLO is in a tier: an SLO without a policy, or whose
 * budget is above every tier, shows nothing here.
 */
const SloErrorBudgetPolicyTierCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const current: SloCurrentPolicyTier | null = getSloCurrentPolicyTier({
    slo: props.slo,
    tiers: props.tiers,
  });

  if (!current) {
    return <></>;
  }

  /*
   * A tier the overview could not read - deleted since, or the tiers did not
   * load - is still the tier the SLO is in; it reads in the at-risk colour
   * until its threshold is known.
   */
  const color: Color = getSloPolicyTierColor({
    thresholdPercentage: current.thresholdPercentage,
  });
  const tone: "danger" | "warning" =
    color.toString() === Red.toString() ? "danger" : "warning";

  const policyRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_ERROR_BUDGET_POLICY] as Route,
    { modelId: props.sloId },
  );

  const threshold: string = formatSloPolicyTierThreshold(
    current.thresholdPercentage,
  );

  return (
    <section
      aria-label={translator.translateText("Error Budget Policy")}
      data-testid={SLO_POLICY_TIER_CARD_TEST_ID}
      data-tier-tone={tone}
      className={`relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ${props.className || ""}`}
    >
      {/* The tier's colour, down the card's edge. */}
      <div
        aria-hidden="true"
        data-testid={`${SLO_POLICY_TIER_CARD_TEST_ID}-color`}
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color.toString() }}
      ></div>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div
            aria-hidden="true"
            className={`max-sm:hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg sm:flex ${ICON_TILE_CLASS_NAMES[tone]}`}
          >
            <Icon icon={IconProp.Scale} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("Error Budget Policy")}
            </p>
            <h2
              data-testid={`${SLO_POLICY_TIER_CARD_TEST_ID}-name`}
              className="mt-1 break-words text-lg font-semibold text-gray-900"
            >
              {current.name}
            </h2>
            {threshold || current.enteredAt ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-600">
                {threshold ? (
                  <span
                    data-testid={`${SLO_POLICY_TIER_CARD_TEST_ID}-threshold`}
                    className="tabular-nums"
                  >
                    {translator.translateTemplate(
                      POLICY_TIER_BUDGET_LEFT_TEMPLATE,
                      { threshold: threshold },
                    )}
                  </span>
                ) : (
                  <></>
                )}
                {threshold && current.enteredAt ? (
                  <span aria-hidden="true" className="text-gray-300">
                    ·
                  </span>
                ) : (
                  <></>
                )}
                {current.enteredAt ? (
                  <time
                    data-testid={`${SLO_POLICY_TIER_CARD_TEST_ID}-entered`}
                    dateTime={current.enteredAt.toISOString()}
                    title={OneUptimeDate.getDateAsLocalFormattedString(
                      current.enteredAt,
                    )}
                  >
                    {translator.translateTemplate(
                      POLICY_TIER_ENTERED_TEMPLATE,
                      { time: OneUptimeDate.fromNow(current.enteredAt) },
                    )}
                  </time>
                ) : (
                  <></>
                )}
              </p>
            ) : (
              <></>
            )}
            {current.whatWeDo ? (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500">
                  {translator.translateText("What We Do")}
                </p>
                <div
                  data-testid={`${SLO_POLICY_TIER_CARD_TEST_ID}-what-we-do`}
                  className="mt-1 break-words text-sm text-gray-800"
                >
                  <MarkdownViewer text={current.whatWeDo} />
                </div>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          <SloOverviewActionLink
            title="Open policy"
            icon={IconProp.Scale}
            to={policyRoute}
          />
        </div>
      </div>
    </section>
  );
};

export default SloErrorBudgetPolicyTierCard;
