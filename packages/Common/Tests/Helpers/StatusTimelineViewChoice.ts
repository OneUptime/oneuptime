import {
  resetStatusTimelineViewForTesting,
  STATUS_TIMELINE_VIEW_STORAGE_KEY,
  StatusTimelineView,
  writeStatusTimelineView,
} from "../../UI/Components/StatusTimeline/StatusTimelineView";

/*
 * A status timeline page (a monitor's, an incident's, a network site's...)
 * opens on the timeline, and keeps its table one click away. The suites
 * written for that table pick Table first - as a reader does with the
 * page's Timeline | Table switch, which is remembered in the browser - and
 * forget the choice afterwards, so no other suite inherits it.
 */
export const showStatusTimelinesAsTable: () => void = (): void => {
  writeStatusTimelineView(StatusTimelineView.Table);
};

export const forgetStatusTimelineView: () => void = (): void => {
  resetStatusTimelineViewForTesting();

  try {
    window.localStorage.removeItem(STATUS_TIMELINE_VIEW_STORAGE_KEY);
  } catch {
    // No storage: nothing was remembered there.
  }
};
