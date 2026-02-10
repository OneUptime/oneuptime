import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useProject } from "../hooks/useProject";
import {
  useAlertDetail,
  useAlertStates,
  useAlertStateTimeline,
} from "../hooks/useAlertDetail";
import { changeAlertState } from "../api/alerts";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import type { AlertsStackParamList } from "../navigation/types";
import { useQueryClient } from "@tanstack/react-query";

type Props = NativeStackScreenProps<AlertsStackParamList, "AlertDetail">;

export default function AlertDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { alertId } = route.params;
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId = selectedProject?._id ?? "";
  const queryClient = useQueryClient();

  const {
    data: alert,
    isLoading,
    refetch: refetchAlert,
  } = useAlertDetail(projectId, alertId);
  const { data: states } = useAlertStates(projectId);
  const {
    data: timeline,
    refetch: refetchTimeline,
  } = useAlertStateTimeline(projectId, alertId);

  const [changingState, setChangingState] = useState(false);

  const onRefresh = useCallback(async () => {
    await Promise.all([refetchAlert(), refetchTimeline()]);
  }, [refetchAlert, refetchTimeline]);

  const handleStateChange = useCallback(
    async (stateId: string, stateName: string) => {
      setChangingState(true);
      try {
        await changeAlertState(projectId, alertId, stateId);
        await Promise.all([refetchAlert(), refetchTimeline()]);
        await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      } catch {
        Alert.alert("Error", `Failed to change state to ${stateName}.`);
      } finally {
        setChangingState(false);
      }
    },
    [projectId, alertId, refetchAlert, refetchTimeline, queryClient],
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
      </View>
    );
  }

  if (!alert) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      >
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textSecondary },
          ]}
        >
          Alert not found.
        </Text>
      </View>
    );
  }

  const stateColor = alert.currentAlertState?.color
    ? rgbToHex(alert.currentAlertState.color)
    : theme.colors.textTertiary;

  const severityColor = alert.alertSeverity?.color
    ? rgbToHex(alert.alertSeverity.color)
    : theme.colors.textTertiary;

  const acknowledgeState = states?.find((s) => s.isAcknowledgedState);
  const resolveState = states?.find((s) => s.isResolvedState);

  const currentStateName =
    alert.currentAlertState?.name?.toLowerCase() ?? "";
  const isResolved = currentStateName.includes("resolve");
  const isAcknowledged = currentStateName.includes("acknowledge");

  return (
    <ScrollView
      style={[{ backgroundColor: theme.colors.backgroundPrimary }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <Text style={[styles.number, { color: theme.colors.textTertiary }]}>
        {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
      </Text>

      <Text
        style={[
          theme.typography.titleLarge,
          { color: theme.colors.textPrimary, marginTop: 4 },
        ]}
      >
        {alert.title}
      </Text>

      {/* Badges */}
      <View style={styles.badgeRow}>
        {alert.currentAlertState ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: stateColor }]} />
            <Text style={[styles.badgeText, { color: theme.colors.textPrimary }]}>
              {alert.currentAlertState.name}
            </Text>
          </View>
        ) : null}

        {alert.alertSeverity ? (
          <View
            style={[styles.badge, { backgroundColor: severityColor + "26" }]}
          >
            <Text style={[styles.badgeText, { color: severityColor }]}>
              {alert.alertSeverity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Description */}
      {alert.description ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: theme.colors.textSecondary },
            ]}
          >
            Description
          </Text>
          <Text
            style={[
              theme.typography.bodyMedium,
              { color: theme.colors.textPrimary },
            ]}
          >
            {alert.description}
          </Text>
        </View>
      ) : null}

      {/* Details */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Details
        </Text>

        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
        >
          <View style={styles.detailRow}>
            <Text
              style={[styles.detailLabel, { color: theme.colors.textTertiary }]}
            >
              Created
            </Text>
            <Text
              style={[styles.detailValue, { color: theme.colors.textPrimary }]}
            >
              {formatDateTime(alert.createdAt)}
            </Text>
          </View>

          {alert.monitor ? (
            <View style={styles.detailRow}>
              <Text
                style={[styles.detailLabel, { color: theme.colors.textTertiary }]}
              >
                Monitor
              </Text>
              <Text
                style={[styles.detailValue, { color: theme.colors.textPrimary }]}
              >
                {alert.monitor.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* State Change Actions */}
      {!isResolved ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: theme.colors.textSecondary },
            ]}
          >
            Actions
          </Text>
          <View style={styles.actionRow}>
            {!isAcknowledged && !isResolved && acknowledgeState ? (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  { backgroundColor: theme.colors.stateAcknowledged },
                ]}
                onPress={() =>
                  handleStateChange(
                    acknowledgeState._id,
                    acknowledgeState.name,
                  )
                }
                disabled={changingState}
              >
                {changingState ? (
                  <ActivityIndicator size="small" color={theme.colors.textInverse} />
                ) : (
                  <Text
                    style={[
                      styles.actionButtonText,
                      { color: theme.colors.textInverse },
                    ]}
                  >
                    Acknowledge
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}

            {resolveState ? (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  { backgroundColor: theme.colors.stateResolved },
                ]}
                onPress={() =>
                  handleStateChange(resolveState._id, resolveState.name)
                }
                disabled={changingState}
              >
                {changingState ? (
                  <ActivityIndicator size="small" color={theme.colors.textInverse} />
                ) : (
                  <Text
                    style={[
                      styles.actionButtonText,
                      { color: theme.colors.textInverse },
                    ]}
                  >
                    Resolve
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* State Timeline */}
      {timeline && timeline.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: theme.colors.textSecondary },
            ]}
          >
            State Timeline
          </Text>
          {timeline.map((entry) => {
            const entryColor = entry.alertState?.color
              ? rgbToHex(entry.alertState.color)
              : theme.colors.textTertiary;
            return (
              <View
                key={entry._id}
                style={[
                  styles.timelineEntry,
                  {
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderColor: theme.colors.borderSubtle,
                  },
                ]}
              >
                <View
                  style={[styles.timelineDot, { backgroundColor: entryColor }]}
                />
                <View style={styles.timelineInfo}>
                  <Text
                    style={[
                      theme.typography.bodyMedium,
                      { color: theme.colors.textPrimary, fontWeight: "600" },
                    ]}
                  >
                    {entry.alertState?.name ?? "Unknown"}
                  </Text>
                  <Text
                    style={[
                      theme.typography.bodySmall,
                      { color: theme.colors.textTertiary },
                    ]}
                  >
                    {formatDateTime(entry.createdAt)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  number: {
    fontSize: 14,
    fontWeight: "600",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  detailCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  detailRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 14,
    width: 90,
  },
  detailValue: {
    fontSize: 14,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  timelineEntry: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  timelineInfo: {
    flex: 1,
  },
});
