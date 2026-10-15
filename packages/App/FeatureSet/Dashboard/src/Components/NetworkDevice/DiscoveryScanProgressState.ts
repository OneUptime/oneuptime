import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveryScanStatus,
  DISCOVERY_SCAN_STARTED_MESSAGE,
} from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";

/*
 * What a discovery scan's progress says, apart from the component that draws
 * it (DiscoveryScanProgress.tsx). This file imports no React, so modules
 * App's tests load - DiscoveryImportReview among them - can use it: App
 * installs no React, so its tsc and jest cannot follow an import into a
 * Dashboard file that imports "react".
 */

/**
 * A recurring scan retains the preceding result until its first report.
 * The claim marker separates that snapshot from this run's real progress.
 */
export function isWaitingForDiscoveryProgress(
  scan: NetworkDeviceDiscoveryScan | null,
): boolean {
  return (
    scan?.status === DiscoveryScanStatus.InProgress &&
    scan.statusMessage === DISCOVERY_SCAN_STARTED_MESSAGE
  );
}

export function formatDiscoveryDuration(milliseconds: number): string {
  const seconds: number = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
