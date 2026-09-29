import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ReplayRailTabId } from "./Rail/ReplaySignalTypes";
import { buildReplayMomentRoute } from "./ReplayPlayerUrlState";

/*
 * The URL half of ReplayLink, without React.
 *
 * The route a cross-link points at is pure, and it is what the node tests
 * pin - the grammar of ?at=/?t=/?signal=/?rail= has to be identical from
 * every surface. Keeping it out of ReplayLink.tsx means asserting on it
 * never drags react into App's test or compile program.
 */

export interface ReplayLinkRouteProps {
  rumApplicationId?: ObjectID | string | undefined;
  sessionId?: string | undefined;
  /*
   * The absolute moment (the row's own timestamp) -> ?at=. Preferred: the
   * caller knows the wall clock, the player knows the recording's start,
   * and the conversion happens once, in the player, against the header.
   */
  atTime?: Date | undefined;
  /* An offset into the recording -> ?t=. Used when only an offset is known. */
  atOffsetMs?: number | undefined;
  /* The rail row to select on arrival (log:<id>, span:<id>, exc:<id>). */
  signal?: string | undefined;
  /* The rail tab to open on arrival. */
  rail?: ReplayRailTabId | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

/*
 * The route this link points at, or null when it should not render. Kept
 * separate from the component so a node test can pin the URL grammar
 * without rendering. Every inbound link goes through
 * buildReplayMomentRoute so the pre-roll (1s for a row, 10s for an
 * exception signal) and the clamp at 0 are the same from every surface.
 */
export function buildReplayLinkRoute(
  props: ReplayLinkRouteProps,
): Route | null {
  return buildReplayMomentRoute({
    rumApplicationId: props.rumApplicationId,
    sessionId: props.sessionId,
    at: props.atTime,
    t: props.atOffsetMs,
    signal: props.signal,
    rail: props.rail,
  });
}
