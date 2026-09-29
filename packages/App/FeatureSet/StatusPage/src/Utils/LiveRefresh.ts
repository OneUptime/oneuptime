/*
 * When the status page refreshes itself, and how it says how old what you are
 * looking at is.
 *
 * A status page is not a page you visit once. It is a page you leave open on a
 * second monitor while an incident runs, and until now it never changed after
 * the first paint - a visitor watching for "resolved" was watching a snapshot
 * of whenever they happened to load it, with nothing on the page saying so.
 *
 * All of this is pure so the cadence and the wording can be tested without a
 * renderer and without waiting real seconds.
 */

export interface RelativeTimeParts {
  /*
   * Negative for the past, which is the direction Intl.RelativeTimeFormat
   * expects: format(-5, "minute") is "5 minutes ago".
   */
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

export default class StatusPageLiveRefreshUtil {
  /*
   * Slow enough that a page left open all day is not a load generator, fast
   * enough that "is it back yet?" is answered without a manual reload. Both
   * the poll and the staleness check below use it.
   */
  public static readonly RefreshIntervalInSeconds: number = 60;

  /*
   * Under this, say "now" rather than counting seconds. A readout that ticks
   * 1, 2, 3 next to a status is a distraction, not information.
   */
  public static readonly JustNowThresholdInSeconds: number = 10;

  public static getSecondsSince(data: { from: Date; now: Date }): number {
    const milliseconds: number = data.now.getTime() - data.from.getTime();

    /*
     * A clock that moved backwards (a device syncing NTP, a laptop waking) must
     * not produce "in 3 minutes" next to a live status.
     */
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return 0;
    }

    return Math.floor(milliseconds / 1000);
  }

  public static getRelativeTimeParts(secondsAgo: number): RelativeTimeParts {
    const seconds: number =
      Number.isFinite(secondsAgo) && secondsAgo > 0
        ? Math.floor(secondsAgo)
        : 0;

    if (seconds < this.JustNowThresholdInSeconds) {
      // Intl with numeric "auto" renders 0 seconds as "now".
      return { value: 0, unit: "second" };
    }

    if (seconds < 60) {
      return { value: -seconds, unit: "second" };
    }

    if (seconds < 60 * 60) {
      return { value: -Math.floor(seconds / 60), unit: "minute" };
    }

    if (seconds < 60 * 60 * 24) {
      return { value: -Math.floor(seconds / (60 * 60)), unit: "hour" };
    }

    return { value: -Math.floor(seconds / (60 * 60 * 24)), unit: "day" };
  }

  /*
   * "12 seconds ago", "vor 12 Sekunden", "il y a 12 secondes".
   *
   * Intl.RelativeTimeFormat is what makes this translatable without a
   * translation file: it already knows every locale's plural rules, which a
   * hand written "{{total}} minutes ago" key does not (Russian alone needs
   * three forms). A runtime without it - or a locale tag it rejects - falls
   * back to English rather than throwing on a page whose whole job is to be
   * up when other things are not.
   */
  public static formatRelativeTime(data: {
    secondsAgo: number;
    locale?: string | undefined;
  }): string {
    const parts: RelativeTimeParts = this.getRelativeTimeParts(data.secondsAgo);

    try {
      const formatter: Intl.RelativeTimeFormat = new Intl.RelativeTimeFormat(
        data.locale || "en",
        { numeric: "auto" },
      );

      return formatter.format(parts.value, parts.unit);
    } catch {
      return this.formatRelativeTimeInEnglish(parts);
    }
  }

  private static formatRelativeTimeInEnglish(parts: RelativeTimeParts): string {
    const magnitude: number = Math.abs(parts.value);

    if (magnitude === 0) {
      return "now";
    }

    const unit: string = magnitude === 1 ? parts.unit : `${parts.unit}s`;

    return `${magnitude} ${unit} ago`;
  }

  /*
   * Whether a poll that has just come due should actually fire.
   *
   * A hidden tab is a tab nobody is reading, and a status page pinned in a
   * background tab for eight hours would otherwise make 480 requests nobody
   * sees. Coming back to the tab is handled by the caller, which asks this
   * same question on visibilitychange - so a tab hidden for an hour refreshes
   * the moment it is looked at rather than up to a minute later.
   */
  public static shouldRefreshNow(data: {
    secondsSinceLastRefresh: number;
    isDocumentVisible: boolean;
    isAlreadyRefreshing: boolean;
    intervalInSeconds?: number | undefined;
  }): boolean {
    if (!data.isDocumentVisible) {
      return false;
    }

    if (data.isAlreadyRefreshing) {
      return false;
    }

    const interval: number =
      data.intervalInSeconds || this.RefreshIntervalInSeconds;

    return data.secondsSinceLastRefresh >= interval;
  }
}
