import GlobalEvents from "../../Utils/GlobalEvents";

/*
 * ASKING THE PAGE'S SIDE-MENU COUNTS TO COUNT AGAIN.
 *
 * A count beside a side-menu entry ("Active Alerts 4") says how many records
 * the list it opens holds. It reads that number when it is drawn, and again
 * whenever something on the page asks - every count on the page at once
 * (CountModelSideMenuItem). Nothing else tells it the records changed, so a
 * page that changes them asks:
 *
 *   - every change made from a list asks on its own: the end of every bulk
 *     run (useBulkActionProgress), a row's Delete, a row action that changed
 *     its row (RowActionContext.refresh), a create or edit through the
 *     list's form, and the list's Refresh (BaseModelTable);
 *   - a page that changes records some other way - a dialog of its own, a
 *     card - asks once its change is saved.
 *
 * Records of a kind the server announces (Alert, Incident, their episodes,
 * ...) are also heard live, wherever they change (UseLiveCount).
 *
 * Bulk deleting or resolving alerts used to leave "Active Alerts 4" beside an
 * empty list until the page was reloaded (#6856): the bulk run never asked.
 */
export const REFRESH_SIDEBAR_COUNT_EVENT: string = "REFRESH_SIDEBAR_COUNTS";

export const refreshSideMenuCounts: () => void = (): void => {
  GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
};
