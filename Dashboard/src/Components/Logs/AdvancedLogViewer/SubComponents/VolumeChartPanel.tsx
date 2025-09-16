import React, { FunctionComponent, ReactElement } from "react";
import Log from "Common/Models/AnalyticsModels/Log";
import LogVolumeChart from "../LogVolumeChart";

export interface VolumeChartPanelProps {
  logs: Array<Log>;
  from: Date | null;
  to: Date | null;
  timeRangePreset: string;
}

const VolumeChartPanel: FunctionComponent<VolumeChartPanelProps> = (
  props: VolumeChartPanelProps,
): ReactElement => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          Log Volume
        </span>
        {props.timeRangePreset ? (
          <span className="text-slate-400">
            Preset: {props.timeRangePreset}
          </span>
        ) : null}
      </div>
      <LogVolumeChart logs={props.logs} from={props.from} to={props.to} />
    </div>
  );
};

export default VolumeChartPanel;
