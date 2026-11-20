import DefaultDashboardSize from "../../Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";

/*
 * WHERE AN IMPORTED DASHBOARD'S WIDGETS GO (issue #7697).
 *
 * Grafana lays panels out on 24 columns of rows 30px tall; Datadog's
 * ordered dashboards on 12 columns. OneUptime's board is 12 columns of
 * square units, about 100px each on a laptop, and its widgets have
 * minimum sizes (a chart is at least 6 wide and 3 tall). So the source's
 * layout is kept as rows, read top to bottom and left to right: each
 * panel takes its share of the row in OneUptime's units, at least its
 * widget's minimum, and a row that no longer fits on 12 columns goes on
 * to the next line. The order the source shows its panels in is the
 * order the board shows them.
 */

export interface ImportedPlacement {
  // The row the source puts the panel in, and where along it.
  sourceRow: number;
  sourceColumn: number;
  // The panel's size in OneUptime's units, before minimums.
  width: number;
  height: number;
  // Starts a line of its own (a Grafana row's heading, a group's title).
  startsLine?: boolean | undefined;
}

export interface PlacedComponent {
  component: DashboardBaseComponent;
  placement: ImportedPlacement;
}

const COLUMNS: number = DefaultDashboardSize.widthInDashboardUnits;

/*
 * Grafana's 24 columns in OneUptime's 12, and its 30px rows (38px with
 * the gap) in OneUptime's units of about 100px.
 */
export const GRAFANA_COLUMNS_PER_UNIT: number = 2;
export const GRAFANA_ROWS_PER_UNIT: number = 2.6;

export const fromGrafanaWidth: (width: number) => number = (
  width: number,
): number => {
  return Math.max(1, Math.round((width || 12) / GRAFANA_COLUMNS_PER_UNIT));
};

export const fromGrafanaHeight: (height: number) => number = (
  height: number,
): number => {
  return Math.max(1, Math.round((height || 8) / GRAFANA_ROWS_PER_UNIT));
};

/*
 * The components laid out in the source's order, in lines of 12 columns.
 * Returns new components and the board's height; none handed in is changed.
 */
export const layOutImportedComponents: (
  placed: Array<PlacedComponent>,
) => { components: Array<DashboardBaseComponent>; height: number } = (
  placed: Array<PlacedComponent>,
): { components: Array<DashboardBaseComponent>; height: number } => {
  const ordered: Array<PlacedComponent> = [...placed].sort(
    (a: PlacedComponent, b: PlacedComponent): number => {
      return (
        a.placement.sourceRow - b.placement.sourceRow ||
        a.placement.sourceColumn - b.placement.sourceColumn
      );
    },
  );

  const components: Array<DashboardBaseComponent> = [];
  let lineTop: number = 0;
  let lineHeight: number = 0;
  let left: number = 0;
  let lineSourceRow: number | undefined = undefined;

  const newLine: () => void = (): void => {
    lineTop += lineHeight;
    lineHeight = 0;
    left = 0;
  };

  for (const item of ordered) {
    const component: DashboardBaseComponent = item.component;
    const minWidth: number = Math.min(
      COLUMNS,
      Math.max(1, component.minWidthInDashboardUnits || 1),
    );
    const minHeight: number = Math.max(
      1,
      component.minHeightInDashboardUnits || 1,
    );
    const width: number = Math.min(
      COLUMNS,
      Math.max(minWidth, item.placement.width),
    );
    const height: number = Math.max(minHeight, item.placement.height);

    const isNewSourceRow: boolean =
      lineSourceRow === undefined || item.placement.sourceRow !== lineSourceRow;

    if (
      left > 0 &&
      (item.placement.startsLine || isNewSourceRow || left + width > COLUMNS)
    ) {
      newLine();
    }

    lineSourceRow = item.placement.sourceRow;

    components.push({
      ...component,
      leftInDashboardUnits: left,
      topInDashboardUnits: lineTop,
      widthInDashboardUnits: width,
      heightInDashboardUnits: height,
    });

    left += width;
    lineHeight = Math.max(lineHeight, height);

    if (item.placement.startsLine) {
      newLine();
      lineSourceRow = undefined;
    }
  }

  const height: number = Math.max(
    DefaultDashboardSize.heightInDashboardUnits,
    lineTop + lineHeight,
  );

  return { components, height };
};
