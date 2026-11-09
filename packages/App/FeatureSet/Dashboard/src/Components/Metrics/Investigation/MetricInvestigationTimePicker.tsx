import React, { FunctionComponent, ReactElement, useMemo } from "react";
import TimeRange from "Common/Types/Time/TimeRange";
import TimeRangePickerDropdown, {
  TIME_RANGE_PRESET_OPTIONS,
  TimeRangePickerMomentOption,
  TimeRangePickerMoments,
  TimeRangePickerPresetOption,
  getTimeRangeButtonLabel,
} from "Common/UI/Components/Date/TimeRangePickerDropdown";
import { TIME_RANGE_DROPDOWN_WIDTH_IN_PX } from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
} from "./MetricInvestigationTime";
import { InvestigationTimeRangeState } from "./UseInvestigationTimeRange";

// Above the ranges the page anchors, when the page does not name them.
export const DEFAULT_PRESETS_HEADING: string = translationKey("Suggested");

// Above the ranges relative to now, when the page anchors ranges of its own.
export const RELATIVE_TO_NOW_HEADING: string =
  translationKey("Relative to now");

export const METRIC_INVESTIGATION_TIME_PICKER_TEST_ID_PREFIX: string =
  "metric-investigation-time";

export interface ComponentProps {
  /*
   * The time range it picks: a metric investigation's
   * (useMetricInvestigation), or one a card holds with no metrics of its
   * own (useInvestigationTimeRange: an incident's logs, traces or
   * exceptions).
   */
  investigation: InvestigationTimeRangeState;
  /*
   * English heading above the ranges the page anchors ("Around this
   * incident"). Wrap it in translationKey where it is written.
   */
  presetsHeading?: string | undefined;
  // The ranges relative to now to offer; every one the picker has if left out.
  relativeRanges?: Array<TimeRange> | undefined;
}

/**
 * Picks the time range of a metric investigation: the ranges the page
 * anchors on what it is about ("Around the start", each with the window it
 * covers), the ranges relative to now, and a custom range, with Reset zoom
 * beside it while a drag on a chart has zoomed the investigation.
 *
 * Any number of these can sit on a page, all picking the one range: the
 * incident page puts one on each tab of its telemetry card, whether that
 * card charts metrics or lists logs, traces or exceptions.
 */
const MetricInvestigationTimePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const investigation: InvestigationTimeRangeState = props.investigation;

  const presetOptions: Array<TimeRangePickerPresetOption> | undefined =
    useMemo((): Array<TimeRangePickerPresetOption> | undefined => {
      if (!props.relativeRanges) {
        return undefined;
      }

      const relativeRanges: Array<TimeRange> = props.relativeRanges;

      return TIME_RANGE_PRESET_OPTIONS.filter(
        (option: TimeRangePickerPresetOption): boolean => {
          return relativeRanges.includes(option.range);
        },
      );
    }, [props.relativeRanges?.join("|")]);

  const presets: Array<MetricInvestigationTimePreset> = investigation.presets;
  const selectedPresetId: string | null =
    investigation.selection.kind === MetricInvestigationTimeKind.Preset
      ? investigation.selection.presetId
      : null;

  const moments: TimeRangePickerMoments | undefined =
    presets.length > 0
      ? {
          heading: props.presetsHeading || DEFAULT_PRESETS_HEADING,
          presetsHeading: RELATIVE_TO_NOW_HEADING,
          options: presets.map(
            (
              preset: MetricInvestigationTimePreset,
            ): TimeRangePickerMomentOption => {
              return {
                id: preset.id,
                label: preset.label,
                // The window it covers, written as a custom range is.
                detail: getTimeRangeButtonLabel({
                  range: TimeRange.CUSTOM,
                  startAndEndDate: preset.window,
                }),
              };
            },
          ),
          selectedId: selectedPresetId,
          onSelect: investigation.selectPreset,
        }
      : undefined;

  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <TimeRangePickerDropdown
        value={investigation.pickerValue}
        onChange={investigation.selectPickerValue}
        dataTestIdPrefix={METRIC_INVESTIGATION_TIME_PICKER_TEST_ID_PREFIX}
        dropdownWidthInPx={TIME_RANGE_DROPDOWN_WIDTH_IN_PX}
        moments={moments}
        presetOptions={presetOptions}
      />
      {/*
       * The investigation's own zoom, offered to this button alone: the
       * picker can sit in a card whose contents keep zooms of their own
       * (a companion tab's explorer), where the page offers none.
       */}
      <TimeRangeZoomProvider zoom={investigation.zoom}>
        <ResetTimeRangeZoomButton />
      </TimeRangeZoomProvider>
    </div>
  );
};

export default MetricInvestigationTimePicker;
