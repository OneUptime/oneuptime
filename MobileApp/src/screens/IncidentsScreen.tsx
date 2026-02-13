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
import { useAllProjectIncidents } from "../hooks/useAllProjectIncidents";
import { useAllProjectIncidentEpisodes } from "../hooks/useAllProjectIncidentEpisodes";
import { useAllProjectIncidentStates } from "../hooks/useAllProjectIncidentStates";
import { changeIncidentState } from "../api/incidents";
import { useHaptics } from "../hooks/useHaptics";
import IncidentCard from "../components/IncidentCard";
import EpisodeCard from "../components/EpisodeCard";
import SwipeableCard from "../components/SwipeableCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SegmentedControl from "../components/SegmentedControl";
import type { IncidentsStackParamList } from "../navigation/types";
import type {
  IncidentState,
  ProjectIncidentItem,
  ProjectIncidentEpisodeItem,
} from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE: number = 20;

type Segment = "incidents" | "episodes";

type NavProp = NativeStackNavigationProp<
  IncidentsStackParamList,
  "IncidentsList"
>;

export default function IncidentsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const navigation: NavProp = useNavigation<NavProp>();

  const [segment, setSegment] = useState<Segment>("incidents");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(PAGE_SIZE);

  const {
    items: allIncidents,
    isLoading,
    isError,
    refetch,
  } = useAllProjectIncidents();
  const { statesMap } = useAllProjectIncidentStates();
  const {
    items: allEpisodes,
    isLoading: episodesLoading,
    isError: episodesError,
    refetch: refetchEpisodes,
  } = useAllProjectIncidentEpisodes();
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient: QueryClient = useQueryClient();

  const incidents: ProjectIncidentItem[] = allIncidents.slice(0, visibleCount);
  const episodes: ProjectIncidentEpisodeItem[] = allEpisodes.slice(
    0,
    visibleEpisodeCount,
  );

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    if (segment === "incidents") {
      setVisibleCount(PAGE_SIZE);
      await refetch();
    } else {
      setVisibleEpisodeCount(PAGE_SIZE);
      await refetchEpisodes();
    }
  }, [refetch, refetchEpisodes, lightImpact, segment]);

  const loadMore: () => void = useCallback(() => {
    if (segment === "incidents") {
      if (visibleCount < allIncidents.length) {
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
  }, [segment, visibleCount, allIncidents.length, visibleEpisodeCount, allEpisodes.length]);

  const handlePress: (wrapped: ProjectIncidentItem) => void = useCallback(
    (wrapped: ProjectIncidentItem) => {
      navigation.navigate("IncidentDetail", {
        incidentId: wrapped.item._id,
        projectId: wrapped.projectId,
      });
    },
    [navigation],
  );

  const handleEpisodePress: (wrapped: ProjectIncidentEpisodeItem) => void =
    useCallback(
      (wrapped: ProjectIncidentEpisodeItem) => {
        navigation.navigate("IncidentEpisodeDetail", {
          episodeId: wrapped.item._id,
          projectId: wrapped.projectId,
        });
      },
      [navigation],
    );

  const handleAcknowledge: (wrapped: ProjectIncidentItem) => Promise<void> =
    useCallback(
      async (wrapped: ProjectIncidentItem) => {
        const projectStates: IncidentState[] | undefined = statesMap.get(
          wrapped.projectId,
        );
        const acknowledgeState: IncidentState | undefined = projectStates?.find(
          (s: IncidentState) => {
            return s.isAcknowledgedState;
          },
        );
        if (!acknowledgeState) {
          return;
        }
        try {
          await changeIncidentState(
            wrapped.projectId,
            wrapped.item._id,
            acknowledgeState._id,
          );
          await successFeedback();
          await refetch();
          await queryClient.invalidateQueries({ queryKey: ["incidents"] });
        } catch {
          await errorFeedback();
        }
      },
      [statesMap, successFeedback, errorFeedback, refetch, queryClient],
    );

  const showLoading: boolean =
    segment === "incidents"
      ? isLoading && allIncidents.length === 0
      : episodesLoading && allEpisodes.length === 0;

  const showError: boolean =
    segment === "incidents" ? isError : episodesError;

  if (showLoading) {
    return (
      <View className="flex-1 bg-bg-primary">
        <SegmentedControl
          segments={[
            { key: "incidents" as const, label: "Incidents" },
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
      segment === "incidents"
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
            { key: "incidents" as const, label: "Incidents" },
            { key: "episodes" as const, label: "Episodes" },
          ]}
          selected={segment}
          onSelect={setSegment}
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-body-md text-text-secondary text-center">
            {segment === "incidents"
              ? "Failed to load incidents."
              : "Failed to load incident episodes."}
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
          { key: "incidents" as const, label: "Incidents" },
          { key: "episodes" as const, label: "Episodes" },
        ]}
        selected={segment}
        onSelect={setSegment}
      />
      {segment === "incidents" ? (
        <FlatList
          data={incidents}
          keyExtractor={(wrapped: ProjectIncidentItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            incidents.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({
            item: wrapped,
          }: ListRenderItemInfo<ProjectIncidentItem>) => {
            const projectStates: IncidentState[] | undefined = statesMap.get(
              wrapped.projectId,
            );
            const acknowledgeState: IncidentState | undefined =
              projectStates?.find((s: IncidentState) => {
                return s.isAcknowledgedState;
              });
            return (
              <SwipeableCard
                rightAction={
                  acknowledgeState &&
                  wrapped.item.currentIncidentState?._id !==
                    acknowledgeState._id
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
                <IncidentCard
                  incident={wrapped.item}
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
              title="No active incidents"
              subtitle="Incidents assigned to you will appear here."
              icon="incidents"
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
          keyExtractor={(wrapped: ProjectIncidentEpisodeItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            episodes.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({
            item: wrapped,
          }: ListRenderItemInfo<ProjectIncidentEpisodeItem>) => {
            return (
              <EpisodeCard
                episode={wrapped.item}
                type="incident"
                projectName={wrapped.projectName}
                onPress={() => {
                  return handleEpisodePress(wrapped);
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No incident episodes"
              subtitle="Incident episodes will appear here."
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
