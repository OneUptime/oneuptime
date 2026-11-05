import { addUtcDays, addUtcMonths, startOfUtcMonth } from "../../../Types/Cloud/CloudCost";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackCapacityHost,
  OpenStackInstancesOnHost,
} from "../../../Types/OpenStack/OpenStackCapacity";
import {
  OpenStackCapacityFlavor,
  OpenStackCapacityFlavorSourceRow,
  OpenStackCapacityHostSourceRow,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import {
  OpenStackPriceList,
  OpenStackUsageCost,
  getOpenStackUsageCost,
} from "../../../Types/OpenStack/OpenStackPriceList";
import {
  OpenStackAppliedReading,
  OpenStackProjectHolding,
  OpenStackUsageInterval,
  OpenStackUsageQuantities,
  OpenStackUsageRows,
  OpenStackUsageSlice,
  OpenStackUsageTotals,
  applyOpenStackUsageReading,
  getEmptyOpenStackUsageQuantities,
  getOpenStackFlavorUsageKey,
  getOpenStackProjectHoldings,
  getOpenStackUsageInterval,
  getOpenStackUsageTotals,
  hasOpenStackUsage,
  sumOpenStackUsageQuantities,
  toOpenStackUsageDay,
  toOpenStackUsageMonth,
} from "../../../Types/OpenStack/OpenStackProjectUsage";
import {
  OPENSTACK_SPEND_DAYS_KEPT,
  OPENSTACK_SPEND_MONTHS_KEPT,
  OpenStackProjectCost,
  OpenStackRatedByPeriod,
  OpenStackSpendComparison,
  OpenStackSpendCoverage,
  OpenStackSpendDay,
  OpenStackSpendMonth,
  OpenStackSpendProject,
  OpenStackSpendSnapshot,
  addOpenStackSpendCoverage,
  getOpenStackOnCourseFor,
  getOpenStackPriceListKey,
  getOpenStackProjectCost,
  getOpenStackProjectGrowth,
  getOpenStackSameDayLastMonth,
  getOpenStackSpendBreakdown,
  getOpenStackSpendDomains,
  getOpenStackSpendGrowers,
  getOpenStackSpendSource,
  getOpenStackVcpuHoursOnCourseFor,
  readOpenStackRatedByPeriod,
} from "../../../Types/OpenStack/OpenStackSpendSnapshot";
import {
  OPENSTACK_WASTE_EVERY_MINUTES,
  OpenStackMovableHostFlavor,
  OpenStackWasteFinding,
  getOpenStackImagesInUse,
  getOpenStackMovableHosts,
  getOpenStackWasteFindings,
} from "../../../Types/OpenStack/OpenStackWaste";
import OpenStackProjectUsageService, {
  OpenStackUsageDomainRow,
  OpenStackUsagePeriodRow,
  OpenStackUsageProjectRow,
  OpenStackUsageRowWrite,
  OpenStackWasteRows,
} from "../../Services/OpenStackProjectUsageService";
import OpenStackResourceService, {
  OpenStackCapacityRows,
} from "../../Services/OpenStackResourceService";
import logger from "../Logger";

/*
 * ONE CLOUD'S USAGE, READ AND KEPT.
 *
 * Every quarter of an hour: what each project holds now, multiplied by the time since the last
 * reading, added to its month. At each midnight, each project's month so far is kept as that day's
 * row, which is what a day's own hours and the same day last month are taken from. Then what the
 * Spend page says is worked out from those rows and kept in one column.
 *
 * Nothing reads a metric store, and nothing writes a series. So it costs a cloud the same whichever
 * of its instances' series it keeps, and costs the telemetry bill nothing.
 *
 * Saving is one transaction, whose last statement moves the time this cloud has been read up to, and
 * fails if it has already moved. See OpenStackProjectUsageService.saveReading.
 */

function getPreviousMonth(now: Date): string {
  return toOpenStackUsageMonth(addUtcMonths(startOfUtcMonth(now), -1));
}

function isDue(
  lastAt: string | null | undefined,
  everyMinutes: number,
  now: Date,
): boolean {
  if (!lastAt) {
    return true;
  }
  const last: number = new Date(lastAt).getTime();
  return (
    !Number.isFinite(last) ||
    now.getTime() - last >= everyMinutes * 60 * 1000
  );
}

function getCloudCost(
  costs: ReadonlyArray<{ amount: number | null }>,
): number | null {
  let total: number | null = null;

  for (const cost of costs) {
    if (cost.amount !== null) {
      total = (total || 0) + cost.amount;
    }
  }

  return total === null ? null : Math.round(total * 10000) / 10000;
}

// The figures a finished day says, taken from its month as it stood at midnight, and the midnight before.
export function getOpenStackSpendDay(data: {
  day: string;
  monthAtMidnight: OpenStackUsageTotals;
  monthAtLastMidnight: OpenStackUsageTotals | null;
}): OpenStackSpendDay {
  const before: OpenStackUsageTotals | null = data.monthAtLastMidnight;
  const since: (key: keyof OpenStackUsageTotals) => number = (
    key: keyof OpenStackUsageTotals,
  ): number => {
    return Math.max(0, data.monthAtMidnight[key] - (before ? before[key] : 0));
  };

  return {
    day: data.day,
    vcpuHours: since("vcpuHours"),
    memoryGbHours: since("memoryGbHours"),
    volumeGbHours: since("volumeGbHours"),
    floatingIpHours: since("floatingIpHours"),
  };
}

export interface OpenStackUsageRefreshResult {
  snapshot: OpenStackSpendSnapshot;
  // Each project's row of this month, for what the budgets read.
  projects: Array<OpenStackSpendProject>;
  wasSaved: boolean;
  rowsWritten: number;
}

export default class OpenStackUsageRefresh {
  public static async refresh(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    lastReadAt: Date | null;
    previous: OpenStackSpendSnapshot | null;
    priceList: OpenStackPriceList | null;
    now: Date;
  }): Promise<OpenStackUsageRefreshResult> {
    const { projectId, openStackCloudId, lastReadAt, priceList, now } = data;
    const previous: OpenStackSpendSnapshot | null = data.previous;
    const thisMonth: string = toOpenStackUsageMonth(now);
    const lastMonth: string = getPreviousMonth(now);

    const usageRows: OpenStackUsageRows =
      await OpenStackProjectUsageService.getUsageRows({
        projectId,
        openStackCloudId,
      });
    const holdings: Array<OpenStackProjectHolding> =
      getOpenStackProjectHoldings(usageRows);
    const holdingOf: Map<string, OpenStackProjectHolding> = new Map(
      holdings.map(
        (holding: OpenStackProjectHolding): [string, OpenStackProjectHolding] => {
          return [holding.openStackProjectId, holding];
        },
      ),
    );

    const named: {
      projects: Array<OpenStackUsageProjectRow>;
      domains: Array<OpenStackUsageDomainRow>;
    } = await OpenStackProjectUsageService.getUsageProjects({
      projectId,
      openStackCloudId,
    });
    const projectRows: Map<string, OpenStackUsageProjectRow> = new Map(
      named.projects.map(
        (row: OpenStackUsageProjectRow): [string, OpenStackUsageProjectRow] => {
          return [row.openStackProjectId, row];
        },
      ),
    );
    const domainNames: Map<string, string | null> = new Map(
      named.domains.map(
        (row: OpenStackUsageDomainRow): [string, string | null] => {
          return [row.domainId, row.name];
        },
      ),
    );

    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt,
      now,
    });

    /*
     * The months this reading touches: this one, the last one for comparing against, and whichever
     * a day it finishes falls in.
     */
    const monthsToRead: Set<string> = new Set([thisMonth, lastMonth]);

    for (const slice of interval.slices) {
      monthsToRead.add(slice.month);
    }
    if (interval.closesDay) {
      monthsToRead.add(interval.closesDay.slice(0, 7));
    }

    const stored: Map<string, Map<string, OpenStackUsagePeriodRow>> = new Map();

    for (const month of monthsToRead) {
      const rows: Array<OpenStackUsagePeriodRow> =
        await OpenStackProjectUsageService.getPeriodRows({
          projectId,
          openStackCloudId,
          period: month,
        });
      stored.set(
        month,
        new Map(
          rows.map(
            (row: OpenStackUsagePeriodRow): [string, OpenStackUsagePeriodRow] => {
              return [row.openStackProjectId, row];
            },
          ),
        ),
      );
    }

    const quantitiesOfMonths: Map<
      string,
      Map<string, OpenStackUsageQuantities>
    > = new Map();

    for (const [month, rows] of stored) {
      const quantities: Map<string, OpenStackUsageQuantities> = new Map();
      for (const [id, row] of rows) {
        quantities.set(id, row.quantities);
      }
      quantitiesOfMonths.set(month, quantities);
    }

    const applied: OpenStackAppliedReading = applyOpenStackUsageReading({
      months: quantitiesOfMonths,
      holdings,
      interval,
    });

    const lastMonthRows: Map<string, OpenStackUsageQuantities> =
      applied.months.get(lastMonth) || new Map();
    const thisMonthRows: Map<string, OpenStackUsageQuantities> =
      applied.months.get(thisMonth) || new Map();
    const isLastMonthRead: boolean = lastMonthRows.size > 0;

    // A project used last month shows this month too, as having used nothing yet.
    const projectIds: Set<string> = new Set([
      ...thisMonthRows.keys(),
      ...holdingOf.keys(),
      ...lastMonthRows.keys(),
    ]);

    const projects: Array<OpenStackSpendProject> = [];
    const projectTotals: Array<{
      project: OpenStackSpendProject;
      totals: OpenStackUsageTotals;
    }> = [];
    const thisMonthCosts: Array<OpenStackProjectCost> = [];
    const lastMonthCosts: Array<OpenStackProjectCost> = [];
    const onCourseCosts: Array<{ amount: number | null }> = [];
    const writes: Array<OpenStackUsageRowWrite> = [];
    let projectsRatedByCloudKitty: number = 0;
    let projectsPartlyPriced: number = 0;
    let cloudKittyReadAt: string | null = null;

    const namesOf: (id: string) => {
      name: string | null;
      domainId: string | null;
      domainName: string | null;
    } = (
      id: string,
    ): {
      name: string | null;
      domainId: string | null;
      domainName: string | null;
    } => {
      const row: OpenStackUsageProjectRow | undefined = projectRows.get(id);

      // A project that has since been deleted keeps what it was last known by.
      const kept: OpenStackUsagePeriodRow | undefined =
        stored.get(thisMonth)?.get(id) || stored.get(lastMonth)?.get(id);
      const domainId: string | null = row?.domainId ?? kept?.domainId ?? null;

      return {
        name: row?.name ?? kept?.name ?? null,
        domainId,
        domainName:
          (domainId ? domainNames.get(domainId) : null) ??
          kept?.domainName ??
          null,
      };
    };

    for (const id of projectIds) {
      const quantities: OpenStackUsageQuantities =
        thisMonthRows.get(id) || getEmptyOpenStackUsageQuantities();
      const lastMonthQuantities: OpenStackUsageQuantities =
        lastMonthRows.get(id) || getEmptyOpenStackUsageQuantities();
      const rated: OpenStackRatedByPeriod = readOpenStackRatedByPeriod(
        projectRows.get(id)?.rated,
      );
      const cost: OpenStackProjectCost = getOpenStackProjectCost({
        quantities,
        priceList,
        rated: rated[thisMonth],
      });
      const lastMonthCost: OpenStackProjectCost = getOpenStackProjectCost({
        quantities: lastMonthQuantities,
        priceList,
        rated: rated[lastMonth],
      });
      const onCourseFor: number | null = getOpenStackOnCourseFor({
        cost,
        holding: holdingOf.get(id),
        priceList,
        now,
      });
      const totals: OpenStackUsageTotals = getOpenStackUsageTotals(quantities);
      const lastMonthTotals: OpenStackUsageTotals =
        getOpenStackUsageTotals(lastMonthQuantities);
      const vcpuHoursOnCourseFor: number = getOpenStackVcpuHoursOnCourseFor({
        quantities,
        holding: holdingOf.get(id),
        now,
      });
      const growth: number | null = getOpenStackProjectGrowth({
        onCourseFor,
        lastMonth: lastMonthCost.amount,
        vcpuHoursOnCourseFor,
        lastMonthVcpuHours: lastMonthTotals.vcpuHours,
        isLastMonthRead,
      });

      if (rated[thisMonth]) {
        projectsRatedByCloudKitty++;
        const readAt: string | null = rated[thisMonth]!.readAt;
        if (readAt && (!cloudKittyReadAt || readAt > cloudKittyReadAt)) {
          cloudKittyReadAt = readAt;
        }
      }

      if (
        hasOpenStackUsage(quantities) &&
        priceList &&
        cost.source !== "cloudkitty" &&
        (cost.amount === null || cost.unpricedLineCount > 0)
      ) {
        projectsPartlyPriced++;
      }

      const project: OpenStackSpendProject = {
        openStackProjectId: id,
        ...namesOf(id),
        thisMonth: cost.amount,
        lastMonth: lastMonthCost.amount,
        onCourseFor,
        source: cost.source,
        vcpuHours: totals.vcpuHours,
        lastMonthVcpuHours: isLastMonthRead ? lastMonthTotals.vcpuHours : null,
        vcpuHoursOnCourseFor,
        growth,
      };

      projects.push(project);
      projectTotals.push({ project, totals });
      thisMonthCosts.push(cost);
      lastMonthCosts.push(lastMonthCost);
      onCourseCosts.push({ amount: onCourseFor });

      writes.push({
        openStackProjectId: id,
        period: thisMonth,
        name: project.name,
        domainId: project.domainId,
        domainName: project.domainName,
        quantities,
        vcpuHours: totals.vcpuHours,
        memoryGbHours: totals.memoryGbHours,
        volumeGbHours: totals.volumeGbHours,
        floatingIpHours: totals.floatingIpHours,
        estimatedCost: cost.amount,
        lastMonthCost: lastMonthCost.amount,
        onCourseFor,
        growth,
        costSource: cost.source,
        unpricedLineCount: cost.unpricedLineCount,
        sortValue: cost.amount ?? totals.vcpuHours,
      });
    }

    /*
     * Any other month a reading added to: the last hours of a month that ended since the last
     * reading, which then keeps what they came to at today's prices.
     */
    for (const [month, rows] of applied.months) {
      const isTouched: boolean = interval.slices.some(
        (slice: OpenStackUsageSlice): boolean => {
          return slice.month === month;
        },
      );

      if (month === thisMonth || !isTouched) {
        continue;
      }

      for (const [id, quantities] of rows) {
        const totals: OpenStackUsageTotals = getOpenStackUsageTotals(quantities);
        const kept: OpenStackUsagePeriodRow | undefined = stored
          .get(month)
          ?.get(id);
        const names: {
          name: string | null;
          domainId: string | null;
          domainName: string | null;
        } = namesOf(id);
        const cost: OpenStackProjectCost = getOpenStackProjectCost({
          quantities,
          priceList,
          rated: readOpenStackRatedByPeriod(projectRows.get(id)?.rated)[month],
        });

        writes.push({
          openStackProjectId: id,
          period: month,
          name: names.name ?? kept?.name ?? null,
          domainId: names.domainId ?? kept?.domainId ?? null,
          domainName: names.domainName ?? kept?.domainName ?? null,
          quantities,
          vcpuHours: totals.vcpuHours,
          memoryGbHours: totals.memoryGbHours,
          volumeGbHours: totals.volumeGbHours,
          floatingIpHours: totals.floatingIpHours,
          estimatedCost: cost.amount,
          lastMonthCost: null,
          onCourseFor: null,
          growth: null,
          costSource: cost.source,
          unpricedLineCount: cost.unpricedLineCount,
          sortValue: cost.amount ?? totals.vcpuHours,
        });
      }
    }

    for (const [day, rows] of applied.closedDays) {
      for (const [id, quantities] of rows) {
        const totals: OpenStackUsageTotals = getOpenStackUsageTotals(quantities);
        const names: {
          name: string | null;
          domainId: string | null;
          domainName: string | null;
        } = namesOf(id);

        writes.push({
          openStackProjectId: id,
          period: day,
          name: names.name,
          domainId: names.domainId,
          domainName: names.domainName,
          quantities,
          vcpuHours: totals.vcpuHours,
          memoryGbHours: totals.memoryGbHours,
          volumeGbHours: totals.volumeGbHours,
          floatingIpHours: totals.floatingIpHours,
          estimatedCost: null,
          lastMonthCost: null,
          onCourseFor: null,
          growth: null,
          costSource: null,
          unpricedLineCount: null,
          sortValue: totals.vcpuHours,
        });
      }
    }

    const thisMonthTotal: OpenStackUsageQuantities =
      sumOpenStackUsageQuantities(thisMonthRows.values());
    const lastMonthTotal: OpenStackUsageQuantities =
      sumOpenStackUsageQuantities(lastMonthRows.values());
    const usage: OpenStackUsageTotals = getOpenStackUsageTotals(thisMonthTotal);

    const snapshot: OpenStackSpendSnapshot = {
      readAt: now.toISOString(),
      month: thisMonth,
      currency: priceList?.currency ?? null,
      source: getOpenStackSpendSource({ projects }),
      projectCount: projects.length,
      projectsRatedByCloudKitty,
      cloudKittyReadAt,
      projectsPartlyPriced,
      thisMonth: getCloudCost(thisMonthCosts),
      lastMonth: isLastMonthRead ? getCloudCost(lastMonthCosts) : null,
      onCourseFor: getCloudCost(onCourseCosts),
      usage,
      lastMonthUsage: isLastMonthRead
        ? getOpenStackUsageTotals(lastMonthTotal)
        : null,
      comparison: await this.getComparison({
        projectId,
        openStackCloudId,
        previous,
        priceList,
        now,
      }),
      ...this.getCoverage({
        previous,
        applied,
        interval,
        thisMonth,
        lastMonth,
        now,
      }),
      ...getOpenStackSpendBreakdown({
        quantities: thisMonthTotal,
        priceList,
      }),
      ...getOpenStackSpendDomains(projectTotals),
      growers: getOpenStackSpendGrowers(projects),
      ...this.getHistory({ previous, applied, priceList, thisMonth }),
      ...(await this.getWaste({
        projectId,
        openStackCloudId,
        previous,
        usageRows,
        priceList,
        now,
      })),
    };

    const wasSaved: boolean = await OpenStackProjectUsageService.saveReading({
      projectId,
      openStackCloudId,
      rows: writes,
      lastReadAt,
      readAt: now,
      snapshot: snapshot as unknown as JSONObject,
    });

    if (
      wasSaved &&
      (!lastReadAt ||
        toOpenStackUsageDay(lastReadAt) !== toOpenStackUsageDay(now))
    ) {
      await this.deleteOldRows({ projectId, openStackCloudId, now });
    }

    return { snapshot, projects, wasSaved, rowsWritten: writes.length };
  }

  private static async deleteOldRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    now: Date;
  }): Promise<void> {
    try {
      await OpenStackProjectUsageService.deleteOldRows(data);
    } catch (err) {
      // Old rows cost space and nothing else, and the next day tries again.
      logger.warn(
        `OpenStack cloud ${data.openStackCloudId.toString()}: its old usage could not be removed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private static getCoverage(data: {
    previous: OpenStackSpendSnapshot | null;
    applied: OpenStackAppliedReading;
    interval: OpenStackUsageInterval;
    thisMonth: string;
    lastMonth: string;
    now: Date;
  }): {
    coverage: OpenStackSpendCoverage;
    lastMonthCoverage: OpenStackSpendCoverage | null;
  } {
    const { previous, applied, interval, thisMonth, now } = data;
    const isSameMonth: boolean = previous?.month === thisMonth;

    return {
      coverage: addOpenStackSpendCoverage({
        coverage: isSameMonth ? previous!.coverage : null,
        countedHours: applied.countedHoursByMonth.get(thisMonth) || 0,
        notCountedHours: interval.notCountedHours,
        now,
      }),
      // A month that has just ended keeps what its last reading added to it.
      lastMonthCoverage: isSameMonth
        ? previous!.lastMonthCoverage
        : previous?.month === data.lastMonth
          ? addOpenStackSpendCoverage({
              coverage: previous.coverage,
              countedHours:
                applied.countedHoursByMonth.get(data.lastMonth) || 0,
              notCountedHours: 0,
              now,
            })
          : null,
    };
  }

  private static getHistory(data: {
    previous: OpenStackSpendSnapshot | null;
    applied: OpenStackAppliedReading;
    priceList: OpenStackPriceList | null;
    thisMonth: string;
  }): {
    days: Array<OpenStackSpendDay>;
    months: Array<OpenStackSpendMonth>;
    monthAtLastMidnight: OpenStackUsageTotals | null;
  } {
    const { previous, applied, priceList, thisMonth } = data;
    const days: Array<OpenStackSpendDay> = [...(previous?.days || [])];
    let months: Array<OpenStackSpendMonth> = [...(previous?.months || [])];
    let monthAtLastMidnight: OpenStackUsageTotals | null =
      previous?.monthAtLastMidnight ?? null;
    let monthOfMidnight: string | null = previous?.month ?? null;

    for (const day of Array.from(applied.closedDays.keys()).sort()) {
      const month: string = day.slice(0, 7);
      const atMidnight: OpenStackUsageTotals = getOpenStackUsageTotals(
        sumOpenStackUsageQuantities(applied.closedDays.get(day)!.values()),
      );

      days.push(
        getOpenStackSpendDay({
          day,
          monthAtMidnight: atMidnight,
          monthAtLastMidnight:
            monthOfMidnight === month ? monthAtLastMidnight : null,
        }),
      );
      monthAtLastMidnight = atMidnight;
      monthOfMidnight = month;
    }

    // A month that has ended has its whole figures now, and a new month starts counting from nothing.
    if (previous && previous.month !== thisMonth) {
      const ended: Map<string, OpenStackUsageQuantities> =
        applied.months.get(previous.month) || new Map();
      const quantities: OpenStackUsageQuantities = sumOpenStackUsageQuantities(
        ended.values(),
      );
      const cost: OpenStackUsageCost = getOpenStackUsageCost({
        quantities,
        priceList,
      });

      months = [
        ...months.filter((entry: OpenStackSpendMonth): boolean => {
          return entry.month !== previous.month;
        }),
        {
          month: previous.month,
          amount: cost.amount,
          ...getOpenStackUsageTotals(quantities),
        },
      ];
      monthAtLastMidnight = null;
    }

    return {
      days: days.slice(-OPENSTACK_SPEND_DAYS_KEPT),
      months: months.slice(-OPENSTACK_SPEND_MONTHS_KEPT),
      monthAtLastMidnight,
    };
  }

  /*
   * This month's full days against the same days last month, at today's prices. That takes reading
   * two days' rows, which on a large cloud is worth doing once a day, and again if a price changes.
   * A month's first day has no full day yet.
   */
  private static async getComparison(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    previous: OpenStackSpendSnapshot | null;
    priceList: OpenStackPriceList | null;
    now: Date;
  }): Promise<OpenStackSpendComparison | null> {
    const { previous, priceList, now } = data;
    const yesterday: Date = addUtcDays(now, -1);

    if (toOpenStackUsageMonth(yesterday) !== toOpenStackUsageMonth(now)) {
      return null;
    }

    const throughDay: string = toOpenStackUsageDay(yesterday);
    const priceListKey: string = getOpenStackPriceListKey(priceList);

    if (
      previous?.comparison?.throughDay === throughDay &&
      previous.comparison.priceListKey === priceListKey
    ) {
      return previous.comparison;
    }

    try {
      const lastMonthThroughDay: string =
        getOpenStackSameDayLastMonth(throughDay);
      const read: (
        period: string,
      ) => Promise<OpenStackUsageQuantities | null> = async (
        period: string,
      ): Promise<OpenStackUsageQuantities | null> => {
        const rows: Array<OpenStackUsagePeriodRow> =
          await OpenStackProjectUsageService.getPeriodRows({
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            period,
          });

        return rows.length > 0
          ? sumOpenStackUsageQuantities(
              rows.map(
                (row: OpenStackUsagePeriodRow): OpenStackUsageQuantities => {
                  return row.quantities;
                },
              ),
            )
          : null;
      };

      const thisMonth: OpenStackUsageQuantities | null = await read(throughDay);
      const lastMonth: OpenStackUsageQuantities | null =
        await read(lastMonthThroughDay);

      if (!thisMonth || !lastMonth) {
        return null;
      }

      return {
        throughDay,
        lastMonthThroughDay,
        thisMonth: getOpenStackUsageCost({ quantities: thisMonth, priceList })
          .amount,
        lastMonth: getOpenStackUsageCost({ quantities: lastMonth, priceList })
          .amount,
        thisMonthVcpuHours: getOpenStackUsageTotals(thisMonth).vcpuHours,
        lastMonthVcpuHours: getOpenStackUsageTotals(lastMonth).vcpuHours,
        priceListKey,
      };
    } catch (err) {
      logger.warn(
        `OpenStack cloud ${data.openStackCloudId.toString()}: this month against last could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return previous?.comparison ?? null;
    }
  }

  // What could be reclaimed, hourly. A run that fails leaves what was last found.
  private static async getWaste(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    previous: OpenStackSpendSnapshot | null;
    usageRows: OpenStackUsageRows;
    priceList: OpenStackPriceList | null;
    now: Date;
  }): Promise<{
    waste: Array<OpenStackWasteFinding> | null;
    wasteReadAt: string | null;
  }> {
    const { previous, now } = data;

    if (
      previous?.waste &&
      !isDue(previous.wasteReadAt, OPENSTACK_WASTE_EVERY_MINUTES, now)
    ) {
      return { waste: previous.waste, wasteReadAt: previous.wasteReadAt };
    }

    try {
      return {
        waste: await this.readWaste(data),
        wasteReadAt: now.toISOString(),
      };
    } catch (err) {
      logger.warn(
        `OpenStack cloud ${data.openStackCloudId.toString()}: what could be reclaimed could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        waste: previous?.waste ?? null,
        wasteReadAt: previous?.wasteReadAt ?? null,
      };
    }
  }

  private static async readWaste(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    usageRows: OpenStackUsageRows;
    priceList: OpenStackPriceList | null;
    now: Date;
  }): Promise<Array<OpenStackWasteFinding>> {
    const { projectId, openStackCloudId, usageRows, priceList, now } = data;
    const rows: OpenStackWasteRows =
      await OpenStackProjectUsageService.getWasteRows({
        projectId,
        openStackCloudId,
      });
    const capacityRows: OpenStackCapacityRows =
      await OpenStackResourceService.getCapacityRows({
        projectId,
        openStackCloudId,
      });
    const instancesOnHosts: Array<OpenStackInstancesOnHost> | null =
      await OpenStackResourceService.getInstancesOnHosts({
        projectId,
        openStackCloudId,
      });
    const hosts: Array<OpenStackCapacityHost> = capacityRows.hypervisors.map(
      (row: JSONObject): OpenStackCapacityHost => {
        return readOpenStackCapacityHost(
          row as unknown as OpenStackCapacityHostSourceRow,
        );
      },
    );
    const flavors: Array<OpenStackCapacityFlavor> = capacityRows.flavors.map(
      (row: JSONObject): OpenStackCapacityFlavor => {
        return readOpenStackCapacityFlavor({
          row: row as unknown as OpenStackCapacityFlavorSourceRow,
          instanceCount: 0,
        });
      },
    );
    const movableFlavors: Array<OpenStackMovableHostFlavor> = flavors.map(
      (flavor: OpenStackCapacityFlavor): OpenStackMovableHostFlavor => {
        return {
          regionName: flavor.regionName,
          flavorId: flavor.id,
          resources: flavor.request.resources,
        };
      },
    );
    const flavorRows: Map<string, OpenStackUsageRows["flavors"][number]> =
      new Map(
        usageRows.flavors.map(
          (
            flavor: OpenStackUsageRows["flavors"][number],
          ): [string, OpenStackUsageRows["flavors"][number]] => {
            return [getOpenStackFlavorUsageKey(flavor), flavor];
          },
        ),
      );
    const flavorDisks: Map<string, number> = new Map(
      flavors.map((flavor: OpenStackCapacityFlavor): [string, number] => {
        return [
          getOpenStackFlavorUsageKey({
            regionName: flavor.regionName,
            flavorId: flavor.id,
          }),
          flavor.request.resources["DISK_GB"] || 0,
        ];
      }),
    );

    return getOpenStackWasteFindings({
      volumes: rows.volumes,
      floatingIps: rows.floatingIps,
      instances: rows.instances,
      images: rows.images,
      snapshots: rows.snapshots,
      flavorOf: (flavor: {
        regionName: string | null;
        flavorId: string | null;
      }) => {
        const key: string = getOpenStackFlavorUsageKey(flavor);
        const row: OpenStackUsageRows["flavors"][number] | undefined =
          flavorRows.get(key);

        return row
          ? {
              name: row.name,
              vcpus: row.vcpus || 0,
              ramMib: (row.memoryBytes || 0) / (1024 * 1024),
              diskGb: flavorDisks.get(key) || 0,
            }
          : null;
      },
      imagesInUse: getOpenStackImagesInUse({
        instanceImageIds: rows.instanceImageIds,
        volumeImageIds: rows.volumeImageIds,
        instancesNotSaying: rows.instancesNotSaying,
      }),
      snapshotsAreReported: rows.snapshotRowCount > 0,
      movableHosts: instancesOnHosts
        ? getOpenStackMovableHosts({
            hosts,
            instancesOnHosts,
            flavors: movableFlavors,
          })
        : [],
      priceList,
      now,
    });
  }
}
