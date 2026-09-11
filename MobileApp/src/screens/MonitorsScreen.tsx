import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  SectionList,
  ScrollView,
  RefreshControl,
  Text,
  Pressable,
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
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";
import { useScreenPadding } from "../hooks/useScreenPadding";
import ScreenIntro from "../components/ScreenIntro";
import SearchField from "../components/SearchField";
import { matchesSearch } from "../utils/search";
import { useAllProjectMonitors } from "../hooks/useAllProjectMonitors";
import { useHaptics } from "../hooks/useHaptics";
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
  kind: "issues" | "operational" | "disabled" | "unknown";
  data: ProjectMonitorItem[];
}

interface MonitorCounts {
  total: number;
  operational: number;
  inoperational: number;
  disabled: number;
}

function MonitorSummary({
  counts,
}: {
  counts: MonitorCounts;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 16,
        paddingVertical: 20,
        marginBottom: 12,
      }}
    >
      {[
        {
          label: "Healthy",
          count: counts.operational,
          color: theme.colors.statusSuccess,
        },
        {
          label: "Has issues",
          count: counts.inoperational,
          color: theme.colors.statusError,
        },
        {
          label: "Disabled",
          count: counts.disabled,
          color: theme.colors.textSecondary,
        },
      ].map((item: { label: string; count: number; color: string }) => {
        return (
          <View
            key={item.label}
            style={{ flex: 1, gap: 6 }}
            testID={`monitor-summary-${item.label}`}
          >
            <Text
              style={{
                fontSize: 32,
                lineHeight: 38,
                fontWeight: "600",
                letterSpacing: -1,
                color: theme.colors.textPrimary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {item.count}
            </Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: item.color,
                }}
              />
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: 13,
                  lineHeight: 19,
                  color: theme.colors.textSecondary,
                }}
              >
                {item.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SectionHeader({
  title,
  count,
  kind,
}: {
  title: string;
  count: number;
  kind: MonitorSection["kind"];
}): React.JSX.Element {
  const { theme } = useTheme();
  const isActive: boolean = kind === "issues";
  const iconName: keyof typeof Ionicons.glyphMap =
    kind === "issues"
      ? "alert-circle"
      : kind === "operational"
        ? "checkmark-circle"
        : kind === "disabled"
          ? "pause-circle"
          : "help-circle";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: 8,
        paddingTop: 4,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <Ionicons
        name={iconName}
        size={13}
        color={
          isActive ? theme.colors.severityCritical : theme.colors.textTertiary
        }
        style={{ marginRight: 6 }}
      />
      <Text
        accessibilityRole="header"
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

export default function MonitorsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const navigation: NavProp = useNavigation<NavProp>();
  const route: RouteProp<MonitorsStackParamList, "MonitorsList"> =
    useRoute<RouteProp<MonitorsStackParamList, "MonitorsList">>();

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (route.params?.initialFilter) {
      setSearch("");
      setFilter(route.params.initialFilter);
      setVisibleCount(PAGE_SIZE);
    }
  }, [route.params]);

  const {
    items: allMonitors,
    isLoading,
    isError,
    refetch,
  } = useAllProjectMonitors();
  const { lightImpact } = useHaptics();

  const { monitorSections, counts } = useMemo(() => {
    const issues: ProjectMonitorItem[] = [];
    const operational: ProjectMonitorItem[] = [];
    const disabled: ProjectMonitorItem[] = [];
    const unknown: ProjectMonitorItem[] = [];
    let disabledCount: number = 0;
    let inoperationalCount: number = 0;
    let operationalCount: number = 0;

    for (const wrapped of allMonitors) {
      const isDisabled: boolean = wrapped.item.disableActiveMonitoring === true;
      // Status names are editable. Only the server's semantic flag establishes health.
      const operationalState: boolean | undefined =
        wrapped.item.currentMonitorStatus?.isOperationalState;
      const hasIssue: boolean = operationalState === false;
      const isHealthy: boolean = operationalState === true && !isDisabled;
      if (isDisabled) {
        disabledCount++;
      }
      if (hasIssue) {
        inoperationalCount++;
      }
      if (isHealthy) {
        operationalCount++;
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
      } else {
        unknown.push(wrapped);
      }
    }

    const sections: MonitorSection[] = [];
    if (issues.length > 0) {
      sections.push({
        title: "Issues",
        kind: "issues",
        data: issues.slice(0, visibleCount),
      });
    }
    if (unknown.length > 0) {
      sections.push({
        title: "Status unknown",
        kind: "unknown",
        data: unknown.slice(0, visibleCount),
      });
    }
    if (disabled.length > 0) {
      sections.push({
        title: "Disabled monitors",
        kind: "disabled",
        data: disabled.slice(0, visibleCount),
      });
    }
    if (operational.length > 0) {
      sections.push({
        title: "Healthy",
        kind: "operational",
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

  const hasFilters: boolean = search.trim().length > 0 || filter !== "all";
  const listHeader: React.JSX.Element = (
    <View style={{ marginBottom: 24 }}>
      <ScreenIntro
        compact
        title="Monitors"
        description="A clear view of what’s up, and what needs a look."
      />
      {totalCount > 0 ? <MonitorSummary counts={counts} /> : null}
      <SearchField
        value={search}
        onChangeText={(value: string) => {
          setSearch(value);
          setVisibleCount(PAGE_SIZE);
        }}
        placeholder="Search name or ID"
        accessibilityLabel="Search monitors"
      />
      {allMonitors.length >= 100 ? (
        <Text
          style={{
            marginTop: 10,
            fontSize: 14,
            lineHeight: 21,
            color: theme.colors.textSecondary,
          }}
        >
          Search covers the 100 most recent monitors.
        </Text>
      ) : null}
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
            { key: "all", label: "All monitors" },
            { key: "issues", label: "Has issues" },
            { key: "operational", label: "Healthy" },
            { key: "disabled", label: "Disabled only" },
          ] as const
        ).map((option: { key: MonitorFilter; label: string }) => {
          const selected: boolean = filter === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              {...getToggleAccessibilityProps(selected)}
              onPress={() => {
                setFilter(option.key);
                setVisibleCount(PAGE_SIZE);
              }}
              style={{
                minHeight: 48,
                paddingHorizontal: 10,
                justifyContent: "center",
                borderRadius: 24,
                backgroundColor: selected
                  ? theme.colors.textPrimary
                  : theme.colors.backgroundElevated,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: selected
                    ? theme.colors.textInverse
                    : theme.colors.textSecondary,
                }}
              >
                {option.key === "all"
                  ? "All"
                  : option.key === "issues"
                    ? "Issues"
                    : option.key === "operational"
                      ? "Healthy"
                      : "Disabled"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {filter === "issues" ? (
        <Text
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 21,
            color: theme.colors.textSecondary,
          }}
        >
          Includes disabled monitors whose last reported status was
          non-operational.
        </Text>
      ) : null}
    </View>
  );

  if (isLoading && allMonitors.length === 0) {
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

  if (isError) {
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
            subtitle="Failed to load monitors. Pull to refresh or try again."
            icon="monitors"
            actionLabel="Retry"
            onAction={() => {
              return refetch();
            }}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}>
      <SectionList
        sections={monitorSections}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="monitor-list"
        keyExtractor={(wrapped: ProjectMonitorItem) => {
          return `${wrapped.projectId}-${wrapped.item._id}`;
        }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
        ListHeaderComponent={listHeader}
        renderSectionHeader={(params: {
          section: DefaultSectionT & MonitorSection;
        }) => {
          return (
            <SectionHeader
              title={params.section.title}
              count={params.section.data.length}
              kind={params.section.kind}
            />
          );
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
              muted={isOperational}
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
            onAction={
              hasFilters
                ? () => {
                    setSearch("");
                    setFilter("all");
                    setVisibleCount(PAGE_SIZE);
                  }
                : undefined
            }
            icon="monitors"
          />
        }
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}
