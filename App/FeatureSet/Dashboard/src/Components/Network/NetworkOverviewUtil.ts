import DeviceStatusUtil, {
  NetworkDeviceStatus,
} from "../NetworkDevice/DeviceStatusUtil";

/*
 * Pure aggregation for the Network Overview page. React-free so the
 * fleet-rollup decisions (what counts as "needs attention", how vendors
 * are grouped) can be unit-tested in a plain Node context.
 */

export interface OverviewDeviceRow {
  _id?: string | undefined;
  name?: string | undefined;
  lastSeenAt?: Date | undefined;
  interfacesDown?: number | undefined;
  vendor?: string | undefined;
}

export interface OverviewSiteRow {
  _id?: string | undefined;
  name?: string | undefined;
  siteType?: string | undefined;
  statusName?: string | undefined;
  statusColor?: string | undefined;
  isOperational?: boolean | undefined;
}

export interface DeviceFleetSummary {
  total: number;
  up: number;
  down: number;
  pending: number;
  interfacesDown: number;
}

export function summarizeDeviceFleet(
  devices: Array<OverviewDeviceRow>,
): DeviceFleetSummary {
  const summary: DeviceFleetSummary = {
    total: devices.length,
    up: 0,
    down: 0,
    pending: 0,
    interfacesDown: 0,
  };

  for (const device of devices) {
    const status: NetworkDeviceStatus = DeviceStatusUtil.getStatus(
      device.lastSeenAt,
    );

    if (status === NetworkDeviceStatus.Up) {
      summary.up++;
    } else if (status === NetworkDeviceStatus.Down) {
      summary.down++;
    } else {
      summary.pending++;
    }

    summary.interfacesDown += device.interfacesDown || 0;
  }

  return summary;
}

/*
 * Devices worth a human's next click: unreachable ones first (stalest
 * first, since the longest-silent device is the most likely hard-down),
 * then reachable devices carrying down interfaces (most down first).
 * Pending devices are excluded — never-polled is onboarding, not an
 * outage.
 */
export function pickDevicesNeedingAttention(
  devices: Array<OverviewDeviceRow>,
  limit: number,
): Array<OverviewDeviceRow> {
  const downDevices: Array<OverviewDeviceRow> = devices
    .filter((device: OverviewDeviceRow): boolean => {
      return (
        DeviceStatusUtil.getStatus(device.lastSeenAt) ===
        NetworkDeviceStatus.Down
      );
    })
    .sort((a: OverviewDeviceRow, b: OverviewDeviceRow): number => {
      return (
        new Date(a.lastSeenAt || 0).getTime() -
        new Date(b.lastSeenAt || 0).getTime()
      );
    });

  const degradedDevices: Array<OverviewDeviceRow> = devices
    .filter((device: OverviewDeviceRow): boolean => {
      return (
        (device.interfacesDown || 0) > 0 &&
        DeviceStatusUtil.getStatus(device.lastSeenAt) === NetworkDeviceStatus.Up
      );
    })
    .sort((a: OverviewDeviceRow, b: OverviewDeviceRow): number => {
      return (b.interfacesDown || 0) - (a.interfacesDown || 0);
    });

  return [...downDevices, ...degradedDevices].slice(0, Math.max(0, limit));
}

/*
 * Sites whose persisted rollup is in a non-operational status. Sites with
 * no rollup yet are skipped — no devices, no verdict.
 */
export function pickSitesNeedingAttention(
  sites: Array<OverviewSiteRow>,
  limit: number,
): Array<OverviewSiteRow> {
  return sites
    .filter((site: OverviewSiteRow): boolean => {
      return Boolean(site.statusName) && site.isOperational === false;
    })
    .slice(0, Math.max(0, limit));
}

export interface VendorCount {
  vendor: string;
  count: number;
}

// Vendor breakdown, largest first; unenriched devices group as "Unknown".
export function summarizeVendors(
  devices: Array<OverviewDeviceRow>,
  limit: number,
): Array<VendorCount> {
  const countsByVendor: Map<string, number> = new Map<string, number>();

  for (const device of devices) {
    const vendor: string = (device.vendor || "").trim() || "Unknown";
    countsByVendor.set(vendor, (countsByVendor.get(vendor) || 0) + 1);
  }

  return [...countsByVendor.entries()]
    .map(([vendor, count]: [string, number]): VendorCount => {
      return { vendor, count };
    })
    .sort((a: VendorCount, b: VendorCount): number => {
      // Ties break alphabetically so the list is stable across refreshes.
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.vendor.localeCompare(b.vendor);
    })
    .slice(0, Math.max(0, limit));
}
