import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface GettingStartedStep {
  title: string;
  description: string;
  linkText: string;
  page: PageMap;
  icon: IconProp;
}

/*
 * The three things that turn an empty project into a working SOC, in the
 * order they pay off: events to look at, rules that find threats in them,
 * and a playbook that responds when a case opens.
 */
export const SECURITY_GETTING_STARTED_STEPS: ReadonlyArray<GettingStartedStep> =
  [
    {
      title: translationKey("Bring in security events"),
      description: translationKey(
        "Connect Google SecOps, Microsoft Sentinel, CrowdStrike Falcon, Okta and more, or send events straight to OneUptime.",
      ),
      linkText: translationKey("Connect a source"),
      page: PageMap.SECURITY_EVENTS_CONNECTIONS,
      icon: IconProp.Link,
    },
    {
      title: translationKey("Turn on detections"),
      description: translationKey(
        "Add ready-made rules for brute force, impossible travel, suspicious PowerShell and more. Each match opens a case.",
      ),
      linkText: translationKey("Browse the rule library"),
      page: PageMap.SECURITY_EVENTS_RULE_LIBRARY,
      icon: IconProp.ShieldCheck,
    },
    {
      title: translationKey("Respond automatically"),
      description: translationKey(
        "Write a playbook that assigns new cases, checks threat intel, pages on-call or contains a host - with approval where it matters.",
      ),
      linkText: translationKey("Create a playbook"),
      page: PageMap.SECURITY_PLAYBOOKS,
      icon: IconProp.Bolt,
    },
  ];

const SecurityGettingStarted: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Icon icon={IconProp.ShieldCheck} className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {translator.translateText("Set up security operations")}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {translator.translateText(
              "Security Events collects your security signals, finds threats in them, groups what it finds into cases, and responds with playbooks. Three steps get it working.",
            )}
          </p>
        </div>
      </div>
      <ol className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        {SECURITY_GETTING_STARTED_STEPS.map(
          (step: GettingStartedStep, index: number): ReactElement => {
            return (
              <li
                key={step.page}
                className="flex flex-col rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <Icon icon={step.icon} className="h-4 w-4 text-gray-400" />
                  <span className="text-sm font-semibold text-gray-900">
                    {translator.translateText(step.title)}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm text-gray-600">
                  {translator.translateText(step.description)}
                </p>
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[step.page] as Route,
                  )}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
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
    </div>
  );
};

export default SecurityGettingStarted;
