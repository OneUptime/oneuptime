import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  SecurityPipelineStage,
  SecurityPipelineStageKey,
  SecuritySetupStatus,
  countSecuritySources,
  getSecurityPipelineStages,
} from "./SecuritySetupModel";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const SECURITY_PIPELINE_ID: string = "security-pipeline";

export interface ComponentProps {
  status: SecuritySetupStatus;
}

interface StageFigures {
  figure: string;
  detail: string;
}

/*
 * The figure under each stage, in words that agree with the number: how
 * many sources and what they sent today, how many rules are on, how many
 * cases are open, how many playbooks respond.
 */
export function getStageFigures(
  stage: SecurityPipelineStage,
  status: SecuritySetupStatus,
  translator: Translator,
): StageFigures {
  switch (stage.key) {
    case SecurityPipelineStageKey.Sources: {
      const sources: number = countSecuritySources(status);

      return {
        figure:
          sources > 0
            ? translator.translatePlural(
                { one: "{{count}} source", other: "{{count}} sources" },
                sources,
              )
            : translator.translateText("Not set up") || "",
        detail:
          status.eventsLast24Hours > 0
            ? translator.translatePlural(
                {
                  one: "{{count}} event in the last 24 hours",
                  other: "{{count}} events in the last 24 hours",
                },
                status.eventsLast24Hours,
              )
            : translator.translateText("No events in the last 24 hours") || "",
      };
    }
    case SecurityPipelineStageKey.Detections:
      return {
        figure:
          status.enabledRules > 0
            ? translator.translatePlural(
                { one: "{{count}} rule on", other: "{{count}} rules on" },
                status.enabledRules,
              )
            : translator.translateText("Not set up") || "",
        detail:
          status.recommendedRules > 0
            ? translator.translateTemplate(
                "{{on}} of {{total}} recommended rules on",
                {
                  on: status.recommendedRulesOn,
                  total: status.recommendedRules,
                },
              )
            : "",
      };
    case SecurityPipelineStageKey.Cases:
      return {
        figure:
          status.openCases > 0
            ? translator.translatePlural(
                { one: "{{count}} open case", other: "{{count}} open cases" },
                status.openCases,
              )
            : translator.translateText("None open") || "",
        detail:
          status.openCases > 0
            ? translator.translateText("Waiting for a person") || ""
            : translator.translateText("Nothing waiting") || "",
      };
    case SecurityPipelineStageKey.Playbooks:
      return {
        figure:
          status.enabledPlaybooks > 0
            ? translator.translatePlural(
                {
                  one: "{{count}} playbook on",
                  other: "{{count}} playbooks on",
                },
                status.enabledPlaybooks,
              )
            : translator.translateText("Not set up") || "",
        detail: translator.translateText("Respond to new cases") || "",
      };
  }
}

/*
 * The Overview's top strip: how Security works in this project, left to
 * right - where events come from, what finds threats in them, what needs a
 * person, what responds - each stage a link to its page, a stage not set up
 * marked so. A SIEM the events are copied to is named under it.
 */
const SecurityPipeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const stages: Array<SecurityPipelineStage> = getSecurityPipelineStages(
    props.status,
  );

  return (
    <nav
      id={SECURITY_PIPELINE_ID}
      data-testid={SECURITY_PIPELINE_ID}
      aria-label={translator.translateText("How Security works here")}
    >
      <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stages.map(
          (stage: SecurityPipelineStage, index: number): ReactElement => {
            const figures: StageFigures = getStageFigures(
              stage,
              props.status,
              translator,
            );
            return (
              <li
                key={stage.key}
                className="relative"
                data-testid={`security-pipeline-${stage.key}`}
                data-ready={stage.isReady ? "true" : "false"}
              >
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[stage.page] as Route,
                  )}
                  className={
                    !stage.isReady
                      ? "block h-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm transition-colors hover:border-indigo-300"
                      : stage.needsAttention
                        ? "block h-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm transition-colors hover:border-indigo-300"
                        : "block h-full rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-indigo-300"
                  }
                >
                  <>
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <Icon icon={stage.icon} className="h-4 w-4" />
                      <span>{translator.translateText(stage.title)}</span>
                    </div>
                    <div
                      className={
                        !stage.isReady
                          ? "mt-1 text-lg font-semibold text-amber-700"
                          : stage.needsAttention
                            ? "mt-1 text-lg font-semibold text-red-700"
                            : "mt-1 text-lg font-semibold text-gray-900"
                      }
                    >
                      {figures.figure}
                    </div>
                    {figures.detail ? (
                      <div className="mt-0.5 text-xs text-gray-500">
                        {figures.detail}
                      </div>
                    ) : (
                      <></>
                    )}
                  </>
                </AppLink>
                {index < stages.length - 1 ? (
                  <div
                    className="pointer-events-none absolute -right-3 top-1/2 z-10 max-md:hidden -translate-y-1/2 text-gray-400 md:block"
                    aria-hidden="true"
                  >
                    <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          },
        )}
      </ol>
      {props.status.destinations > 0 ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="security-pipeline-destinations"
        >
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
            )}
            className="hover:text-gray-700 hover:underline"
          >
            {translator.translatePlural(
              {
                one: "Security events are also sent to {{count}} SIEM.",
                other: "Security events are also sent to {{count}} SIEMs.",
              },
              props.status.destinations,
            )}
          </AppLink>
        </p>
      ) : (
        <></>
      )}
    </nav>
  );
};

export default SecurityPipeline;
