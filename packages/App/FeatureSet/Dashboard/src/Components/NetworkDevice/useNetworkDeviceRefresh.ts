import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import ObjectID from "Common/Types/ObjectID";
import { readNetworkDeviceDiscoveredDetails } from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  NetworkDeviceRefreshAnswer,
  NetworkDeviceRefreshProgress,
  NetworkDeviceRefreshSource,
  NetworkDeviceRefreshStanding,
  canRefreshNetworkDevice,
  getNetworkDeviceRefreshStanding,
  getPendingNetworkDeviceRefresh,
} from "Common/Utils/NetworkDevice/NetworkDeviceRefresh";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { requestNetworkDeviceRefresh } from "./NetworkDeviceRefreshApi";
import { REFRESH_FOLLOW_INTERVAL_MS } from "./NetworkDeviceRefreshWords";

/*
 * Refresh, on a card: whether it is offered, asking the server, following
 * the device until its readers have read it again, and saying where that
 * stands (NetworkDeviceRefreshStatus).
 *
 * Offered to whoever may edit network devices, for a device something reads
 * on its own: its probe, or a Meraki connection. While it is read again the
 * card asks for the device every few seconds; when every reader asked has
 * read it - or the time a read takes has passed - it stops, and `onRead` is
 * told once, so a page can read anything else the reading changed (an
 * Inventory item copied from the device).
 *
 * A refresh asked for elsewhere - another tab, before a reload - shows as
 * under way when the page opens, from the device's own record of the ask.
 */

export type NetworkDeviceRefreshDevice = NetworkDeviceRefreshSource & {
  refreshRequestedAt?: unknown;
  lastPolledAt?: unknown;
  isReachable?: unknown;
};

export interface UseNetworkDeviceRefreshResult {
  canRefresh: boolean;
  // Asking, or waiting for the readers.
  isRefreshing: boolean;
  answer: NetworkDeviceRefreshAnswer | undefined;
  standing: NetworkDeviceRefreshStanding | undefined;
  error: string;
  refresh: () => void;
}

export function deviceOfModel(
  model: NetworkDevice | null | undefined,
): NetworkDeviceRefreshDevice | null {
  if (!model) {
    return null;
  }

  return {
    probeId: model.probeId,
    isPollingEnabled: model.isPollingEnabled,
    monitoringMethod: model.monitoringMethod,
    hostname: model.hostname,
    discoveredDetails: model.discoveredDetails,
    refreshRequestedAt: model.refreshRequestedAt,
    lastPolledAt: model.lastPolledAt,
    isReachable: model.isReachable,
  };
}

const useNetworkDeviceRefresh: (data: {
  deviceId: ObjectID | null;
  device: NetworkDeviceRefreshDevice | null;
  // Reads the device again; the hook is handed the new one as `device`.
  reload: () => void;
  onRead?: (() => void) | undefined;
  // Test seam for the clock.
  now?: (() => Date) | undefined;
}) => UseNetworkDeviceRefreshResult = (data: {
  deviceId: ObjectID | null;
  device: NetworkDeviceRefreshDevice | null;
  reload: () => void;
  onRead?: (() => void) | undefined;
  now?: (() => Date) | undefined;
}): UseNetworkDeviceRefreshResult => {
  const clock: () => Date =
    data.now ||
    ((): Date => {
      return new Date();
    });

  const [answer, setAnswer] = useState<NetworkDeviceRefreshAnswer | undefined>(
    undefined,
  );
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // Moves the clock the standing is read at while the card follows.
  const [, setTick] = useState<number>(0);
  const toldRead: MutableRefObject<string> = useRef<string>("");
  const reloadRef: MutableRefObject<() => void> = useRef<() => void>(
    data.reload,
  );
  const onReadRef: MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(data.onRead);

  reloadRef.current = data.reload;
  onReadRef.current = data.onRead;

  const canEdit: boolean = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  ).isAllowed;
  const canRefresh: boolean = Boolean(
    data.deviceId &&
      data.device &&
      canEdit &&
      canRefreshNetworkDevice(data.device),
  );

  // A refresh under way when the page opened: followed as if asked here.
  useEffect(() => {
    if (answer || !data.device) {
      return;
    }

    const pending: NetworkDeviceRefreshAnswer | undefined =
      getPendingNetworkDeviceRefresh({ device: data.device, now: clock() });

    if (pending) {
      setAnswer(pending);
    }
  }, [data.device]);

  const standing: NetworkDeviceRefreshStanding | undefined =
    answer && data.device
      ? getNetworkDeviceRefreshStanding({
          answer: answer,
          lastPolledAt: data.device.lastPolledAt,
          isReachable: data.device.isReachable,
          controllerReadAt: readNetworkDeviceDiscoveredDetails(
            data.device.discoveredDetails,
          ).controller?.readAt,
          now: clock(),
        })
      : undefined;

  const isWaiting: boolean =
    standing?.progress === NetworkDeviceRefreshProgress.Waiting;

  // Follow the device while it is read again.
  useEffect(() => {
    if (!isWaiting) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setTick((value: number): number => {
        return value + 1;
      });
      reloadRef.current();
    }, REFRESH_FOLLOW_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isWaiting, answer?.requestedAt]);

  // Read again: said once to the page, per ask.
  useEffect(() => {
    if (
      !answer ||
      (standing?.progress !== NetworkDeviceRefreshProgress.Read &&
        standing?.progress !== NetworkDeviceRefreshProgress.Unreachable) ||
      toldRead.current === answer.requestedAt
    ) {
      return;
    }

    toldRead.current = answer.requestedAt;

    if (onReadRef.current) {
      onReadRef.current();
    }
  }, [standing?.progress, answer?.requestedAt]);

  const refresh: () => void = useCallback((): void => {
    if (!data.deviceId || isAsking) {
      return;
    }

    setIsAsking(true);
    setError("");

    requestNetworkDeviceRefresh(data.deviceId)
      .then((received: NetworkDeviceRefreshAnswer) => {
        setAnswer(received);
        reloadRef.current();
      })
      .catch((err: unknown) => {
        setAnswer(undefined);
        setError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsAsking(false);
      });
  }, [data.deviceId?.toString(), isAsking]);

  return {
    canRefresh: canRefresh,
    isRefreshing: isAsking || isWaiting,
    answer: answer,
    standing: standing,
    error: error,
    refresh: refresh,
  };
};

export default useNetworkDeviceRefresh;
