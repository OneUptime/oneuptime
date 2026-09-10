import React, { useCallback } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import {
  useMonitorDetail,
  useMonitorStatusTimeline,
  useMonitorFeed,
  useMonitorProbes,
} from "../hooks/useMonitorDetail";
import { rgbToHex } from "../utils/color";
import { formatDateTime, formatRelativeTime } from "../utils/date";
import { toPlainText } from "../utils/text";
import type { MonitorsStackParamList } from "../navigation/types";
import type { MonitorStatusTimelineItem } from "../api/monitors";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import MarkdownContent from "../components/MarkdownContent";
import MonitorSummaryView from "../components/MonitorSummaryView";
import EmptyState from "../components/EmptyState";

type Props = NativeStackScreenProps<MonitorsStackParamList, "MonitorDetail">;

function getMonitorTypeLabel(monitorType?: string): string {
  if (!monitorType) {
    return "Monitor";
  }
  const labels: Record<string, string> = {
    Website: "Website",
    API: "API",
    Ping: "Ping",
    IP: "IP",
    Port: "Port",
    DNS: "DNS",
    SSLCertificate: "SSL Certificate",
    Domain: "Domain",
    Server: "Server",
    IncomingRequest: "Incoming Request",
    Database: "Database Health",
    SyntheticMonitor: "Synthetic Monitor",
    CustomJavaScriptCode: "Custom JavaScript",
    Logs: "Logs",
    Metrics: "Metrics",
    Traces: "Traces",
    Manual: "Manual",
  };
  return labels[monitorType] ?? monitorType;
}

