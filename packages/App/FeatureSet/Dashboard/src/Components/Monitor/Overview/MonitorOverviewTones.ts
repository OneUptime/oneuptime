import { StatusBadgeType } from "Common/UI/Components/StatusBadge/StatusBadge";
import { MonitorOverviewTone } from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeHealth } from "Common/Utils/Monitor/MonitorOverviewProbeUtil";

/*
 * The monitor overview's colour vocabulary, as literal class strings.
 *
 * Every class here is one Theme.css remaps for dark mode, and each is written
 * out in full (never assembled from a tone name) so the runtime Tailwind
 * scanner can see it. Status colours themselves never become classes: they
 * are applied inline on the small dots, because a project can pick any
 * colour for a status.
 */

// The hero's icon tile.
export const TONE_TILE_CLASS: Record<MonitorOverviewTone, string> = {
  good: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
  neutral: "bg-gray-100 text-gray-500",
};

// A fact's value. Neutral reads as ordinary text, not as a muted grey.
export const TONE_TEXT_CLASS: Record<MonitorOverviewTone, string> = {
  good: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-red-700",
  info: "text-sky-700",
  neutral: "text-gray-900",
};

export const TONE_BADGE: Record<MonitorOverviewTone, StatusBadgeType> = {
  good: StatusBadgeType.Success,
  warning: StatusBadgeType.Warning,
  danger: StatusBadgeType.Danger,
  info: StatusBadgeType.Info,
  neutral: StatusBadgeType.Neutral,
};

export type MonitorOverviewFactCount = 1 | 2 | 3 | 4;

/*
 * The facts band never has more than four entries. Three sit in one row from
 * sm up; four go through a 2 x 2 grid before they spread across at xl, the
 * same steps the stat bar takes.
 */
export const FACT_GRID_CLASS: Record<MonitorOverviewFactCount, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
};

export const getFactGridClass: (factCount: number) => string = (
  factCount: number,
): string => {
  const clamped: number = Math.min(4, Math.max(1, Math.floor(factCount) || 1));

  return FACT_GRID_CLASS[clamped as MonitorOverviewFactCount];
};

// The status text on the right of each row in the Probes card.
export const PROBE_HEALTH_TEXT_CLASS: Record<
  MonitorOverviewProbeHealth,
  string
> = {
  [MonitorOverviewProbeHealth.Up]: "text-emerald-700",
  [MonitorOverviewProbeHealth.Down]: "text-red-700",
  [MonitorOverviewProbeHealth.Disconnected]: "text-red-700",
  [MonitorOverviewProbeHealth.Late]: "text-amber-700",
  [MonitorOverviewProbeHealth.NoResultYet]: "text-gray-500",
  [MonitorOverviewProbeHealth.TurnedOff]: "text-gray-500",
  [MonitorOverviewProbeHealth.Reported]: "text-gray-700",
};
