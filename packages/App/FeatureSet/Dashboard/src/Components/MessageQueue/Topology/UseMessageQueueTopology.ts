import { MessageQueueTopologyResponse } from "Common/Types/MessageQueue/MessageQueueTopology";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";
import { fetchMessageQueueTopology } from "./MessageQueueTopologyApi";

/*
 * The topology for a time range: read when the page opens, again when the
 * range changes or Refresh is pressed. A relative range ("Past 1 Hour") is
 * worked out when the read starts. While a read is running the last map
 * stays on screen; an answer for a range that is no longer the one picked
 * is dropped. A failed first read is an error; a failed refresh keeps the
 * map it had and says so.
 */

export type MessageQueueTopologyLoadStatus = "loading" | "ready" | "error";

export interface MessageQueueTopologyLoad {
  status: MessageQueueTopologyLoadStatus;
  data: MessageQueueTopologyResponse | null;
  // The range of `data`.
  window: { start: Date; end: Date } | null;
  error: string;
  isRefreshing: boolean;
  loadedAt: Date | null;
  reload: () => void;
}

export default function useMessageQueueTopology(
  timeRange: RangeStartAndEndDateTime,
): MessageQueueTopologyLoad {
  const [data, setData] = useState<MessageQueueTopologyResponse | null>(null);
  const [window, setWindow] = useState<{ start: Date; end: Date } | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [reloadCount, setReloadCount] = useState<number>(0);

  const rangeKey: string = JSON.stringify(timeRange);

  useEffect(() => {
    let cancelled: boolean = false;
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const next: { start: Date; end: Date } = {
      start: range.startValue,
      end: range.endValue,
    };
    setIsLoading(true);

    fetchMessageQueueTopology(next)
      .then((answer: MessageQueueTopologyResponse): void => {
        if (cancelled) {
          return;
        }
        setData(answer);
        setWindow(next);
        setError("");
        setLoadedAt(OneUptimeDate.getCurrentDate());
        setIsLoading(false);
      })
      .catch((err: unknown): void => {
        if (cancelled) {
          return;
        }
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rangeKey, reloadCount]);

  const status: MessageQueueTopologyLoadStatus = data
    ? "ready"
    : error && !isLoading
      ? "error"
      : "loading";

  return {
    status: status,
    data: data,
    window: window,
    error: error,
    isRefreshing: Boolean(data) && isLoading,
    loadedAt: loadedAt,
    reload: (): void => {
      setReloadCount((count: number): number => {
        return count + 1;
      });
    },
  };
}
