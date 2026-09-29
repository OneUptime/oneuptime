/*
 * What the monitor view layout hands the page in its <Outlet>.
 *
 * The header (the "Monitor - {name}" title and the labels) is read by the
 * layout's ModelPage, not by the page below it, so a page that edits the
 * monitor's name or labels has no way to refresh it on its own. It calls
 * refreshHeader instead, which reads the header again without unmounting
 * the page.
 */
export default interface MonitorViewOutletContext {
  refreshHeader: () => void;
}
