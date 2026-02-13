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
import { useAllProjectAlerts } from "../hooks/useAllProjectAlerts";
import { useAllProjectAlertEpisodes } from "../hooks/useAllProjectAlertEpisodes";
import { useAllProjectAlertStates } from "../hooks/useAllProjectAlertStates";
import { changeAlertState } from "../api/alerts";
import { useHaptics } from "../hooks/useHaptics";
import AlertCard from "../components/AlertCard";
import EpisodeCard from "../components/EpisodeCard";
import SwipeableCard from "../components/SwipeableCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SegmentedControl from "../components/SegmentedControl";
import type { AlertsStackParamList } from "../navigation/types";
import type {
  AlertState,
  ProjectAlertItem,
  ProjectAlertEpisodeItem,
} from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE: number = 20;

type Segment = "alerts" | "episodes";

type NavProp = NativeStackNavigationProp<AlertsStackParamList, "AlertsList">;

export default function AlertsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const navigation: NavProp = useNavigation<NavProp>();

  const [segment, setSegment] = useState<Segment>("alerts");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(PAGE_SIZE);

  const {
    items: allAlerts,
    isLoading,
    isError,
    refetch,
  } = useAllProjectAlerts();
  const { statesMap } = useAllProjectAlertStates();
  const {
    items: allEpisodes,
    isLoading: episodesLoading,
    isError: episodesError,
    refetch: refetchEpisodes,
  } = useAllProjectAlertEpisodes();
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient: QueryClient = useQueryClient();

  const alerts: ProjectAlertItem[] = allAlerts.slice(0, visibleCount);
  const episodes: ProjectAlertEpisodeItem[] = allEpisodes.slice(
    0,
    visibleEpisodeCount,
  );

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    if (segment === "alerts") {
      setVisibleCount(PAGE_SIZE);
      await refetch();
    } else {
      setVisibleEpisodeCount(PAGE_SIZE);
      await refetchEpisodes();
    }
  }, [refetch, refetchEpisodes, lightImpact, segment]);

  const loadMore: () => void = useCallback(() => {
    if (segment === "alerts") {
      if (visibleCount < allAlerts.length) {
        setVisibleCount((prev: number) => {
          return prev + PAGE_SIZE;
        });
      }
    } else {
      if (visibleEpisodeCount < allEpisodes.length) {
        setVisibleEpisodeCount((prev: number) => {
          return prev + PAGE_SIZE;
        });
      }
    }
  }, [segment, visibleCount, allAlerts.length, visibleEpisodeCount, allEpisodes.length]);

  const handlePress: (wrapped: ProjectAlertItem) => void = useCallback(
    (wrapped: ProjectAlertItem) => {
      navigation.navigate("AlertDetail", {
        alertId: wrapped.item._id,
        projectId: wrapped.projectId,
      });
    },
    [navigation],
  );

  const handleEpisodePress: (wrapped: ProjectAlertEpisodeItem) => void =
    useCallback(
      (wrapped: ProjectAlertEpisodeItem) => {
        navigation.navigate("AlertEpisodeDetail", {
          episodeId: wrapped.item._id,
          projectId: wrapped.projectId,
        });
      },
      [navigation],
    );

  const handleAcknowledge: (wrapped: ProjectAlertItem) => Promise<void> =
    useCallback(
      async (wrapped: ProjectAlertItem) => {
        const projectStates: AlertState[] | undefined = statesMap.get(
          wrapped.projectId,
        );
        const acknowledgeState: AlertState | undefined = projectStates?.find(
          (s: AlertState) => {
            return s.isAcknowledgedState;
          },
        );
        if (!acknowledgeState) {
          return;
        }
        try {
          await changeAlertState(
            wrapped.projectId,
            wrapped.item._id,
            acknowledgeState._id,
          );
          await successFeedback();
          await refetch();
          await queryClient.invalidateQueries({ queryKey: ["alerts"] });
        } catch {
          await errorFeedback();
        }
      },
      [statesMap, successFeedback, errorFeedback, refetch, queryClient],
    );

  const showLoading: boolean =
    segment === "alerts"
      ? isLoading && allAlerts.length === 0
      : episodesLoading && allEpisodes.length === 0;

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
          keyExtractor={(wrapped: ProjectAlertItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            alerts.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({
            item: wrapped,
          }: ListRenderItemInfo<ProjectAlertItem>) => {
            const projectStates: AlertState[] | undefined = statesMap.get(
              wrapped.projectId,
            );
            const acknowledgeState: AlertState | undefined =
              projectStates?.find((s: AlertState) => {
                return s.isAcknowledgedState;
              });
            return (
              <SwipeableCard
                rightAction={
                  acknowledgeState &&
                  wrapped.item.currentAlertState?._id !== acknowledgeState._id
                    ? {
                        label: "Acknowledge",
                        color: "#2EA043",
                        onAction: () => {
                          return handleAcknowledge(wrapped);
                        },
                      }
                    : undefined
                }
              >
                <AlertCard
                  alert={wrapped.item}
                  projectName={wrapped.projectName}
                  onPress={() => {
                    return handlePress(wrapped);
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
          keyExtractor={(wrapped: ProjectAlertEpisodeItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            episodes.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({
            item: wrapped,
          }: ListRenderItemInfo<ProjectAlertEpisodeItem>) => {
            return (
              <EpisodeCard
                episode={wrapped.item}
                type="alert"
                projectName={wrapped.projectName}
                onPress={() => {
                  return handleEpisodePress(wrapped);
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No alert episodes"
              subtitle="Alert episodes will appear here."
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
