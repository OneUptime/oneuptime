import { JSONObject } from "../JSON";

/*
 * WHAT THE SERVER KEEPS ABOUT A PROJECT'S WELCOME CHECKLIST (issue #6803),
 * in Project.welcomeChecklistState. The goals themselves are a column of
 * their own (Project.goals, ProjectGoal.ts), so later work reads them
 * without this.
 *
 * Kept on the server so every member and every device sees the same
 * checklist: it used to live in each browser's local storage, so it came
 * back after signing out, on another device and for every teammate.
 *
 * Written only by the server (WelcomeChecklistService). Read it with
 * parseWelcomeChecklistState, never as it is stored: a value written by a
 * newer or older version, or by hand, reads as what it safely can.
 */

// Why the checklist is finished.
export enum WelcomeChecklistFinishedBy {
  // Every step of the project's own is done.
  Outcomes = "outcomes",
  /*
   * The project finished the checklist before this one, which ticked a step
   * when a record existed (isLegacyChecklistComplete).
   */
  Legacy = "legacy",
  // A browser remembered the checklist before this one as finished.
  Browser = "browser",
}

export interface WelcomeChecklistState {
  /*
   * The project was created with this checklist, so it never had the one
   * before it and needs no legacy check (ProjectService sets it).
   */
  startedWithOutcomes?: boolean | undefined;
  // When the checklist before this one was looked at for a project that existed.
  legacyCheckedAt?: string | undefined;
  // When the goals were last chosen (or skipped), and by whom.
  goalsChosenAt?: string | undefined;
  goalsChosenByUserId?: string | undefined;
  // When the checklist finished for everyone, and why.
  finishedAt?: string | undefined;
  finishedBy?: WelcomeChecklistFinishedBy | undefined;
  // The members who hid it for themselves.
  hiddenForUserIds?: Array<string> | undefined;
}

/*
 * The most members one project keeps as having hidden the card. More is
 * a project of thousands; the oldest are let go, and see the card again.
 */
export const MAX_HIDDEN_FOR_USER_IDS: number = 1000;

const readString: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  return typeof value === "string" && value.length > 0 && value.length <= 100
    ? value
    : undefined;
};

const isFinishedBy: (value: unknown) => value is WelcomeChecklistFinishedBy = (
  value: unknown,
): value is WelcomeChecklistFinishedBy => {
  return (
    typeof value === "string" &&
    (Object.values(WelcomeChecklistFinishedBy) as Array<string>).includes(
      value,
    )
  );
};

// The state a stored value holds: what it says that makes sense, nothing else.
export const parseWelcomeChecklistState: (
  value: unknown,
) => WelcomeChecklistState = (value: unknown): WelcomeChecklistState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const state: WelcomeChecklistState = {};

  if (raw["startedWithOutcomes"] === true) {
    state.startedWithOutcomes = true;
  }

  const legacyCheckedAt: string | undefined = readString(
    raw["legacyCheckedAt"],
  );

  if (legacyCheckedAt) {
    state.legacyCheckedAt = legacyCheckedAt;
  }

  const goalsChosenAt: string | undefined = readString(raw["goalsChosenAt"]);

  if (goalsChosenAt) {
    state.goalsChosenAt = goalsChosenAt;
  }

  const goalsChosenByUserId: string | undefined = readString(
    raw["goalsChosenByUserId"],
  );

  if (goalsChosenByUserId) {
    state.goalsChosenByUserId = goalsChosenByUserId;
  }

  const finishedAt: string | undefined = readString(raw["finishedAt"]);

  if (finishedAt) {
    state.finishedAt = finishedAt;
    state.finishedBy = isFinishedBy(raw["finishedBy"])
      ? raw["finishedBy"]
      : WelcomeChecklistFinishedBy.Outcomes;
  }

  if (Array.isArray(raw["hiddenForUserIds"])) {
    const hidden: Array<string> = [];

    for (const item of raw["hiddenForUserIds"] as Array<unknown>) {
      const userId: string | undefined = readString(item);

      if (userId && !hidden.includes(userId.toLowerCase())) {
        hidden.push(userId.toLowerCase());
      }
    }

    if (hidden.length > 0) {
      state.hiddenForUserIds = hidden.slice(-MAX_HIDDEN_FOR_USER_IDS);
    }
  }

  return state;
};

// The state as the column stores it.
export const toWelcomeChecklistStateJSON: (
  state: WelcomeChecklistState,
) => JSONObject = (state: WelcomeChecklistState): JSONObject => {
  const json: JSONObject = {};

  for (const [key, value] of Object.entries(
    parseWelcomeChecklistState(state),
  )) {
    if (value !== undefined) {
      json[key] = value as string | boolean | Array<string>;
    }
  }

  return json;
};

// What a project created now starts with.
export const getNewProjectWelcomeChecklistState: () => WelcomeChecklistState =
  (): WelcomeChecklistState => {
    return { startedWithOutcomes: true };
  };

/*
 * Whether the server still has to look at the checklist before this one: a
 * project that existed before this checklist, not looked at yet. A stored
 * null is such a project.
 */
export const needsLegacyCheck: (state: WelcomeChecklistState) => boolean = (
  state: WelcomeChecklistState,
): boolean => {
  return !state.startedWithOutcomes && !state.legacyCheckedAt;
};

export const isWelcomeChecklistFinished: (
  state: WelcomeChecklistState,
) => boolean = (state: WelcomeChecklistState): boolean => {
  return Boolean(state.finishedAt);
};

export const isWelcomeChecklistHiddenFor: (
  state: WelcomeChecklistState,
  userId: string | null | undefined,
) => boolean = (
  state: WelcomeChecklistState,
  userId: string | null | undefined,
): boolean => {
  if (!userId) {
    return false;
  }

  return (state.hiddenForUserIds || []).includes(userId.toLowerCase());
};

// The state with the card hidden, or shown again, for one member.
export const withWelcomeChecklistHiddenFor: (
  state: WelcomeChecklistState,
  userId: string,
  isHidden: boolean,
) => WelcomeChecklistState = (
  state: WelcomeChecklistState,
  userId: string,
  isHidden: boolean,
): WelcomeChecklistState => {
  const id: string = userId.toLowerCase();
  const others: Array<string> = (state.hiddenForUserIds || []).filter(
    (hiddenFor: string): boolean => {
      return hiddenFor !== id;
    },
  );
  const hiddenForUserIds: Array<string> = isHidden ? [...others, id] : others;

  const next: WelcomeChecklistState = { ...state };

  if (hiddenForUserIds.length > 0) {
    next.hiddenForUserIds = hiddenForUserIds.slice(-MAX_HIDDEN_FOR_USER_IDS);
  } else {
    delete next.hiddenForUserIds;
  }

  return next;
};

// The state with the checklist finished, unless it already was.
export const withWelcomeChecklistFinished: (
  state: WelcomeChecklistState,
  finishedBy: WelcomeChecklistFinishedBy,
  at: Date,
) => WelcomeChecklistState = (
  state: WelcomeChecklistState,
  finishedBy: WelcomeChecklistFinishedBy,
  at: Date,
): WelcomeChecklistState => {
  if (state.finishedAt) {
    return state;
  }

  return {
    ...state,
    finishedAt: at.toISOString(),
    finishedBy: finishedBy,
  };
};
