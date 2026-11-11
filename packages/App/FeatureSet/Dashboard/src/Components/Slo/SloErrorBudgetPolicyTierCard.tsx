import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewActionLink from "./SloOverviewActionLink";
import {
  DEPLOYMENTS_FROZEN_SINCE_TEMPLATE,
  DEPLOYMENTS_FROZEN_TEXT,
  POLICY_TIER_BUDGET_LEFT_TEMPLATE,
  POLICY_TIER_ENTERED_TEMPLATE,
  SloCurrentPolicyTier,
  SloDeploymentFreeze,
  getSloCurrentPolicyTier,
  getSloDeploymentFreeze,
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
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatSloPolicyTierThreshold } from "Common/Utils/Slo/SloErrorBudgetPolicy";
import { getSloPolicyTierColor } from "Common/Utils/Slo/SloStatusColor";
import React, { FunctionComponent, ReactElement } from "react";

export const SLO_POLICY_TIER_CARD_TEST_ID: string = "slo-overview-policy-tier";

export const SLO_DEPLOYMENTS_FROZEN_TEST_ID: string = `${SLO_POLICY_TIER_CARD_TEST_ID}-deployments-frozen`;

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
 * While the tier freezes deployments - the SLO's deploymentsAllowed is
 * false - a red "Deployments frozen since <time>" badge sits under the
 * tier's name, so nobody who opens the SLO has to ask CI why a release
 * waits. It reads the SLO's own answer, the one pipelines get, not the
 * tier's switch: a switch flipped a moment ago changes the answer on the
 * next evaluation, and the badge says what pipelines are told now.
 *
 * Drawn only while the SLO is in a tier: an SLO without a policy, or whose
 * budget is above every tier, shows nothing here - and is never frozen.
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
    translator,
  );

  const freeze: SloDeploymentFreeze | null = getSloDeploymentFreeze(props.slo);

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
                    <InlineSeparator markOnly />
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
            {freeze ? (
              <p
                data-testid={SLO_DEPLOYMENTS_FROZEN_TEST_ID}
                className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200"
              >
                <Icon
                  icon={IconProp.Lock}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                {freeze.frozenAt ? (
                  <time
                    dateTime={freeze.frozenAt.toISOString()}
                    title={OneUptimeDate.fromNow(freeze.frozenAt)}
                  >
                    {translator.translateTemplate(
                      DEPLOYMENTS_FROZEN_SINCE_TEMPLATE,
                      {
                        time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          freeze.frozenAt,
                        ),
                      },
                    )}
                  </time>
                ) : (
                  <span>
                    {translator.translateText(DEPLOYMENTS_FROZEN_TEXT)}
                  </span>
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
