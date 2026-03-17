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
    error,
    refetch,
  } = useAllProjectMonitors();
  const { lightImpact } = useHaptics();

  const monitorSections: MonitorSection[] = useMemo(() => {
    const issues: ProjectMonitorItem[] = [];
    const operational: ProjectMonitorItem[] = [];
    for (const wrapped of allMonitors) {
      const statusName: string =
        wrapped.item.currentMonitorStatus?.name?.toLowerCase() ?? "";
      const isDisabled: boolean =
        wrapped.item.disableActiveMonitoring === true;
      if (
        isDisabled ||
        statusName === "offline" ||
        statusName === "degraded" ||
        statusName === "down"
      ) {
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
    return sections;
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
    const errorMessage: string = error?.message ?? "Unknown error";
    const errorDetails: string =
      (error as unknown as Record<string, unknown>)?.response
        ? JSON.stringify(
            (
              (error as unknown as Record<string, unknown>)
                .response as Record<string, unknown>
            ).data,
          )
        : "";
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          <EmptyState
            title="Something went wrong"
            subtitle={`${errorMessage}${errorDetails ? `\n\n${errorDetails}` : ""}`}
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
