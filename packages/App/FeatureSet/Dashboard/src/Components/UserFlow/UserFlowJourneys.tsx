import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  buildUserFlowJourneySteps,
  getUserFlowPageText,
  UserFlowJourney,
  UserFlowJourneySteps,
  UserFlowJourneyStep,
} from "Common/Utils/Rum/UserFlow";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { formatInline, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import { RUM_USER_FLOW_METRIC_DESCRIPTIONS } from "../MetricDescriptions/RumMetricDescriptions";
import { buildReplayLinkRoute } from "../SessionReplay/ReplayLinkRoute";
import {
  formatUserFlowCount,
  formatUserFlowDuration,
  getUserFlowPathLineDirection,
} from "./UserFlowFormat";

/*
 * What the map cannot show about one person: each of their sessions on a line
 * of its own, page by page, from where it landed to where it left. A return to
 * a page already seen and a page with a problem are marked where they
 * happened, and a session with footage links to it.
 *
 * The page puts the list under the map, which it reads with, and above the
 * tables (UserFlowPageSections.ts). Rows are drawn a page at a time: a person
 * is usually a handful of sessions, but a shared browser or a kiosk can be
 * thousands, and the tables sit under this list.
 */

export const USER_FLOW_JOURNEYS_PAGE_SIZE: number = 10;

export interface ComponentProps {
  journeys: Array<UserFlowJourney>;
  rumApplicationId: ObjectID;
}

function stepTitle(step: UserFlowJourneyStep, translator: Translator): string {
  const notes: Array<string | undefined> = [
    step.isLanding ? translator.translateText("Landed here") : undefined,
    step.isExit
      ? translator.translateText("Left the application here")
      : undefined,
    step.visit > 1
      ? translator.translateTemplate("Visit {{visit}} to this page", {
          visit: step.visit,
        })
      : undefined,
    step.hadError
      ? translator.translateText("Hit an error on this page")
      : undefined,
    step.hadFrustration
      ? translator.translateText("Frustration signal on this page")
      : undefined,
  ];

  return [
    getUserFlowPageText(step.page),
    ...notes.filter((note: string | undefined): note is string => {
      return Boolean(note);
    }),
  ].join("\n");
}

const MARKER_CLASS: string =
  "text-[10px] font-semibold uppercase tracking-wide text-gray-500";

function Step(props: {
  step: UserFlowJourneyStep;
  isFirst: boolean;
}): ReactElement {
  const translator: Translator = useTranslator();
  const step: UserFlowJourneyStep = props.step;
  const isReturn: boolean = step.visit > 1;

  return (
    <li
      className="flex min-w-0 items-center gap-1"
      data-testid="user-flow-journey-step"
      data-page={step.page}
      data-visit={step.visit}
      data-landing={step.isLanding}
      data-exit={step.isExit}
      data-error={step.hadError}
      data-frustration={step.hadFrustration}
    >
      {props.isFirst ? (
        <></>
      ) : (
        <Icon
          icon={IconProp.ChevronRight}
          className="h-3 w-3 flex-none text-gray-400"
        />
      )}
      {step.isLanding ? (
        <span className={MARKER_CLASS}>
          {translator.translateText("Landing page")}
        </span>
      ) : (
        <></>
      )}
      <span
        className={`inline-flex min-w-0 max-w-[16rem] items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs ${
          isReturn ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-800"
        }`}
        title={stepTitle(step, translator)}
      >
        {isReturn ? (
          <Icon icon={IconProp.ArrowUturnLeft} className="h-3 w-3 flex-none" />
        ) : (
          <></>
        )}
        {/*
         * A path reads from the left on any page: "/home", not "home/", and
         * "/الرئيسية", not "الرئيسية/".
         */}
        <span
          className="truncate"
          dir={getUserFlowPathLineDirection(step.page, translator.language)}
        >
          {getUserFlowPageText(step.page)}
        </span>
        {step.hadError ? (
          <span
            className="h-1.5 w-1.5 flex-none rounded-full bg-rose-500"
            data-testid="user-flow-journey-step-error"
          />
        ) : (
          <></>
        )}
        {step.hadFrustration ? (
          <span
            className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500"
            data-testid="user-flow-journey-step-frustration"
          />
        ) : (
          <></>
        )}
      </span>
      {step.isExit ? (
        <span className={MARKER_CLASS}>
          {translator.translateText("Exit page")}
        </span>
      ) : (
        <></>
      )}
    </li>
  );
}

function Journey(props: {
  journey: UserFlowJourney;
  rumApplicationId: ObjectID;
}): ReactElement {
  const translator: Translator = useTranslator();
  const journey: UserFlowJourney = props.journey;
  const { steps, revisits }: UserFlowJourneySteps =
    buildUserFlowJourneySteps(journey);
  const replayRoute: Route | null = buildReplayLinkRoute({
    rumApplicationId: props.rumApplicationId,
    sessionId: journey.sessionId,
  });
  const facts: Array<string> = [
    formatUserFlowDuration(journey.durationMs),
    journey.browserName,
    journey.deviceType,
    journey.countryCode,
  ].filter((fact: string): boolean => {
    return Boolean(fact);
  });

  return (
    <li
      className="px-4 py-3"
      data-testid="user-flow-journey"
      data-session-id={journey.sessionId}
      data-path={journey.pages.join(" > ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="text-sm font-medium text-gray-900"
            data-testid="user-flow-journey-start"
          >
            {OneUptimeDate.getDateAsLocalFormattedString(
              new Date(journey.startUnixMs),
            )}
          </span>
          <span
            className="text-xs text-gray-500"
            data-testid="user-flow-journey-facts"
          >
            {formatInline(facts, translator)}
          </span>
          {journey.errorCount > 0 ? (
            <span
              className="text-xs font-medium text-rose-700"
              data-testid="user-flow-journey-errors"
            >
              {translator.translatePlural(
                { one: "{{count}} error", other: "{{count}} errors" },
                journey.errorCount,
              )}
            </span>
          ) : (
            <></>
          )}
          {journey.frustrationCount > 0 ? (
            <span
              className="text-xs font-medium text-amber-700"
              data-testid="user-flow-journey-frustration"
            >
              {translator.translatePlural(
                {
                  one: "{{count}} frustration signal",
                  other: "{{count}} frustration signals",
                },
                journey.frustrationCount,
              )}
            </span>
          ) : (
            <></>
          )}
        </div>
        {journey.hasRecording === false ? (
          <span
            className="text-xs text-gray-400"
            data-testid="user-flow-journey-no-recording"
          >
            {translator.translateText("No recording")}
          </span>
        ) : replayRoute ? (
          <AppLink
            to={replayRoute}
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-700 hover:underline"
            dataTestId="user-flow-journey-watch"
          >
            <Icon icon={IconProp.Play} className="h-3 w-3" />
            <span>{translator.translateText("Watch")}</span>
          </AppLink>
        ) : (
          <></>
        )}
      </div>

      <ol
        className="mt-2 flex flex-wrap items-center gap-y-1.5"
        aria-label={translator.translateText("Pages visited, in order")}
      >
        {steps.map((step: UserFlowJourneyStep, index: number): ReactElement => {
          return (
            <Step
              key={`${index}-${step.page}`}
              step={step}
              isFirst={index === 0}
            />
          );
        })}
      </ol>

      {/*
       * Set apart as the reader's language does (formatInline): a middle dot
       * beside a Persian count read as its zero, so "۷ صفحه · ۱ بازگشت" said
       * ten returns.
       */}
      <p
        className="mt-1.5 text-xs text-gray-500"
        data-testid="user-flow-journey-summary"
      >
        {formatInline(
          [
            steps.length === 1 && !journey.isTruncated
              ? translator.translateText("Left without navigating") || ""
              : translator.translatePlural(
                  { one: "{{count}} page", other: "{{count}} pages" },
                  steps.length,
                ),
            revisits > 0
              ? translator.translatePlural(
                  {
                    one: "{{count}} return to an earlier page",
                    other: "{{count}} returns to an earlier page",
                  },
                  revisits,
                )
              : "",
            journey.isTruncated
              ? translator.translateText(
                  "the session went on past these pages",
                ) || ""
              : "",
          ].filter((part: string): boolean => {
            return Boolean(part);
          }),
          translator,
        )}
      </p>
    </li>
  );
}

const UserFlowJourneys: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [shown, setShown] = useState<number>(USER_FLOW_JOURNEYS_PAGE_SIZE);
  const total: number = props.journeys.length;

  /* A new set of journeys starts from the top again. */
  useEffect((): void => {
    setShown(USER_FLOW_JOURNEYS_PAGE_SIZE);
  }, [props.journeys]);

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white"
      data-testid="user-flow-journeys"
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Journeys")}
          </h3>
          <InfoTooltip
            label={translator.translateText("Journeys") as string}
            text={RUM_USER_FLOW_METRIC_DESCRIPTIONS.journeys}
            dataTestId="user-flow-journeys-info"
          />
        </div>
        <span
          className="flex-none text-xs text-gray-500"
          data-testid="user-flow-journeys-count"
        >
          {translator.translatePlural(
            { one: "{{count}} session", other: "{{count}} sessions" },
            total,
          )}
        </span>
      </div>

      {total === 0 ? (
        <p
          className="px-4 py-6 text-center text-sm text-gray-500"
          data-testid="user-flow-journeys-empty"
        >
          {translator.translateText(
            "No session matches the filters above. Show all sessions or all devices to see the rest.",
          )}
        </p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {props.journeys
            .slice(0, shown)
            .map((journey: UserFlowJourney): ReactElement => {
              return (
                <Journey
                  key={journey.sessionId}
                  journey={journey}
                  rumApplicationId={props.rumApplicationId}
                />
              );
            })}
        </ol>
      )}

      {shown < total ? (
        <div className="border-t border-gray-100 px-4 py-2 text-center">
          <button
            type="button"
            className="text-sm font-medium text-indigo-700 hover:underline"
            data-testid="user-flow-journeys-more"
            onClick={(): void => {
              setShown((current: number): number => {
                return current + USER_FLOW_JOURNEYS_PAGE_SIZE;
              });
            }}
          >
            {translator.translateTemplate("Show more ({{left}} left)", {
              left: formatUserFlowCount(total - shown, translator),
            })}
          </button>
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

export default UserFlowJourneys;
