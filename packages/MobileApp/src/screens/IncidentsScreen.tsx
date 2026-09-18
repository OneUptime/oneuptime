import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  SectionList,
  ScrollView,
  RefreshControl,
  Text,
  Alert,
  SectionListRenderItemInfo,
  DefaultSectionT,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing, typography } from "../theme/tokens";
import ListFilters from "../components/ListFilters";
import QueryErrorNotice from "../components/QueryErrorNotice";
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
import type { IncidentsStackParamList } from "../navigation/types";
import type {
  IncidentState,
  ProjectIncidentItem,
  ProjectIncidentEpisodeItem,
} from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  ListSectionHeader,
  ViewSwitch,
  type ViewOption,
} from "../components/ResponseListControls";

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
  count: number;
  data: ProjectIncidentItem[];
}

interface EpisodeSection {
  title: string;
  isActive: boolean;
  count: number;
  data: ProjectIncidentEpisodeItem[];
}

const VIEW_OPTIONS: Array<ViewOption<Segment>> = [
  {
    key: "incidents",
    label: "Incidents",
    icon: "list-outline",
    accessibilityHint: "Show individual incidents",
  },
  {
    key: "episodes",
    label: "Episodes",
    icon: "layers-outline",
    accessibilityHint: "Show related incidents grouped into episodes",
  },
];

const INCIDENTS_DESCRIPTION: string = "Each incident, listed on its own.";
const EPISODES_DESCRIPTION: string =
  "Related incidents, grouped into episodes.";

interface IncidentsScreenProps {
  embedded?: boolean;
}

