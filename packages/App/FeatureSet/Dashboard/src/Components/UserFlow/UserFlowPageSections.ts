import { UserFlowOptions } from "Common/Utils/Rum/UserFlow";
import { UserFlowScope } from "./UserFlowScope";

/*
 * What the User Flows page's body shows, and in what order.
 *
 * The page reads overview first, then detail, whoever it is drawn for: the
 * key numbers and the findings, then the map (with the panel a click on it
 * opens), then - narrowed to one person or one session - each of their
 * sessions page by page, then the tables. Narrowing changes which journeys
 * the page is drawn from and adds the list of them; it never moves the map,
 * so someone going from everyone to one person and back finds every part
 * where they left it. The list used to come first for a person, above the
 * map (issue #6192).
 *
 * The list sits under the map and above the tables. It is what someone
 * narrows to one person for, and over a handful of sessions the tables mostly
 * repeat it: Top paths is the same journeys, grouped.
 *
 * Plain TypeScript with no React and no Common/UI import, so node tests can
 * pin it.
 */

export type UserFlowPageSection = "overview" | "map" | "journeys" | "tables";

export function getUserFlowPageSections(
  scope: UserFlowScope | null,
): Array<UserFlowPageSection> {
  return scope
    ? ["overview", "map", "journeys", "tables"]
    : ["overview", "map", "tables"];
}

/*
 * The controls that drop whole sessions: Sessions, Device and hidden pages.
 * The others (where the map starts, how many steps and pages per step,
 * grouping ids) redraw the same sessions.
 */
export type UserFlowNarrowingFilters = Pick<
  UserFlowOptions,
  "sessionFilter" | "deviceType" | "hiddenPages"
>;

export function hasUserFlowNarrowingFilters(
  options: UserFlowNarrowingFilters,
): boolean {
  return (
    options.sessionFilter !== "all" ||
    Boolean(options.deviceType) ||
    options.hiddenPages.length > 0
  );
}

/* What "Clear filters" sets: every session in the read, every page shown. */
export function getClearedUserFlowFilters(): UserFlowNarrowingFilters {
  return { sessionFilter: "all", deviceType: "", hiddenPages: [] };
}

export type UserFlowPageState =
  /* The first read for this person (or everyone) is still running. */
  | "loading"
  /* The read failed, or answered for somebody else. */
  | "error"
  /* Nobody was recorded in the range. */
  | "empty"
  /* The person or session was not recorded in the range. */
  | "scope-empty"
  /* Sessions were read, but the Sessions, Device and hidden-page filters keep none. */
  | "filtered-out"
  | "ready";

export interface UserFlowPageStateInput {
  isLoading: boolean;
  /* The last read's error; empty when it did not fail. */
  error: string;
  scope: UserFlowScope | null;
  /* Sessions the last read answered with; null until one answers for this person. */
  sessionsRead: number | null;
  /* Of those, the journeys the page's own filters keep. */
  journeysKept: number;
  options: UserFlowNarrowingFilters;
}

export function getUserFlowPageState(
  input: UserFlowPageStateInput,
): UserFlowPageState {
  const hasAnswer: boolean = input.sessionsRead !== null;

  if (input.isLoading && !hasAnswer) {
    return "loading";
  }

  /*
   * A failed read is said even with an older answer still in hand: that
   * answer is for the range before, and the picker already shows the new one.
   */
  if (input.error) {
    return "error";
  }

  if (!hasAnswer) {
    return "empty";
  }

  if (input.sessionsRead === 0) {
    return input.scope ? "scope-empty" : "empty";
  }

  if (input.journeysKept > 0) {
    return "ready";
  }

  /*
   * Every session the server sends has a page, so nothing kept means a filter
   * dropped them all. Without one, there is nothing to draw and nothing to
   * clear: it reads as a range with no recordings.
   */
  if (hasUserFlowNarrowingFilters(input.options)) {
    return "filtered-out";
  }

  return input.scope ? "scope-empty" : "empty";
}
