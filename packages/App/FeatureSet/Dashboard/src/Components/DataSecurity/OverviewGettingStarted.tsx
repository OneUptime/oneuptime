import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the Overview shows while Data Security has found nothing yet: three
 * steps, each with the page it is done on. Data Security reads what a
 * cloud connection lets it read, so the first two steps are a connection
 * and its Data security setting (Off, Configuration only, or Configuration
 * and content samples); the third is where the results land. A database
 * the team runs itself is added by hand instead, on Data Stores.
 */

export interface OverviewGettingStartedStep {
  key: string;
  title: string;
  description: string;
  linkText: string;
  page: PageMap;
  isDone: boolean;
}

export function getOverviewGettingStartedSteps(data: {
  hasCloudConnection: boolean;
  hasStores: boolean;
}): Array<OverviewGettingStartedStep> {
  return [
    {
      key: "connect",
      title: "Connect a cloud account",
      description:
        "Connect AWS, Azure or Google Cloud with read-only access. It takes a few minutes and one command in your cloud's terminal.",
      linkText: "Connect a cloud",
      page: PageMap.CLOUD_CONNECT,
      isDone: data.hasCloudConnection,
    },
    {
      key: "turn-on",
      title: "Turn on Data Security for it",
      description:
        "In the connection's settings, set Data security to Configuration only, or to Configuration and content samples to also find sensitive data inside your buckets and databases. Run the command it shows to grant that access.",
      linkText: "Open cloud connections",
      page: PageMap.CLOUD_CONNECT,
      isDone: data.hasStores,
    },
    {
      key: "review",
      title: "Review what to fix first",
      description:
        "OneUptime lists every bucket and database it finds, the sensitive data in each, who can reach it, and the issues to fix, riskiest first.",
      linkText: "See issues",
      page: PageMap.DATA_SECURITY_ISSUES,
      isDone: false,
    },
  ];
}

export interface ComponentProps {
  hasCloudConnection: boolean;
}

export const OVERVIEW_GETTING_STARTED_TEST_ID: string =
  "data-security-getting-started";

const OverviewGettingStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Array<OverviewGettingStartedStep> =
    getOverviewGettingStartedSteps({
      hasCloudConnection: props.hasCloudConnection,
      hasStores: false,
    });

  const route: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  return (
    <section
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      data-testid={OVERVIEW_GETTING_STARTED_TEST_ID}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <Icon icon={IconProp.ShieldCheck} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900">
            {translator.translateText("Find your sensitive data")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            {translator.translateText(
              "Data Security finds where sensitive data lives in your clouds, databases and telemetry, who can reach it, and what to fix first. Three steps get you there.",
            )}
          </p>
        </div>
      </div>

      <ol className="mt-5 divide-y divide-gray-100">
        {steps.map(
          (step: OverviewGettingStartedStep, index: number): ReactElement => {
            return (
              <li
                key={step.key}
                data-testid={`data-security-setup-step-${step.key}`}
                data-done={step.isDone ? "true" : "false"}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div
                    className={
                      step.isDone
                        ? "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white"
                        : "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs font-semibold text-gray-500"
                    }
                    aria-hidden="true"
                  >
                    {step.isDone ? (
                      <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                    ) : (
                      <>{translator.formatNumber(index + 1)}</>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={
                        step.isDone
                          ? "text-sm font-medium text-gray-500"
                          : "text-sm font-medium text-gray-900"
                      }
                    >
                      {translator.translateText(step.title)}
                      <span className="sr-only">
                        {" "}
                        {step.isDone
                          ? translator.translateText("(done)")
                          : translator.translateText("(to do)")}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {translator.translateText(step.description)}
                    </p>
                  </div>
                </div>
                <AppLink
                  to={route(step.page)}
                  className="ml-9 inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 sm:ml-0"
                >
                  <>
                    <span>{translator.translateText(step.linkText)}</span>
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-3.5 w-3.5"
                    />
                  </>
                </AppLink>
              </li>
            );
          },
        )}
      </ol>

      <p className="mt-4 border-t border-gray-100 pt-4 text-sm text-gray-600">
        <TranslatedSentence
          template="Run a database yourself? {{addLink}}. New to Data Security? {{guideLink}}."
          slots={{
            addLink: (
              <AppLink
                to={route(PageMap.DATA_SECURITY_STORES)}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                <span>{translator.translateText("Add it on Data Stores")}</span>
              </AppLink>
            ),
            guideLink: (
              <AppLink
                to={route(PageMap.DATA_SECURITY_DOCUMENTATION)}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                <span>{translator.translateText("Read the setup guide")}</span>
              </AppLink>
            ),
          }}
        />
      </p>
    </section>
  );
};

export default OverviewGettingStarted;
