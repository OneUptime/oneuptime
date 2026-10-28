import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  View,
  SectionList,
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
import { useContentGutters } from "../layout/WindowLayout";
import type { ContentGutters } from "../layout/windowLayout";
import {
  useListPane,
  usePaneScrollRestoration,
  usePaneState,
  type ListPaneState,
  type PaneScrollRestoration,
} from "../navigation/paneState";
import ScreenIntro from "../components/ScreenIntro";
import SearchField from "../components/SearchField";
import ListStatusScroll from "../components/ListStatusScroll";
import { matchesSearch } from "../utils/search";
import { getResolvedStateIds } from "../utils/resolvedState";
import {
  getAcknowledgedState,
  isAcknowledgedById,
} from "../utils/acknowledgedState";
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
import type { AlertsStackParamList } from "../navigation/types";
import type {
  AlertState,
  ProjectAlertItem,
  ProjectAlertEpisodeItem,
} from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  ListSectionHeader,
  ViewSwitch,
  type ViewOption,
} from "../components/ResponseListControls";

const PAGE_SIZE: number = 20;

type Segment = "alerts" | "episodes";
type StateFilter = "all" | "active" | "resolved";

type NavProp = NativeStackNavigationProp<AlertsStackParamList, "AlertsList">;

interface AlertSection {
  title: string;
  isActive: boolean;
  count: number;
  data: ProjectAlertItem[];
}

interface EpisodeSection {
  title: string;
  isActive: boolean;
  count: number;
  data: ProjectAlertEpisodeItem[];
}

const VIEW_OPTIONS: Array<ViewOption<Segment>> = [
  {
    key: "alerts",
    label: "Alerts",
    icon: "list-outline",
    accessibilityHint: "Show individual alerts",
  },
  {
    key: "episodes",
    label: "Episodes",
    icon: "layers-outline",
    accessibilityHint: "Show related alerts grouped into episodes",
  },
];

const ALERTS_DESCRIPTION: string = "Each alert, listed on its own.";
const EPISODES_DESCRIPTION: string = "Related alerts, grouped into episodes.";

interface AlertsScreenProps {
  embedded?: boolean;
}

