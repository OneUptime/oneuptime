import OneUptimeDate from "Common/Types/Date";
import { DailyUptimeEntry } from "Common/Utils/NetworkSite/SiteUptimeUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  entries: Array<DailyUptimeEntry>;
  // Below this, a day is drawn as bad rather than merely imperfect.
  goodThresholdPercent?: number | undefined;
}

const DEFAULT_GOOD_THRESHOLD_PERCENT: number = 99.9;

/*
 * One bar per 24-hour slice, oldest on the left.
 *
 * This exists because a 30-day average cannot show a bad day. A full day of
 * outage inside a 30-day window costs 3.3 points, so a site that was dark
 * for a whole Tuesday still reports 96.7% for the month — a number that
 * looks like a rounding artifact rather than a day-long outage. The strip
 * puts the same data on an axis where one bad day is one bad bar.
 *
 * Four states, deliberately distinguished:
 *   - measured and healthy (green)
 *   - measured and degraded / down (amber / red by depth)
 *   - fully inside a maintenance window (striped amber — there was nothing
 *     left to measure, which is not the same as a perfect day)
 *   - before the site's timeline begins (hollow — we were not watching)
 */
const SiteDailyUptimeStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const goodThreshold: number =
    props.goodThresholdPercent ?? DEFAULT_GOOD_THRESHOLD_PERCENT;

  if (props.entries.length === 0) {
    return <></>;
  }

  type ToneFunction = (entry: DailyUptimeEntry) => string;

  const toneClass: ToneFunction = (entry: DailyUptimeEntry): string => {
    if (entry.isFullyMaintained) {
      return "bg-amber-200";
    }
    if (!entry.hasTimelineCoverage || entry.uptimePercent === null) {
      return "border border-dashed border-gray-300 bg-white";
    }
    if (entry.uptimePercent >= goodThreshold) {
      return "bg-emerald-500";
    }
    if (entry.uptimePercent >= 95) {
      return "bg-amber-400";
    }
    return "bg-red-500";
  };

  type LabelFunction = (entry: DailyUptimeEntry) => string;

  const tooltipFor: LabelFunction = (entry: DailyUptimeEntry): string => {
    const day: string = OneUptimeDate.getDateAsLocalFormattedString(
      entry.dayStart,
      true,
    );

    if (entry.isFullyMaintained) {
      return `${day} — entirely inside a scheduled maintenance window; not counted.`;
    }

    if (!entry.hasTimelineCoverage || entry.uptimePercent === null) {
      return `${day} — no rollup history yet.`;
    }

    const maintenanceNote: string =
      entry.maintenanceInMs > 0
        ? ` (${Math.round(entry.maintenanceInMs / 60000)} min of maintenance excluded)`
        : "";

    return `${day} — ${entry.uptimePercent.toFixed(2)}% uptime${maintenanceNote}`;
  };

  return (
    <div data-testid="site-daily-uptime-strip">
      <div className="flex items-end gap-[3px]">
        {props.entries.map(
          (entry: DailyUptimeEntry, index: number): ReactElement => {
            return (
              <div
                key={index}
                title={tooltipFor(entry)}
                className={`h-8 flex-1 rounded-sm ${toneClass(entry)}`}
              />
            );
          },
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
        <span>
          {OneUptimeDate.getDateAsLocalFormattedString(
            props.entries[0]!.dayStart,
            true,
          )}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
};

export default SiteDailyUptimeStrip;
