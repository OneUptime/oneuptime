/*
 * What the worker would keep on a cloud about its usage, from an estate's rows, by the code it runs:
 * the same holdings, the same sums and the same rules. A recording's rows carry what a real cloud
 * said, so a walk reads this page on that.
 *
 * Hours are made up, because a recording is one moment. Every project is taken to have held what it
 * holds now since the 1st, with last month at three quarters of that when ?spend asks for a history.
 *
 *   ?spend=none        a cloud no worker has read yet
 *   ?spend=priced      prices set, with a last month to compare
 *   ?spend=partial     a price for vCPUs and nothing else
 *   ?spend=zero        a price list of zeros, which isn't a free cloud
 *   ?spend=cloudkitty  CloudKitty's figures for one project, no prices
 *   ?spend=gap         as priced, with hours nobody was reading
 *   ?waste=old         the rules run 31 days after the recording, so what's been sitting is old
 */
import {
  addOpenStackUsage,
  getEmptyOpenStackUsageQuantities,
  getOpenStackProjectHoldings,
  readOpenStackUsageFlavorId,
} from "../../../Common/Types/OpenStack/OpenStackProjectUsage";
import { readOpenStackPriceList } from "../../../Common/Types/OpenStack/OpenStackPriceList";
import {
  getOpenStackSpendProjectRead,
  getOpenStackSpendSummary,
} from "../../../Common/Types/OpenStack/OpenStackSpendSnapshot";
import {
  getOpenStackImagesInUse,
  getOpenStackMovableHosts,
  getOpenStackWasteFindings,
} from "../../../Common/Types/OpenStack/OpenStackWaste";
import {
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
} from "../../../Common/Types/OpenStack/OpenStackCapacitySnapshot";

const DAY = 24 * 60 * 60 * 1000;

export const SPEND_PRICES = {
  currency: "EUR",
  vcpuHour: 0.02,
  memoryGbHour: 0.01,
  volumeGbHour: 0.0005,
  floatingIpHour: 0.005,
  imageGbHour: 0.0002,
  snapshotGbHour: 0.0003,
  flavorHour: {},
  volumeTypeGbHour: {},
  leaveOutShutOff: false,
};

function priceListOf(scenario) {
  switch (scenario) {
    case "priced":
    case "gap":
      return SPEND_PRICES;
    case "partial":
      return { currency: "EUR", vcpuHour: 0.02 };
    case "zero":
      return { currency: "EUR", vcpuHour: 0, memoryGbHour: 0 };
    default:
      return null;
  }
}

// The grouping the worker's SQL does (OpenStackProjectUsageService.getUsageRows), over a walk's rows.
function usageRowsOf(rows) {
  const ofKind = (kind) => {
    return rows.filter((row) => {
      return row.kind === kind;
    });
  };
  const facts = (row) => {
    return row.facts || {};
  };
  const instances = ofKind("Instance")
    .filter((row) => {
      return (
        row.hypervisorName &&
        !["SHELVED_OFFLOADED", "DELETED"].includes(row.status)
      );
    })
    .map((row) => {
      return {
        openStackProjectId: row.openStackProjectId,
        regionName: row.regionName,
        flavorId: facts(row).flavorId || null,
        status: row.status,
        count: 1,
      };
    });
  const storage = (kind, test, withType) => {
    return ofKind(kind)
      .filter(test)
      .map((row) => {
        return {
          openStackProjectId: row.openStackProjectId,
          ...(withType ? { type: facts(row).volumeType || null } : {}),
          bytes: Number(row.diskCapacityBytes) || 0,
        };
      });
  };
  const holdsSomething = (row) => {
    return !["error", "creating"].includes(row.status);
  };

  return {
    instances,
    flavors: ofKind("Flavor").map((row) => {
      return {
        regionName: row.regionName,
        flavorId: readOpenStackUsageFlavorId({
          externalId: row.externalId,
          regionName: row.regionName,
        }),
        name: row.name,
        vcpus: row.vcpuCapacity ?? null,
        memoryBytes:
          row.memoryCapacityBytes === null ||
          row.memoryCapacityBytes === undefined
            ? null
            : Number(row.memoryCapacityBytes),
      };
    }),
    volumes: storage("Volume", holdsSomething, true),
    floatingIps: ofKind("FloatingIp").map((row) => {
      return { openStackProjectId: row.openStackProjectId, count: 1 };
    }),
    images: storage(
      "Image",
      (row) => {
        return row.status === "active";
      },
      false,
    ),
    snapshots: storage("Snapshot", holdsSomething, false),
  };
}

