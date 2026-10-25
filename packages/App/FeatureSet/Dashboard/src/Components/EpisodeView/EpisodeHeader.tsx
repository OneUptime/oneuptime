import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { EventStatusFact } from "../EventView/EventStatusPanel";
import RelativeTime from "./RelativeTime";
import EventHeaderSkeleton from "../EventView/EventHeaderSkeleton";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

export type EpisodeMemberNoun = "incident" | "alert";

export interface EpisodeHeaderFactsInput {
  groupingRuleName?: string | undefined;
  lastMemberAddedAt?: Date | undefined;
  memberNoun: EpisodeMemberNoun;
}

/**
 * The context line under an episode header, after who runs it (the page's
 * people facts): how the episode was formed and when it last grew. Who
 * opened it is said under when, in the stat bar's first tile. Facts with no
 * value are left out here rather than rendered as "-", so a brand new
 * episode does not show an empty "Last incident added". The panel looks the
 * labels up; the values that are our own words are given in the reader's
 * language here.
 */
export function getEpisodeHeaderFacts(
  input: EpisodeHeaderFactsInput,
  translator: Translator = getGlobalTranslator(),
): Array<EventStatusFact> {
  const facts: Array<EventStatusFact> = [
    {
      label: "Grouping",
      value:
        input.groupingRuleName ||
        (translator.translateText("Manual episode") as string),
      icon: IconProp.Layers,
    },
  ];

  if (input.lastMemberAddedAt) {
    facts.push({
      label:
        input.memberNoun === "alert"
          ? "Last alert added"
          : "Last incident added",
      value: <RelativeTime date={input.lastMemberAddedAt} />,
      icon: IconProp.Clock,
    });
  }

  return facts;
}

export interface EpisodeHeaderSkeletonProps {
  loadingText?: string | undefined;
}

/*
 * Holds the header's place while it loads, drawn as the loaded header is
 * (EventHeaderSkeleton), so the stat bar and cards below do not jump when it
 * lands. It replaces the old full-width PageLoader, whose 13rem top margin
 * pushed the page down.
 */
export const EpisodeHeaderSkeleton: FunctionComponent<
  EpisodeHeaderSkeletonProps
> = (props: EpisodeHeaderSkeletonProps): ReactElement => {
  return (
    <EventHeaderSkeleton
      testId="episode-header-skeleton"
      loadingText={props.loadingText || "Loading episode"}
      buttonCount={2}
      factCount={5}
    />
  );
};

export interface EpisodeHeaderErrorProps {
  message: string;
  onRetry: () => void;
}

// A failed first load keeps the header's card so the page layout holds.
export const EpisodeHeaderError: FunctionComponent<EpisodeHeaderErrorProps> = (
  props: EpisodeHeaderErrorProps,
): ReactElement => {
  return (
    <div
      data-testid="episode-header-error"
      className="rounded-xl border border-gray-200 bg-white px-4 shadow-sm sm:px-5"
    >
      <ErrorMessage message={props.message} onRefreshClick={props.onRetry} />
    </div>
  );
};

export interface EpisodeHeaderRefreshErrorProps {
  message: string;
  onRetry: () => void;
}

/*
 * Try again, as the header's bands draw their own controls (the AI band's
 * Show more): a soft button in the band's colour, its words whole.
 */
export const EPISODE_HEADER_RETRY_CLASS_NAME: string =
  "-my-1 -ms-1.5 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 font-medium text-red-700 transition-colors hover:bg-red-100 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2";

/*
 * A refresh that fails after the header has loaded keeps the last good data
 * on screen and says so inline, instead of swapping the whole header for an
 * error. It is the words of the header's red band (EventStatusPanel's
 * "danger" notice), which paints the band itself: no box of its own. Laid
 * out as the other bands are - a mark on a tile of the band's colour, then
 * what happened, then what to do - so the three read as one header's.
 */
export const EpisodeHeaderRefreshError: FunctionComponent<
  EpisodeHeaderRefreshErrorProps
> = (props: EpisodeHeaderRefreshErrorProps): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div
      role="alert"
      data-testid="episode-header-refresh-error"
      className="flex items-start gap-2.5"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-red-100 text-red-700"
      >
        <Icon icon={IconProp.Alert} className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pt-0.5 text-sm">
        <span className="min-w-0 break-words font-medium text-red-800">
          {translator.translateTemplate(
            "Couldn't refresh this episode: {{message}}",
            { message: props.message },
          )}
        </span>
        <button
          type="button"
          onClick={props.onRetry}
          className={EPISODE_HEADER_RETRY_CLASS_NAME}
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          {translator.translateText("Try again")}
        </button>
      </div>
    </div>
  );
};
