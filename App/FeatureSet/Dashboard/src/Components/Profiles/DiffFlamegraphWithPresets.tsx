import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import DiffFlamegraph, { DiffFlamegraphNode } from "./DiffFlamegraph";
import ProfileUtil from "../../Utils/ProfileUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface DiffFlamegraphWithPresetsProps {
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  /**
   * Width of the comparison window (in minutes). Without `anchorTime`
   * the comparison period is `[now - windowMinutes, now]`; the
   * baseline is the same window shifted by the preset's offset.
   */
  windowMinutes?: number | undefined;
  /**
   * When set, the comparison window is centered on this moment instead
   * of ending at "now". Used by the profile detail page so the diff
   * describes the time the profile was actually captured — comparing
   * an arbitrary recent window would say nothing about that profile.
   */
  anchorTime?: Date | undefined;
}

type PresetKey = "1h" | "24h" | "7d" | "1w";

interface Preset {
  key: PresetKey;
  label: string;
  description: string;
  /** How far back (in minutes) to shift the comparison window to get the baseline. */
  offsetMinutes: number;
}

/*
 * Presets are the whole point of this component: "show me what got
 * slower since {X}" is the question engineers actually ask. Free-form
 * time pickers bury this behind three clicks and a mental calculation.
 */
const PRESETS: Array<Preset> = [
  {
    key: "1h",
    label: "vs. 1 hour ago",
    description: "Compare the last window to the one before it",
    offsetMinutes: 60,
  },
  {
    key: "24h",
    label: "vs. yesterday",
    description: "Same time window, 24 hours earlier",
    offsetMinutes: 60 * 24,
  },
  {
    key: "7d",
    label: "vs. last week",
    description: "Same time window, 7 days earlier",
    offsetMinutes: 60 * 24 * 7,
  },
];

type DeltaDirection = "regressed" | "improved";

/**
 * One function's change between the two windows, expressed as its
 * share of total self time in each window. Shares (not absolute
 * values) are compared so a window where the service simply handled
 * more traffic doesn't mark every function as regressed.
 */
interface FunctionShareDeltaRow {
  functionName: string;
  fileName: string;
  baselineSharePercent: number;
  comparisonSharePercent: number;
  deltaPercentagePoints: number;
}

/*
 * Share-of-total changes below this many percentage points are
 * sampling noise — listing them would bury the handful of real
 * regressions under dozens of ±0.0x jitter rows.
 */
const FUNCTION_DELTA_FLOOR_PERCENTAGE_POINTS: number = 0.1;

/*
 * Eight rows is enough to act on. Anything past that is in long-tail
 * territory where the flame graph itself is the better tool.
 */
const FUNCTION_DELTA_ROW_LIMIT: number = 8;

/**
 * Flatten the merged diff tree into per-function share deltas.
 *
 * The same function appears at many positions in the tree (one node
 * per distinct call path), so its self values are summed across every
 * node keyed by function + file. Line numbers are excluded from the
 * key — they shift on every deploy, the very event a diff exists to
 * analyse. Self (not total) values are aggregated because summing
 * total values across call paths would double-count parents and
 * children of the same frame.
 */
