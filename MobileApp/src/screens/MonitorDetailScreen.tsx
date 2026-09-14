import React from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import QueryErrorNotice from "../components/QueryErrorNotice";
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
import {
  ResponseDetailHeader,
  ResponseInfoRow,
  ResponseSection,
} from "../components/ResponseDetailLayout";
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
  const {
    data: statusTimeline,
    isError: timelineError,
    refetch: refetchTimeline,
  } = useMonitorStatusTimeline(projectId, monitorId);
  const {
    data: probeItems,
    isLoading: probesLoading,
    isError: probesError,
    refetch: refetchProbes,
  } = useMonitorProbes(projectId, monitorId);
  const {
    data: feed,
    isError: feedError,
    refetch: refetchFeed,
  } = useMonitorFeed(projectId, monitorId);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.allSettled([
      refetchMonitor(),
      refetchTimeline(),
      refetchProbes(),
      refetchFeed(),
    ]);
  });

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
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ResponseDetailHeader
        title={monitor.name}
        kind={getMonitorTypeLabel(monitor.monitorType)}
        state={isDisabled ? "Disabled" : monitor.currentMonitorStatus?.name}
        stateColor={isDisabled ? theme.colors.textTertiary : statusColor}
      />
      {isDisabled ? (
        <View
          style={{
            padding: 18,
            marginBottom: 26,
            borderRadius: 16,
            backgroundColor: theme.colors.backgroundTertiary,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: theme.colors.textPrimary,
              marginBottom: 6,
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
      <ResponseSection title="Monitor Summary">
        {probesError ? (
          <QueryErrorNotice
            message="Unable to load the latest monitor measurements."
            retryLabel="Retry monitor summary"
            onRetry={refetchProbes}
          />
        ) : null}
        {probesLoading ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: theme.colors.textSecondary }}
          >
            Loading monitor measurements…
          </Text>
        ) : null}
        {probeItems || (!probesError && !probesLoading) ? (
          <MonitorSummaryView
            monitorType={monitor.monitorType}
            probeItems={probeItems ?? []}
          />
        ) : null}
      </ResponseSection>
      {descriptionText ? (
        <ResponseSection title="Description">
          <MarkdownContent content={descriptionText} />
        </ResponseSection>
      ) : null}
      <ResponseSection title="Details">
        <ResponseInfoRow
          label="Type"
          value={getMonitorTypeLabel(monitor.monitorType)}
        />
        <ResponseInfoRow
          label="Status"
          value={
            isDisabled
              ? "Disabled"
              : monitor.currentMonitorStatus?.name ?? "Unknown"
          }
        />
        <ResponseInfoRow
          label="Created"
          value={formatDateTime(monitor.createdAt)}
        />
      </ResponseSection>
      {timelineError ? (
        <QueryErrorNotice
          message="Unable to load the latest status history."
          retryLabel="Retry status history"
          onRetry={refetchTimeline}
        />
      ) : null}
      {statusTimeline && statusTimeline.length > 0 ? (
        <ResponseSection title="Status History">
          {statusTimeline.map(
            (entry: MonitorStatusTimelineItem, index: number) => {
              const entryColor: string = entry.monitorStatus?.color
                ? rgbToHex(entry.monitorStatus.color)
                : theme.colors.textTertiary;
              return (
                <View
                  key={entry._id}
                  style={{ flexDirection: "row", gap: 12, paddingVertical: 15 }}
                >
                  <View style={{ alignItems: "center", width: 10 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginTop: 7,
                        backgroundColor: entryColor,
                      }}
                    />
                    {index < statusTimeline.length - 1 ? (
                      <View
                        style={{
                          width: 1,
                          flex: 1,
                          backgroundColor: theme.colors.borderDefault,
                          marginTop: 7,
                          marginBottom: -21,
                        }}
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        lineHeight: 22,
                        fontWeight: "600",
                        color: theme.colors.textPrimary,
                      }}
                    >
                      {entry.monitorStatus?.name ?? "Unknown"}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        lineHeight: 20,
                        color: theme.colors.textSecondary,
                      }}
                    >
                      {formatRelativeTime(entry.startsAt ?? entry.createdAt)}
                    </Text>
                    {entry.rootCause ? (
                      <MarkdownContent
                        content={entry.rootCause}
                        variant="secondary"
                      />
                    ) : null}
                  </View>
                </View>
              );
            },
          )}
        </ResponseSection>
      ) : null}
      {feedError ? (
        <QueryErrorNotice
          message="Unable to load the latest activity."
          retryLabel="Retry activity"
          onRetry={refetchFeed}
        />
      ) : null}
      {feed && feed.length > 0 ? (
        <ResponseSection title="Activity Feed">
          <FeedTimeline feed={feed} />
        </ResponseSection>
      ) : null}
    </ScrollView>
  );
}
