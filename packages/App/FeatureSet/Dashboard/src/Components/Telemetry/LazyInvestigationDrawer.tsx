/*
 * Type-only on purpose: the one place the drawer is loaded is the import()
 * below, so it stays out of the first load of every page that draws a chart.
 */
import type InvestigationDrawer from "./InvestigationDrawer";
import type { ComponentProps } from "./InvestigationDrawer";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "Common/UI/Utils/LazyLibrary";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The investigation drawer as a chart opens it: from "Investigate" on a
 * chart widget, or on a chart's series menu or the values at a moment. A
 * chart draws without it - on a dashboard, a resource page or a public
 * dashboard, which never offers it - yet it brings the whole telemetry stack:
 * the logs, traces and exceptions viewers with their live updates, the LLM
 * span panels, the cloud metric catalogs. Statically imported, that was 233
 * KiB of the 1,742 KiB (gzipped) a public dashboard's visitor downloaded
 * before it could draw (packages/Common/Scripts/first-load-budgets.js). So it
 * is a file of its own, loaded the first time a drawer opens, and there from
 * the first frame of every drawer opened after.
 */
const investigationDrawer: LazyLibrary<typeof InvestigationDrawer> =
  new LazyLibrary<typeof InvestigationDrawer>(
    async (): Promise<typeof InvestigationDrawer> => {
      return (await import("./InvestigationDrawer")).default;
    },
  );

// Loads the drawer, once however many ask; a failed load is retried.
export const loadInvestigationDrawer: () => Promise<
  typeof InvestigationDrawer
> = (): Promise<typeof InvestigationDrawer> => {
  return investigationDrawer.load();
};

const LazyInvestigationDrawer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const load: LazyLibraryLoad<typeof InvestigationDrawer> = useLazyLibraryLoad(
    investigationDrawer,
    true,
  );

  if (load.error) {
    /*
     * Its file did not arrive - usually a new version deployed while the tab
     * was open. Thrown, as a lazily loaded component's error is, so the part
     * of the page it opens from says so and offers the new version
     * (ContainedErrorBoundary, ChunkLoadRecovery).
     */
    throw load.error;
  }

  if (!load.library) {
    // On its way: the moment its file takes, the first time only.
    return <></>;
  }

  const Drawer: typeof InvestigationDrawer = load.library;

  return <Drawer {...props} />;
};

export default LazyInvestigationDrawer;
