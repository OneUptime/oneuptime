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
import { useIncidents } from "../hooks/useIncidents";
import { useIncidentStates } from "../hooks/useIncidentDetail";
import { changeIncidentState } from "../api/incidents";
import { useIncidentEpisodes } from "../hooks/useIncidentEpisodes";
import { useHaptics } from "../hooks/useHaptics";
import IncidentCard from "../components/IncidentCard";
import EpisodeCard from "../components/EpisodeCard";
import SwipeableCard from "../components/SwipeableCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SegmentedControl from "../components/SegmentedControl";
import type { IncidentsStackParamList } from "../navigation/types";
import type { IncidentItem, IncidentState, IncidentEpisodeItem } from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE: number = 20;

type Segment = "incidents" | "episodes";

type NavProp = NativeStackNavigationProp<
  IncidentsStackParamList,
  "IncidentsList"
>;

export default function IncidentsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId: string = selectedProject?._id ?? "";
  const navigation: NavProp = useNavigation<NavProp>();

  const [segment, setSegment] = useState<Segment>("incidents");
  const [page, setPage] = useState(0);
  const [episodePage, setEpisodePage] = useState(0);
  const skip: number = page * PAGE_SIZE;
  const episodeSkip: number = episodePage * PAGE_SIZE;

  const { data, isLoading, isError, refetch } = useIncidents(
    projectId,
    skip,
    PAGE_SIZE,
  );
  const { data: states } = useIncidentStates(projectId);
  const {
    data: episodeData,
    isLoading: episodesLoading,
    isError: episodesError,
    refetch: refetchEpisodes,
  } = useIncidentEpisodes(projectId, episodeSkip, PAGE_SIZE);
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient: QueryClient = useQueryClient();

  const acknowledgeState: IncidentState | undefined = states?.find(
    (s: IncidentState) => {
      return s.isAcknowledgedState;
    },
  );

  const incidents: IncidentItem[] = data?.data ?? [];
  const totalCount: number = data?.count ?? 0;
  const hasMore: boolean = skip + PAGE_SIZE < totalCount;

  const episodes: IncidentEpisodeItem[] = episodeData?.data ?? [];
  const episodeTotalCount: number = episodeData?.count ?? 0;
  const episodeHasMore: boolean = episodeSkip + PAGE_SIZE < episodeTotalCount;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    if (segment === "incidents") {
      setPage(0);
      await refetch();
    } else {
      setEpisodePage(0);
      await refetchEpisodes();
    }
  }, [refetch, refetchEpisodes, lightImpact, segment]);

  const loadMore: () => void = useCallback(() => {
    if (segment === "incidents") {
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

  const handlePress: (incident: IncidentItem) => void = useCallback(
    (incident: IncidentItem) => {
      navigation.navigate("IncidentDetail", { incidentId: incident._id });
    },
    [navigation],
  );

  const handleEpisodePress: (episode: IncidentEpisodeItem) => void =
    useCallback(
      (episode: IncidentEpisodeItem) => {
        navigation.navigate("IncidentEpisodeDetail", {
          episodeId: episode._id,
        });
      },
      [navigation],
    );

  const handleAcknowledge: (incident: IncidentItem) => Promise<void> =
    useCallback(
      async (incident: IncidentItem) => {
        if (!acknowledgeState) {
          return;
        }
        try {
          await changeIncidentState(
            projectId,
            incident._id,
            acknowledgeState._id,
          );
          await successFeedback();
          await refetch();
          await queryClient.invalidateQueries({ queryKey: ["incidents"] });
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
    segment === "incidents"
      ? isLoading && incidents.length === 0
      : episodesLoading && episodes.length === 0;

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
          keyExtractor={(item: IncidentItem) => {
            return item._id;
          }}
          contentContainerStyle={
            incidents.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({ item }: ListRenderItemInfo<IncidentItem>) => {
            return (
              <SwipeableCard
                rightAction={
                  acknowledgeState &&
                  item.currentIncidentState?._id !== acknowledgeState._id
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
                <IncidentCard
                  incident={item}
                  onPress={() => {
                    return handlePress(item);
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
          keyExtractor={(item: IncidentEpisodeItem) => {
            return item._id;
          }}
          contentContainerStyle={
            episodes.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderItem={({
            item,
          }: ListRenderItemInfo<IncidentEpisodeItem>) => {
            return (
              <EpisodeCard
                episode={item}
                type="incident"
                onPress={() => {
                  return handleEpisodePress(item);
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No incident episodes"
              subtitle="Incident episodes for this project will appear here."
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
