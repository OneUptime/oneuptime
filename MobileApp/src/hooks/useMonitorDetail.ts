import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  fetchMonitorById,
  fetchMonitorFeed,
  fetchMonitorStatusTimeline,
} from "../api/monitors";
import type { MonitorStatusTimelineItem } from "../api/monitors";
import type { MonitorItem, FeedItem } from "../api/types";

export function useMonitorDetail(
  projectId: string,
  monitorId: string,
): UseQueryResult<MonitorItem, Error> {
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
