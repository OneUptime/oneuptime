import {
  READINESS_STATUS_NOT_REACHABLE,
  READINESS_STATUS_PARTIALLY_READY,
  UserReadinessWire,
} from "../OnCallPolicy/Readiness/ReadinessTypes";
import PageMap from "../../Utils/PageMap";
import { hasNotificationSetupToFinish } from "Common/Types/OnCallDutyPolicy/NotificationSetupToFinish";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "FINISH SETTING UP YOUR NOTIFICATIONS", IN THE BELL (#7040).
 *
 * Somebody on an on-call policy whom OneUptime cannot fully reach used to
 * hear of it only on Home's member card, which an owner never sees and a
 * member hides. The bell is on every page, so it asks there too - by the
 * rule the setup reminder and On-Call > Readiness use
 * (hasNotificationSetupToFinish), read from the person's own readiness:
 *
 *   - nothing can reach them (NotReachable);
 *   - a severity has no rule of theirs (PartiallyReady);
 *   - their project asks everyone on call for a phone method, and they
 *     have none verified (#7449).
 *
 * Only while they are on a policy: somebody nobody pages has nothing to be
 * reached for yet, and the setup checklist says so to them. One click
 * opens the page that fixes it. Easy to put away: Hide puts it away for a
 * week, in this browser; it goes by itself once it is fixed.
 */

export enum NotificationSetupReason {
  NothingReaches = "nothing_reaches",
  RuleGaps = "rule_gaps",
  NoPhone = "no_phone",
}

export const NOTIFICATION_SETUP_NUDGE_COPY: {
  title: string;
  nothingReaches: string;
  ruleGaps: string;
  noPhone: string;
  hide: string;
} = {
  title: translationKey("Finish setting up your notifications"),
  // The setup checklist's own headline for the same state, as a sentence.
  nothingReaches: translationKey("Nothing can reach you yet."),
  ruleGaps: translationKey("Some severities have no notification rule yet."),
  // How to Reach Me's own words for the project's ask.
  noPhone: translationKey(
    "This project asks everyone on call to have a phone method.",
  ),
  hide: translationKey("Hide for a week"),
};

export const NOTIFICATION_SETUP_NUDGE_ITEM_ID: string = "notificationSetup";

/*
 * Why the person has their setup to finish, or null when they do not - or
 * are on no on-call policy. Nothing reaching them says more than a missing
 * rule or phone, so it comes first.
 */
export const getNotificationSetupReason: (
  readiness: UserReadinessWire | null | undefined,
) => NotificationSetupReason | null = (
  readiness: UserReadinessWire | null | undefined,
): NotificationSetupReason | null => {
  if (!readiness || readiness.reachedVia.length === 0) {
    return null;
  }

  if (!hasNotificationSetupToFinish(readiness)) {
    return null;
  }

  if (readiness.status === READINESS_STATUS_NOT_REACHABLE) {
    return NotificationSetupReason.NothingReaches;
  }

  if (readiness.status === READINESS_STATUS_PARTIALLY_READY) {
    return NotificationSetupReason.RuleGaps;
  }

  // Ready, and the project asks for a phone method they have not verified.
  return NotificationSetupReason.NoPhone;
};

export const getNotificationSetupReasonText: (
  reason: NotificationSetupReason,
) => string = (reason: NotificationSetupReason): string => {
  switch (reason) {
    case NotificationSetupReason.NothingReaches:
      return NOTIFICATION_SETUP_NUDGE_COPY.nothingReaches;
    case NotificationSetupReason.NoPhone:
      return NOTIFICATION_SETUP_NUDGE_COPY.noPhone;
    default:
      return NOTIFICATION_SETUP_NUDGE_COPY.ruleGaps;
  }
};

/*
 * Where the item opens: the setup checklist, which names every step left
 * and the page for each - or, for a phone the project asks for, How to
 * Reach Me, where Add your phone is (the checklist has no step for it).
 */
export const getNotificationSetupPage: (
  reason: NotificationSetupReason,
) => PageMap = (reason: NotificationSetupReason): PageMap => {
  return reason === NotificationSetupReason.NoPhone
    ? PageMap.USER_SETTINGS_ON_CALL_RULES
    : PageMap.USER_SETTINGS_SETUP;
};

// How long Hide puts the item away for.
export const NOTIFICATION_SETUP_NUDGE_HIDDEN_FOR_IN_MS: number =
  7 * 24 * 60 * 60 * 1000;

export const NOTIFICATION_SETUP_NUDGE_HIDDEN_KEY_PREFIX: string =
  "oneuptime.bell.notificationSetupHiddenUntil:";

const hiddenKey: (data: {
  userId: string;
  projectId: string;
}) => string = (data: { userId: string; projectId: string }): string => {
  return `${NOTIFICATION_SETUP_NUDGE_HIDDEN_KEY_PREFIX}${data.userId.toLowerCase()}:${data.projectId.toLowerCase()}`;
};

/*
 * Until when the person put the item away in this project, on this browser
 * (Date.now()), or 0. A browser that keeps nothing - a private window,
 * storage turned off - reads 0: the item shows, and Hide hides it until the
 * page is loaded again.
 */
export const readNotificationSetupHiddenUntil: (data: {
  userId: string;
  projectId: string;
}) => number = (data: { userId: string; projectId: string }): number => {
  try {
    const value: string | null = window.localStorage.getItem(hiddenKey(data));
    const until: number = value ? Number(value) : 0;

    return Number.isFinite(until) && until > 0 ? until : 0;
  } catch {
    return 0;
  }
};

// Puts the item away for a week. Returns until when.
export const hideNotificationSetupNudge: (data: {
  userId: string;
  projectId: string;
  now: number;
}) => number = (data: {
  userId: string;
  projectId: string;
  now: number;
}): number => {
  const until: number = data.now + NOTIFICATION_SETUP_NUDGE_HIDDEN_FOR_IN_MS;

  try {
    window.localStorage.setItem(hiddenKey(data), String(until));
  } catch {
    // Kept for this page only: the item comes back on the next load.
  }

  return until;
};
