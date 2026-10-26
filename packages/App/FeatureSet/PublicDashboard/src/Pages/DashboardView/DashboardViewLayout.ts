/*
 * How a public dashboard's page is laid out on a narrow screen.
 *
 * The board is a grid of twelve columns its widgets were placed on at
 * 1000px and wider, so it never draws narrower than that: a widget squeezed
 * to a phone's width would be a few pixels a column. The page around it -
 * the header with the dashboard's name and its toolbar (auto-refresh,
 * theme, full screen), the time range and the variables, and the footer -
 * is the width of the screen.
 *
 * The page used to be 1000px wide as a whole (a minWidth on it), so on a
 * phone the toolbar sat past the right edge until the visitor scrolled, and
 * the header and footer scrolled away with the board. Now only the board's
 * frame scrolls sideways, and only on a screen narrower than the board plus
 * a scroll bar; from there up the frame does not scroll, so nothing a
 * widget draws past its bottom edge (a chart's tooltip) is cut off.
 *
 * React-free, so the page and its tests read the same numbers.
 */

// The narrowest the board is drawn: the width its grid is laid out for.
export const PUBLIC_DASHBOARD_BOARD_MIN_WIDTH_IN_PX: number = 1000;

/*
 * The board's frame scrolls sideways below 1080px: the board's 1000px and
 * room for the page's own vertical scroll bar.
 */
export const PUBLIC_DASHBOARD_FRAME_CLASS_NAME: string =
  "max-[1079px]:overflow-x-auto";

export const PUBLIC_DASHBOARD_PAGE_TEST_ID: string = "public-dashboard-page";
export const PUBLIC_DASHBOARD_HEADER_TEST_ID: string =
  "public-dashboard-header";
export const PUBLIC_DASHBOARD_TOOLBAR_TEST_ID: string =
  "public-dashboard-toolbar";
export const PUBLIC_DASHBOARD_FRAME_TEST_ID: string =
  "public-dashboard-board-frame";
export const PUBLIC_DASHBOARD_BOARD_TEST_ID: string = "public-dashboard-board";
