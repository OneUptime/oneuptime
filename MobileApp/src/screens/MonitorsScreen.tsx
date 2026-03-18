import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  SectionList,
  ScrollView,
  RefreshControl,
  Text,
  SectionListRenderItemInfo,
  DefaultSectionT,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useAllProjectMonitors } from "../hooks/useAllProjectMonitors";
import { useHaptics } from "../hooks/useHaptics";
import MonitorCard from "../components/MonitorCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { MonitorsStackParamList } from "../navigation/types";
import type { ProjectMonitorItem } from "../api/types";

const PAGE_SIZE: number = 20;

type NavProp = NativeStackNavigationProp<
  MonitorsStackParamList,
  "MonitorsList"
>;

interface MonitorSection {
  title: string;
  isActive: boolean;
  data: ProjectMonitorItem[];
}

interface MonitorCounts {
  total: number;
  operational: number;
  inoperational: number;
  disabled: number;
}

function SummaryPill({
  count,
  label,
  iconName,
  color,
}: {
  count: number;
  label: string;
  iconName: keyof typeof Ionicons.glyphMap;
  color: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: color + "14",
          marginBottom: 6,
        }}
      >
        <Ionicons name={iconName} size={16} color={color} />
      </View>
      <Text
        style={{
          fontSize: 20,
          fontWeight: "bold",
          color: theme.colors.textPrimary,
          fontVariant: ["tabular-nums"],
          letterSpacing: -0.5,
        }}
      >
        {count}
      </Text>
      <Text
        style={{
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.textTertiary,
          marginTop: 2,
          letterSpacing: 0.2,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
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
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 12,
        borderRadius: 18,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      >
        <SummaryPill
          count={counts.operational}
          label="Operational"
          iconName="checkmark-circle"
          color={theme.colors.oncallActive}
        />
        <View
          style={{
            width: 1,
            marginVertical: 10,
            backgroundColor: theme.colors.borderSubtle,
          }}
        />
        <SummaryPill
          count={counts.inoperational}
          label="Inoperational"
          iconName="close-circle"
          color={theme.colors.severityCritical}
        />
        <View
          style={{
            width: 1,
            marginVertical: 10,
            backgroundColor: theme.colors.borderSubtle,
          }}
        />
        <SummaryPill
          count={counts.disabled}
          label="Disabled"
          iconName="pause-circle"
          color={theme.colors.textTertiary}
        />
      </View>
    </View>
  );
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
        paddingBottom: 8,
        paddingTop: 4,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <Ionicons
        name={isActive ? "alert-circle" : "checkmark-circle"}
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

export default function MonitorsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const navigation: NavProp = useNavigation<NavProp>();

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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
    let disabledCount: number = 0;
    let inoperationalCount: number = 0;

    for (const wrapped of allMonitors) {
      const statusName: string =
        wrapped.item.currentMonitorStatus?.name?.toLowerCase() ?? "";
      const isDisabled: boolean = wrapped.item.disableActiveMonitoring === true;

      if (isDisabled) {
        disabledCount++;
        issues.push(wrapped);
      } else if (
        statusName === "offline" ||
        statusName === "degraded" ||
        statusName === "down"
      ) {
        inoperationalCount++;
        issues.push(wrapped);
      } else {
        operational.push(wrapped);
      }
    }

    const sections: MonitorSection[] = [];
    if (issues.length > 0) {
      sections.push({
        title: "Issues",
        isActive: true,
        data: issues.slice(0, visibleCount),
      });
    }
    if (operational.length > 0) {
      sections.push({
        title: "Operational",
        isActive: false,
        data: operational.slice(0, visibleCount),
      });
    }

    return {
      monitorSections: sections,
      counts: {
        total: allMonitors.length,
        operational: operational.length,
        inoperational: inoperationalCount,
        disabled: disabledCount,
      },
    };
  }, [allMonitors, visibleCount]);

  const totalCount: number = allMonitors.length;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    setVisibleCount(PAGE_SIZE);
    await refetch();
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

  if (isLoading && allMonitors.length === 0) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          <View style={{ padding: 16 }}>
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
        <ScrollView contentInsetAdjustmentBehavior="automatic">
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
        keyExtractor={(wrapped: ProjectMonitorItem) => {
          return `${wrapped.projectId}-${wrapped.item._id}`;
        }}
        contentContainerStyle={
          monitorSections.length === 0 ? { flex: 1 } : { padding: 16 }
        }
        ListHeaderComponent={
          totalCount > 0 ? <MonitorSummary counts={counts} /> : null
        }
        renderSectionHeader={(params: {
          section: DefaultSectionT & MonitorSection;
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
          ProjectMonitorItem,
          DefaultSectionT & MonitorSection
        >) => {
          const isOperational: boolean = !section.isActive;
          return (
            <MonitorCard
              monitor={wrapped.item}
              projectName={wrapped.projectName}
              muted={isOperational}
              onPress={() => {
                return handlePress(wrapped);
              }}
            />
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title="No monitors"
            subtitle="Monitors from your projects will appear here."
            icon="monitors"
          />
        }
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={onRefresh} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}
