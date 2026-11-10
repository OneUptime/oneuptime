import {
  DiscoveryImportView,
  isDiscoveryImportActive,
} from "Common/Types/NetworkDevice/DiscoveryImport";

/*
 * Which of the project's imports are running, for whom: a scan's row, or
 * the Discovered Devices list (issue #5775), whose imports have no scan.
 * Kept free of React, because App's jest tests import it and App installs
 * no React; useActiveDiscoveryImports re-exports both functions.
 */

export function indexActiveImportsByScan(
  imports: ReadonlyArray<DiscoveryImportView>,
): Map<string, DiscoveryImportView> {
  const byScanId: Map<string, DiscoveryImportView> = new Map<
    string,
    DiscoveryImportView
  >();

  // The oldest active import of a scan is the one running; later ones wait.
  for (const view of imports) {
    // An import from the Discovered Devices list belongs to no scan's row.
    if (!view.scanId) {
      continue;
    }

    if (isDiscoveryImportActive(view.status) && !byScanId.has(view.scanId)) {
      byScanId.set(view.scanId, view);
    }
  }

  return byScanId;
}

// The active imports of rows of the Discovered Devices list, oldest first.
export function getActiveDiscoveredDeviceImports(
  imports: ReadonlyArray<DiscoveryImportView>,
): Array<DiscoveryImportView> {
  return imports.filter((view: DiscoveryImportView): boolean => {
    return !view.scanId && isDiscoveryImportActive(view.status);
  });
}
