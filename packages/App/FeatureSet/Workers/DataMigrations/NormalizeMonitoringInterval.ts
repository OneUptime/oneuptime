import DataMigrationBase from "./DataMigrationBase";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import MonitoringIntervalUtil, {
  MonitoringIntervalNormalization,
  MonitoringIntervalNormalizationStatus,
} from "Common/Utils/Monitor/MonitoringIntervalUtil";

/*
 * Makes every monitor's `monitoringInterval` column SAY what it means.
 *
 * The column is supposed to hold a 5-field cron expression and nothing ever
 * validated it, so rows accumulated holding "5m", "Every 5 minutes",
 * "1 minute", "every-1-min" and similar. cron-parser threw on all of them
 * and the claim query caught that and fell back to "one minute from now", so
 * a monitor asking for five minutes was probed every ~75 seconds — four
 * times the requested rate, silently, for as long as the row existed. 103
 * monitors across 10 projects were in that state when this was found.
 *
 * Most of them got there by copying OUR OWN Terraform examples, which passed
 * the dropdown LABEL where the API wanted the VALUE. Those examples are
 * fixed in the same change; without that, these rows simply grow back.
 *
 * The scheduler no longer depends on this migration — it reads a human
 * cadence correctly now (MonitorProbeService.resolveNextPingAt), so the
 * over-monitoring stops the moment the code deploys, whether or not this has
 * run. What this fixes is the COLUMN: so the stored value matches what the
 * dashboard shows, so a future read path cannot reintroduce the bug by
 * forgetting to normalize, and so the data stops teaching the next person
 * that a label is acceptable here.
 *
 * Templates first, then monitors. A template's interval is pushed onto every
 * monitor linked to it by syncLinkedMonitors, so cleaning monitors first
 * would let a still-dirty template write the old value straight back.
 *
 * Idempotent, and safe to run twice concurrently as this runner requires
 * (see Workers/Utils/DataMigration.ts): a second pass sees AlreadyCanonical
 * and writes nothing, and two passes writing the same canonical value to the
 * same row cannot disagree.
 *
 * Two kinds of row are deliberately left alone:
 *   - Empty (NULL or blank). That is a legitimate state — a Manual monitor
 *     is never probed — and ~4,177 rows are in it. Writing them would be a
 *     no-op at best and a behaviour change at worst.
 *   - Unrecognized ("every 7 minutes", free text). Nulling it would erase
 *     what the operator asked for while pinning the monitor to the 1-minute
 *     default with no record of why, and guessing at it would be worse.
 *     They are counted and named in a summary log so an operator can fix
 *     them by hand; the runtime behaviour for these is unchanged.
 *
 * Written as a root column write WITHOUT hooks: the monitor's schedule is
 * not changing, only how the row spells it, and running onUpdateSuccess
 * here would refresh nextPingAt for the whole fleet in one burst.
 */
export default class NormalizeMonitoringInterval extends DataMigrationBase {
  public constructor() {
    super("NormalizeMonitoringInterval");
  }

  public override async migrate(): Promise<void> {
    await this.normalizeMonitorTemplates();
    await this.normalizeMonitors();
  }

  private async normalizeMonitorTemplates(): Promise<void> {
    let skip: number = 0;
    let normalizedCount: number = 0;
    const unrecognized: Array<string> = [];

    /*
     * Paged on a stable id order rather than read once at LIMIT_MAX: a fleet
     * larger than one page would otherwise have its tail silently skipped.
     * The write never moves a row within that order, so the page boundaries
     * stay put under the walk.
     */
    while (true) {
      const templates: Array<MonitorTemplate> =
        await MonitorTemplateService.findBy({
          query: {},
          select: {
            _id: true,
            monitoringInterval: true,
          },
          sort: { _id: SortOrder.Ascending },
          skip,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const template of templates) {
        if (!template.id) {
          continue;
        }

        const result: MonitoringIntervalNormalization =
          MonitoringIntervalUtil.normalize(template.monitoringInterval);

        if (
          result.status === MonitoringIntervalNormalizationStatus.Unrecognized
        ) {
          unrecognized.push(
            `${template.id.toString()} (${JSON.stringify(result.input)})`,
          );
          continue;
        }

        if (
          result.status !== MonitoringIntervalNormalizationStatus.Normalized ||
          !result.cron
        ) {
          continue;
        }

        try {
          await MonitorTemplateService.updateColumnsByIdWithoutHooks({
            id: template.id,
            data: {
              monitoringInterval: result.cron,
            },
          });
          normalizedCount++;
        } catch (err) {
          /*
           * One unwritable template must not cost the rest of the fleet its
           * spelling, nor halt every migration queued behind this one — the
           * runtime reads the old value correctly either way.
           */
          logger.error(
            `Failed to normalise the monitoring interval of monitor template ${template.id.toString()}:`,
          );
          logger.error(err);
        }
      }

      if (templates.length < LIMIT_MAX) {
        break;
      }

      skip += templates.length;
    }

    NormalizeMonitoringInterval.logSummary(
      "monitor template",
      normalizedCount,
      unrecognized,
    );
  }

  private async normalizeMonitors(): Promise<void> {
    let skip: number = 0;
    let normalizedCount: number = 0;
    const unrecognized: Array<string> = [];

    while (true) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {},
        select: {
          _id: true,
          monitoringInterval: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const monitor of monitors) {
        if (!monitor.id) {
          continue;
        }

        const result: MonitoringIntervalNormalization =
          MonitoringIntervalUtil.normalize(monitor.monitoringInterval);

        if (
          result.status === MonitoringIntervalNormalizationStatus.Unrecognized
        ) {
          unrecognized.push(
            `${monitor.id.toString()} (${JSON.stringify(result.input)})`,
          );
          continue;
        }

        if (
          result.status !== MonitoringIntervalNormalizationStatus.Normalized ||
          !result.cron
        ) {
          continue;
        }

        try {
          await MonitorService.updateColumnsByIdWithoutHooks({
            id: monitor.id,
            data: {
              monitoringInterval: result.cron,
            },
          });
          normalizedCount++;
        } catch (err) {
          logger.error(
            `Failed to normalise the monitoring interval of monitor ${monitor.id.toString()}:`,
          );
          logger.error(err);
        }
      }

      if (monitors.length < LIMIT_MAX) {
        break;
      }

      skip += monitors.length;
    }

    NormalizeMonitoringInterval.logSummary(
      "monitor",
      normalizedCount,
      unrecognized,
    );
  }

  /*
   * Aggregate, and only when there is something to say — a clean fleet and a
   * re-run both stay silent. The unrecognized rows are NAMED rather than just
   * counted, because an operator cannot act on a count.
   */
  private static logSummary(
    label: string,
    normalizedCount: number,
    unrecognized: Array<string>,
  ): void {
    if (normalizedCount > 0) {
      logger.info(
        `NormalizeMonitoringInterval: rewrote ${normalizedCount} ${label}(s) to a canonical cron expression.`,
      );
    }

    if (unrecognized.length > 0) {
      logger.warn(
        `NormalizeMonitoringInterval: ${unrecognized.length} ${label}(s) have a monitoringInterval that cannot be read as a schedule and were left unchanged. They fall back to a 1-minute cadence until fixed by hand: ${unrecognized
          .slice(0, 50)
          .join(", ")}`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
