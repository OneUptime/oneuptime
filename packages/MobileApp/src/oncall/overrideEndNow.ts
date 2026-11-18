import { displayNameForUser } from "../components/RosterScheduleCard";
import { formatShiftTime } from "../utils/duration";
import type { OnCallOverrideItem } from "../api/types";

/*
 * END NOW, IN THE APP (#7897, as the dashboard's #7899): the question asked
 * before an override under way is ended, in the app's voice - "you" for the
 * person signed in. It says, as the dashboard's does, what happens to the
 * time left and who is paged from then on:
 *
 *   Sam Rivera stops covering for you now instead of Tomorrow 9:00 AM.
 *   From then on, your pages come to you again.
 */

export interface EndNowQuestion {
  title: string;
  message: string;
}

export const END_NOW_TITLE: string = "End this override now?";

export function describeEndNow(
  override: OnCallOverrideItem,
  currentUserId: string | null,
  now: number = Date.now(),
): EndNowQuestion {
  const until: string =
    formatShiftTime(override.endsAt, now) || "when it was set to end";

  const awayIsMe: boolean = Boolean(
    currentUserId && override.overrideUser?._id === currentUserId,
  );
  const coverIsMe: boolean = Boolean(
    currentUserId && override.routeAlertsToUser?._id === currentUserId,
  );
  const away: string = displayNameForUser(override.overrideUser);

  // Nobody named: the rotation covers, so they are skipped.
  if (!override.routeAlertsToUser) {
    return {
      title: END_NOW_TITLE,
      message: awayIsMe
        ? `You stop being skipped now instead of ${until}. From then on, you take your turns in the rotation again.`
        : `${away} stops being skipped now instead of ${until}. From then on, they take their turns in the rotation again.`,
    };
  }

  const cover: string = displayNameForUser(override.routeAlertsToUser);

  if (awayIsMe) {
    return {
      title: END_NOW_TITLE,
      message: `${cover} stops covering for you now instead of ${until}. From then on, your pages come to you again.`,
    };
  }

  if (coverIsMe) {
    return {
      title: END_NOW_TITLE,
      message: `You stop covering for ${away} now instead of ${until}. From then on, their pages go to them again.`,
    };
  }

  return {
    title: END_NOW_TITLE,
    message: `${cover} stops covering for ${away} now instead of ${until}. From then on, alerts page ${away} again.`,
  };
}
