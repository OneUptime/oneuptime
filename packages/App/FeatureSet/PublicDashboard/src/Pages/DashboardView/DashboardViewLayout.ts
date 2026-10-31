/*
 * How a public dashboard's page is laid out at any width.
 *
 * The page is the width of the screen: the header with the dashboard's name
 * and its toolbar (auto-refresh, theme, full screen), the time range and
 * the variables, the board and the footer. The board lays its widgets out
 * in the width it has (the shared canvas, Common/Utils/Dashboard/
 * DashboardBoardLayout): on its twelve-column grid, the columns narrowing
 * with the screen while every row keeps its height, and on a phone one
 * under another, in the order the grid is read.
 *
 * The board used to keep 1000px - the width its grid was laid out for - in
 * a frame of its own that scrolled sideways below 1080px, so a phone showed
 * half of each row of widgets and a visitor scrolled the board to see the
 * rest. Now nothing on the page scrolls sideways, and the frame is only the
 * box Full Screen shows.
 *
 * React-free, so the page and its tests read the same names.
 */

export const PUBLIC_DASHBOARD_PAGE_TEST_ID: string = "public-dashboard-page";
export const PUBLIC_DASHBOARD_HEADER_TEST_ID: string =
  "public-dashboard-header";
export const PUBLIC_DASHBOARD_TOOLBAR_TEST_ID: string =
  "public-dashboard-toolbar";
export const PUBLIC_DASHBOARD_FRAME_TEST_ID: string =
  "public-dashboard-board-frame";
export const PUBLIC_DASHBOARD_BOARD_TEST_ID: string = "public-dashboard-board";
