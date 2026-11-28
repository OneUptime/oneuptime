import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibraryLoad,
} from "Common/UI/Utils/LazyLibrary";
import React, { ComponentType, FunctionComponent, ReactElement } from "react";

/*
 * A WIDGET THE BOARD LOADS THE FIRST TIME IT DRAWS ONE.
 *
 * A public dashboard cannot draw logs, traces, security events, product
 * analytics or cloud costs (PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES): such a
 * widget says so under its title, and that is all it draws there. The
 * board's registry (DashboardBaseComponent) imported them statically all the
 * same, and with them the models they read - every cloud cost model, a RUM
 * application's, a security event's - some 250 KiB before gzip (53 KiB
 * gzipped) that every public dashboard's visitor downloaded before the board
 * drew, whether the board had one of them or not
 * (packages/Common/Scripts/first-load-budgets.js). So each is a file of its
 * own, asked for the first time a board draws one, and there from the first
 * frame of every one drawn after.
 */

/*
 * What the widget's place draws until its file has arrived: the skeleton the
 * widget draws itself while it reads, so nothing moves when it arrives.
 */
export enum LazyDashboardWidgetShape {
  // A chart's area, filling the widget (ChartSkeleton).
  Chart = "Chart",
  // A table's rows (TableSkeleton).
  Table = "Table",
}

export interface LazyDashboardWidgetOptions<Props> {
  /*
   * The widget, read from its module. Named only in an import(), so the
   * bundler puts the module in a file of its own.
   */
  loadWidget: () => Promise<ComponentType<Props>>;
  shape: LazyDashboardWidgetShape;
}

export function lazyDashboardWidget<Props>(
  options: LazyDashboardWidgetOptions<Props>,
): FunctionComponent<Props> {
  // Loaded once however many of the widget a board draws; a failed load is retried.
  const widget: LazyLibrary<ComponentType<Props>> = new LazyLibrary<
    ComponentType<Props>
  >(options.loadWidget);

  const LazyDashboardWidget: FunctionComponent<Props> = (
    props: Props,
  ): ReactElement => {
    const load: LazyLibraryLoad<ComponentType<Props>> = useLazyLibraryLoad(
      widget,
      true,
    );

    if (load.error) {
      /*
       * Its file did not arrive - usually a new version deployed while the
       * tab was open. Thrown, as a lazily loaded component's error is, so the
       * widget's place says so and offers the new version (the board draws
       * each widget in a ContainedErrorBoundary, which draws
       * ChunkLoadRecovery), and the rest of the board stays.
       */
      throw load.error;
    }

    if (!load.library) {
      return (
        <div className="flex h-full items-center justify-center">
          {options.shape === LazyDashboardWidgetShape.Table ? (
            <TableSkeleton rows={5} />
          ) : (
            <ChartSkeleton hasLegend={false} fillsHeight={true} />
          )}
        </div>
      );
    }

    const Widget: ComponentType<Props> = load.library;

    /*
     * Props is unconstrained, so the compiler cannot see that it already
     * satisfies JSX's IntrinsicAttributes (every props object does), as in
     * Enterprise/EnterprisePluginPage.
     */
    const widgetProps: Props & React.JSX.IntrinsicAttributes = props as Props &
      React.JSX.IntrinsicAttributes;

    return <Widget {...widgetProps} />;
  };

  return LazyDashboardWidget;
}
