import {
  DeviceNamingPreview,
  DeviceNamingPreviewItem,
} from "Common/Types/NetworkDevice/DeviceNaming";
import { MAX_HOSTS_PER_DISCOVERY_IMPORT } from "Common/Types/NetworkDevice/DiscoveryImport";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  previewDiscoveredDeviceNames,
  previewScanNames,
} from "./DeviceNamingApi";

/*
 * THE IMPORT'S NAMING PREVIEW (issue #6619): what the project's naming
 * rules call each host an import would create, read from the server for the
 * hosts selected - a scan's, by address, or the Discovered Devices list's,
 * by device - and read again a moment after the selection changes, since
 * the numbers a pattern's {nn} gives depend on which hosts are imported
 * together.
 *
 * Quiet by design: the preview only informs, the import names the devices
 * itself, so a preview that cannot be read leaves the rows as they were. A
 * project the server says has no naming rule is not asked again while the
 * dialog is open.
 */

// How long the selection must rest before the preview is read again.
export const NAMING_PREVIEW_DELAY_MS: number = 400;

export interface NamingPreviewState {
  preview: DeviceNamingPreview | null;
  // The preview's items by the import's host key.
  byKey: ReadonlyMap<string, DeviceNamingPreviewItem> | undefined;
  isLoading: boolean;
}

export function indexNamingPreview(
  preview: DeviceNamingPreview | null,
): ReadonlyMap<string, DeviceNamingPreviewItem> | undefined {
  if (!preview || !preview.hasRules) {
    return undefined;
  }

  return new Map<string, DeviceNamingPreviewItem>(
    preview.items.map(
      (item: DeviceNamingPreviewItem): [string, DeviceNamingPreviewItem] => {
        return [item.key, item];
      },
    ),
  );
}

export default function useNamingPreview(data: {
  isActive: boolean;
  // A scan's hosts, by address.
  scanId?: string | undefined;
  ipAddresses?: Array<string> | undefined;
  // Or devices of the Discovered Devices list.
  endpointIds?: Array<string> | undefined;
}): NamingPreviewState {
  const [preview, setPreview] = useState<DeviceNamingPreview | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const hasNoRulesRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);

  const keys: Array<string> = (
    data.endpointIds ||
    data.ipAddresses ||
    []
  ).slice(0, MAX_HOSTS_PER_DISCOVERY_IMPORT);
  const signature: string = `${data.scanId || ""}|${keys.join(",")}`;

  useEffect(() => {
    if (!data.isActive || hasNoRulesRef.current || keys.length === 0) {
      return;
    }

    requestRef.current += 1;
    const request: number = requestRef.current;

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setIsLoading(true);

      const read: Promise<DeviceNamingPreview> = data.endpointIds
        ? previewDiscoveredDeviceNames({ endpointIds: keys })
        : previewScanNames({
            scanId: data.scanId || "",
            ipAddresses: keys,
          });

      read
        .then((loaded: DeviceNamingPreview) => {
          if (request !== requestRef.current) {
            return;
          }

          if (!loaded.hasRules) {
            hasNoRulesRef.current = true;
          }

          setPreview(loaded);
        })
        .catch(() => {
          // The rows stay as they were: the import names the devices itself.
        })
        .finally(() => {
          if (request === requestRef.current) {
            setIsLoading(false);
          }
        });
    }, NAMING_PREVIEW_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [data.isActive, signature]);

  const byKey: ReadonlyMap<string, DeviceNamingPreviewItem> | undefined =
    useMemo(() => {
      return indexNamingPreview(preview);
    }, [preview]);

  return { preview: preview, byKey: byKey, isLoading: isLoading };
}
