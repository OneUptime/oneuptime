import { useState, useEffect } from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect((): (() => void) => {
    const unsubscribe: () => void = NetInfo.addEventListener(
      (state: NetInfoState): void => {
        setStatus({
          isConnected: state.isConnected ?? true,
          isInternetReachable: state.isInternetReachable,
        });
      },
    );

    return (): void => {
      unsubscribe();
    };
  }, []);

  return status;
}
