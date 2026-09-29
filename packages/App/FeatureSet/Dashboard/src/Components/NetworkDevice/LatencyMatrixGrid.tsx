import LatencyMatrix, {
  LatencyMatrixAxisItem,
  LatencyMatrixCell,
} from "Common/Types/Monitor/LatencyMatrix";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  matrix: LatencyMatrix;
}

// Cells older than this are considered stale and get dimmed with a tooltip.
const STALE_AGE_IN_SECONDS: number = 600;

/**
 * Return Tailwind background + text color classes for a latency value.
 * Exported so the color grading can be unit-tested independently of React.
 *
 * Scale: green <=50ms, light-green <=150, amber <=400, orange <=1000,
 * red >1000. Text color is picked for legibility against each background.
 */
export const latencyColorClasses: (ms: number) => string = (
  ms: number,
): string => {
  if (ms <= 50) {
    return "bg-green-600 text-white";
  }
  if (ms <= 150) {
    return "bg-green-300 text-green-900";
  }
  if (ms <= 400) {
    return "bg-amber-300 text-amber-900";
  }
  if (ms <= 1000) {
    return "bg-orange-400 text-orange-950";
  }
  return "bg-red-600 text-white";
};

interface LegendEntry {
  label: string;
  classes: string;
}

// Legend swatches mirror the latencyColorClasses breakpoints.
const LEGEND_ENTRIES: Array<LegendEntry> = [
  { label: "≤ 50 ms", classes: "bg-green-600 text-white" },
  { label: "≤ 150 ms", classes: "bg-green-300 text-green-900" },
  { label: "≤ 400 ms", classes: "bg-amber-300 text-amber-900" },
  { label: "≤ 1000 ms", classes: "bg-orange-400 text-orange-950" },
  { label: "> 1000 ms", classes: "bg-red-600 text-white" },
];

/**
 * Human-readable "Last checked Xm ago" for a stale cell tooltip.
 */
const staleTooltip: (ageInSeconds: number) => string = (
  ageInSeconds: number,
): string => {
  const minutes: number = Math.round(ageInSeconds / 60);
  return `Last checked ${minutes}m ago`;
};

const renderCellContent: (
  cell: LatencyMatrixCell | undefined,
) => ReactElement = (cell: LatencyMatrixCell | undefined): ReactElement => {
  if (!cell || !cell.hasData) {
    return (
      <td className="px-4 py-2 text-center text-sm text-gray-400 border-b border-gray-100">
        &mdash;
      </td>
    );
  }

  if (cell.isOnline === false) {
    return (
      <td className="px-4 py-2 text-center text-sm font-medium text-red-600 border-b border-gray-100">
        Offline
      </td>
    );
  }

  const latency: number = Math.round(cell.latencyInMs ?? 0);
  const isStale: boolean =
    cell.ageInSeconds !== undefined && cell.ageInSeconds > STALE_AGE_IN_SECONDS;

  return (
    <td
      className={`px-4 py-2 text-center text-sm font-medium border-b border-gray-100 ${latencyColorClasses(
        latency,
      )}`}
      style={isStale ? { opacity: 0.5 } : undefined}
      title={
        isStale && cell.ageInSeconds !== undefined
          ? staleTooltip(cell.ageInSeconds)
          : undefined
      }
    >
      {latency} ms
    </td>
  );
};

const LatencyMatrixGrid: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitors: Array<LatencyMatrixAxisItem> = props.matrix?.monitors || [];
  const probes: Array<LatencyMatrixAxisItem> = props.matrix?.probes || [];
  const cells: LatencyMatrix["cells"] = props.matrix?.cells || {};

  if (monitors.length === 0 || probes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 px-6">
        <div className="text-center max-w-md">
          <div className="text-sm font-medium text-gray-900">
            No probe latency data yet.
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Latency appears here once your probeable monitors run from at least
            one probe.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="w-full" style={{ overflowX: "auto" }}>
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200">
                Monitor
              </th>
              {probes.map((probe: LatencyMatrixAxisItem): ReactElement => {
                return (
                  <th
                    key={`probe-${probe.id}`}
                    className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200"
                  >
                    {probe.name}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {monitors.map((monitor: LatencyMatrixAxisItem): ReactElement => {
              const rowCells: Record<string, LatencyMatrixCell> =
                cells[monitor.id] || {};
              return (
                <tr key={`monitor-${monitor.id}`}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white px-4 py-2 text-left text-sm font-medium text-gray-900 border-b border-gray-100 whitespace-nowrap"
                  >
                    {monitor.name}
                  </th>
                  {probes.map((probe: LatencyMatrixAxisItem): ReactElement => {
                    return (
                      <React.Fragment key={`cell-${monitor.id}-${probe.id}`}>
                        {renderCellContent(rowCells[probe.id])}
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Color scale legend. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-500">Latency:</span>
        {LEGEND_ENTRIES.map((entry: LegendEntry): ReactElement => {
          return (
            <span
              key={`legend-${entry.label}`}
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${entry.classes}`}
            >
              {entry.label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default LatencyMatrixGrid;
