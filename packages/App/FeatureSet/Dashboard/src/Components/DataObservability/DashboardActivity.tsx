import RelativeTime from "../EpisodeView/RelativeTime";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import {
  DataBiRefreshStatus,
  DataDashboardRefresh,
  DataDashboardRefreshHistory,
  getDataDashboardRefreshTime,
} from "Common/Types/DataObservability/DataDashboardActivity";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";

/*
 * How a BI dashboard is used and how fresh its data is, drawn the same way
 * on BI Dashboards and on a table's Lineage tab: a refresh's status as a
 * pill, times as "2 hours ago" with the full time on hover.
 */

// A refresh's status, at a glance.
export function getRefreshStatusPill(
  status: string | null | undefined,
  size?: PillSize | undefined,
): ReactElement {
  switch (status) {
    case DataBiRefreshStatus.Completed:
      return <Pill text="Refreshed" color={Green500} size={size} />;
    case DataBiRefreshStatus.Failed:
      return <Pill text="Refresh Failed" color={Red500} size={size} />;
    case DataBiRefreshStatus.Cancelled:
      return <Pill text="Refresh Cancelled" color={Red500} size={size} />;
    case DataBiRefreshStatus.InProgress:
      return <Pill text="Refreshing" color={Yellow500} size={size} />;
    case DataBiRefreshStatus.Disabled:
      return <Pill text="Refresh Disabled" color={Gray500} size={size} />;
    default:
      return <Pill text="Refresh Unknown" color={Gray500} size={size} />;
  }
}

/*
 * A time as "2 hours ago", with the full date and time on hover: in the
 * reader's language, or inside a sentence in the sentence's.
 */
export function TimeAgo(props: {
  at: Date | string;
  className?: string | undefined;
}): ReactElement {
  return (
    <RelativeTime
      date={OneUptimeDate.fromString(props.at)}
      className={props.className || "text-xs text-gray-500"}
    />
  );
}

const REFRESHES_IN_A_WEEK: PluralTemplate = {
  one: "{{count}} refresh in the last 7 days",
  other: "{{count}} refreshes in the last 7 days",
};

/*
 * "12,873 views", "1 viewer in the last 28 days": translatePlural writes
 * {{count}} the reader's way ("12.873", "۱۲٬۸۷۳") unless it is handed a
 * count of its own, so these are filled with the count alone.
 */
export const VIEWS: PluralTemplate = {
  one: "{{count}} view",
  other: "{{count}} views",
};

export const VIEWERS_IN_28_DAYS: PluralTemplate = {
  one: "{{count}} viewer in the last 28 days",
  other: "{{count}} viewers in the last 28 days",
};

// "3 of 24 failed in the last 7 days", or the count alone when none failed.
export function getRefreshCountText(
  translator: Translator,
  history: DataDashboardRefreshHistory | null,
): string | null {
  if (!history || history.refreshCount === null) {
    return null;
  }

  // Counts written the reader's way: "1,408", "1.408", "۱٬۴۰۸".
  if (history.failureCount) {
    return translator.translateTemplate(
      "{{failed}} of {{count}} failed in the last 7 days",
      {
        failed: translator.formatNumber(history.failureCount),
        count: translator.formatNumber(history.refreshCount),
      },
    );
  }

  return translator.translatePlural(REFRESHES_IN_A_WEEK, history.refreshCount);
}

/*
 * A refresh's error, as its tool wrote it (Power BI's are English): on a
 * line of its own that reads the error's way, so on an Arabic or Persian
 * page a long one is cut at its own end and keeps its full stop.
 */
export function RefreshError(props: {
  error: string;
  className: string;
}): ReactElement {
  return (
    <IsolatedLine
      as="span"
      text={props.error}
      title={props.error}
      className={props.className}
      dataTestId="refresh-error"
    />
  );
}

// One refresh on a line: its status, when, and a failed one's error.
export function RefreshLine(props: {
  refresh: DataDashboardRefresh;
}): ReactElement {
  const at: string | null = getDataDashboardRefreshTime(props.refresh);

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {getRefreshStatusPill(props.refresh.status, PillSize.Small)}
      {at ? <TimeAgo at={at} /> : <></>}
      {props.refresh.error ? (
        <RefreshError
          error={props.refresh.error}
          className="max-w-md truncate text-xs text-red-600"
        />
      ) : (
        <></>
      )}
    </span>
  );
}