function computeFunctionShareDeltas(
  root: DiffFlamegraphNode,
): Array<FunctionShareDeltaRow> {
  const baselineTotal: number = root.baselineValue;
  const comparisonTotal: number = root.comparisonValue;

  interface FunctionAccumulator {
    functionName: string;
    fileName: string;
    selfBaselineValue: number;
    selfComparisonValue: number;
  }

  const byFunction: Map<string, FunctionAccumulator> = new Map();

  const walk: (node: DiffFlamegraphNode) => void = (
    node: DiffFlamegraphNode,
  ): void => {
    const key: string = `${node.functionName}@${node.fileName}`;
    const existing: FunctionAccumulator | undefined = byFunction.get(key);
    if (existing) {
      existing.selfBaselineValue += node.selfBaselineValue;
      existing.selfComparisonValue += node.selfComparisonValue;
    } else {
      byFunction.set(key, {
        functionName: node.functionName,
        fileName: node.fileName,
        selfBaselineValue: node.selfBaselineValue,
        selfComparisonValue: node.selfComparisonValue,
      });
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);

  const rows: Array<FunctionShareDeltaRow> = [];

  for (const entry of byFunction.values()) {
    const baselineSharePercent: number =
      baselineTotal > 0 ? (entry.selfBaselineValue / baselineTotal) * 100 : 0;
    const comparisonSharePercent: number =
      comparisonTotal > 0
        ? (entry.selfComparisonValue / comparisonTotal) * 100
        : 0;

    rows.push({
      functionName: entry.functionName,
      fileName: entry.fileName,
      baselineSharePercent,
      comparisonSharePercent,
      deltaPercentagePoints: comparisonSharePercent - baselineSharePercent,
    });
  }

  return rows;
}

const DiffFlamegraphWithPresets: FunctionComponent<
  DiffFlamegraphWithPresetsProps
> = (props: DiffFlamegraphWithPresetsProps): ReactElement => {
  const windowMinutes: number = props.windowMinutes ?? 60;
  const [preset, setPreset] = useState<PresetKey>("1h");

  /*
   * Merged diff tree pushed up by the child after each successful
   * fetch — reusing it for the table below avoids a second request
   * for data the graph already holds.
   */
  const [diffRoot, setDiffRoot] = useState<DiffFlamegraphNode | null>(null);
  const [deltaDirection, setDeltaDirection] =
    useState<DeltaDirection>("regressed");

  /*
   * Stable identity: the child invokes this from its fetch path, and
   * a fresh function per render would defeat any memoisation keyed on
   * it downstream.
   */
  const handleDiffDataLoaded: (root: DiffFlamegraphNode | null) => void =
    useCallback((root: DiffFlamegraphNode | null): void => {
      setDiffRoot(root);
    }, []);

  const ranges: {
    baselineStartTime: Date;
    baselineEndTime: Date;
    comparisonStartTime: Date;
    comparisonEndTime: Date;
  } = useMemo(() => {
    /*
     * Anchored mode centers the window on the anchor so the capture
     * moment sits in the middle of the comparison period; otherwise
     * the window ends at "now" (live mode).
     */
    const comparisonEnd: Date = props.anchorTime
      ? OneUptimeDate.addRemoveMinutes(props.anchorTime, windowMinutes / 2)
      : OneUptimeDate.getCurrentDate();
    const comparisonStart: Date = OneUptimeDate.addRemoveMinutes(
      comparisonEnd,
      -windowMinutes,
    );

    const active: Preset =
      PRESETS.find((p: Preset) => {
        return p.key === preset;
      }) || PRESETS[0]!;

    const baselineEnd: Date = OneUptimeDate.addRemoveMinutes(
      comparisonStart,
      -(active.offsetMinutes - windowMinutes),
    );
    const baselineStart: Date = OneUptimeDate.addRemoveMinutes(
      baselineEnd,
      -windowMinutes,
    );

    return {
      comparisonStartTime: comparisonStart,
      comparisonEndTime: comparisonEnd,
      baselineStartTime: baselineStart,
      baselineEndTime: baselineEnd,
    };
  }, [preset, windowMinutes, props.anchorTime?.getTime()]);

  const activePreset: Preset =
    PRESETS.find((p: Preset) => {
      return p.key === preset;
    }) || PRESETS[0]!;

  /*
   * Compared by joined ids (not array identity) for the same reason
   * the child compares its props by value — a parent re-render with a
   * fresh-but-equal array must not wipe a perfectly current table.
   */
  const serviceIdsKey: string = props.serviceIds
    ? props.serviceIds
        .map((id: ObjectID) => {
          return id.toString();
        })
        .join(",")
    : "all";

  /*
   * The held tree was fetched for the previous windows/filters — once
   * those change it describes ranges no longer on screen, so drop it
   * rather than letting a slow or failed reload leave a mismatched
   * table under the new graph.
   */
  useEffect(() => {
    setDiffRoot(null);
  }, [ranges, props.profileType, serviceIdsKey]);

  const functionShareDeltas: Array<FunctionShareDeltaRow> = useMemo(() => {
    return diffRoot ? computeFunctionShareDeltas(diffRoot) : [];
  }, [diffRoot]);

  const regressedRows: Array<FunctionShareDeltaRow> = useMemo(() => {
    return functionShareDeltas
      .filter((row: FunctionShareDeltaRow) => {
        return (
          row.deltaPercentagePoints > FUNCTION_DELTA_FLOOR_PERCENTAGE_POINTS
        );
      })
      .sort((a: FunctionShareDeltaRow, b: FunctionShareDeltaRow) => {
        return b.deltaPercentagePoints - a.deltaPercentagePoints;
      })
      .slice(0, FUNCTION_DELTA_ROW_LIMIT);
  }, [functionShareDeltas]);

  const improvedRows: Array<FunctionShareDeltaRow> = useMemo(() => {
    return functionShareDeltas
      .filter((row: FunctionShareDeltaRow) => {
        return (
          row.deltaPercentagePoints < -FUNCTION_DELTA_FLOOR_PERCENTAGE_POINTS
        );
      })
      .sort((a: FunctionShareDeltaRow, b: FunctionShareDeltaRow) => {
        return a.deltaPercentagePoints - b.deltaPercentagePoints;
      })
      .slice(0, FUNCTION_DELTA_ROW_LIMIT);
  }, [functionShareDeltas]);

  const activeDeltaRows: Array<FunctionShareDeltaRow> =
    deltaDirection === "regressed" ? regressedRows : improvedRows;

  /*
   * Bars are scaled to the worst offender in the visible list so the
   * top row always spans full width and the rest read as ratios of it.
   */
  const maxAbsDeltaPoints: number = activeDeltaRows.reduce(
    (max: number, row: FunctionShareDeltaRow) => {
      return Math.max(max, Math.abs(row.deltaPercentagePoints));
    },
    0,
  );

  return (
    <div className="w-full">
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-xs text-gray-600 leading-relaxed">
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.InformationCircle}
            className="h-3.5 w-3.5 mt-0.5 text-gray-400 flex-shrink-0"
          />
          <div>
            Diff compares the{" "}
            <span className="font-medium text-gray-800">
              {props.anchorTime
                ? `${windowMinutes}-minute window around this capture`
                : `last ${windowMinutes} minutes`}
            </span>{" "}
            against a baseline period. Red frames got slower, green got faster,
            gray stayed the same. Use this to answer{" "}
            <em>&ldquo;what regressed since the last deploy?&rdquo;</em>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
          {PRESETS.map((p: Preset) => {
            const active: boolean = preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                title={p.description}
                onClick={() => {
                  setPreset(p.key);
                }}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  active
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-gray-500">
          {activePreset.description}
        </span>
      </div>

      <DiffFlamegraph
        baselineStartTime={ranges.baselineStartTime}
        baselineEndTime={ranges.baselineEndTime}
        comparisonStartTime={ranges.comparisonStartTime}
        comparisonEndTime={ranges.comparisonEndTime}
        serviceIds={props.serviceIds}
        profileType={props.profileType}
        onDataLoaded={handleDiffDataLoaded}
      />

      {diffRoot && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              {deltaDirection === "regressed"
                ? "Most regressed functions"
                : "Most improved functions"}
            </h3>

            <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => {
                  setDeltaDirection("regressed");
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  deltaDirection === "regressed"
                    ? "bg-white text-red-700 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Most regressed
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeltaDirection("improved");
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  deltaDirection === "improved"
                    ? "bg-white text-green-700 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Most improved
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            {activeDeltaRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                {deltaDirection === "regressed"
                  ? "No functions regressed beyond the noise floor between these windows."
                  : "No functions improved beyond the noise floor between these windows."}
              </div>
            ) : (
              activeDeltaRows.map(
                (row: FunctionShareDeltaRow, index: number) => {
                  const barPercent: number =
                    maxAbsDeltaPoints > 0
                      ? (Math.abs(row.deltaPercentagePoints) /
                          maxAbsDeltaPoints) *
                        100
                      : 0;

                  return (
                    <div
                      key={`${row.functionName}-${row.fileName}-${index}`}
                      className="px-4 py-2.5 border-t border-gray-100 first:border-t-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono text-sm text-gray-900 truncate">
                            {row.functionName || "(anonymous)"}
                          </div>
                          {row.fileName && (
                            <div className="text-[11px] text-gray-400 font-mono truncate">
                              {ProfileUtil.formatFileName(row.fileName, 80)}
                            </div>
                          )}
                        </div>

                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-mono text-gray-700">
                            {row.baselineSharePercent.toFixed(1)}%{" "}
                            <span className="text-gray-400">→</span>{" "}
                            {row.comparisonSharePercent.toFixed(1)}%
                          </div>
                          <div
                            className={`text-[11px] font-medium ${
                              deltaDirection === "regressed"
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {row.deltaPercentagePoints >= 0 ? "+" : ""}
                            {row.deltaPercentagePoints.toFixed(1)} pp
                          </div>
                        </div>
                      </div>

                      <div className="mt-1.5 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            deltaDirection === "regressed"
                              ? "bg-red-400"
                              : "bg-green-400"
                          }`}
                          style={{ width: `${barPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                },
              )
            )}
          </div>

          <div className="mt-2 text-[11px] text-gray-500">
            Share of total self time — immune to traffic volume changes between
            the windows.
          </div>
        </div>
      )}
    </div>
  );
};

export default DiffFlamegraphWithPresets;
