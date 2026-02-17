import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  SectionList,
  RefreshControl,
  Text,
  SectionListRenderItemInfo,
  DefaultSectionT,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

interface AlertSection {
  title: string;
  isActive: boolean;
  data: ProjectAlertItem[];
}

interface EpisodeSection {
  title: string;
  isActive: boolean;
  data: ProjectAlertEpisodeItem[];
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
    <View
      style={{ flexDirection: "row", alignItems: "center", paddingBottom: 8, paddingTop: 4, backgroundColor: theme.colors.backgroundPrimary }}
    >
      <Ionicons
        name={isActive ? "flame" : "checkmark-done"}
        size={13}
        color={
          isActive ? theme.colors.severityCritical : theme.colors.textTertiary
        }
        style={{ marginRight: 6 }}
      />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          textTransform: "uppercase",
          color: isActive
            ? theme.colors.textPrimary
            : theme.colors.textTertiary,
          letterSpacing: 0.6,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          marginLeft: 8,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: isActive
            ? theme.colors.severityCritical + "18"
            : theme.colors.backgroundTertiary,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: "bold",
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

  const resolvedStateIds: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set();
    statesMap.forEach((states: AlertState[]) => {
      states.forEach((s: AlertState) => {
        if (s.isResolvedState) {
          ids.add(s._id);
        }
      });
    });
    return ids;
  }, [statesMap]);

  const alertSections: AlertSection[] = useMemo(() => {
    const active: ProjectAlertItem[] = [];
    const resolved: ProjectAlertItem[] = [];
    for (const wrapped of allAlerts) {
      const stateId: string | undefined = wrapped.item.currentAlertState?._id;
      if (stateId && resolvedStateIds.has(stateId)) {
        resolved.push(wrapped);
      } else {
        active.push(wrapped);
      }
    }
    const sections: AlertSection[] = [];
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
  }, [allAlerts, resolvedStateIds, visibleCount]);

  const episodeSections: EpisodeSection[] = useMemo(() => {
    const active: ProjectAlertEpisodeItem[] = [];
    const resolved: ProjectAlertEpisodeItem[] = [];
    for (const wrapped of allEpisodes) {
      const stateId: string | undefined = wrapped.item.currentAlertState?._id;
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

  const totalAlertCount: number = allAlerts.length;
  const totalEpisodeCount: number = allEpisodes.length;

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
      if (visibleCount < totalAlertCount) {
        setVisibleCount((prev: number) => {
          return prev + PAGE_SIZE;
        });
      }
    } else if (visibleEpisodeCount < totalEpisodeCount) {
      setVisibleEpisodeCount((prev: number) => {
        return prev + PAGE_SIZE;
      });
    }
  }, [
    segment,
    visibleCount,
    totalAlertCount,
    visibleEpisodeCount,
    totalEpisodeCount,
  ]);

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
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <SegmentedControl
          segments={[
            { key: "alerts" as const, label: "Alerts" },
            { key: "episodes" as const, label: "Episodes" },
          ]}
          selected={segment}
          onSelect={setSegment}
        />
        <View style={{ padding: 16 }}>
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
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <SegmentedControl
          segments={[
            { key: "alerts" as const, label: "Alerts" },
            { key: "episodes" as const, label: "Episodes" },
          ]}
          selected={segment}
          onSelect={setSegment}
        />
        <EmptyState
          title="Something went wrong"
          subtitle={
            segment === "alerts"
              ? "Failed to load alerts. Pull to refresh or try again."
              : "Failed to load alert episodes. Pull to refresh or try again."
          }
          icon="alerts"
          actionLabel="Retry"
          onAction={retryFn}
        />
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
    >
      <SegmentedControl
        segments={[
          { key: "alerts" as const, label: "Alerts" },
          { key: "episodes" as const, label: "Episodes" },
        ]}
        selected={segment}
        onSelect={setSegment}
      />
      {segment === "alerts" ? (
        <SectionList
          sections={alertSections}
          style={{ flex: 1 }}
          keyExtractor={(wrapped: ProjectAlertItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            alertSections.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderSectionHeader={(params: {
            section: DefaultSectionT & AlertSection;
          }) => {
            return (
              <SectionHeader
                title={params.section.title}
                count={params.section.data.length}
                isActive={params.section.isActive}
              />
            );
          }}
          renderItem={({
            item: wrapped,
            section,
          }: SectionListRenderItemInfo<
            ProjectAlertItem,
            DefaultSectionT & AlertSection
          >) => {
            const isResolved: boolean = !section.isActive;
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
                  !isResolved &&
                  acknowledgeState &&
                  wrapped.item.currentAlertState?._id !== acknowledgeState._id
                    ? {
                        label: "Acknowledge",
                        color: "#22C55E",
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
              title="No alerts"
              subtitle="Alerts assigned to you will appear here."
              icon="alerts"
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
          style={{ flex: 1 }}
          keyExtractor={(wrapped: ProjectAlertEpisodeItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={
            episodeSections.length === 0 ? { flex: 1 } : { padding: 16 }
          }
          renderSectionHeader={(params: {
            section: DefaultSectionT & EpisodeSection;
          }) => {
            return (
              <SectionHeader
                title={params.section.title}
                count={params.section.data.length}
                isActive={params.section.isActive}
              />
            );
          }}
          renderItem={({
            item: wrapped,
            section,
          }: SectionListRenderItemInfo<
            ProjectAlertEpisodeItem,
            DefaultSectionT & EpisodeSection
          >) => {
            const isResolved: boolean = !section.isActive;
            return (
              <EpisodeCard
                episode={wrapped.item}
                type="alert"
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
              title="No alert episodes"
              subtitle="Alert episodes will appear here."
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
