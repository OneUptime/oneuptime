import React, { FunctionComponent, ReactElement, useState } from "react";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  UserFlowSessionJourney,
  UserFlowVisit,
} from "Common/Utils/Rum/UserFlow";
import { formatSessionDuration } from "../SessionReplay/SessionReplayPlayability";
import UserFlowWatchLink from "./UserFlowWatchLink";
import {
  describeUserFlowSessionOwner,
  getUserFlowRecordingState,
  summarizeUserFlowJourney,
  UserFlowRecordingState,
} from "./UserFlowPerson";

/*
 * One person's sessions, newest first, each read page by page: where they
 * landed, the order they went in, what they came back to, where something
 * went wrong and where they left. The answer to "what did this person do",
 * without watching every recording to find out.
 *
 * The newest session starts open: it is usually the one being asked about,
 * and a person with one session should not have to open it. Rows are folded
 * to one line otherwise, so someone with fifty sessions can be scanned.
 */

/* Sessions drawn at a time. A browser left on a kiosk can hold thousands. */
export const USER_FLOW_JOURNEYS_PAGE_SIZE: number = 20;

export interface ComponentProps {
  journeys: Array<UserFlowSessionJourney>;
  rumApplicationId: ObjectID;
  /*
   * Name the person on each row: one browser can have been several people,
   * so a list narrowed to it says whose each session was.
   */
  showsOwner: boolean;
  /* Read once per render, so every row agrees on "now". */
  nowUnixMs?: number | undefined;
}

function deviceLine(journey: UserFlowSessionJourney): string {
  return [journey.browserName, journey.deviceType, journey.countryCode]
    .filter(Boolean)
    .join(" · ");
}