function wasteOf(rows, usageRows, priceList, now) {
  const ofKind = (kind, status) => {
    return rows.filter((row) => {
      return row.kind === kind && (!status || row.status === status);
    });
  };
  const flavors = ofKind("Flavor").map((row) => {
    return readOpenStackCapacityFlavor({ row, instanceCount: 0 });
  });
  const flavorRow = (regionName, flavorId) => {
    return usageRows.flavors.find((flavor) => {
      return flavor.regionName === regionName && flavor.flavorId === flavorId;
    });
  };
  const instances = ofKind("Instance");
  const isSaying = (row) => {
    return "imageId" in (row.facts || {});
  };

  return getOpenStackWasteFindings({
    volumes: ofKind("Volume", "available"),
    floatingIps: ofKind("FloatingIp"),
    instances: ofKind("Instance", "SHUTOFF"),
    images: ofKind("Image", "active"),
    snapshots: ofKind("Snapshot", "available"),
    flavorOf: (flavor) => {
      const row = flavorRow(flavor.regionName, flavor.flavorId);
      return row
        ? {
            name: row.name,
            vcpus: row.vcpus || 0,
            ramMib: (row.memoryBytes || 0) / (1024 * 1024),
            diskGb: 0,
          }
        : null;
    },
    imagesInUse: getOpenStackImagesInUse({
      instanceImageIds: instances.filter(isSaying).map((row) => {
        return row.facts.imageId;
      }),
      volumeImageIds: ofKind("Volume").map((row) => {
        return (row.facts || {}).imageId || null;
      }),
      instancesNotSaying: instances.filter((row) => {
        return !isSaying(row);
      }).length,
    }),
    snapshotsAreReported: ofKind("Snapshot").length > 0,
    movableHosts: getOpenStackMovableHosts({
      hosts: ofKind("Hypervisor").map(readOpenStackCapacityHost),
      instancesOnHosts: [],
      flavors: flavors.map((flavor) => {
        return {
          regionName: flavor.regionName,
          flavorId: flavor.id,
          resources: flavor.request.resources,
        };
      }),
    }),
    priceList,
    now,
  });
}

export function buildSpendOf(rows, options) {
  const now = new Date(options.loadedAt);
  const scenario = options.scenario;
  const month = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);
  const hoursSoFar = Math.max(
    1,
    (now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) /
      (60 * 60 * 1000),
  );
  const storedPriceList = priceListOf(scenario);
  const priceList = readOpenStackPriceList(storedPriceList);
  const hasHistory = scenario === "priced" || scenario === "gap";
  const usageRows = usageRowsOf(rows);
  const holdings = getOpenStackProjectHoldings(usageRows);
  const projectRows = new Map(
    rows
      .filter((row) => {
        return row.kind === "Project";
      })
      .map((row) => {
        return [row.externalId, row];
      }),
  );
  const domainNames = new Map(
    rows
      .filter((row) => {
        return row.kind === "Domain";
      })
      .map((row) => {
        return [row.externalId, row.name];
      }),
  );
  const months = new Map();
  const last = new Map();
  const reads = [];
  const usage = [];

  for (const holding of holdings) {
    const id = holding.openStackProjectId;
    const quantities = addOpenStackUsage({
      quantities: getEmptyOpenStackUsageQuantities(),
      holding,
      hours: hoursSoFar,
    });
    const lastMonthQuantities = hasHistory
      ? addOpenStackUsage({
          quantities: getEmptyOpenStackUsageQuantities(),
          holding,
          hours: (hoursSoFar * 3) / 4,
        })
      : getEmptyOpenStackUsageQuantities();
    const row = projectRows.get(id);
    const domainId = (row?.facts || {}).domainId || null;
    const read = getOpenStackSpendProjectRead({
      openStackProjectId: id,
      names: {
        name: row?.name || null,
        domainId,
        domainName: domainId ? domainNames.get(domainId) || null : null,
      },
      quantities,
      lastMonthQuantities,
      holding,
      priceList,
      rated:
        scenario === "cloudkitty" && reads.length === 0
          ? {
              [month]: {
                total: 321.5,
                byType: { "instance.usage": 321.5 },
                readAt: now.toISOString(),
              },
            }
          : {},
      thisMonth: month,
      lastMonth,
      isLastMonthRead: hasHistory,
      now,
    });

    months.set(id, quantities);
    last.set(id, lastMonthQuantities);
    reads.push(read);
    usage.push({
      _id: `7a000000-0000-4000-8000-${String(reads.length).padStart(12, "0")}`,
      openStackCloudId: options.openStackCloudId,
      openStackProjectId: id,
      period: month,
      name: read.project.name,
      domainId: read.project.domainId,
      domainName: read.project.domainName,
      quantities,
      vcpuHours: read.totals.vcpuHours,
      memoryGbHours: read.totals.memoryGbHours,
      volumeGbHours: read.totals.volumeGbHours,
      floatingIpHours: read.totals.floatingIpHours,
      estimatedCost: read.cost.amount,
      lastMonthCost: read.lastMonthCost.amount,
      onCourseFor: read.project.onCourseFor,
      growth: read.project.growth,
      costSource: read.cost.source,
      unpricedLineCount: read.cost.unpricedLineCount,
      sortValue: read.cost.amount ?? read.totals.vcpuHours,
    });
  }

  const wasteNow =
    options.waste === "old" ? new Date(options.observedAt + 31 * DAY) : now;

  return {
    priceList: storedPriceList,
    usage,
    snapshot: {
      readAt: now.toISOString(),
      month,
      ...getOpenStackSpendSummary({
        reads,
        thisMonthQuantities: months.values(),
        lastMonthQuantities: last.values(),
        priceList,
        isLastMonthRead: hasHistory,
      }),
      comparison: hasHistory
        ? {
            throughDay: `${month}-04`,
            lastMonthThroughDay: `${lastMonth}-04`,
            thisMonth: 110,
            lastMonth: 100,
            thisMonthVcpuHours: 11,
            lastMonthVcpuHours: 10,
            priceListKey: JSON.stringify(priceList),
          }
        : null,
      coverage: {
        firstReadAt: `${month}-01T00:00:00.000Z`,
        countedHours: hoursSoFar,
        notCountedHours: scenario === "gap" ? 42 : 0,
      },
      lastMonthCoverage: null,
      days: [],
      months: [],
      monthAtLastMidnight: null,
      waste: wasteOf(rows, usageRows, priceList, wasteNow),
      wasteReadAt: now.toISOString(),
    },
  };
}
