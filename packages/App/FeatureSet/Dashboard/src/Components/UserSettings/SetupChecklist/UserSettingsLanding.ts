import PageMap from "../../../Utils/PageMap";

/*
 * THE PAGE USER SETTINGS OPENS ON (#7039).
 *
 * While a person's setup checklist has essential steps left
 * (hasEssentialStepsLeft), User Settings opens on it: it is the one page
 * that says what is left, in the order it matters, with the page for each.
 * Once nothing essential is left, User Settings opens where it always did,
 * on Notification Methods. Every page keeps its own address: a link to any
 * of them opens that page, as before.
 *
 * The nav bar's User Settings, Search's and every page's "User Settings"
 * crumb go to User Settings' own address (PageMap.USER_SETTINGS,
 * …/user-settings/), which forwards to the page (Pages/UserSettings/Landing).
 * To forward at once, the answer of the last checklist read in this browser
 * is remembered here, per person and project: every read of the checklist
 * (the checklist itself, Home's card for an invited member, the forward)
 * writes it. With none remembered the forward reads the checklist first;
 * with one older than RECHECK_AFTER it forwards at once and reads it again
 * behind, for the next time.
 */

export const USER_SETTINGS_LANDING_KEY_PREFIX: string =
  "oneuptime.userSettings.essentialStepsLeft:";

// An answer older than this is read again, after forwarding by it.
export const USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS: number = 10 * 60 * 1000;

export interface RememberedLanding {
  hasEssentialStepsLeft: boolean;
  // When the checklist said so (Date.now()).
  checkedAt: number;
}

const keyOf: (data: { userId: string; projectId: string }) => string = (data: {
  userId: string;
  projectId: string;
}): string => {
  return `${USER_SETTINGS_LANDING_KEY_PREFIX}${data.userId.toLowerCase()}:${data.projectId.toLowerCase()}`;
};

/*
 * What the last checklist read in this browser said, or null: never read,
 * or a browser that keeps nothing (a private window, storage turned off) -
 * the forward then reads the checklist, every time.
 */
export const readRememberedLanding: (data: {
  userId: string;
  projectId: string;
}) => RememberedLanding | null = (data: {
  userId: string;
  projectId: string;
}): RememberedLanding | null => {
  try {
    const value: string | null = window.localStorage.getItem(keyOf(data));

    if (!value) {
      return null;
    }

    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const remembered: Record<string, unknown> = parsed as Record<
      string,
      unknown
    >;

    if (
      typeof remembered["hasEssentialStepsLeft"] !== "boolean" ||
      typeof remembered["checkedAt"] !== "number" ||
      !Number.isFinite(remembered["checkedAt"])
    ) {
      return null;
    }

    return {
      hasEssentialStepsLeft: remembered["hasEssentialStepsLeft"],
      checkedAt: remembered["checkedAt"],
    };
  } catch {
    return null;
  }
};

export const rememberLanding: (data: {
  userId: string;
  projectId: string;
  hasEssentialStepsLeft: boolean;
  now: number;
}) => void = (data: {
  userId: string;
  projectId: string;
  hasEssentialStepsLeft: boolean;
  now: number;
}): void => {
  try {
    window.localStorage.setItem(
      keyOf(data),
      JSON.stringify({
        hasEssentialStepsLeft: data.hasEssentialStepsLeft,
        checkedAt: data.now,
      }),
    );
  } catch {
    // Nothing kept: the next visit reads the checklist again.
  }
};

// The page User Settings opens on, by what the checklist says.
export const getUserSettingsLandingPage: (
  hasEssentialStepsLeft: boolean,
) => PageMap = (hasEssentialStepsLeft: boolean): PageMap => {
  return hasEssentialStepsLeft
    ? PageMap.USER_SETTINGS_SETUP
    : PageMap.USER_SETTINGS_NOTIFICATION_METHODS;
};

// Whether a remembered answer is old enough to read again behind the forward.
export const isLandingDueForRecheck: (
  remembered: RememberedLanding,
  now: number,
) => boolean = (remembered: RememberedLanding, now: number): boolean => {
  return (
    now - remembered.checkedAt >= USER_SETTINGS_LANDING_RECHECK_AFTER_IN_MS
  );
};