export default function MonitorDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { monitorId, projectId } = route.params;
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();

  const {
    data: monitor,
    isLoading,
    isError,
    refetch: refetchMonitor,
  } = useMonitorDetail(projectId, monitorId);
  const { data: statusTimeline, refetch: refetchTimeline } =
    useMonitorStatusTimeline(projectId, monitorId);
  const { data: probeItems, refetch: refetchProbes } = useMonitorProbes(
    projectId,
    monitorId,
  );
  const { data: feed, refetch: refetchFeed } = useMonitorFeed(
    projectId,
    monitorId,
  );

  const onRefresh: () => Promise<void> = useCallback(async () => {
    await Promise.all([
      refetchMonitor(),
      refetchTimeline(),
      refetchProbes(),
      refetchFeed(),
    ]);
  }, [refetchMonitor, refetchTimeline, refetchProbes, refetchFeed]);

  if (isLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
      >
        <SkeletonCard variant="detail" />
      </ScrollView>
    );
  }

  if (!monitor) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
      >
        <EmptyState
          title={isError ? "Something went wrong" : "Monitor not found."}
          subtitle={
            isError
              ? "We could not load this monitor. Check your connection and try again."
              : "This monitor no longer exists, or it is not part of this project."
          }
          icon="monitors"
          actionLabel={isError ? "Retry" : undefined}
          onAction={
            isError
              ? () => {
                  return refetchMonitor();
                }
              : undefined
          }
        />
      </ScrollView>
    );
  }

  const statusColor: string = monitor.currentMonitorStatus?.color
    ? rgbToHex(monitor.currentMonitorStatus.color)
    : theme.colors.textTertiary;

  const isDisabled: boolean = monitor.disableActiveMonitoring === true;
  const descriptionText: string = toPlainText(monitor.description);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      testID="detail-scroll"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {/* Header card */}
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          marginBottom: 20,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 6,
          elevation: 1,
        }}
      >
        <View
          style={{
            height: 3,
            backgroundColor: isDisabled
              ? theme.colors.textTertiary
              : statusColor,
          }}
        />
        <View style={{ padding: 20 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              marginBottom: 8,
              color: theme.colors.textSecondary,
            }}
          >
            {getMonitorTypeLabel(monitor.monitorType)}
          </Text>

          <Text
            style={{
              fontSize: 28,
              lineHeight: 36,
              fontWeight: "bold",
              color: theme.colors.textPrimary,
              letterSpacing: -0.6,
            }}
          >
            {monitor.name}
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
            }}
          >
            {isDisabled ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    marginRight: 6,
                    backgroundColor: theme.colors.textTertiary,
                  }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: theme.colors.textSecondary,
                  }}
                >
                  Disabled
                </Text>
              </View>
            ) : monitor.currentMonitorStatus ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: statusColor + "14",
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    marginRight: 6,
                    backgroundColor: statusColor,
                  }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: statusColor,
                  }}
                >
                  {monitor.currentMonitorStatus.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Description */}
      {isDisabled ? (
        <View
          style={{
            padding: 16,
            marginBottom: 24,
            borderRadius: 16,
            backgroundColor: theme.colors.backgroundTertiary,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: theme.colors.textPrimary,
              marginBottom: 4,
            }}
          >
            Monitoring is paused
          </Text>
          <Text
            style={{
              fontSize: 15,
              lineHeight: 23,
              color: theme.colors.textSecondary,
            }}
          >
            Active checks are disabled. The last recorded status may not reflect
            this service&apos;s current health.
          </Text>
        </View>
      ) : null}
      {descriptionText ? (
        <View style={{ marginBottom: 24 }}>
          <SectionHeader title="Description" iconName="document-text-outline" />
          <View
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <MarkdownContent content={descriptionText} />
          </View>
        </View>
      ) : null}

      {/* Monitor Summary */}
      <View style={{ marginBottom: 24 }}>
        <SectionHeader title="Monitor Summary" iconName="analytics-outline" />
        <MonitorSummaryView
          monitorType={monitor.monitorType}
          probeItems={probeItems ?? []}
        />
      </View>

      {/* Details */}
      <View style={{ marginBottom: 24 }}>
        <SectionHeader title="Details" iconName="information-circle-outline" />
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: "row", marginBottom: 12 }}>
              <Text
                style={{
                  fontSize: 14,
                  width: 90,
                  flexShrink: 0,
                  color: theme.colors.textSecondary,
                }}
              >
                Type
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  flexShrink: 1,
                  color: theme.colors.textPrimary,
                }}
              >
                {getMonitorTypeLabel(monitor.monitorType)}
              </Text>
            </View>

            <View style={{ flexDirection: "row", marginBottom: 12 }}>
              <Text
                style={{
                  fontSize: 14,
                  width: 90,
                  flexShrink: 0,
                  color: theme.colors.textSecondary,
                }}
              >
                Status
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  color: isDisabled ? theme.colors.textTertiary : statusColor,
                }}
              >
                {isDisabled
                  ? "Disabled"
                  : monitor.currentMonitorStatus?.name ?? "Unknown"}
              </Text>
            </View>

            <View style={{ flexDirection: "row" }}>
              <Text
                style={{
                  fontSize: 14,
                  width: 90,
                  flexShrink: 0,
                  color: theme.colors.textSecondary,
                }}
              >
                Created
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  flexShrink: 1,
                  color: theme.colors.textPrimary,
                }}
              >
                {formatDateTime(monitor.createdAt)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Status Timeline */}
      {statusTimeline && statusTimeline.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <SectionHeader title="Status History" iconName="time-outline" />
          <View
            style={{
              borderRadius: 16,
              overflow: "hidden",
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            {statusTimeline.map(
              (entry: MonitorStatusTimelineItem, index: number) => {
                const entryColor: string = entry.monitorStatus?.color
                  ? rgbToHex(entry.monitorStatus.color)
                  : theme.colors.textTertiary;
                return (
                  <View
                    key={entry._id}
                    style={{
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      borderTopWidth: index > 0 ? 1 : 0,
                      borderTopColor: theme.colors.borderSubtle,
                    }}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 9999,
                        marginRight: 12,
                        backgroundColor: entryColor,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "600",
                          color: entryColor,
                        }}
                      >
                        {entry.monitorStatus?.name ?? "Unknown"}
                      </Text>
                      {entry.rootCause ? (
                        <View style={{ marginTop: 2 }}>
                          <MarkdownContent
                            content={entry.rootCause}
                            variant="secondary"
                          />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={{
                        fontSize: 14,
                        color: theme.colors.textSecondary,
                        marginLeft: 8,
                      }}
                    >
                      {formatRelativeTime(entry.startsAt ?? entry.createdAt)}
                    </Text>
                  </View>
                );
              },
            )}
          </View>
        </View>
      ) : null}

      {/* Activity Feed */}
      {feed && feed.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <SectionHeader title="Activity Feed" iconName="list-outline" />
          <FeedTimeline feed={feed} />
        </View>
      ) : null}
    </ScrollView>
  );
}
