import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import {
  useAlertDetail,
  useAlertStates,
  useAlertStateTimeline,
  useAlertFeed,
} from "../hooks/useAlertDetail";
import { useAlertNotes } from "../hooks/useAlertNotes";
import { changeAlertState } from "../api/alerts";
import { createAlertNote } from "../api/alertNotes";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import { toPlainText } from "../utils/text";
import type { AlertsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import type { AlertState } from "../api/types";
import AddNoteModal from "../components/AddNoteModal";
import EmptyState from "../components/EmptyState";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import NotesSection from "../components/NotesSection";
import RootCauseCard from "../components/RootCauseCard";
import MarkdownContent from "../components/MarkdownContent";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<AlertsStackParamList, "AlertDetail">;

export default function AlertDetailScreen({ route }: Props): React.JSX.Element {
  const { alertId, projectId } = route.params;
  const { theme } = useTheme();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: alert,
    isLoading,
    isError,
    refetch: refetchAlert,
  } = useAlertDetail(projectId, alertId);
  const { data: states } = useAlertStates(projectId);
  const { refetch: refetchTimeline } = useAlertStateTimeline(
    projectId,
    alertId,
  );
  const { data: feed, refetch: refetchFeed } = useAlertFeed(projectId, alertId);
  const { data: notes, refetch: refetchNotes } = useAlertNotes(
    projectId,
    alertId,
  );

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const onRefresh: () => Promise<void> = useCallback(async () => {
    await Promise.all([
      refetchAlert(),
      refetchTimeline(),
      refetchFeed(),
      refetchNotes(),
    ]);
  }, [refetchAlert, refetchTimeline, refetchFeed, refetchNotes]);

  const handleStateChange: (
    stateId: string,
    stateName: string,
  ) => Promise<void> = useCallback(
    async (stateId: string, stateName: string) => {
      if (!alert) {
        return;
      }
      const queryKey: string[] = ["alert", projectId, alertId];
      const previousData: unknown = queryClient.getQueryData(queryKey);
      const newState: AlertState | undefined = states?.find((s: AlertState) => {
        return s._id === stateId;
      });
      if (newState) {
        queryClient.setQueryData(queryKey, {
          ...alert,
          currentAlertState: {
            _id: newState._id,
            name: newState.name,
            color: newState.color,
          },
        });
      }
      setChangingState(true);
      try {
        await changeAlertState(projectId, alertId, stateId);
        await successFeedback();
        await Promise.all([refetchAlert(), refetchTimeline(), refetchFeed()]);
        await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      } catch {
        queryClient.setQueryData(queryKey, previousData);
        await errorFeedback();
        Alert.alert("Error", `Failed to change state to ${stateName}.`);
      } finally {
        setChangingState(false);
      }
    },
    [
      projectId,
      alertId,
      alert,
      states,
      refetchAlert,
      refetchTimeline,
      refetchFeed,
      queryClient,
    ],
  );

  const handleAddNote: (noteText: string) => Promise<void> = useCallback(
    async (noteText: string) => {
      setSubmittingNote(true);
      try {
        await createAlertNote(projectId, alertId, noteText);
        await refetchNotes();
        setNoteModalVisible(false);
      } catch {
        Alert.alert("Error", "Failed to add note.");
      } finally {
        setSubmittingNote(false);
      }
    },
    [projectId, alertId, refetchNotes],
  );

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  /*
   * Nothing to show, and the two reasons for that are not the same reason.
   *
   * This screen is where a page lands: the responder tapped a push
   * notification about an alert that is on fire somewhere. "Alert not found."
   * was every one of those endings - the token expired, the gateway was down,
   * the train went into a tunnel - and it told the responder the page they
   * were woken for does not exist, with nothing to press. The alert was still
   * on fire.
   *
   * So a failure that might clear says so and offers another go, and only a
   * request that succeeded and found nothing is allowed to say the alert is
   * gone. Telling them apart takes no cleverness now: `fetchAlertById` resolves
   * `null` for an alert that is not there, so a deleted alert reaches us as
   * settled data and `isError` means only that the request failed.
   *
   * Note the guard is inside `!alert`: a refresh that fails while the alert is
   * already on screen must not replace it with an error page, because a stale
   * alert is worth vastly more here than an apology.
   */
  if (!alert) {
    if (isError) {
      return (
        <View
          style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        >
          <EmptyState
            title="Something went wrong"
            subtitle="This alert could not be loaded, which is not the same as it no longer existing. Try again."
            icon="alerts"
            actionLabel="Retry"
            onAction={() => {
              return refetchAlert();
            }}
          />
        </View>
      );
    }

    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="Alert not found"
          subtitle="This alert no longer exists, or it is not part of this project."
          icon="alerts"
        />
      </View>
    );
  }

  const stateColor: string = alert.currentAlertState?.color
    ? rgbToHex(alert.currentAlertState.color)
    : theme.colors.textTertiary;

  const severityColor: string = alert.alertSeverity?.color
    ? rgbToHex(alert.alertSeverity.color)
    : theme.colors.textTertiary;

  const acknowledgeState: AlertState | undefined = states?.find(
    (s: AlertState) => {
      return s.isAcknowledgedState;
    },
  );
  const resolveState: AlertState | undefined = states?.find((s: AlertState) => {
    return s.isResolvedState;
  });

  const currentStateId: string | undefined = alert.currentAlertState?._id;
  const isResolved: boolean = resolveState?._id === currentStateId;
  const isAcknowledged: boolean = acknowledgeState?._id === currentStateId;
  const rootCauseTextRaw: string = toPlainText(alert.rootCause);
  const rootCauseText: string | undefined =
    rootCauseTextRaw.trim() || undefined;
  const descriptionText: string = toPlainText(alert.description);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
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
          borderRadius: 24,
          overflow: "hidden",
          marginBottom: 20,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: "#000",
          shadowOpacity: 0.28,
          shadowOffset: { width: 0, height: 10 },
          shadowRadius: 18,
          elevation: 7,
        }}
      >
        <LinearGradient
          colors={[stateColor + "26", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: -50,
            left: -10,
            right: -10,
            height: 190,
          }}
        />
        <View
          style={{
            height: 3,
            backgroundColor: stateColor,
          }}
        />
        <View style={{ padding: 20 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              marginBottom: 8,
              color: stateColor,
            }}
          >
            {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
          </Text>

          <Text
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: theme.colors.textPrimary,
              letterSpacing: -0.6,
            }}
          >
            {alert.title}
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
            }}
          >
            {alert.currentAlertState ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: stateColor + "14",
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    marginRight: 6,
                    backgroundColor: stateColor,
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: stateColor,
                  }}
                >
                  {alert.currentAlertState.name}
                </Text>
              </View>
            ) : null}

            {alert.alertSeverity ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: severityColor + "14",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: severityColor,
                  }}
                >
                  {alert.alertSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Description */}
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

      <View style={{ marginBottom: 24 }}>
        <SectionHeader title="Root Cause" iconName="bulb-outline" />
        <RootCauseCard rootCauseText={rootCauseText} />
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
                  fontSize: 13,
                  width: 90,
                  color: theme.colors.textTertiary,
                }}
              >
                Created
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textPrimary,
                }}
              >
                {formatDateTime(alert.createdAt)}
              </Text>
            </View>

            {alert.monitor ? (
              <View style={{ flexDirection: "row" }}>
                <Text
                  style={{
                    fontSize: 13,
                    width: 90,
                    color: theme.colors.textTertiary,
                  }}
                >
                  Monitor
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.textPrimary,
                  }}
                >
                  {alert.monitor.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* State Change Actions */}
      {!isResolved ? (
        <View style={{ marginBottom: 24 }}>
          <SectionHeader title="Actions" iconName="flash-outline" />
          <View
            style={{
              borderRadius: 16,
              padding: 12,
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <View style={{ flexDirection: "row" }}>
              {!isAcknowledged && !isResolved && acknowledgeState ? (
                <View style={{ flex: 1 }}>
                  <Pressable
                    style={{
                      flexDirection: "row",
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 48,
                      backgroundColor: theme.colors.stateAcknowledged,
                    }}
                    onPress={() => {
                      return handleStateChange(
                        acknowledgeState._id,
                        acknowledgeState.name,
                      );
                    }}
                    disabled={changingState}
                    accessibilityRole="button"
                    accessibilityLabel="Acknowledge alert"
                  >
                    {changingState ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={17}
                          color="#FFFFFF"
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "bold",
                            color: "#FFFFFF",
                          }}
                        >
                          Acknowledge
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {resolveState ? (
                <View
                  style={{
                    flex: 1,
                    marginLeft:
                      !isAcknowledged && !isResolved && acknowledgeState
                        ? 12
                        : 0,
                  }}
                >
                  <Pressable
                    style={{
                      flexDirection: "row",
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 48,
                      backgroundColor: theme.colors.stateResolved,
                    }}
                    onPress={() => {
                      return handleStateChange(
                        resolveState._id,
                        resolveState.name,
                      );
                    }}
                    disabled={changingState}
                    accessibilityRole="button"
                    accessibilityLabel="Resolve alert"
                  >
                    {changingState ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons
                          name="checkmark-done-outline"
                          size={17}
                          color="#FFFFFF"
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "bold",
                            color: "#FFFFFF",
                          }}
                        >
                          Resolve
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}
            </View>
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

      {/* Internal Notes */}
      <NotesSection notes={notes} setNoteModalVisible={setNoteModalVisible} />

      <AddNoteModal
        visible={noteModalVisible}
        onClose={() => {
          return setNoteModalVisible(false);
        }}
        onSubmit={handleAddNote}
        isSubmitting={submittingNote}
      />
    </ScrollView>
  );
}
