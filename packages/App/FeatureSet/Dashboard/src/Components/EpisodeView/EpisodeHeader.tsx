import IconProp from "Common/Types/Icon/IconProp";
import User from "Common/Models/DatabaseModels/User";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import { EventStatusFact } from "../EventView/EventStatusPanel";
import RelativeTime from "./RelativeTime";

export type EpisodeMemberNoun = "incident" | "alert";

export interface EpisodeHeaderFactsInput {
  groupingRuleName?: string | undefined;
  createdByName?: string | undefined;
  lastMemberAddedAt?: Date | undefined;
  memberNoun: EpisodeMemberNoun;
}

/**
 * The context line under an episode header: how the episode was formed, who
 * opened it and when it last grew. Facts with no value are left out here
 * rather than rendered as "-", so a brand new episode does not show an empty
 * "Last incident added".
 */
export function getEpisodeHeaderFacts(
  input: EpisodeHeaderFactsInput,
): Array<EventStatusFact> {
  const facts: Array<EventStatusFact> = [
    {
      label: "Grouping",
      value: input.groupingRuleName || "Manual episode",
      icon: IconProp.Layers,
    },
    {
      label: "Created by",
      value: input.createdByName || "System",
      icon: IconProp.User,
    },
  ];

  if (input.lastMemberAddedAt) {
    facts.push({
      label: `Last ${input.memberNoun} added`,
      value: <RelativeTime date={input.lastMemberAddedAt} />,
      icon: IconProp.Clock,
    });
  }

  return facts;
}

type GetEpisodeCreatorNameFunction = (
  user: User | null | undefined,
) => string | undefined;

// The name the header shows for createdByUser; undefined means "System".
export const getEpisodeCreatorName: GetEpisodeCreatorNameFunction = (
  user: User | null | undefined,
): string | undefined => {
  if (!user) {
    return undefined;
  }

  return (
    user.name?.toString().trim() ||
    user.email?.toString().trim() ||
    "Unknown user"
  );
};

export interface EpisodeHeaderSkeletonProps {
  loadingText?: string | undefined;
}

/*
 * Holds the header's place while it loads, at the header's own size, so the
 * stat bar and cards below do not jump when it lands. It replaces the old
 * full-width PageLoader, whose 13rem top margin pushed the page down.
 */
export const EpisodeHeaderSkeleton: FunctionComponent<
  EpisodeHeaderSkeletonProps
> = (props: EpisodeHeaderSkeletonProps): ReactElement => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="episode-header-skeleton"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <span className="sr-only">{props.loadingText || "Loading episode"}</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="h-5 w-16 rounded-md bg-gray-100" />
              <div className="mt-2 h-6 w-3/4 max-w-md rounded bg-gray-200" />
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-28 rounded-md bg-gray-100" />
              <div className="h-9 w-24 rounded-md bg-gray-100" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <div className="h-5 w-20 rounded-full bg-gray-100" />
            <div className="h-5 w-16 rounded-full bg-gray-100" />
            <div className="h-5 w-28 rounded bg-gray-100" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-5">
            <div className="h-4 w-36 max-w-full rounded bg-gray-100" />
            <div className="h-4 w-28 max-w-full rounded bg-gray-100" />
          </div>
        </div>
        <div className="border-t border-gray-100 px-4 py-2.5 sm:px-5">
          <div className="h-3 w-2/3 max-w-sm rounded bg-gray-100" />
        </div>
      </div>
    </div>
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
 * A refresh that fails after the header has loaded keeps the last good data
 * on screen and says so inline, instead of swapping the whole header for an
 * error.
 */
export const EpisodeHeaderRefreshError: FunctionComponent<
  EpisodeHeaderRefreshErrorProps
> = (props: EpisodeHeaderRefreshErrorProps): ReactElement => {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100"
    >
      <span className="min-w-0 break-words">
        Couldn&apos;t refresh this episode: {props.message}
      </span>
      <button
        type="button"
        onClick={props.onRetry}
        className="font-medium underline underline-offset-2 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-sm"
      >
        Try again
      </button>
    </div>
  );
};
