import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  SectionList,
  RefreshControl,
  TouchableOpacity,
  Text,
  SectionListRenderItemInfo,
  DefaultSectionT,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

interface IncidentSection {
  title: string;
  isActive: boolean;
  data: ProjectIncidentItem[];
}

interface EpisodeSection {
  title: string;
  isActive: boolean;
  data: ProjectIncidentEpisodeItem[];
}

function SectionHeader({
  title,
  count,
  isActive,
}: {
  title: string;
  count: number;
  isActive: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View className="flex-row items-center pb-2 pt-1 bg-bg-primary">
      <Ionicons
        name={isActive ? "flame" : "checkmark-done"}
        size={14}
        color={isActive ? theme.colors.severityCritical : theme.colors.textTertiary}
        style={{ marginRight: 6 }}
      />
      <Text
        className="text-[13px] font-semibold uppercase tracking-wide"
        style={{
          color: isActive
            ? theme.colors.textPrimary
            : theme.colors.textTertiary,
        }}
      >
        {title}
      </Text>
      <View
        className="ml-2 px-1.5 py-0.5 rounded-full"
        style={{
          backgroundColor: isActive
            ? theme.colors.severityCritical + "1A"
            : theme.colors.backgroundTertiary,
        }}
      >
        <Text
          className="text-[11px] font-bold"
          style={{
            color: isActive
              ? theme.colors.severityCritical
              : theme.colors.textTertiary,
          }}
        >
          {count}
        </Text>
      </View>
    </View>
  );
}

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

  const resolvedStateIds: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set();
    statesMap.forEach((states: IncidentState[]) => {
      states.forEach((s: IncidentState) => {
        if (s.isResolvedState) {
          ids.add(s._id);
        }
      });
    });
    return ids;
  }, [statesMap]);

  const incidentSections: IncidentSection[] = useMemo(() => {
    const active: ProjectIncidentItem[] = [];
    const resolved: ProjectIncidentItem[] = [];
    for (const wrapped of allIncidents) {
      const stateId: string | undefined =
        wrapped.item.currentIncidentState?._id;
      if (stateId && resolvedStateIds.has(stateId)) {
        resolved.push(wrapped);
      } else {
        active.push(wrapped);
      }
    }
    const sections: IncidentSection[] = [];
    if (active.length > 0) {
      sections.push({
        title: "Active",
        isActive: true,
        data: active.slice(0, visibleCount),
      });
    }
    if (resolved.length > 0) {
      sections.push({
        title: "Resolved",
        isActive: false,
        data: resolved.slice(0, visibleCount),
      });
    }
    return sections;
  }, [allIncidents, resolvedStateIds, visibleCount]);

  const episodeSections: EpisodeSection[] = useMemo(() => {
    const active: ProjectIncidentEpisodeItem[] = [];
    const resolved: ProjectIncidentEpisodeItem[] = [];
    for (const wrapped of allEpisodes) {
      const stateId: string | undefined =
        wrapped.item.currentIncidentState?._id;
      if (stateId && resolvedStateIds.has(stateId)) {
        resolved.push(wrapped);
      } else {
        active.push(wrapped);
      }
    }
    const sections: EpisodeSection[] = [];
    if (active.length > 0) {
      sections.push({
        title: "Active",
        isActive: true,
        data: active.slice(0, visibleEpisodeCount),
      });
    }
    if (resolved.length > 0) {
      sections.push({
        title: "Resolved",
        isActive: false,
        data: resolved.slice(0, visibleEpisodeCount),
      });
    }
    return sections;
  }, [allEpisodes, resolvedStateIds, visibleEpisodeCount]);

  const totalIncidentCount: number = allIncidents.length;
  const totalEpisodeCount: number = allEpisodes.length;

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
      if (visibleCount < totalIncidentCount) {
        setVisibleCount((prev: number) => {
          return prev + PAGE_SIZE;
        });
      }
    } else {
      if (visibleEpisodeCount < totalEpisodeCount) {
        setVisibleEpisodeCount((prev: number) => {
          return prev + PAGE_SIZE;
        });
      }
    }
  }, [segment, visibleCount, totalIncidentCount, visibleEpisodeCount, totalEpisodeCount]);

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
        <SectionList
          sections={incidentSections}
          keyExtractor={(wrapped: ProjectIncidentItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            incidentSections.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderSectionHeader={({
            section,
          }: {
            section: DefaultSectionT & IncidentSection;
          }) => {
            return (
              <SectionHeader
                title={section.title}
                count={section.data.length}
                isActive={section.isActive}
              />
            );
          }}
          renderItem={({
            item: wrapped,
            section,
          }: SectionListRenderItemInfo<
            ProjectIncidentItem,
            DefaultSectionT & IncidentSection
          >) => {
            const isResolved: boolean = !section.isActive;
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
                  !isResolved &&
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
                  muted={isResolved}
                  onPress={() => {
                    return handlePress(wrapped);
                  }}
                />
              </SwipeableCard>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title="No incidents"
              subtitle="Incidents assigned to you will appear here."
              icon="incidents"
            />
          }
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      ) : (
        <SectionList
          sections={episodeSections}
          keyExtractor={(wrapped: ProjectIncidentEpisodeItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            episodeSections.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderSectionHeader={({
            section,
          }: {
            section: DefaultSectionT & EpisodeSection;
          }) => {
            return (
              <SectionHeader
                title={section.title}
                count={section.data.length}
                isActive={section.isActive}
              />
            );
          }}
          renderItem={({
            item: wrapped,
            section,
          }: SectionListRenderItemInfo<
            ProjectIncidentEpisodeItem,
            DefaultSectionT & EpisodeSection
          >) => {
            const isResolved: boolean = !section.isActive;
            return (
              <EpisodeCard
                episode={wrapped.item}
                type="incident"
                projectName={wrapped.projectName}
                muted={isResolved}
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
          stickySectionHeadersEnabled={false}
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
