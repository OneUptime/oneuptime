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
  SectionListRenderItemInfo,
  DefaultSectionT,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";
import AppText from "../components/AppText";
import IconBadge from "../components/IconBadge";
import ListFilters from "../components/ListFilters";
import { getToneColors, type StatusTone } from "../components/StatusPill";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useContentGutters } from "../layout/WindowLayoutProvider";
import type { ContentGutters } from "../layout/windowLayout";
import {
  useListPane,
  usePaneScrollRestoration,
  usePaneState,
  type ListPaneState,
  type PaneScrollRestoration,
} from "../navigation/paneState";
import ScreenIntro from "../components/ScreenIntro";
import SearchFilterRow from "../components/filters/SearchFilterRow";
import ActiveFilterBar from "../components/filters/ActiveFilterBar";
import FilterSheet from "../components/filters/FilterSheet";
import {
  useRecordFilterControls,
  type RecordFilterControls,
} from "../hooks/useRecordFilterControls";
import type { FilterFacet, RecordFilters } from "../filters/recordFilters";
import ListStatusScroll from "../components/ListStatusScroll";
import { matchesSearch } from "../utils/search";
import { getMonitorHealth, type MonitorHealth } from "../utils/monitorHealth";
import { useAllProjectMonitors } from "../hooks/useAllProjectMonitors";
import { useHaptics } from "../hooks/useHaptics";
import { useNow } from "../hooks/useNow";
import MonitorCard from "../components/MonitorCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { MonitorsStackParamList } from "../navigation/types";
import type { ProjectMonitorItem } from "../api/types";

const PAGE_SIZE: number = 20;
type MonitorFilter = "all" | "issues" | "operational" | "disabled";

type NavProp = NativeStackNavigationProp<
  MonitorsStackParamList,
  "MonitorsList"
>;

interface MonitorSection {
  title: string;
  kind: "issues" | "operational" | "disabled" | "unknown" | "notChecked";
  count: number;
  data: ProjectMonitorItem[];
}

interface MonitorCounts {
  total: number;
  operational: number;
  inoperational: number;
  disabled: number;
  notChecked: number;
}

interface HealthTileProps {
  label: string;
  count: number;
  iconName: keyof typeof Ionicons.glyphMap;
  color: string;
  /** Draw a non-zero count in `color`, for the tile that needs attention. */
  emphasize?: boolean;
  stacked: boolean;
}

/*
 * One figure of the fleet summary. The whole tile is a single accessibility
 * element so a screen reader hears "Has issues: 3" rather than a bare "3"
 * followed, a swipe later, by the word it belongs to.
 */
function HealthTile({
  label,
  count,
  iconName,
  color,
  emphasize = false,
  stacked,
}: HealthTileProps): React.JSX.Element {
  const { theme } = useTheme();
  const countColor: string =
    emphasize && count > 0 ? color : theme.colors.textPrimary;

  const countText: React.JSX.Element = (
    <AppText
      variant="title2"
      color={countColor}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {String(count)}
    </AppText>
  );
  const labelText: React.JSX.Element = (
    <AppText
      variant="footnote"
      tone="secondary"
      numberOfLines={stacked ? undefined : 1}
      style={stacked ? { flex: 1 } : undefined}
    >
      {label}
    </AppText>
  );

  return (
    <View
      testID={`monitor-summary-${label}`}
      accessible
      accessibilityLabel={`${label}: ${count}`}
      style={{
        flex: stacked ? undefined : 1,
        flexDirection: stacked ? "row" : "column",
        alignItems: stacked ? "center" : "flex-start",
        gap: stacked ? spacing.md : spacing.xs,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
        backgroundColor: theme.colors.backgroundElevated,
        ...elevation("card", theme.dark),
      }}
    >
      <View style={stacked ? undefined : { marginBottom: spacing.xs }}>
        <IconBadge name={iconName} color={color} size="sm" />
      </View>
      {stacked ? labelText : countText}
      {stacked ? countText : labelText}
    </View>
  );
}

