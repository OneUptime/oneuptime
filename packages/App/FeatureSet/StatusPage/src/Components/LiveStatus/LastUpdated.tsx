import IconProp from "Common/Types/Icon/IconProp";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import StatusPageLiveRefreshUtil from "../../Utils/LiveRefresh";
import OneUptimeDate from "Common/Types/Date";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  /* When the data currently on screen was fetched. */
  lastRefreshedAt: Date;
  isRefreshing: boolean;
  /* Set when the last background refresh failed; what is on screen is stale. */
  refreshError?: string | null | undefined;
  onRefreshClick: () => void;
}

/*
 * "Updated 12 seconds ago", and a button to do it now.
 *
 * The point of this line is not the button - it is the sentence. A status page
 * is read during an outage, often from a tab that has been open a while, and
 * without a timestamp there is no way to tell a page that says "operational"
 * because everything recovered from one that says it because it was loaded
 * before anything broke.
 */
const LastUpdated: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t, i18n } = useTranslation();

  /*
   * Re-render on a timer so the sentence ages while the page sits still.
   * Every ten seconds is enough for a readout whose smallest step is ten
   * seconds, and cheap enough to leave running.
   */
  const [now, setNow] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, 10 * 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const secondsAgo: number = StatusPageLiveRefreshUtil.getSecondsSince({
    from: props.lastRefreshedAt,
    now: now,
  });

  const relativeTime: string = StatusPageLiveRefreshUtil.formatRelativeTime({
    secondsAgo: secondsAgo,
    locale: i18n.resolvedLanguage || i18n.language || "en",
  });

  const hasError: boolean = Boolean(props.refreshError);

  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      data-testid="status-page-last-updated"
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {hasError ? (
          <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-amber-500" />
        ) : (
          <span
            className={`h-1.5 w-1.5 rounded-full bg-emerald-500${
              props.isRefreshing ? " animate-pulse" : ""
            }`}
            aria-hidden="true"
          />
        )}
        {/*
         * Deliberately not a live region. It changes every ten seconds; a
         * screen reader reading "updated 40 seconds ago" over the page every
         * ten seconds would make the page unusable. The status itself is the
         * live region - see the overview's status banner.
         */}
        <span data-testid="status-page-last-updated-text">
          {hasError
            ? t("liveStatus.refreshFailed", {
                defaultValue:
                  "Could not refresh. Showing the last known status.",
              })
            : t("liveStatus.updated", {
                time: relativeTime,
                defaultValue: "Updated {{time}}",
              })}
        </span>
      </div>

      <button
        type="button"
        onClick={props.onRefreshClick}
        disabled={props.isRefreshing}
        data-testid="status-page-refresh-button"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon
          icon={IconProp.Refresh}
          thick={ThickProp.Thick}
          className={`h-3.5 w-3.5${props.isRefreshing ? " animate-spin" : ""}`}
        />
        {props.isRefreshing
          ? t("liveStatus.refreshing", { defaultValue: "Refreshing" })
          : t("liveStatus.refresh", { defaultValue: "Refresh" })}
      </button>
    </div>
  );
};

export default LastUpdated;
