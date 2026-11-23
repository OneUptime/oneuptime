import GlobalCache from "../../Infrastructure/GlobalCache";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import {
  MAX_SERIES_BEHIND_STATUS,
  SeriesBehindStatusReader,
} from "./GroupedMonitorRecovery";

/*
 * The series behind a grouped monitor's status, kept between its checks in
 * Redis, one key per monitor step (GroupedMonitorRecovery says what they are
 * and why they must be kept).
 *
 * Read at most once per evaluation, and only while the monitor is not at its
 * default status: at its default status nothing is behind it. Written by
 * MonitorResource under the monitor's evaluation lock, after the check is
 * judged - every check while some series is behind the status, which also
 * keeps the key from running out, and deleted once none is.
 *
 * Nothing here throws. A Redis that cannot be reached reads as "none behind
 * the status", and a recovery criteria then matches on any series, as it did
 * before the rule.
 */
export default class SeriesBehindStatus implements SeriesBehindStatusReader {
  public static readonly NAMESPACE: string = "monitor-series-behind-status";

  /*
   * Refreshed by every check that writes it: only a monitor that is not
   * checked for this long loses what is behind its status.
   */
  public static readonly EXPIRES_IN_SECONDS: number =
    OneUptimeDate.getSecondsInDays(7);

  private readonly key: string | null;

  private series: Promise<ReadonlySet<string>> | null = null;

  private constructor(key: string | null) {
    this.key = key;
  }

  public static forMonitorStep(input: {
    monitorId: ObjectID | null | undefined;
    monitorStepId: ObjectID | string | null | undefined;
  }): SeriesBehindStatus {
    if (!input.monitorId || !input.monitorStepId) {
      return new SeriesBehindStatus(null);
    }

    return new SeriesBehindStatus(
      `${input.monitorId.toString().toLowerCase()}-${input.monitorStepId
        .toString()
        .toLowerCase()}`,
    );
  }

  // Read once, then from memory. Never throws.
  public getSeries(): Promise<ReadonlySet<string>> {
    if (!this.series) {
      this.series = this.read();
    }

    return this.series;
  }

  /*
   * Keeps what is behind the status after a check; none deletes the key.
   * Never throws.
   */
  public async keep(fingerprints: ReadonlyArray<string>): Promise<void> {
    if (!this.key) {
      return;
    }

    const kept: Array<string> = fingerprints
      .filter((fingerprint: string): boolean => {
        return typeof fingerprint === "string" && fingerprint.length > 0;
      })
      .slice(0, MAX_SERIES_BEHIND_STATUS);

    try {
      if (kept.length === 0) {
        await GlobalCache.deleteKey(SeriesBehindStatus.NAMESPACE, this.key);
      } else {
        await GlobalCache.setStringArray(
          SeriesBehindStatus.NAMESPACE,
          this.key,
          kept,
          { expiresInSeconds: SeriesBehindStatus.EXPIRES_IN_SECONDS },
        );
      }
    } catch (err) {
      logger.debug("Could not keep the series behind a monitor's status.");
      logger.debug(err);
    }

    // What the next read in this evaluation would find.
    this.series = Promise.resolve(new Set<string>(kept));
  }

  private async read(): Promise<ReadonlySet<string>> {
    if (!this.key) {
      return new Set<string>();
    }

    try {
      const stored: Array<string> | null = await GlobalCache.getStringArray(
        SeriesBehindStatus.NAMESPACE,
        this.key,
      );

      return new Set<string>(
        (stored || []).filter((fingerprint: unknown): boolean => {
          return typeof fingerprint === "string" && fingerprint.length > 0;
        }),
      );
    } catch (err) {
      logger.debug("Could not read the series behind a monitor's status.");
      logger.debug(err);
      return new Set<string>();
    }
  }
}
