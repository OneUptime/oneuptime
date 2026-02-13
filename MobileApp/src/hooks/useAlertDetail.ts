import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  fetchAlertById,
  fetchAlertStates,
  fetchAlertStateTimeline,
  fetchAlertFeed,
} from "../api/alerts";
import type {
  AlertItem,
  AlertState,
  StateTimelineItem,
  FeedItem,
} from "../api/types";

export function useAlertDetail(
  projectId: string,
  alertId: string,
): UseQueryResult<AlertItem, Error> {
  return useQuery({
    queryKey: ["alert", projectId, alertId],
    queryFn: () => {
      return fetchAlertById(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}

export function useAlertStates(
  projectId: string,
): UseQueryResult<AlertState[], Error> {
  return useQuery({
    queryKey: ["alert-states", projectId],
    queryFn: () => {
      return fetchAlertStates(projectId);
    },
    enabled: Boolean(projectId),
  });
}

export function useAlertStateTimeline(
  projectId: string,
  alertId: string,
): UseQueryResult<StateTimelineItem[], Error> {
  return useQuery({
    queryKey: ["alert-state-timeline", projectId, alertId],
    queryFn: () => {
      return fetchAlertStateTimeline(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}

export function useAlertFeed(
  projectId: string,
  alertId: string,
): UseQueryResult<FeedItem[], Error> {
  return useQuery({
    queryKey: ["alert-feed", projectId, alertId],
    queryFn: () => {
      return fetchAlertFeed(projectId, alertId);
    },
    enabled: Boolean(projectId) && Boolean(alertId),
  });
}