export default function IncidentsScreen({
  embedded = false,
}: IncidentsScreenProps = {}): React.JSX.Element {
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
    if (route.params?.initialSegment || route.params?.initialFilter) {
      setSearch("");
    }
    if (
      route.params?.initialSegment === "incidents" ||
      route.params?.initialSegment === "episodes"
    ) {
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
  const {
    statesMap,
    isLoading: statesLoading,
    isError: statesError,
  } = useAllProjectIncidentStates();
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
        count: active.length,
        data: active.slice(0, visibleCount),
      });
    }
    if (resolved.length > 0 && stateFilter !== "active") {
      sections.push({
        title: "Resolved",
        isActive: false,
        count: resolved.length,
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
        count: active.length,
        data: active.slice(0, visibleEpisodeCount),
      });
    }
    if (resolved.length > 0 && stateFilter !== "active") {
      sections.push({
        title: "Resolved",
        isActive: false,
        count: resolved.length,
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
        await Promise.all([
          refetch(),
          queryClient.refetchQueries({
            queryKey: ["incident-states"],
            type: "active",
          }),
        ]);
      } else {
        setVisibleEpisodeCount(PAGE_SIZE);
        await Promise.all([
          refetchEpisodes(),
          queryClient.refetchQueries({
            queryKey: ["incident-states"],
            type: "active",
          }),
        ]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchEpisodes, lightImpact, segment, queryClient]);

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
    statesLoading ||
    (segment === "incidents"
      ? isLoading && allIncidents.length === 0
      : episodesLoading && allEpisodes.length === 0);

  const hasStateMetadata: boolean =
    statesMap.size > 0 &&
    (segment === "incidents" ? allIncidents : allEpisodes).every(
      (wrapped: { projectId: string }) => {
        return statesMap.has(wrapped.projectId);
      },
    );
  const showError: boolean =
    (statesError && !hasStateMetadata) ||
    (segment === "incidents" ? isError : episodesError);

  const hasFilters: boolean = search.trim().length > 0 || stateFilter !== "all";
  const resetFilters: () => void = () => {
    setSearch("");
    setStateFilter("all");
    setVisibleCount(PAGE_SIZE);
    setVisibleEpisodeCount(PAGE_SIZE);
  };
  const viewDescription: string =
    segment === "incidents" ? INCIDENTS_DESCRIPTION : EPISODES_DESCRIPTION;
  const listHeader: React.JSX.Element = (
    <View style={{ marginBottom: spacing.xs }}>
      {!embedded ? (
        <ScreenIntro
          title="Incidents"
          description="One place to understand what needs your response."
        />
      ) : null}
      <ViewSwitch<Segment>
        options={VIEW_OPTIONS}
        selected={segment}
        onSelect={(next: Segment) => {
          setSegment(next);
          setVisibleCount(PAGE_SIZE);
          setVisibleEpisodeCount(PAGE_SIZE);
        }}
      />
      <Text
        style={{
          ...typography.footnote,
          marginTop: spacing.sm,
          paddingHorizontal: spacing.xs,
          color: theme.colors.textSecondary,
        }}
      >
        {viewDescription}
      </Text>
      <View style={{ marginTop: spacing.md }}>
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
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.xs + 2,
              marginTop: spacing.sm,
              paddingHorizontal: spacing.xs,
            }}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={theme.colors.textTertiary}
              style={{ marginTop: 1 }}
            />
            <Text
              style={{
                ...typography.footnote,
                flex: 1,
                color: theme.colors.textSecondary,
              }}
            >
              Search covers the 100 most recent{" "}
              {segment === "incidents" ? "incidents" : "episodes"}.
            </Text>
          </View>
        ) : null}
      </View>
      {statesError && hasStateMetadata ? (
        <View style={{ marginTop: spacing.md }}>
          <QueryErrorNotice
            message="Could not refresh incident states. Showing last loaded states."
            retryLabel="Retry incident states"
            onRetry={onRefresh}
          />
        </View>
      ) : null}
      <ListFilters
        options={[
          { key: "all", label: "All", accessibilityLabel: "All states" },
          { key: "active", label: "Active", accessibilityLabel: "Active only" },
          {
            key: "resolved",
            label: "Resolved",
            accessibilityLabel: "Resolved only",
          },
        ]}
        selected={stateFilter}
        onSelect={(value: StateFilter) => {
          setStateFilter(value);
          setVisibleCount(PAGE_SIZE);
          setVisibleEpisodeCount(PAGE_SIZE);
        }}
        resultCount={
          showLoading || showError
            ? undefined
            : (segment === "incidents"
                ? incidentSections
                : episodeSections
              ).reduce((total: number, section: { count: number }) => {
                return total + section.count;
              }, 0)
        }
        onReset={hasFilters ? resetFilters : undefined}
      />
    </View>
  );

  const refreshControl: React.JSX.Element = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.textSecondary}
      colors={[theme.colors.actionPrimary]}
      progressBackgroundColor={theme.colors.backgroundElevated}
    />
  );
  const contentContainerStyle: ViewStyle = {
    padding: spacing.xl,
    paddingBottom: bottomPadding,
    flexGrow: 1,
  };

  if (showLoading) {
    return (
      <View
        testID="response-screen"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          testID="response-list-status"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={refreshControl}
          contentContainerStyle={contentContainerStyle}
        >
          {listHeader}
          <View
            testID="response-list-loading"
            style={{ marginTop: spacing.xs }}
          >
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (showError) {
    return (
      <View
        testID="response-screen"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          testID="response-list-status"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={refreshControl}
          contentContainerStyle={contentContainerStyle}
        >
          {listHeader}
          <EmptyState
            title="Something went wrong"
            subtitle={
              statesError
                ? "Could not load incident states. Retry to see which incidents are active or resolved."
                : segment === "incidents"
                  ? "Failed to load incidents. Pull to refresh or try again."
                  : "Failed to load incident episodes. Pull to refresh or try again."
            }
            icon="error"
            actionLabel="Retry"
            onAction={onRefresh}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      testID="response-screen"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
    >
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
          contentContainerStyle={contentContainerStyle}
          renderSectionHeader={(params: {
            section: DefaultSectionT & IncidentSection;
          }) => {
            return (
              <ListSectionHeader
                title={params.section.title}
                count={params.section.count}
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
                actionInsetBottom={spacing.md}
                rightAction={
                  !isResolved &&
                  acknowledgeState &&
                  wrapped.item.currentIncidentState?._id !==
                    acknowledgeState._id
                    ? {
                        label: "Acknowledge",
                        icon: "checkmark-circle",
                        color: theme.colors.statusSuccess,
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
              icon={hasFilters ? "incidents" : "success"}
            />
          }
          stickySectionHeadersEnabled={false}
          refreshControl={refreshControl}
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
          contentContainerStyle={contentContainerStyle}
          renderSectionHeader={(params: {
            section: DefaultSectionT & EpisodeSection;
          }) => {
            return (
              <ListSectionHeader
                title={params.section.title}
                count={params.section.count}
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
          refreshControl={refreshControl}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}
