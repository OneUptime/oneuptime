import { useRef, useState, type RefObject } from "react";

interface UseRefreshResult {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}

/** Keep pull-to-refresh visible until the requested reads have finished. */
export function useRefresh(refresh: () => Promise<unknown>): UseRefreshResult {
  const pending: RefObject<boolean> = useRef(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    if (pending.current) {
      return;
    }

    pending.current = true;
    setRefreshing(true);

    try {
      await refresh();
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  };

  return { refreshing, onRefresh };
}
