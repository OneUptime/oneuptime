import React from "react";
import {
  ActivityIndicator,
  View,
  ScrollView,
  RefreshControl,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import QueryErrorNotice from "../components/QueryErrorNotice";
import {
  useMonitorDetail,
  useMonitorStatusTimeline,
  useMonitorFeed,
  useMonitorProbes,
} from "../hooks/useMonitorDetail";
import { rgbToHex, withAlpha } from "../utils/color";
import { formatDateTime, formatRelativeTime } from "../utils/date";
import { toPlainText } from "../utils/text";
import type { MonitorsStackParamList } from "../navigation/types";
import type { MonitorStatusTimelineItem } from "../api/monitors";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import FeedTimeline from "../components/FeedTimeline";
import SectionHeader from "../components/SectionHeader";
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

/*
 * Status changes as a vertical timeline on one card: a dot in the status
 * colour, a rail joining it to the next change, then the status, when it
 * began and why. The rail is drawn inside each row, so there are no hairline
 * separators for it to cross.
 */
function StatusHistory({
  entries,
}: {
  entries: MonitorStatusTimelineItem[];
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card testID="monitor-status-history">
      {entries.map((entry: MonitorStatusTimelineItem, index: number) => {
        const entryColor: string = entry.monitorStatus?.color
          ? rgbToHex(entry.monitorStatus.color)
          : theme.colors.textTertiary;
        const isLast: boolean = index === entries.length - 1;
        return (
          <View
            key={entry._id}
            testID="monitor-status-history-entry"
            style={{ flexDirection: "row", gap: spacing.md }}
          >
            <View style={{ alignItems: "center", width: 16 }}>
              <View
                testID="monitor-status-history-halo"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  marginTop: 3,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: withAlpha(
                    entryColor,
                    theme.dark ? 0.3 : 0.2,
                  ),
                }}
              >
                <View
                  testID="monitor-status-history-dot"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: entryColor,
                  }}
                />
              </View>
              {!isLast ? (
                <View
                  testID="monitor-status-history-rail"
                  style={{
                    width: 2,
                    flex: 1,
                    marginTop: spacing.xs,
                    borderRadius: 1,
                    backgroundColor: theme.colors.borderSubtle,
                  }}
                />
              ) : null}
            </View>
            <View
              style={{
                flex: 1,
                gap: spacing.xxs,
                paddingBottom: isLast ? 0 : spacing.lg,
              }}
            >
              <AppText variant="headline">
                {entry.monitorStatus?.name ?? "Unknown"}
              </AppText>
              <AppText variant="footnote" tone="secondary">
                {formatRelativeTime(entry.startsAt ?? entry.createdAt)}
              </AppText>
              {entry.rootCause ? (
                <View style={{ marginTop: spacing.xs }}>
                  <MarkdownContent
                    content={entry.rootCause}
                    variant="secondary"
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
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
          // The detail skeleton carries the screen gutter itself.
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
          padding: spacing.xl,
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
          icon={isError ? "error" : "monitors"}
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
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
          colors={[theme.colors.actionPrimary]}
          progressBackgroundColor={theme.colors.backgroundElevated}
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
        <Banner
          testID="monitor-paused-banner"
          tone="warning"
          icon="pause-circle"
          title="Monitoring is paused"
          message="Active checks are disabled. The last recorded status may not reflect this service's current health."
          style={{ marginBottom: spacing.xxl }}
        />
      ) : null}
      {/*
       * The summary is its own card, so it sits under a plain header rather
       * than inside a ResponseSection card - a card within a card.
       */}
      <View
        testID="monitor-summary-section"
        style={{ marginBottom: spacing.xxl }}
      >
        <SectionHeader title="Monitor Summary" />
        {probesError ? (
          <QueryErrorNotice
            message="Unable to load the latest monitor measurements."
            retryLabel="Retry monitor summary"
            onRetry={refetchProbes}
          />
        ) : null}
        {probesLoading ? (
          <Card
            testID="monitor-summary-loading"
            style={probeItems ? { marginBottom: spacing.md } : undefined}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
              }}
            >
              <ActivityIndicator
                size="small"
                color={theme.colors.actionPrimary}
              />
              <AppText
                variant="subhead"
                tone="secondary"
                accessibilityLiveRegion="polite"
                style={{ flex: 1 }}
              >
                Loading monitor measurements…
              </AppText>
            </View>
          </Card>
        ) : null}
        {probeItems || (!probesError && !probesLoading) ? (
          <MonitorSummaryView
            monitorType={monitor.monitorType}
            probeItems={probeItems ?? []}
          />
        ) : null}
      </View>
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
        <View style={{ marginBottom: spacing.xxl }}>
          <SectionHeader title="Status History" />
          <StatusHistory entries={statusTimeline} />
        </View>
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