export default function AlertsScreen({
  embedded = false,
}: AlertsScreenProps = {}): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const listPane: ListPaneState = useListPane();
  // Kept in the navigator so a fold or an unfold brings the list back as it was.
  const [search, setSearch] = usePaneState<string>("alerts.search", "");
  const [stateFilter, setStateFilter] = usePaneState<StateFilter>(
    "alerts.filter",
    "all",
  );
  const [refreshing, setRefreshing] = useState(false);
  const navigation: NavProp = useNavigation<NavProp>();
  const route: RouteProp<AlertsStackParamList, "AlertsList"> =
    useRoute<RouteProp<AlertsStackParamList, "AlertsList">>();

  const [segment, setSegment] = usePaneState<Segment>(
    "alerts.segment",
    "alerts",
  );
  const [visibleCount, setVisibleCount] = usePaneState<number>(
    "alerts.visible",
    PAGE_SIZE,
  );
  const [visibleEpisodeCount, setVisibleEpisodeCount] = usePaneState<number>(
    "alerts.visibleEpisodes",
    PAGE_SIZE,
  );
  // The params already applied: seen again after a fold, they must not wipe the search.
  const [appliedParams, setAppliedParams] = usePaneState<
    AlertsStackParamList["AlertsList"] | null
  >("alerts.appliedParams", null);
  const alertListRef: React.RefObject<SectionList<
    ProjectAlertItem,
    AlertSection
  > | null> = useRef<SectionList<ProjectAlertItem, AlertSection>>(null);
  const episodeListRef: React.RefObject<SectionList<
    ProjectAlertEpisodeItem,
    EpisodeSection
  > | null> =
    useRef<SectionList<ProjectAlertEpisodeItem, EpisodeSection>>(null);
  const alertScroll: PaneScrollRestoration = usePaneScrollRestoration(
    "alerts.scroll.alerts",
    (offsetY: number): void => {
      alertListRef.current
        ?.getScrollResponder()
        ?.scrollTo({ x: 0, y: offsetY, animated: false });
    },
    { headerTop: spacing.xl },
  );
  const episodeScroll: PaneScrollRestoration = usePaneScrollRestoration(
    "alerts.scroll.episodes",
    (offsetY: number): void => {
      episodeListRef.current
        ?.getScrollResponder()
        ?.scrollTo({ x: 0, y: offsetY, animated: false });
    },
    { headerTop: spacing.xl },
  );

  useEffect(() => {
    if (route.params === appliedParams || route.params === undefined) {
      return;
    }
    setAppliedParams(route.params);
    if (route.params?.initialSegment || route.params?.initialFilter) {
      setSearch("");
    }
    if (
      route.params?.initialSegment === "alerts" ||
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
    items: allAlerts,
    isLoading,
    isError,
    refetch,
  } = useAllProjectAlerts();
  const {
    statesMap,
    isLoading: statesLoading,
    isError: statesError,
  } = useAllProjectAlertStates();
  const {
    items: allEpisodes,
    isLoading: episodesLoading,
    isError: episodesError,
    refetch: refetchEpisodes,
  } = useAllProjectAlertEpisodes();
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient: QueryClient = useQueryClient();

  /*
   * Per project, the states a record counts as resolved in: the project's
   * resolved state and any state placed after it (utils/resolvedState).
   */
  const resolvedStateIds: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set();
    statesMap.forEach((states: AlertState[]) => {
      getResolvedStateIds(states).forEach((stateId: string) => {
        ids.add(stateId);
      });
    });
    return ids;
  }, [statesMap]);

  const filteredAlerts: ProjectAlertItem[] = useMemo(() => {
    return allAlerts.filter((wrapped: ProjectAlertItem) => {
      return matchesSearch(search, [
        wrapped.item.title,
        wrapped.item._id,
        wrapped.item.alertNumber,
        wrapped.item.alertNumberWithPrefix,
        wrapped.projectName,
      ]);
    });
  }, [allAlerts, search]);

  const filteredEpisodes: ProjectAlertEpisodeItem[] = useMemo(() => {
    return allEpisodes.filter((wrapped: ProjectAlertEpisodeItem) => {
      return matchesSearch(search, [
        wrapped.item.title,
        wrapped.item._id,
        wrapped.item.episodeNumber,
        wrapped.item.episodeNumberWithPrefix,
        wrapped.projectName,
      ]);
    });
  }, [allEpisodes, search]);

  const alertSections: AlertSection[] = useMemo(() => {
    const active: ProjectAlertItem[] = [];
    const resolved: ProjectAlertItem[] = [];
    for (const wrapped of filteredAlerts) {
      const stateId: string | undefined = wrapped.item.currentAlertState?._id;
      if (stateId && resolvedStateIds.has(stateId)) {
        resolved.push(wrapped);
      } else {
        active.push(wrapped);
      }
    }
    const sections: AlertSection[] = [];
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
  }, [filteredAlerts, resolvedStateIds, visibleCount, stateFilter]);

  const episodeSections: EpisodeSection[] = useMemo(() => {
    const active: ProjectAlertEpisodeItem[] = [];
    const resolved: ProjectAlertEpisodeItem[] = [];
    for (const wrapped of filteredEpisodes) {
      const stateId: string | undefined = wrapped.item.currentAlertState?._id;
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

  const totalAlertCount: number = filteredAlerts.length;
  const totalEpisodeCount: number = filteredEpisodes.length;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    setRefreshing(true);
    try {
      if (segment === "alerts") {
        setVisibleCount(PAGE_SIZE);
        await Promise.all([
          refetch(),
          queryClient.refetchQueries({
            queryKey: ["alert-states"],
            type: "active",
          }),
        ]);
      } else {
        setVisibleEpisodeCount(PAGE_SIZE);
        await Promise.all([
          refetchEpisodes(),
          queryClient.refetchQueries({
            queryKey: ["alert-states"],
            type: "active",
          }),
        ]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchEpisodes, lightImpact, segment, queryClient]);

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
        // Where Acknowledge moves it: the project's acknowledged state.
        const acknowledgeState: AlertState | undefined =
          getAcknowledgedState(projectStates);
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
            "Failed to acknowledge this alert. It is still unacknowledged.",
          );
        }
      },
      [statesMap, successFeedback, errorFeedback, refetch, queryClient],
    );

  const showLoading: boolean =
    statesLoading ||
    (segment === "alerts"
      ? isLoading && allAlerts.length === 0
      : episodesLoading && allEpisodes.length === 0);

  const hasStateMetadata: boolean =
    statesMap.size > 0 &&
    (segment === "alerts" ? allAlerts : allEpisodes).every(
      (wrapped: { projectId: string }) => {
        return statesMap.has(wrapped.projectId);
      },
    );
  const showError: boolean =
    (statesError && !hasStateMetadata) ||
    (segment === "alerts" ? isError : episodesError);

  const hasFilters: boolean = search.trim().length > 0 || stateFilter !== "all";
  const resetFilters: () => void = () => {
    setSearch("");
    setStateFilter("all");
    setVisibleCount(PAGE_SIZE);
    setVisibleEpisodeCount(PAGE_SIZE);
  };
  const viewDescription: string =
    segment === "alerts" ? ALERTS_DESCRIPTION : EPISODES_DESCRIPTION;
  const listHeader: React.JSX.Element = (
    <View style={{ marginBottom: spacing.xs }}>
      {!embedded ? (
        <ScreenIntro
          title="Alerts"
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
          accessibilityLabel="Search alerts and episodes"
        />
        {(segment === "alerts" ? allAlerts.length : allEpisodes.length) >=
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
              {segment === "alerts" ? "alerts" : "episodes"}.
            </Text>
          </View>
        ) : null}
      </View>
      {statesError && hasStateMetadata ? (
        <View style={{ marginTop: spacing.md }}>
          <QueryErrorNotice
            message="Could not refresh alert states. Showing last loaded states."
            retryLabel="Retry alert states"
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
            : (segment === "alerts" ? alertSections : episodeSections).reduce(
                (total: number, section: { count: number }) => {
                  return total + section.count;
                },
                0,
              )
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
    ...gutters,
    flexGrow: 1,
  };

  if (showLoading) {
    return (
      <View
        testID="response-screen"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ListStatusScroll
          scrollKey="alerts.scroll.status"
          header={listHeader}
          headerTop={spacing.xl}
          testID="response-list-status"
          refreshControl={refreshControl}
          contentContainerStyle={contentContainerStyle}
        >
          <View
            testID="response-list-loading"
            style={{ marginTop: spacing.xs }}
          >
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </ListStatusScroll>
      </View>
    );
  }

  if (showError) {
    return (
      <View
        testID="response-screen"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ListStatusScroll
          scrollKey="alerts.scroll.status"
          header={listHeader}
          headerTop={spacing.xl}
          testID="response-list-status"
          refreshControl={refreshControl}
          contentContainerStyle={contentContainerStyle}
        >
          <EmptyState
            title="Something went wrong"
            subtitle={
              statesError
                ? "Could not load alert states. Retry to see which alerts are active or resolved."
                : segment === "alerts"
                  ? "Failed to load alerts. Pull to refresh or try again."
                  : "Failed to load alert episodes. Pull to refresh or try again."
            }
            icon="error"
            actionLabel="Retry"
            onAction={onRefresh}
          />
        </ListStatusScroll>
      </View>
    );
  }

  return (
    <View
      testID="response-screen"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
    >
      {segment === "alerts" ? (
        <SectionList
          ref={alertListRef}
          sections={alertSections}
          style={{ flex: 1 }}
          onScroll={alertScroll.onScroll}
          onContentSizeChange={alertScroll.onContentSizeChange}
          scrollEventThrottle={alertScroll.scrollEventThrottle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="response-list"
          ListHeaderComponent={
            <View onLayout={alertScroll.onHeaderLayout}>{listHeader}</View>
          }
          keyExtractor={(wrapped: ProjectAlertItem) => {
            return `${wrapped.projectId}-${wrapped.item._id}`;
          }}
          contentContainerStyle={contentContainerStyle}
          renderSectionHeader={(params: {
            section: DefaultSectionT & AlertSection;
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
            ProjectAlertItem,
            DefaultSectionT & AlertSection
          >) => {
            const isResolved: boolean = !section.isActive;
            const projectStates: AlertState[] | undefined = statesMap.get(
              wrapped.projectId,
            );
            /*
             * Swiping acknowledges an alert nobody has acknowledged yet: not
             * one in the acknowledged state or in a state placed after it
             * (utils/acknowledgedState), where it would be a move back up
             * the list.
             */
            const canAcknowledge: boolean =
              !isResolved &&
              Boolean(getAcknowledgedState(projectStates)) &&
              !isAcknowledgedById(
                projectStates,
                wrapped.item.currentAlertState?._id,
              );
            return (
              <SwipeableCard
                actionInsetBottom={spacing.md}
                rightAction={
                  canAcknowledge
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
                <AlertCard
                  alert={wrapped.item}
                  muted={isResolved}
                  selected={listPane.isOpen("AlertDetail", {
                    alertId: wrapped.item._id,
                    projectId: wrapped.projectId,
                  })}
                  showChevron={!listPane.besideDetail}
                  onPress={() => {
                    return handlePress(wrapped);
                  }}
                />
              </SwipeableCard>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title={hasFilters ? "No matching alerts" : "No alerts"}
              subtitle={
                hasFilters
                  ? "Try another search or clear your filters to see more."
                  : "Alerts in this project will appear here."
              }
              actionLabel={hasFilters ? "Clear filters" : undefined}
              onAction={hasFilters ? resetFilters : undefined}
              icon={hasFilters ? "alerts" : "success"}
            />
          }
          stickySectionHeadersEnabled={false}
          refreshControl={refreshControl}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
        />
      ) : (
        <SectionList
          ref={episodeListRef}
          sections={episodeSections}
          style={{ flex: 1 }}
          onScroll={episodeScroll.onScroll}
          onContentSizeChange={episodeScroll.onContentSizeChange}
          scrollEventThrottle={episodeScroll.scrollEventThrottle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="response-list"
          ListHeaderComponent={
            <View onLayout={episodeScroll.onHeaderLayout}>{listHeader}</View>
          }
          keyExtractor={(wrapped: ProjectAlertEpisodeItem) => {
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
            ProjectAlertEpisodeItem,
            DefaultSectionT & EpisodeSection
          >) => {
            const isResolved: boolean = !section.isActive;
            return (
              <EpisodeCard
                episode={wrapped.item}
                type="alert"
                muted={isResolved}
                selected={listPane.isOpen("AlertEpisodeDetail", {
                  episodeId: wrapped.item._id,
                  projectId: wrapped.projectId,
                })}
                showChevron={!listPane.besideDetail}
                onPress={() => {
                  return handleEpisodePress(wrapped);
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title={hasFilters ? "No matching episodes" : "No alert episodes"}
              subtitle={
                hasFilters
                  ? "Try another search or clear your filters to see more."
                  : "Alert episodes will appear here."
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
