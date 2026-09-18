import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewActionLink from "./SloOverviewActionLink";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import { SLO_EVALUATION_CADENCE_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  sloId: ObjectID;
  enabledBurnRateRuleCount: number;
}

interface StepOption {
  key: string;
  icon: IconProp;
  title: string;
  description: string;
  action: ReactElement;
}

/*
 * What a brand-new SLO shows instead of a wall of "not evaluated" tiles.
 *
 * The create form no longer asks for monitors — they come from the Monitors
 * and Monitor Rules pages — so EVERY new SLO lands here with nothing to
 * measure. Four dashes, an empty chart and an empty monitors card would
 * describe that state accurately and help no one; this names the one thing
 * to do next, offers both ways to do it side by side, and says what happens
 * after.
 */
const SloOverviewGettingStartedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitorsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
    { modelId: props.sloId },
  );

  const monitorRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_MONITOR_RULES] as Route,
    { modelId: props.sloId },
  );

  const burnRateRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_BURN_RATE_RULES] as Route,
    { modelId: props.sloId },
  );

  const monitorOptions: Array<StepOption> = [
    {
      key: "rule",
      icon: IconProp.Filter,
      title: "Match monitors with a rule",
      description:
        "Attach every monitor whose name, description or labels match — and keep monitors created later in sync automatically.",
      action: (
        <SloOverviewActionLink
          variant="primary"
          title="Create a monitor rule"
          icon={IconProp.Filter}
          to={monitorRulesRoute}
        />
      ),
    },
    {
      key: "manual",
      icon: IconProp.AltGlobe,
      title: "Pick monitors by hand",
      description:
        "Choose the exact monitors this SLO measures. Best for a small, fixed set.",
      action: (
        <SloOverviewActionLink
          variant="secondary"
          title="Add monitors"
          icon={IconProp.Add}
          to={monitorsRoute}
        />
      ),
    },
  ];

  const burnRuleText: string =
    props.enabledBurnRateRuleCount > 0
      ? `${props.enabledBurnRateRuleCount} burn rate rule${
          props.enabledBurnRateRuleCount === 1 ? " is" : "s are"
        } ready to alert when the budget burns too fast. Adjust thresholds, severities and who gets paged.`
      : "No burn rate rule is enabled yet, so nothing will alert when the budget burns too fast.";

  return (
    <section
      aria-labelledby="slo-getting-started-title"
      data-testid="slo-overview-getting-started"
      className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex items-start gap-3 px-5 pt-6 md:px-6">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200">
          <Icon icon={IconProp.RocketLaunch} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2
            id="slo-getting-started-title"
            className="text-lg font-semibold text-gray-900"
          >
            Choose what this SLO measures
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            An SLO tracks uptime across its monitors. It has none yet, so there
            are no numbers to show.
          </p>
        </div>
      </div>

      <ol className="mt-5 space-y-6 px-5 pb-6 md:px-6">
        <li className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
          >
            1
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              Attach monitors
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {monitorOptions.map((option: StepOption) => {
                return (
                  <div
                    key={option.key}
                    data-testid={`slo-getting-started-option-${option.key}`}
                    className="flex flex-col rounded-lg border border-gray-200 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        icon={option.icon}
                        className="h-4 w-4 flex-shrink-0 text-gray-500"
                      />
                      <p className="text-sm font-medium text-gray-900">
                        {option.title}
                      </p>
                    </div>
                    <p className="mt-1 flex-1 text-sm text-gray-500">
                      {option.description}
                    </p>
                    <div className="mt-3">{option.action}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-50 text-sm font-semibold text-gray-600 ring-1 ring-inset ring-gray-200"
          >
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              Check who gets alerted
            </p>
            <p className="mt-1 text-sm text-gray-500">{burnRuleText}</p>
            <div className="mt-2">
              <SloOverviewActionLink
                title="Review burn rate rules"
                icon={IconProp.Fire}
                to={burnRateRulesRoute}
              />
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-50 text-sm font-semibold text-gray-600 ring-1 ring-inset ring-gray-200"
          >
            3
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              Watch the numbers arrive
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {`OneUptime evaluates SLOs every ${SLO_EVALUATION_CADENCE_MINUTES} minutes. The SLI, error budget and burn-down appear on this page after the first evaluation.`}
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
};

export default SloOverviewGettingStartedCard;
