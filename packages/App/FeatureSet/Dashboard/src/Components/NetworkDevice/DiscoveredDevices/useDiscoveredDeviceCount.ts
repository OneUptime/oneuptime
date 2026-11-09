import {
  DiscoveredDeviceListResponse,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import { useEffect, useState } from "react";
import { listDiscoveredDevices } from "./DiscoveredDeviceApi";

/*
 * How many discovered devices OneUptime does not monitor yet - what the
 * Discovered Devices list opens on - for the topology map's button to the
 * list (issue #5775). One small read (a page of one row carries the
 * counts), again whenever refreshKey changes. Null until it is known, when
 * it is not wanted (isEnabled: the reader may not read the list), and when
 * the read fails: the button then says its name alone.
 */
export default function useDiscoveredDeviceCount(data: {
  siteId?: string | undefined;
  isEnabled: boolean;
  refreshKey?: number | undefined;
}): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!data.isEnabled) {
      setCount(null);
      return undefined;
    }

    let isCurrent: boolean = true;

    listDiscoveredDevices({
      search: "",
      show: DiscoveredDeviceShow.NotMonitored,
      ...(data.siteId ? { siteId: data.siteId } : {}),
      sort: DiscoveredDeviceSort.LastSeen,
      sortOrder: "desc",
      limit: 1,
      skip: 0,
    })
      .then((response: DiscoveredDeviceListResponse) => {
        if (isCurrent) {
          setCount(response.counts.notMonitored);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setCount(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [data.siteId, data.isEnabled, data.refreshKey]);

  return count;
}
