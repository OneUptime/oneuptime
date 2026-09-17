import React, { FunctionComponent, ReactElement, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import { getRecordingHealthActionLink } from "./RecordingHealthCard";
import type { SessionReplaySummary } from "./SessionReplayTable";
import type { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";

/*
 * The quiet line above the session list that tells a customer WHY every
 * row says "Anonymous" or "Visitor ...": their page never calls
 * identify(). The customer behind issue #3705 read a whole page of
 * anonymous rows as the product being unable to group by user, when the
 * fix was one call on their side. Nothing on the page said so.
 *
 * It is a nudge, not an alert - the recording is healthy and nothing is
 * broken - so it is a soft indigo band with a dismiss, remembered for the
 * tab (sessionStorage, per application) rather than forever: the next
 * visit to the same list a week later should say it again if nothing has
 * changed.
 */

/* Per-application, so dismissing it on one app does not silence another. */
export const IDENTITY_NUDGE_DISMISSED_KEY_PREFIX: string =
  "oneuptime.replay.identityNudgeDismissed:";

/*
 * Fewer rows than this and "every session is anonymous" is not yet a
 * pattern worth a banner - a single test session from the developer's own
 * browser would trigger it.
 */
export const IDENTITY_NUDGE_MIN_ROWS: number = 3;

function dismissedKey(rumApplicationId: string): string {
  return `${IDENTITY_NUDGE_DISMISSED_KEY_PREFIX}${rumApplicationId}`;
}

export function readIdentityNudgeDismissed(rumApplicationId: string): boolean {
  try {
    return (
      window.sessionStorage.getItem(dismissedKey(rumApplicationId)) === "1"
    );
  } catch {
    return false;
  }
}

export function writeIdentityNudgeDismissed(rumApplicationId: string): void {
  try {
    window.sessionStorage.setItem(dismissedKey(rumApplicationId), "1");
  } catch {
    /* Private mode or a full store: the nudge simply comes back next time. */
  }
}

/*
 * Should the nudge be offered for this page of rows? Only when the page is
 * settled, has enough rows to be a pattern, and every one of them is
 * genuinely unidentified as far as THIS viewer can tell: a row whose
 * identity column was withheld (isIdentityVisible === false) may well be
 * an identified person, so one such row disqualifies the whole page - the
 * nudge would otherwise tell an admin to add identify() to a page that
 * already calls it.
 */
export function shouldShowIdentityNudge(
  rows: Array<SessionReplaySummary>,
  isLoading: boolean,
  filters?: IdentityNudgeFilters | undefined,
): boolean {
  if (isLoading || rows.length < IDENTITY_NUDGE_MIN_ROWS) {
    return false;
  }

  /*
   * A list the viewer has already narrowed to one person - a visitor, a
   * pseudonymous key, a user reference - is anonymous by construction, not
   * by omission: every row is that visitor. Telling them to call
   * identify() there says nothing they did not just choose.
   */
  if (
    filters &&
    (filters.identifiedUserRef.trim().length > 0 ||
      filters.identifiedUserKey.trim().length > 0 ||
      filters.visitorId.trim().length > 0)
  ) {
    return false;
  }

  return rows.every((row: SessionReplaySummary): boolean => {
    return row.isIdentityVisible !== false && row.identifiedUserLabel === "";
  });
}

/* The identity filters that make a page anonymous on purpose. */
export type IdentityNudgeFilters = Pick<
  SessionReplayAdvancedFilters,
  "identifiedUserRef" | "identifiedUserKey" | "visitorId"
>;

/* True when at least one row carries a visitor id - the recorder is current. */
export function hasAnyVisitorId(rows: Array<SessionReplaySummary>): boolean {
  return rows.some((row: SessionReplaySummary): boolean => {
    return row.visitorId.length > 0;
  });
}

export interface SessionReplayIdentityNudgeProps {
  rumApplicationId: string;
  /* Whether any row on the page carries a visitor id; changes the copy. */
  hasVisitorIds: boolean;
  onShowUsers: () => void;
}

const SessionReplayIdentityNudge: FunctionComponent<
  SessionReplayIdentityNudgeProps
> = (props: SessionReplayIdentityNudgeProps): ReactElement => {
  const [isDismissed, setIsDismissed] = useState<boolean>((): boolean => {
    return readIdentityNudgeDismissed(props.rumApplicationId);
  });

  if (isDismissed) {
    return <></>;
  }

  const body: string = `Call OneUptimeReplay.identify() when your page knows who is signed in, and sessions group by person here and in the player. Until then, sessions from the same browser are grouped by visitor id.${
    props.hasVisitorIds
      ? ""
      : " These recordings carry no visitor id yet; the current recorder adds one automatically."
  }`;

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950"
      data-testid="session-identity-nudge"
      role="note"
    >
      <Icon
        icon={IconProp.Info}
        className="mt-0.5 h-5 w-5 flex-none text-indigo-500"
      />
      <div className="min-w-0 flex-1">
        <strong className="font-semibold">
          No session here is linked to a signed-in user.
        </strong>{" "}
        <span className="text-indigo-900/80">{body}</span>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            className="text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid="session-identity-nudge-guide"
            onClick={(): void => {
              Navigation.navigate(
                getRecordingHealthActionLink(
                  "setup-guide",
                  props.rumApplicationId,
                ).to,
              );
            }}
          >
            How to identify users
          </button>
          <button
            type="button"
            className="text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid="session-identity-nudge-users"
            onClick={props.onShowUsers}
          >
            See users
          </button>
        </div>
      </div>
      <button
        type="button"
        className="-m-1 flex-none rounded p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-label="Dismiss"
        data-testid="session-identity-nudge-dismiss"
        onClick={(): void => {
          writeIdentityNudgeDismissed(props.rumApplicationId);
          setIsDismissed(true);
        }}
      >
        <Icon icon={IconProp.Close} className="h-4 w-4" />
      </button>
    </div>
  );
};

export default SessionReplayIdentityNudge;
