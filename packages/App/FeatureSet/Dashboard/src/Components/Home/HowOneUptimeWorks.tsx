import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import UiAnalytics from "Common/UI/Utils/Analytics";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * OneUptime ships dozens of products, and a new user cannot tell which of them
 * they need or how they relate. This strip answers that in one line: the four
 * core products, in the order a problem flows through them. Everything else is
 * optional and lives in the Products menu, which the footnote says out loud.
 *
 * Strings are English literals looked up as flat keys in the locale files
 * (useTranslateValue), the same convention the rest of the dashboard uses.
 */

export interface HowItWorksStep {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  iconClassName: string;
  pageMap: PageMap;
}

export const HOW_IT_WORKS_TITLE: string = "How OneUptime works";

export const HOW_IT_WORKS_FOOTNOTE: string =
  "That is the core. Logs, metrics, traces, infrastructure and everything else are optional — find them under Products when you need them.";

export const HOW_IT_WORKS_STEPS: Array<HowItWorksStep> = [
  {
    key: "monitor",
    title: "Monitors",
    description: "Check your websites, APIs and servers around the clock.",
    icon: IconProp.AltGlobe,
    iconClassName: "bg-blue-50 text-blue-600 ring-blue-200",
    pageMap: PageMap.MONITORS,
  },
  {
    key: "incident",
    title: "Incidents & Alerts",
    description:
      "A failed check opens an incident when users are affected, or an alert for your team to look into.",
    icon: IconProp.Alert,
    iconClassName: "bg-rose-50 text-rose-600 ring-rose-200",
    pageMap: PageMap.INCIDENTS,
  },
  {
    key: "on-call",
    title: "On-Call Duty",
    description: "Pages the right person, and escalates if nobody answers.",
    icon: IconProp.Call,
    iconClassName: "bg-stone-100 text-stone-600 ring-stone-300",
    pageMap: PageMap.ON_CALL_DUTY,
  },
  {
    key: "status-page",
    title: "Status Pages",
    description: "Keep your customers informed while you fix it.",
    icon: IconProp.CheckCircle,
    iconClassName: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    pageMap: PageMap.STATUS_PAGES,
  },
];

export interface ComponentProps {
  projectId: string;
}

const HowOneUptimeWorks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid="how-oneuptime-works"
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {tx(HOW_IT_WORKS_TITLE)}
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {HOW_IT_WORKS_STEPS.map((step: HowItWorksStep, index: number) => {
          const openStep: () => void = (): void => {
            UiAnalytics.capture("dashboard/home/how-it-works-step", {
              projectId: props.projectId,
              step: step.key,
            });
            Navigation.navigate(
              RouteUtil.populateRouteParams(RouteMap[step.pageMap] as Route),
            );
          };

          return (
            <li key={step.key} className="flex min-w-0">
              <button
                type="button"
                onClick={openStep}
                data-testid={`how-it-works-step-${step.key}`}
                className="group flex w-full items-start gap-3 rounded-md p-2 text-left transition hover:bg-white hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${step.iconClassName}`}
                >
                  <Icon icon={step.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                    <span className="text-gray-400">{index + 1}.</span>
                    {tx(step.title)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                    {tx(step.description)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p
        className="mt-3 px-2 text-xs text-gray-500"
        data-testid="how-oneuptime-works-footnote"
      >
        {tx(HOW_IT_WORKS_FOOTNOTE)}
      </p>
    </div>
  );
};

export default HowOneUptimeWorks;
