import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";

/*
 * "GET COVER" OPENS ADD USER OVERRIDE WITH THE SHIFT FILLED IN.
 *
 * An upcoming shift's "Get cover" link (User Settings > Calendar Feed)
 * opens the User Overrides page with Add User Override already open: you as
 * the person away, and the shift's window as when - so the one thing left to
 * answer is who covers. The window travels as two query parameters on the
 * page's address, written here by the link and read back here by the page.
 *
 * A shift that has already started is covered from now: the pages that
 * matter are the ones still to come. A window that has ended, or whose end
 * is not after its start, asks for nothing.
 *
 * Pure: the calendar feed card, the User Overrides table, the Add User
 * Override form and their tests share it.
 */

export const USER_OVERRIDE_COVER_STARTS_AT_PARAM: string = "coverStartsAt";
export const USER_OVERRIDE_COVER_ENDS_AT_PARAM: string = "coverEndsAt";

export interface UserOverrideCoverWindow {
  startsAt: Date;
  endsAt: Date;
}

/*
 * A time as a form, a link or a shift holds it - a Date, or the ISO string
 * a date input writes - or null when it is not a real instant yet: empty,
 * half typed, or not a time at all. The one reader of override times, so
 * the link, the page and the form's own checks agree on what a time is.
 */
export const toUserOverrideTime: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  // Half-typed text is not a time yet (and would only make moment warn).
  if (Number.isNaN(Date.parse(value))) {
    return null;
  }

  let date: Date;

  try {
    date = OneUptimeDate.fromString(value);
  } catch {
    return null;
  }

  return Number.isNaN(date.getTime()) ? null : date;
};

/*
 * The window to cover for a shift from `start` to `end`, as of `now`: from
 * the start, or from now once it has started, to the end. Null when either
 * time is not a real one, when the end is not after the start, or when the
 * shift has ended.
 */
export const getUserOverrideCoverWindow: (data: {
  start: unknown;
  end: unknown;
  now: Date;
}) => UserOverrideCoverWindow | null = (data: {
  start: unknown;
  end: unknown;
  now: Date;
}): UserOverrideCoverWindow | null => {
  const start: Date | null = toUserOverrideTime(data.start);
  const end: Date | null = toUserOverrideTime(data.end);

  if (!start || !end) {
    return null;
  }

  if (end.getTime() <= start.getTime()) {
    return null;
  }

  if (end.getTime() <= data.now.getTime()) {
    return null;
  }

  return {
    startsAt: start.getTime() < data.now.getTime() ? new Date(data.now) : start,
    endsAt: end,
  };
};

// The query parameters that ask the User Overrides page to cover a window.
export const getUserOverrideCoverQueryParams: (
  window: UserOverrideCoverWindow,
) => Dictionary<string> = (
  window: UserOverrideCoverWindow,
): Dictionary<string> => {
  return {
    [USER_OVERRIDE_COVER_STARTS_AT_PARAM]: encodeURIComponent(
      OneUptimeDate.toString(window.startsAt),
    ),
    [USER_OVERRIDE_COVER_ENDS_AT_PARAM]: encodeURIComponent(
      OneUptimeDate.toString(window.endsAt),
    ),
  };
};

/*
 * The window a page's address asks to cover, read with `getParam` (one
 * query parameter's value by name, or null) as of `now`: a link opened an
 * hour after it was made covers from then. Null when the address asks for
 * nothing usable, and the page then opens as it always does.
 */
export const readUserOverrideCoverRequest: (data: {
  getParam: (name: string) => string | null | undefined;
  now: Date;
}) => UserOverrideCoverWindow | null = (data: {
  getParam: (name: string) => string | null | undefined;
  now: Date;
}): UserOverrideCoverWindow | null => {
  return getUserOverrideCoverWindow({
    start: data.getParam(USER_OVERRIDE_COVER_STARTS_AT_PARAM),
    end: data.getParam(USER_OVERRIDE_COVER_ENDS_AT_PARAM),
    now: data.now,
  });
};

// Whether a page's address carries any part of a cover request.
export const hasUserOverrideCoverParams: (
  getParam: (name: string) => string | null | undefined,
) => boolean = (
  getParam: (name: string) => string | null | undefined,
): boolean => {
  return [
    USER_OVERRIDE_COVER_STARTS_AT_PARAM,
    USER_OVERRIDE_COVER_ENDS_AT_PARAM,
  ].some((name: string): boolean => {
    const value: string | null | undefined = getParam(name);

    return value !== null && value !== undefined;
  });
};