function MonitorSummary({
  counts,
}: {
  counts: MonitorCounts;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked: boolean = fontScale > 1.3;
  return (
    <View
      testID="monitor-summary"
      style={{
        flexDirection: stacked ? "column" : "row",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}
    >
      <HealthTile
        label="Healthy"
        count={counts.operational}
        iconName="checkmark-circle"
        color={theme.colors.statusSuccess}
        stacked={stacked}
      />
      <HealthTile
        label="Has issues"
        count={counts.inoperational}
        iconName="alert-circle"
        color={theme.colors.statusError}
        emphasize
        stacked={stacked}
      />
      <HealthTile
        label="Disabled"
        count={counts.disabled}
        iconName="pause-circle"
        color={theme.colors.textSecondary}
        stacked={stacked}
      />
    </View>
  );
}

const sectionTones: Record<MonitorSection["kind"], StatusTone> = {
  issues: "danger",
  unknown: "warning",
  notChecked: "info",
  disabled: "neutral",
  operational: "success",
};

const sectionIcons: Record<
  MonitorSection["kind"],
  keyof typeof Ionicons.glyphMap
> = {
  issues: "alert-circle",
  unknown: "help-circle",
  notChecked: "hourglass",
  disabled: "pause-circle",
  operational: "checkmark-circle",
};

function MonitorSectionHeader({
  title,
  count,
  kind,
}: {
  title: string;
  count: number;
  kind: MonitorSection["kind"];
}): React.JSX.Element {
  const { theme } = useTheme();
  const tone: { text: string; background: string } = getToneColors(
    theme,
    sectionTones[kind],
  );
  /*
   * Sections that need someone keep full-strength titles; the ones that are
   * fine or switched off step back, so the eye lands on trouble first. A
   * monitor nothing checks is neither fine nor switched off.
   */
  const needsAttention: boolean =
    kind === "issues" || kind === "unknown" || kind === "notChecked";
  return (
    <View
      testID={`monitor-section-${kind}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <Ionicons
        name={sectionIcons[kind]}
        size={18}
        color={kind === "disabled" ? theme.colors.textTertiary : tone.text}
      />
      <AppText
        accessibilityRole="header"
        variant="headline"
        color={
          needsAttention ? theme.colors.textPrimary : theme.colors.textSecondary
        }
        style={{ flexShrink: 1 }}
      >
        {title}
      </AppText>
      <View
        testID={`monitor-section-${kind}-count`}
        style={{
          minWidth: 24,
          alignItems: "center",
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xxs,
          borderRadius: radius.pill,
          backgroundColor: tone.background,
        }}
      >
        <AppText
          variant="caption"
          weight="700"
          color={tone.text}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {String(count)}
        </AppText>
      </View>
    </View>
  );
}

/** A short line of context under a control, with an info glyph beside it. */
function HelperNote({
  children,
  testID,
}: {
  children: string;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.xs + 2,
        marginTop: spacing.sm,
      }}
    >
      <Ionicons
        name="information-circle-outline"
        size={16}
        color={theme.colors.textTertiary}
        style={{ marginTop: 2 }}
      />
      <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

export default function MonitorsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const listPane: ListPaneState = useListPane();
  // Kept in the navigator so a fold or an unfold brings the list back as it was.
  const [search, setSearch] = usePaneState<string>("monitors.search", "");
  const [filter, setFilter] = usePaneState<MonitorFilter>(
    "monitors.filter",
    "all",
  );
  const [refreshing, setRefreshing] = useState(false);
  const navigation: NavProp = useNavigation<NavProp>();
  const route: RouteProp<MonitorsStackParamList, "MonitorsList"> =
    useRoute<RouteProp<MonitorsStackParamList, "MonitorsList">>();

  const [visibleCount, setVisibleCount] = usePaneState<number>(
    "monitors.visible",
    PAGE_SIZE,
  );
  /*
   * Owner, status, type and labels, as the Dashboard filters monitors:
   * asked of the server, so they reach every monitor of the project.
   */
  const recordFilters: RecordFilterControls = useRecordFilterControls(
    "monitors",
    "monitors.recordFilters",
    (): void => {
      setVisibleCount(PAGE_SIZE);
    },
  );
  // The params already applied: seen again after a fold, they must not wipe the search.
  const [appliedParams, setAppliedParams] = usePaneState<
    MonitorsStackParamList["MonitorsList"] | null
  >("monitors.appliedParams", null);
  const listRef: React.RefObject<SectionList<
    ProjectMonitorItem,
    MonitorSection
  > | null> = useRef<SectionList<ProjectMonitorItem, MonitorSection>>(null);
  const scroll: PaneScrollRestoration = usePaneScrollRestoration(
    "monitors.scroll",
    (offsetY: number): void => {
      listRef.current
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
    if (route.params?.initialFilter) {
      setSearch("");
      // A count on Home opens every monitor it counted, not a filtered few.
      recordFilters.clear();
      setFilter(route.params.initialFilter);
      setVisibleCount(PAGE_SIZE);
    }
  }, [route.params]);

  const {
    items: allMonitors,
    isLoading,
    isError,
    refetch,
  } = useAllProjectMonitors(recordFilters.filters);
  const { lightImpact } = useHaptics();
  // When a first result turns overdue, its row says so without a reload.
  const now: number = useNow();

  const { monitorSections, counts } = useMemo(() => {
    const issues: ProjectMonitorItem[] = [];
    const operational: ProjectMonitorItem[] = [];
    const disabled: ProjectMonitorItem[] = [];
    const unknown: ProjectMonitorItem[] = [];
    const notChecked: ProjectMonitorItem[] = [];
    let disabledCount: number = 0;
    let inoperationalCount: number = 0;
    let operationalCount: number = 0;
    let notCheckedCount: number = 0;

    for (const wrapped of allMonitors) {
      /*
       * Status names are editable. Only the server's semantic flag
       * establishes health, and a monitor whose monitoring is off is
       * Disabled, never an issue: the status it holds is what its last check
       * saw (utils/monitorHealth, the web's rule). Home's Monitor issues
       * count asks the server for the same monitors. An operational status
       * no check stands behind - nothing has checked the monitor yet, or no
       * probe checks it - is Not checked, never Healthy, as the web's
       * Operational filter leaves it out (issue #8961).
       */
      const health: MonitorHealth = getMonitorHealth(wrapped.item);
      const isDisabled: boolean = health === "disabled";
      const hasIssue: boolean = health === "issue";
      const isHealthy: boolean = health === "healthy";
      const isNotChecked: boolean = health === "notChecked";
      if (isDisabled) {
        disabledCount++;
      }
      if (hasIssue) {
        inoperationalCount++;
      }
      if (isHealthy) {
        operationalCount++;
      }
      if (isNotChecked) {
        notCheckedCount++;
      }

      if (
        !matchesSearch(search, [
          wrapped.item.name,
          wrapped.item._id,
          wrapped.item.monitorType,
          wrapped.projectName,
        ])
      ) {
        continue;
      }
      if (
        (filter === "issues" && !hasIssue) ||
        (filter === "operational" && !isHealthy) ||
        (filter === "disabled" && !isDisabled)
      ) {
        continue;
      }

      if (isDisabled) {
        disabled.push(wrapped);
      } else if (hasIssue) {
        issues.push(wrapped);
      } else if (isHealthy) {
        operational.push(wrapped);
      } else if (isNotChecked) {
        notChecked.push(wrapped);
      } else {
        unknown.push(wrapped);
      }
    }

    const sections: MonitorSection[] = [];
    if (issues.length > 0) {
      sections.push({
        title: "Issues",
        kind: "issues",
        count: issues.length,
        data: issues.slice(0, visibleCount),
      });
    }
    if (unknown.length > 0) {
      sections.push({
        title: "Status unknown",
        kind: "unknown",
        count: unknown.length,
        data: unknown.slice(0, visibleCount),
      });
    }
    if (notChecked.length > 0) {
      sections.push({
        title: "Not checked",
        kind: "notChecked",
        count: notChecked.length,
        data: notChecked.slice(0, visibleCount),
      });
    }
    if (disabled.length > 0) {
      sections.push({
        title: "Disabled monitors",
        kind: "disabled",
        count: disabled.length,
        data: disabled.slice(0, visibleCount),
      });
    }
    if (operational.length > 0) {
      sections.push({
        title: "Healthy",
        kind: "operational",
        count: operational.length,
        data: operational.slice(0, visibleCount),
      });
    }
    return {
      monitorSections: sections,
      counts: {
        total: allMonitors.length,
        operational: operationalCount,
        inoperational: inoperationalCount,
        disabled: disabledCount,
        notChecked: notCheckedCount,
      },
    };
  }, [allMonitors, visibleCount, search, filter]);

  const totalCount: number = allMonitors.length;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    setVisibleCount(PAGE_SIZE);
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch, lightImpact]);

  const loadMore: () => void = useCallback(() => {
    if (visibleCount < totalCount) {
      setVisibleCount((prev: number) => {
        return prev + PAGE_SIZE;
      });
    }
  }, [visibleCount, totalCount]);

  const handlePress: (wrapped: ProjectMonitorItem) => void = useCallback(
    (wrapped: ProjectMonitorItem) => {
      navigation.navigate("MonitorDetail", {
        monitorId: wrapped.item._id,
        projectId: wrapped.projectId,
      });
    },
    [navigation],
  );

  const hasFilters: boolean =
    search.trim().length > 0 || filter !== "all" || recordFilters.hasActive;
  const resetFilters: () => void = () => {
    setSearch("");
    setFilter("all");
    recordFilters.clear();
    setVisibleCount(PAGE_SIZE);
  };

  const refreshControl: React.JSX.Element = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.actionPrimary}
      colors={[theme.colors.actionPrimary]}
      progressBackgroundColor={theme.colors.backgroundElevated}
    />
  );

  const listHeader: React.JSX.Element = (
    <View style={{ marginBottom: spacing.sm }}>
      <ScreenIntro
        compact
        title="Monitors"
        description="Service health at a glance."
      />
      {totalCount > 0 && !isLoading && !isError ? (
        <MonitorSummary counts={counts} />
      ) : null}
      <SearchFilterRow
        search={search}
        onSearch={(value: string) => {
          setSearch(value);
          setVisibleCount(PAGE_SIZE);
        }}
        placeholder="Search name or ID"
        searchAccessibilityLabel="Search monitors"
        noun="monitors"
        filterCount={recordFilters.activeCount}
        onOpenFilters={(): void => {
          recordFilters.open();
        }}
      />
      {allMonitors.length >= 100 ? (
        <HelperNote testID="monitor-search-cap">
          {recordFilters.hasActive
            ? "Showing the 100 newest monitors that match your filters."
            : "Search covers the 100 most recent monitors."}
        </HelperNote>
      ) : null}
      <ListFilters
        options={[
          { key: "all", label: "All", accessibilityLabel: "All monitors" },
          { key: "issues", label: "Issues", accessibilityLabel: "Has issues" },
          {
            key: "operational",
            label: "Healthy",
            accessibilityLabel: "Healthy",
          },
          {
            key: "disabled",
            label: "Disabled",
            accessibilityLabel: "Disabled only",
          },
        ]}
        selected={filter}
        onSelect={(value: MonitorFilter) => {
          setFilter(value);
          setVisibleCount(PAGE_SIZE);
        }}
        resultCount={
          isLoading || isError
            ? undefined
            : monitorSections.reduce(
                (total: number, section: MonitorSection) => {
                  return total + section.count;
                },
                0,
              )
        }
        onReset={hasFilters ? resetFilters : undefined}
      >
        <ActiveFilterBar
          items={recordFilters.items}
          onOpen={(facet: FilterFacet): void => {
            recordFilters.open(facet);
          }}
          onRemove={(facet: FilterFacet): void => {
            recordFilters.remove(facet);
          }}
        />
      </ListFilters>
      {/*
       * Where a disabled monitor went, said only when there is one: its
       * last status may have been Offline, and it is no issue now.
       */}
      {filter === "issues" && counts.disabled > 0 ? (
        <HelperNote testID="monitor-issues-note">
          Monitors with monitoring turned off are listed under Disabled.
        </HelperNote>
      ) : null}
      {/*
       * Where a monitor nothing has checked yet went, said only when there
       * is one: its status reads Operational, and no check stands behind it.
       */}
      {filter === "operational" && counts.notChecked > 0 ? (
        <HelperNote testID="monitor-healthy-note">
          Monitors that are not checked are listed under All.
        </HelperNote>
      ) : null}
    </View>
  );

  const filterSheet: React.JSX.Element = (
    <FilterSheet
      visible={recordFilters.sheetVisible}
      list="monitors"
      noun="monitors"
      value={recordFilters.filters}
      options={recordFilters.options}
      canFilterByMe
      focusFacet={recordFilters.focusFacet}
      onApply={(next: RecordFilters): void => {
        /*
         * Picking statuses in the sheet is the more exact question: the
         * health chip goes back to All, so the two never contradict each
         * other into an empty list.
         */
        if (recordFilters.apply(next).picksStates) {
          setFilter("all");
        }
      }}
      onClose={recordFilters.close}
    />
  );

  const scrollContentStyle: {
    padding: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
    flexGrow: number;
  } = {
    padding: spacing.xl,
    paddingBottom: bottomPadding,
    ...gutters,
    flexGrow: 1,
  };

  if (isLoading && allMonitors.length === 0) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ListStatusScroll
          scrollKey="monitors.scroll.status"
          header={listHeader}
          testID="monitor-list-loading"
          contentContainerStyle={scrollContentStyle}
        >
          <View style={{ marginTop: spacing.sm }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </ListStatusScroll>
        {filterSheet}
      </View>
    );
  }

  if (isError) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ListStatusScroll
          scrollKey="monitors.scroll.status"
          header={listHeader}
          testID="monitor-list-error"
          contentContainerStyle={scrollContentStyle}
          refreshControl={refreshControl}
        >
          <EmptyState
            title="Something went wrong"
            subtitle="Failed to load monitors. Pull to refresh or try again."
            icon="error"
            actionLabel="Retry"
            onAction={() => {
              return refetch();
            }}
          />
        </ListStatusScroll>
        {filterSheet}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}>
      <SectionList
        ref={listRef}
        sections={monitorSections}
        style={{ flex: 1 }}
        onScroll={scroll.onScroll}
        onContentSizeChange={scroll.onContentSizeChange}
        scrollEventThrottle={scroll.scrollEventThrottle}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="monitor-list"
        keyExtractor={(wrapped: ProjectMonitorItem) => {
          return `${wrapped.projectId}-${wrapped.item._id}`;
        }}
        contentContainerStyle={scrollContentStyle}
        ListHeaderComponent={
          <View onLayout={scroll.onHeaderLayout}>{listHeader}</View>
        }
        renderSectionHeader={(params: {
          section: DefaultSectionT & MonitorSection;
        }) => {
          return (
            <MonitorSectionHeader
              title={params.section.title}
              count={params.section.count}
              kind={params.section.kind}
            />
          );
        }}
        renderSectionFooter={() => {
          return <View style={{ height: spacing.md }} />;
        }}
        renderItem={({
          item: wrapped,
          section,
        }: SectionListRenderItemInfo<
          ProjectMonitorItem,
          DefaultSectionT & MonitorSection
        >) => {
          const isOperational: boolean = section.kind === "operational";
          return (
            <MonitorCard
              monitor={wrapped.item}
              now={new Date(now)}
              muted={isOperational}
              selected={listPane.isOpen("MonitorDetail", {
                monitorId: wrapped.item._id,
                projectId: wrapped.projectId,
              })}
              showChevron={!listPane.besideDetail}
              onPress={() => {
                return handlePress(wrapped);
              }}
            />
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title={hasFilters ? "No matching monitors" : "No monitors"}
            subtitle={
              hasFilters
                ? "Try another search or clear your filters to see more."
                : "Monitors in this project will appear here."
            }
            actionLabel={hasFilters ? "Clear filters" : undefined}
            onAction={hasFilters ? resetFilters : undefined}
            icon="monitors"
          />
        }
        stickySectionHeadersEnabled={false}
        refreshControl={refreshControl}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
      {filterSheet}
    </View>
  );
}
