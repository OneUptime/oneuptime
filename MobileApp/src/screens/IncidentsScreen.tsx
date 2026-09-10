import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  SectionList,
  ScrollView,
  RefreshControl,
  Text,
  Pressable,
  Alert,
  SectionListRenderItemInfo,
  DefaultSectionT,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import ScreenIntro from "../components/ScreenIntro";
import SearchField from "../components/SearchField";
import { matchesSearch } from "../utils/search";
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
type StateFilter = "all" | "active" | "resolved";

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
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: 12,
        paddingTop: 8,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <Ionicons
        name={isActive ? "flame" : "checkmark-done"}
        size={18}
        color={
          isActive ? theme.colors.severityCritical : theme.colors.textTertiary
        }
        style={{ marginRight: 6 }}
      />
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
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
            fontSize: 13,
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

export default function IncidentsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const navigation: NavProp = useNavigation<NavProp>();
  const route: RouteProp<IncidentsStackParamList, "IncidentsList"> =
    useRoute<RouteProp<IncidentsStackParamList, "IncidentsList">>();

  const [segment, setSegment] = useState<Segment>("incidents");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (route.params?.initialSegment) {
      setSegment(route.params.initialSegment);
      setVisibleCount(PAGE_SIZE);
      setVisibleEpisodeCount(PAGE_SIZE);
    }
    if (route.params?.initialFilter) {
      setStateFilter(route.params.initialFilter);
      setVisibleCount(PAGE_SIZE);
      setVisibleEpisodeCount(PAGE_SIZE);
    }
  }, [route.params]);

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

  const filteredIncidents: ProjectIncidentItem[] = useMemo(() => {
    return allIncidents.filter((wrapped: ProjectIncidentItem) => {
      return matchesSearch(search, [
        wrapped.item.title,
        wrapped.item._id,
        wrapped.item.incidentNumber,
        wrapped.item.incidentNumberWithPrefix,
        wrapped.projectName,
      ]);
    });
  }, [allIncidents, search]);

  const filteredEpisodes: ProjectIncidentEpisodeItem[] = useMemo(() => {
    return allEpisodes.filter((wrapped: ProjectIncidentEpisodeItem) => {
      return matchesSearch(search, [
        wrapped.item.title,
        wrapped.item._id,
        wrapped.item.episodeNumber,
        wrapped.item.episodeNumberWithPrefix,
        wrapped.projectName,
      ]);
    });
  }, [allEpisodes, search]);

  const incidentSections: IncidentSection[] = useMemo(() => {
    const active: ProjectIncidentItem[] = [];
    const resolved: ProjectIncidentItem[] = [];
    for (const wrapped of filteredIncidents) {
      const stateId: string | undefined =
        wrapped.item.currentIncidentState?._id;
      if (stateId && resolvedStateIds.has(stateId)) {
        resolved.push(wrapped);
      } else {
        active.push(wrapped);
      }
    }
    const sections: IncidentSection[] = [];
    if (active.length > 0 && stateFilter !== "resolved") {
      sections.push({
        title: "Active",
        isActive: true,
        data: active.slice(0, visibleCount),
      });
    }
    if (resolved.length > 0 && stateFilter !== "active") {
      sections.push({
        title: "Resolved",
        isActive: false,
        data: resolved.slice(0, visibleCount),
      });
    }
    return sections;
  }, [filteredIncidents, resolvedStateIds, visibleCount, stateFilter]);

  const episodeSections: EpisodeSection[] = useMemo(() => {
    const active: ProjectIncidentEpisodeItem[] = [];
    const resolved: ProjectIncidentEpisodeItem[] = [];
    for (const wrapped of filteredEpisodes) {
      const stateId: string | undefined =
        wrapped.item.currentIncidentState?._id;
      if (stateId && resolvedStateIds.has(stateId)) {
        resolved.push(wrapped);
      } else {
        active.push(wrapped);
      }
    }
    const sections: EpisodeSection[] = [];
    if (active.length > 0 && stateFilter !== "resolved") {
      sections.push({
        title: "Active",
        isActive: true,
        data: active.slice(0, visibleEpisodeCount),
      });
    }
    if (resolved.length > 0 && stateFilter !== "active") {
      sections.push({
        title: "Resolved",
        isActive: false,
        data: resolved.slice(0, visibleEpisodeCount),
      });
    }
    return sections;
  }, [filteredEpisodes, resolvedStateIds, visibleEpisodeCount, stateFilter]);

  const totalIncidentCount: number = filteredIncidents.length;
  const totalEpisodeCount: number = filteredEpisodes.length;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    setRefreshing(true);
    try {
      if (segment === "incidents") {
        setVisibleCount(PAGE_SIZE);
        await refetch();
      } else {
        setVisibleEpisodeCount(PAGE_SIZE);
        await refetchEpisodes();
      }
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchEpisodes, lightImpact, segment]);

  const loadMore: () => void = useCallback(() => {
    if (segment === "incidents") {
      if (visibleCount < totalIncidentCount) {
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
    totalIncidentCount,
    visibleEpisodeCount,
    totalEpisodeCount,
  ]);

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
          /*
           * A buzz is not a report. The swipe leaves no trace once the row
           * springs back, so a responder who acknowledged from a pocket, or
           * who simply did not register the haptic, cannot tell an
           * acknowledge that reached the server from one that never left the
           * handset - and the escalation policy goes on paging somebody who
           * believes they have already taken it. The detail screens say so out
           * loud for exactly this failure; the list has to as well. The haptic
           * stays: it is the faster of the two signals for anyone who does
           * feel it.
           */
          Alert.alert(
            "Error",
            "Failed to acknowledge this incident. It is still unacknowledged.",
          );
        }
      },
      [statesMap, successFeedback, errorFeedback, refetch, queryClient],
    );

  const showLoading: boolean =
    segment === "incidents"
      ? isLoading && allIncidents.length === 0
      : episodesLoading && allEpisodes.length === 0;

  const showError: boolean = segment === "incidents" ? isError : episodesError;

  const hasFilters: boolean = search.trim().length > 0 || stateFilter !== "all";
  const resetFilters: () => void = () => {
    setSearch("");
    setStateFilter("all");
    setVisibleCount(PAGE_SIZE);
    setVisibleEpisodeCount(PAGE_SIZE);
  };
  const listHeader: React.JSX.Element = (
    <View style={{ marginBottom: 24 }}>
      <ScreenIntro
        compact
        title="Incident inbox"
        description={
          segment === "incidents"
            ? "Triage and respond to incidents."
            : "Respond to related incidents together."
        }
      />
      <View style={{ marginHorizontal: 0 }}>
        <SegmentedControl
          style={{ marginHorizontal: 0, marginTop: 0 }}
          segments={[
            { key: "incidents" as const, label: "Incidents" },
            { key: "episodes" as const, label: "Episodes" },
          ]}
          selected={segment}
          onSelect={(next: Segment) => {
            setSegment(next);
            setVisibleCount(PAGE_SIZE);
            setVisibleEpisodeCount(PAGE_SIZE);
          }}
        />
      </View>
      <View style={{ marginTop: 12 }}>
        <SearchField
          value={search}
          onChangeText={(value: string) => {
            setSearch(value);
            setVisibleCount(PAGE_SIZE);
            setVisibleEpisodeCount(PAGE_SIZE);
          }}
          placeholder="Search title or ID"
          accessibilityLabel="Search incidents and episodes"
        />
        {(segment === "incidents" ? allIncidents.length : allEpisodes.length) >=
        100 ? (
          <Text
            style={{
              marginTop: 10,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            Search covers the 100 most recent{" "}
            {segment === "incidents" ? "incidents" : "episodes"}.
          </Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 12,
        }}
      >
        {(
          [
            { key: "all", label: "All states" },
            { key: "active", label: "Active only" },
            { key: "resolved", label: "Resolved only" },
          ] as const
        ).map((filter: { key: StateFilter; label: string }) => {
          const selected: boolean = stateFilter === filter.key;
          return (
            <Pressable
              key={filter.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={filter.label}
              onPress={() => {
                setStateFilter(filter.key);
                setVisibleCount(PAGE_SIZE);
                setVisibleEpisodeCount(PAGE_SIZE);
              }}
              style={{
                minHeight: 48,
                justifyContent: "center",
                paddingHorizontal: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: selected
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
                backgroundColor: selected
                  ? theme.colors.iconBackground
                  : theme.colors.backgroundElevated,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: selected
                    ? theme.colors.actionPrimary
                    : theme.colors.textSecondary,
                }}
              >
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (showLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: 20,
            paddingBottom: bottomPadding,
            flexGrow: 1,
          }}
        >
          {listHeader}
          <View>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </ScrollView>
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
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: 20,
            paddingBottom: bottomPadding,
            flexGrow: 1,
          }}
        >
          {listHeader}
          <EmptyState
            title="Something went wrong"
            subtitle={
              segment === "incidents"
                ? "Failed to load incidents. Pull to refresh or try again."
                : "Failed to load incident episodes. Pull to refresh or try again."
            }
            icon="incidents"
            actionLabel="Retry"
            onAction={retryFn}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}>
      {segment === "incidents" ? (
        <SectionList
          sections={incidentSections}
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="response-list"
          ListHeaderComponent={listHeader}
          keyExtractor={(wrapped: ProjectIncidentItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: bottomPadding,
            flexGrow: 1,
          }}
          renderSectionHeader={(params: {
            section: DefaultSectionT & IncidentSection;
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
                        color: "#22C55E",
                        onAction: () => {
                          return handleAcknowledge(wrapped);
                        },
                      }
                    : undefined
                }
              >
                <IncidentCard
                  incident={wrapped.item}
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
              title={hasFilters ? "No matching incidents" : "No incidents"}
              subtitle={
                hasFilters
                  ? "Try another search or clear your filters to see more."
                  : "Incidents in this project will appear here."
              }
              actionLabel={hasFilters ? "Clear filters" : undefined}
              onAction={hasFilters ? resetFilters : undefined}
              icon="incidents"
            />
          }
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      ) : (
        <SectionList
          sections={episodeSections}
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="response-list"
          ListHeaderComponent={listHeader}
          keyExtractor={(wrapped: ProjectIncidentEpisodeItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: bottomPadding,
            flexGrow: 1,
          }}
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
            ProjectIncidentEpisodeItem,
            DefaultSectionT & EpisodeSection
          >) => {
            const isResolved: boolean = !section.isActive;
            return (
              <EpisodeCard
                episode={wrapped.item}
                type="incident"
                muted={isResolved}
                onPress={() => {
                  return handleEpisodePress(wrapped);
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title={
                hasFilters ? "No matching episodes" : "No incident episodes"
              }
              subtitle={
                hasFilters
                  ? "Try another search or clear your filters to see more."
                  : "Incident episodes will appear here."
              }
              actionLabel={hasFilters ? "Clear filters" : undefined}
              onAction={hasFilters ? resetFilters : undefined}
              icon="episodes"
            />
          }
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}
