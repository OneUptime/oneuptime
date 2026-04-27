import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import DiffFlamegraph from "./DiffFlamegraph";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface DiffFlamegraphWithPresetsProps {
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  /**
   * Width of the "now" window (in minutes). The comparison period is
   * `[now - windowMinutes, now]` and the baseline is the same window
   * shifted by the preset's offset.
   */
  windowMinutes?: number | undefined;
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

const DiffFlamegraphWithPresets: FunctionComponent<
  DiffFlamegraphWithPresetsProps
> = (props: DiffFlamegraphWithPresetsProps): ReactElement => {
  const windowMinutes: number = props.windowMinutes ?? 60;
  const [preset, setPreset] = useState<PresetKey>("1h");

  const ranges: {
    baselineStartTime: Date;
    baselineEndTime: Date;
    comparisonStartTime: Date;
    comparisonEndTime: Date;
  } = useMemo(() => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const comparisonStart: Date = OneUptimeDate.addRemoveMinutes(
      now,
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
      comparisonEndTime: now,
      baselineStartTime: baselineStart,
      baselineEndTime: baselineEnd,
    };
  }, [preset, windowMinutes]);

  const activePreset: Preset =
    PRESETS.find((p: Preset) => {
      return p.key === preset;
    }) || PRESETS[0]!;

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
              last {windowMinutes} minutes
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
      />
    </div>
  );
};

export default DiffFlamegraphWithPresets;
