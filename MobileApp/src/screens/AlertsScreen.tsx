import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Text,
  ListRenderItemInfo,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useProject } from "../hooks/useProject";
import { useAlerts } from "../hooks/useAlerts";
import { useAlertStates } from "../hooks/useAlertDetail";
import { changeAlertState } from "../api/alerts";
import { useAlertEpisodes } from "../hooks/useAlertEpisodes";
import { useHaptics } from "../hooks/useHaptics";
import AlertCard from "../components/AlertCard";
import EpisodeCard from "../components/EpisodeCard";
import SwipeableCard from "../components/SwipeableCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SegmentedControl from "../components/SegmentedControl";
import type { AlertsStackParamList } from "../navigation/types";
import type { AlertItem, AlertState, AlertEpisodeItem } from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE: number = 20;

type Segment = "alerts" | "episodes";

type NavProp = NativeStackNavigationProp<AlertsStackParamList, "AlertsList">;

export default function AlertsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId: string = selectedProject?._id ?? "";
  const navigation: NavProp = useNavigation<NavProp>();

  const [segment, setSegment] = useState<Segment>("alerts");
  const [page, setPage] = useState(0);
  const [episodePage, setEpisodePage] = useState(0);
  const skip: number = page * PAGE_SIZE;
  const episodeSkip: number = episodePage * PAGE_SIZE;

  const { data, isLoading, isError, refetch } = useAlerts(
    projectId,
    skip,
    PAGE_SIZE,
  );
  const { data: states } = useAlertStates(projectId);
  const {
    data: episodeData,
    isLoading: episodesLoading,
    isError: episodesError,
    refetch: refetchEpisodes,
  } = useAlertEpisodes(projectId, episodeSkip, PAGE_SIZE);
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient: QueryClient = useQueryClient();

  const acknowledgeState: AlertState | undefined = states?.find(
    (s: AlertState) => {
      return s.isAcknowledgedState;
    },
  );

  const alerts: AlertItem[] = data?.data ?? [];
  const totalCount: number = data?.count ?? 0;
  const hasMore: boolean = skip + PAGE_SIZE < totalCount;

  const episodes: AlertEpisodeItem[] = episodeData?.data ?? [];
  const episodeTotalCount: number = episodeData?.count ?? 0;
  const episodeHasMore: boolean = episodeSkip + PAGE_SIZE < episodeTotalCount;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    if (segment === "alerts") {
      setPage(0);
      await refetch();
    } else {
      setEpisodePage(0);
      await refetchEpisodes();
    }
  }, [refetch, refetchEpisodes, lightImpact, segment]);

  const loadMore: () => void = useCallback(() => {
    if (segment === "alerts") {
      if (hasMore && !isLoading) {
        setPage((prev: number) => {
          return prev + 1;
        });
      }
    } else {
      if (episodeHasMore && !episodesLoading) {
        setEpisodePage((prev: number) => {
          return prev + 1;
        });
      }
    }
  }, [segment, hasMore, isLoading, episodeHasMore, episodesLoading]);

  const handlePress: (alert: AlertItem) => void = useCallback(
    (alert: AlertItem) => {
      navigation.navigate("AlertDetail", { alertId: alert._id });
    },
    [navigation],
  );

  const handleEpisodePress: (episode: AlertEpisodeItem) => void = useCallback(
    (episode: AlertEpisodeItem) => {
      navigation.navigate("AlertEpisodeDetail", {
        episodeId: episode._id,
      });
    },
    [navigation],
  );

  const handleAcknowledge: (alert: AlertItem) => Promise<void> = useCallback(
    async (alert: AlertItem) => {
      if (!acknowledgeState) {
        return;
      }
      try {
        await changeAlertState(projectId, alert._id, acknowledgeState._id);
        await successFeedback();
        await refetch();
        await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      } catch {
        await errorFeedback();
      }
    },
    [
      projectId,
      acknowledgeState,
      successFeedback,
      errorFeedback,
      refetch,
      queryClient,
    ],
  );

  const showLoading: boolean =
    segment === "alerts"
      ? isLoading && alerts.length === 0
      : episodesLoading && episodes.length === 0;

  const showError: boolean = segment === "alerts" ? isError : episodesError;

  if (showLoading) {
    return (
      <View className="flex-1 bg-bg-primary">
        <SegmentedControl
          segments={[
            { key: "alerts" as const, label: "Alerts" },
            { key: "episodes" as const, label: "Episodes" },
          ]}
          selected={segment}
          onSelect={setSegment}
        />
        <View className="p-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (showError) {
    const retryFn: () => void =
      segment === "alerts"
        ? () => {
            return refetch();
          }
        : () => {
            return refetchEpisodes();
          };
    return (
      <View className="flex-1 bg-bg-primary">
        <SegmentedControl
          segments={[
            { key: "alerts" as const, label: "Alerts" },
            { key: "episodes" as const, label: "Episodes" },
          ]}
          selected={segment}
          onSelect={setSegment}
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-body-md text-text-secondary text-center">
            {segment === "alerts"
              ? "Failed to load alerts."
              : "Failed to load alert episodes."}
          </Text>
          <TouchableOpacity
            className="mt-4 px-6 py-3 rounded-[10px] shadow-md"
            style={{ backgroundColor: theme.colors.actionPrimary }}
            onPress={retryFn}
          >
            <Text className="text-body-md text-text-inverse font-semibold">
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-primary">
      <SegmentedControl
        segments={[
          { key: "alerts" as const, label: "Alerts" },
          { key: "episodes" as const, label: "Episodes" },
        ]}
        selected={segment}
        onSelect={setSegment}
      />
      {segment === "alerts" ? (
        <FlatList
          data={alerts}
          keyExtractor={(item: AlertItem) => {
            return item._id;
          }}
          contentContainerStyle={
            alerts.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({ item }: ListRenderItemInfo<AlertItem>) => {
            return (
              <SwipeableCard
                rightAction={
                  acknowledgeState &&
                  item.currentAlertState?._id !== acknowledgeState._id
                    ? {
                        label: "Acknowledge",
                        color: "#2EA043",
                        onAction: () => {
                          return handleAcknowledge(item);
                        },
                      }
                    : undefined
                }
              >
                <AlertCard
                  alert={item}
                  onPress={() => {
                    return handlePress(item);
                  }}
                />
              </SwipeableCard>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No active alerts"
              subtitle="Alerts assigned to you will appear here."
              icon="alerts"
            />
          }
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(item: AlertEpisodeItem) => {
            return item._id;
          }}
          contentContainerStyle={
            episodes.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({ item }: ListRenderItemInfo<AlertEpisodeItem>) => {
            return (
              <EpisodeCard
                episode={item}
                type="alert"
                onPress={() => {
                  return handleEpisodePress(item);
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No alert episodes"
              subtitle="Alert episodes for this project will appear here."
              icon="episodes"
            />
          }
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}