const VisitRow: FunctionComponent<{
  visit: UserFlowVisit;
  position: number;
  isLive: boolean;
}> = (props: {
  visit: UserFlowVisit;
  position: number;
  isLive: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const visit: UserFlowVisit = props.visit;
  const isRepeat: boolean = visit.visit > 1;

  return (
    <li
      className="relative py-1 pl-6"
      data-testid="user-flow-visit"
      data-page={visit.page}
      data-visit={visit.visit}
      data-visits={visit.visitsInSession}
      data-landing={visit.isLanding}
      data-exit={visit.isExit}
    >
      <span
        className={`absolute -left-3 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-semibold ring-1 ${
          visit.errorCount > 0
            ? "text-rose-700 ring-rose-300"
            : isRepeat
              ? "text-amber-700 ring-amber-300"
              : visit.isLanding
                ? "text-indigo-700 ring-indigo-300"
                : "text-gray-500 ring-gray-300"
        }`}
        aria-hidden="true"
      >
        {props.position}
      </span>
      <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="break-all font-mono text-sm text-gray-900"
          title={visit.url}
        >
          {visit.page}
        </span>
        {visit.isLanding ? (
          <StatusBadge text="Landing page" type={StatusBadgeType.Info} />
        ) : (
          <></>
        )}
        {visit.isExit ? (
          <StatusBadge
            text={props.isLive ? "Last page so far" : "Exit page"}
            type={StatusBadgeType.Neutral}
          />
        ) : (
          <></>
        )}
        {isRepeat ? (
          <StatusBadge
            text={translator.translateTemplate(
              "Visit {{visit}} of {{visits}}",
              {
                visit: visit.visit,
                visits: visit.visitsInSession,
              },
            )}
            type={StatusBadgeType.Warning}
          />
        ) : (
          <></>
        )}
        {/*
         * On this page, in those words: a signal is known per page, so on a
         * page visited twice neither visit can claim it alone.
         */}
        {visit.errorCount > 0 ? (
          <StatusBadge
            text={translator.translatePlural(
              {
                one: "{{count}} error on this page",
                other: "{{count}} errors on this page",
              },
              visit.errorCount,
            )}
            type={StatusBadgeType.Danger}
          />
        ) : (
          <></>
        )}
        {visit.frustrationCount > 0 ? (
          <StatusBadge
            text={translator.translatePlural(
              {
                one: "{{count}} frustration signal on this page",
                other: "{{count}} frustration signals on this page",
              },
              visit.frustrationCount,
            )}
            type={StatusBadgeType.Warning}
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

const JourneyRow: FunctionComponent<{
  journey: UserFlowSessionJourney;
  isOpen: boolean;
  onToggle: () => void;
  rumApplicationId: ObjectID;
  showsOwner: boolean;
  nowUnixMs: number;
}> = (props: {
  journey: UserFlowSessionJourney;
  isOpen: boolean;
  onToggle: () => void;
  rumApplicationId: ObjectID;
  showsOwner: boolean;
  nowUnixMs: number;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const journey: UserFlowSessionJourney = props.journey;
  const recording: UserFlowRecordingState = getUserFlowRecordingState(
    journey.detail,
    props.nowUnixMs,
  );

  const lastVisitIndex: number = journey.visits.length - 1;

  const facts: Array<string> = [
    props.showsOwner && journey.detail
      ? describeUserFlowSessionOwner(journey.detail).text
      : "",
    journey.durationMs > 0 ? formatSessionDuration(journey.durationMs) : "",
    translator.translatePlural(
      { one: "{{count}} page", other: "{{count}} pages" },
      journey.visits.length,
    ),
    deviceLine(journey),
  ].filter(Boolean);

  return (
    <li data-testid="user-flow-journey" data-session-id={journey.sessionId}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          className="flex min-w-[12rem] flex-1 items-start gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-expanded={props.isOpen}
          data-testid="user-flow-journey-toggle"
          onClick={props.onToggle}
        >
          <Icon
            icon={props.isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">
              {OneUptimeDate.getDateAsLocalFormattedString(
                new Date(journey.startUnixMs),
              )}
            </span>
            <span className="block text-xs text-gray-500">
              {facts.join(" · ")}
            </span>
            {props.isOpen ? (
              <></>
            ) : (
              <span
                className="mt-1 block truncate font-mono text-xs text-gray-600"
                data-testid="user-flow-journey-summary"
              >
                {summarizeUserFlowJourney(journey)}
              </span>
            )}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {recording.isLive ? (
            <StatusBadge text="Recording now" type={StatusBadgeType.Info} />
          ) : (
            <></>
          )}
          {journey.errorCount > 0 ? (
            <StatusBadge
              text={translator.translatePlural(
                { one: "{{count}} error", other: "{{count}} errors" },
                journey.errorCount,
              )}
              type={StatusBadgeType.Danger}
            />
          ) : (
            <></>
          )}
          {journey.frustrationCount > 0 ? (
            <StatusBadge
              text={translator.translatePlural(
                {
                  one: "{{count}} frustration signal",
                  other: "{{count}} frustration signals",
                },
                journey.frustrationCount,
              )}
              type={StatusBadgeType.Warning}
            />
          ) : (
            <></>
          )}
          {journey.repeatVisits > 0 ? (
            <StatusBadge
              text={translator.translatePlural(
                {
                  one: "{{count}} repeat visit",
                  other: "{{count}} repeat visits",
                },
                journey.repeatVisits,
              )}
              type={StatusBadgeType.Warning}
            />
          ) : (
            <></>
          )}
          {recording.isWatchable ? (
            <UserFlowWatchLink
              sessionId={journey.sessionId}
              rumApplicationId={props.rumApplicationId}
            />
          ) : (
            <span
              className="whitespace-nowrap text-xs text-gray-400"
              title={recording.reason}
              data-testid="user-flow-no-replay"
            >
              {translator.translateText("No replay")}
            </span>
          )}
        </div>
      </div>

      {props.isOpen ? (
        <ol
          className="mb-3 ml-[1.625rem] border-l border-gray-200"
          data-testid="user-flow-visits"
        >
          {journey.visits.map(
            (visit: UserFlowVisit, index: number): ReactElement => {
              const isCutHere: boolean =
                journey.isCut && index === lastVisitIndex;

              return (
                <React.Fragment key={`${index}-${visit.page}`}>
                  {isCutHere ? (
                    <li
                      className="py-1 pl-6 text-xs text-gray-500"
                      data-testid="user-flow-journey-cut"
                    >
                      {translator.translateText(
                        "This session visited more pages than can be shown.",
                      )}
                    </li>
                  ) : (
                    <></>
                  )}
                  <VisitRow
                    visit={visit}
                    position={index + 1}
                    isLive={recording.isLive}
                  />
                </React.Fragment>
              );
            },
          )}
        </ol>
      ) : (
        <></>
      )}
    </li>
  );
};

const UserFlowJourneyList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [shownCount, setShownCount] = useState<number>(
    USER_FLOW_JOURNEYS_PAGE_SIZE,
  );
  /* Rows toggled away from how they start, so a filter change starts clean. */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );

  const nowUnixMs: number = props.nowUnixMs ?? Date.now();
  const firstSessionId: string | undefined = props.journeys[0]?.sessionId;
  const shown: Array<UserFlowSessionJourney> = props.journeys.slice(
    0,
    shownCount,
  );
  const hiddenCount: number = props.journeys.length - shown.length;

  return (
    <div data-testid="user-flow-journeys">
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {shown.map((journey: UserFlowSessionJourney): ReactElement => {
          const startsOpen: boolean = journey.sessionId === firstSessionId;

          return (
            <JourneyRow
              key={journey.sessionId}
              journey={journey}
              isOpen={startsOpen !== toggled.has(journey.sessionId)}
              rumApplicationId={props.rumApplicationId}
              showsOwner={props.showsOwner}
              nowUnixMs={nowUnixMs}
              onToggle={(): void => {
                setToggled((current: ReadonlySet<string>): Set<string> => {
                  const next: Set<string> = new Set<string>(current);

                  if (!next.delete(journey.sessionId)) {
                    next.add(journey.sessionId);
                  }

                  return next;
                });
              }}
            />
          );
        })}
      </ul>

      {hiddenCount > 0 ? (
        <div className="mt-3 flex items-center gap-3">
          <Button
            title={translator.translateTemplate("Show {{count}} more", {
              count: Math.min(hiddenCount, USER_FLOW_JOURNEYS_PAGE_SIZE),
            })}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="user-flow-journeys-more"
            onClick={(): void => {
              setShownCount((count: number): number => {
                return count + USER_FLOW_JOURNEYS_PAGE_SIZE;
              });
            }}
          />
          <span className="text-xs text-gray-500">
            {translator.translateTemplate(
              "Showing {{shown}} of {{total}} sessions",
              { shown: shown.length, total: props.journeys.length },
            )}
          </span>
        </div>
      ) : (
        <></>
      )}

      <p className="mt-3 text-xs text-gray-500">
        {translator.translateText(
          "Pages are listed in the order they were visited, from the session's recording. A reload or a long stay on one page counts as one visit, and recordings from an older recorder can miss a quick return to a page.",
        )}
      </p>
    </div>
  );
};

export default UserFlowJourneyList;
