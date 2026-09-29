import {
  EventStateTimelineDate,
  getEventDurationText,
  getEventEndDateForCurrentState,
} from "../../Utils/EventDuration";

export interface EpisodeTimingState {
  id: string;
  name?: string | undefined;
  isAcknowledgedState?: boolean | undefined;
  isResolvedState?: boolean | undefined;
}

export interface EpisodeTimingInput {
  /*
   * When the episode started: declaredAt for an incident episode (falling
   * back to createdAt), createdAt for an alert episode. Never the first
   * state timeline entry, which can be written well after the episode opened.
   */
  startedAt?: Date | undefined;
  // The episode's own resolvedAt, used only when no timeline was loaded.
  resolvedAt?: Date | undefined;
  // The project's states, in state order.
  states: Array<EpisodeTimingState>;
  // The episode's state timeline, in any order.
  timelines: Array<EventStateTimelineDate>;
}

export interface EpisodeTiming {
  acknowledgedStateName: string; // e.g. "Acknowledged"
  resolvedStateName: string; // e.g. "Resolved"
  timeToAcknowledge: string; // e.g. "12 minutes", "Not yet acknowledged", "-"
  timeToResolve: string; // e.g. "2 hours, 5 minutes", "Not yet resolved", "-"
  durationStartsAt?: Date | undefined;
  // Set only while the episode's current state is the resolved state.
  durationEndsAt?: Date | undefined;
  isResolved: boolean;
}

type FindStateFunction = (
  states: Array<EpisodeTimingState>,
  predicate: (state: EpisodeTimingState) => boolean,
) => EpisodeTimingState | undefined;

const findState: FindStateFunction = (
  states: Array<EpisodeTimingState>,
  predicate: (state: EpisodeTimingState) => boolean,
): EpisodeTimingState | undefined => {
  return states.find((state: EpisodeTimingState) => {
    return Boolean(state.id) && predicate(state);
  });
};

type FirstEntryForStateFunction = (
  sortedTimelines: Array<EventStateTimelineDate>,
  stateId: string | undefined,
) => Date | undefined;

const getFirstEntryForState: FirstEntryForStateFunction = (
  sortedTimelines: Array<EventStateTimelineDate>,
  stateId: string | undefined,
): Date | undefined => {
  if (!stateId) {
    return undefined;
  }

  return sortedTimelines.find((timeline: EventStateTimelineDate) => {
    return timeline.stateId === stateId;
  })?.startsAt;
};

/**
 * The state the episode is in right now according to its timeline: the state
 * of the latest dated entry (a later entry in the list wins a tie, matching
 * getEventEndDateForCurrentState). Undefined when nothing is dated.
 */
export function getLatestTimelineStateId(
  timelines: Array<EventStateTimelineDate>,
): string | undefined {
  let latestTimeline: EventStateTimelineDate | undefined = undefined;

  for (const timeline of timelines) {
    if (!timeline.startsAt) {
      continue;
    }

    if (
      !latestTimeline?.startsAt ||
      timeline.startsAt.getTime() >= latestTimeline.startsAt.getTime()
    ) {
      latestTimeline = timeline;
    }
  }

  return latestTimeline?.stateId || undefined;
}

/**
 * The headline timings shown on both episode overview pages and in their
 * header, computed in one place so the stat bar and the header never
 * disagree. Time to acknowledge and time to resolve are measured from the
 * episode's start to the FIRST acknowledged / resolved entry, so reopening an
 * episode later does not rewrite how quickly it was first handled. The
 * duration ends at the latest entry only while the episode is still resolved.
 * That is why the header labels its duration "Lasted" rather than reusing the
 * stat bar's "Resolved in": for a reopened episode the two numbers differ.
 */
export function getEpisodeTiming(input: EpisodeTimingInput): EpisodeTiming {
  const acknowledgedState: EpisodeTimingState | undefined = findState(
    input.states,
    (state: EpisodeTimingState) => {
      return Boolean(state.isAcknowledgedState);
    },
  );

  const resolvedState: EpisodeTimingState | undefined = findState(
    input.states,
    (state: EpisodeTimingState) => {
      return Boolean(state.isResolvedState);
    },
  );

  const acknowledgedStateName: string =
    acknowledgedState?.name || "Acknowledged";
  const resolvedStateName: string = resolvedState?.name || "Resolved";

  // Sort a copy by start time; entries without a date cannot be placed.
  const sortedTimelines: Array<EventStateTimelineDate> = input.timelines
    .filter((timeline: EventStateTimelineDate) => {
      return Boolean(timeline.startsAt);
    })
    .sort((a: EventStateTimelineDate, b: EventStateTimelineDate) => {
      return a.startsAt!.getTime() - b.startsAt!.getTime();
    });

  const firstAcknowledgedAt: Date | undefined = getFirstEntryForState(
    sortedTimelines,
    acknowledgedState?.id,
  );

  const firstResolvedAt: Date | undefined = getFirstEntryForState(
    sortedTimelines,
    resolvedState?.id,
  );

  const startedAt: Date | undefined = input.startedAt;

  let timeToAcknowledge: string = "-";

  if (!firstAcknowledgedAt && !firstResolvedAt) {
    timeToAcknowledge = "Not yet " + acknowledgedStateName.toLowerCase();
  } else if (startedAt) {
    // An episode resolved straight away was acknowledged when it resolved.
    timeToAcknowledge = getEventDurationText(
      startedAt,
      (firstAcknowledgedAt || firstResolvedAt)!,
    );
  }

  let timeToResolve: string = "-";

  if (!firstResolvedAt) {
    timeToResolve = "Not yet " + resolvedStateName.toLowerCase();
  } else if (startedAt) {
    timeToResolve = getEventDurationText(startedAt, firstResolvedAt);
  }

  const durationEndsAt: Date | undefined =
    sortedTimelines.length > 0
      ? getEventEndDateForCurrentState(sortedTimelines, resolvedState?.id)
      : input.resolvedAt || undefined;

  return {
    acknowledgedStateName,
    resolvedStateName,
    timeToAcknowledge,
    timeToResolve,
    durationStartsAt: startedAt,
    durationEndsAt,
    isResolved: Boolean(durationEndsAt),
  };
}
