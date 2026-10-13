/*
 * Whether a new saved view (logs, metrics, traces) asks to be its project's
 * default, as its create sends it: true when "Set as default" is ticked, and
 * otherwise nothing at all.
 *
 * The saved view services make a project's first saved view its default
 * when the create does not say (LogSavedViewService and the Metric and Trace
 * ones), so a project that saves views has one that opens by default. A
 * Create form sends an untouched box as its column's off, and an explicit
 * off is saying: the project's first view would not be its default.
 */
export function leaveSavedViewDefaultOutUnlessTicked<
  T extends { isDefault?: boolean | undefined },
>(view: T): T {
  if (view.isDefault !== true) {
    view.isDefault = undefined;
  }

  return view;
}
