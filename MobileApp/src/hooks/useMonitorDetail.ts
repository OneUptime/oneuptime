import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  fetchMonitorById,
  fetchMonitorFeed,
  fetchMonitorStatusTimeline,
  fetchMonitorProbes,
  type MonitorStatusTimelineItem,
  type MonitorProbeItem,
} from "../api/monitors";
import type { MonitorItem, FeedItem } from "../api/types";

/*
 * `MonitorItem | null`, because `fetchMonitorById` resolves `null` for a
 * monitor that is gone. That miss is settled DATA, so `isError` here means the
 * request failed and a null `data` means there is no such monitor.
 */
export function useMonitorDetail(
  projectId: string,
  monitorId: string,
): UseQueryResult<MonitorItem | null, Error> {
  return useQuery({
    queryKey: ["monitor", projectId, monitorId],
    queryFn: () => {
      return fetchMonitorById(projectId, monitorId);
    },
    enabled: Boolean(projectId) && Boolean(monitorId),
  });
}

export function useMonitorStatusTimeline(
  projectId: string,
  monitorId: string,
): UseQueryResult<MonitorStatusTimelineItem[], Error> {
  return useQuery({
    queryKey: ["monitor-status-timeline", projectId, monitorId],
    queryFn: () => {
      return fetchMonitorStatusTimeline(projectId, monitorId);
    },
    enabled: Boolean(projectId) && Boolean(monitorId),
  });
}

export function useMonitorProbes(
  projectId: string,
  monitorId: string,
): UseQueryResult<MonitorProbeItem[], Error> {
  return useQuery({
    queryKey: ["monitor-probes", projectId, monitorId],
    queryFn: () => {
      return fetchMonitorProbes(projectId, monitorId);
    },
    enabled: Boolean(projectId) && Boolean(monitorId),
  });
}

export function useMonitorFeed(
  projectId: string,
  monitorId: string,
): UseQueryResult<FeedItem[], Error> {
  return useQuery({
    queryKey: ["monitor-feed", projectId, monitorId],
    queryFn: () => {
      return fetchMonitorFeed(projectId, monitorId);
    },
    enabled: Boolean(projectId) && Boolean(monitorId),
  });
}
