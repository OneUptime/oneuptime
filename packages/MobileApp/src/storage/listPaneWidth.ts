import AsyncStorage from "@react-native-async-storage/async-storage";

/*
 * Where the reader left the divider between a list and its detail: the list's
 * width, in points, the same for the Inbox, Monitors and On-Call. The layout
 * fits it to each window (windowLayout.ts), so one width serves the inner
 * screen held either way up and a tablet alike.
 *
 * Absent - or anything this build cannot read - means the divider sits where
 * the layout puts it. Putting it back there removes the entry, so a reader
 * who never moved it keeps following the layout's own rule.
 */
export const LIST_PANE_WIDTH_KEY: string = "oneuptime_list_pane_width";

/*
 * Widths outside this range were not written by this build's divider (it
 * keeps every pane at least a phone's width), so they are ignored rather than
 * trusted.
 */
export const MIN_STORED_LIST_PANE_WIDTH: number = 200;
export const MAX_STORED_LIST_PANE_WIDTH: number = 4000;

function isStorableWidth(width: number): boolean {
  return (
    Number.isFinite(width) &&
    width >= MIN_STORED_LIST_PANE_WIDTH &&
    width <= MAX_STORED_LIST_PANE_WIDTH
  );
}

export async function getListPaneWidthPreference(): Promise<number | null> {
  const stored: string | null = await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY);
  if (stored === null || stored.trim() === "") {
    return null;
  }
  const width: number = Number(stored);
  return isStorableWidth(width) ? Math.round(width) : null;
}

export async function setListPaneWidthPreference(
  width: number | null,
): Promise<void> {
  if (width === null || !isStorableWidth(width)) {
    await AsyncStorage.removeItem(LIST_PANE_WIDTH_KEY);
    return;
  }
  await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, String(Math.round(width)));
}
