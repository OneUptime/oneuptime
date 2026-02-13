import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import type { AlertsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import type { AlertState, NoteItem } from "../api/types";
import AddNoteModal from "../components/AddNoteModal";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<AlertsStackParamList, "AlertDetail">;

function SectionHeader({
  title,
  iconName,
}: {
  title: string;
  iconName: keyof typeof Ionicons.glyphMap;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View className="flex-row items-center mb-3">
      <Ionicons
        name={iconName}
        size={15}
        color={theme.colors.textSecondary}
        style={{ marginRight: 6 }}
      />
      <Text className="text-[13px] font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </Text>
    </View>
  );
}

export default function AlertDetailScreen({ route }: Props): React.JSX.Element {
  const { alertId, projectId } = route.params;
  const { theme } = useTheme();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: alert,
    isLoading,
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
      <View className="flex-1 bg-bg-primary">
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  if (!alert) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <Text className="text-body-md text-text-secondary">
          Alert not found.
        </Text>
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

  return (
    <ScrollView
      className="bg-bg-primary"
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      {/* Header with gradient background */}
      <View
        className="rounded-2xl p-5 mb-5"
        style={{
          backgroundColor: theme.colors.surfaceGlow,
        }}
      >
        <View
          className="self-start px-3 py-1.5 rounded-full mb-3"
          style={{ backgroundColor: stateColor + "1A" }}
        >
          <Text
            className="text-[13px] font-bold"
            style={{ color: stateColor }}
          >
            {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
          </Text>
        </View>

        <Text
          className="text-title-lg text-text-primary"
          style={{ letterSpacing: -0.5 }}
        >
          {alert.title}
        </Text>

        {/* Badges */}
        <View className="flex-row flex-wrap gap-2 mt-3">
          {alert.currentAlertState ? (
            <View
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: theme.colors.backgroundElevated,
                borderWidth: 1,
                borderColor: theme.colors.borderSubtle,
              }}
            >
              <View
                className="w-2.5 h-2.5 rounded-full mr-2"
                style={{ backgroundColor: stateColor }}
              />
              <Text className="text-[13px] font-semibold text-text-primary">
                {alert.currentAlertState.name}
              </Text>
            </View>
          ) : null}

          {alert.alertSeverity ? (
            <View
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{ backgroundColor: severityColor + "1A" }}
            >
              <Text
                className="text-[13px] font-semibold"
                style={{ color: severityColor }}
              >
                {alert.alertSeverity.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Description */}
      {alert.description ? (
        <View className="mb-6">
          <SectionHeader title="Description" iconName="document-text-outline" />
          <Text className="text-body-md text-text-primary leading-6">
            {alert.description}
          </Text>
        </View>
      ) : null}

      {/* Details */}
      <View className="mb-6">
        <SectionHeader title="Details" iconName="information-circle-outline" />

        <View
          className="rounded-2xl p-4 overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderSubtle,
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.actionPrimary,
            shadowColor: "#000",
            shadowOpacity: theme.isDark ? 0.15 : 0.04,
            shadowOffset: { width: 0, height: 2 },
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          <View className="flex-row mb-3">
            <Text className="text-sm w-[90px] text-text-tertiary">Created</Text>
            <Text className="text-sm text-text-primary">
              {formatDateTime(alert.createdAt)}
            </Text>
          </View>

          {alert.monitor ? (
            <View className="flex-row">
              <Text className="text-sm w-[90px] text-text-tertiary">
                Monitor
              </Text>
              <Text className="text-sm text-text-primary">
                {alert.monitor.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* State Change Actions */}
      {!isResolved ? (
        <View className="mb-6">
          <SectionHeader title="Actions" iconName="flash-outline" />
          <View className="flex-row gap-3">
            {!isAcknowledged && !isResolved && acknowledgeState ? (
              <TouchableOpacity
                className="flex-1 flex-row py-3.5 rounded-xl items-center justify-center min-h-[50px]"
                style={{
                  backgroundColor: theme.colors.stateAcknowledged,
                  shadowColor: theme.colors.stateAcknowledged,
                  shadowOpacity: 0.3,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 12,
                  elevation: 4,
                }}
                onPress={() => {
                  return handleStateChange(
                    acknowledgeState._id,
                    acknowledgeState.name,
                  );
                }}
                disabled={changingState}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Acknowledge alert"
              >
                {changingState ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.textInverse}
                  />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color={theme.colors.textInverse}
                      style={{ marginRight: 6 }}
                    />
                    <Text className="text-[15px] font-bold text-text-inverse">
                      Acknowledge
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            {resolveState ? (
              <TouchableOpacity
                className="flex-1 flex-row py-3.5 rounded-xl items-center justify-center min-h-[50px]"
                style={{
                  backgroundColor: theme.colors.stateResolved,
                  shadowColor: theme.colors.stateResolved,
                  shadowOpacity: 0.3,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 12,
                  elevation: 4,
                }}
                onPress={() => {
                  return handleStateChange(resolveState._id, resolveState.name);
                }}
                disabled={changingState}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Resolve alert"
              >
                {changingState ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.textInverse}
                  />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-done-outline"
                      size={18}
                      color={theme.colors.textInverse}
                      style={{ marginRight: 6 }}
                    />
                    <Text className="text-[15px] font-bold text-text-inverse">
                      Resolve
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Activity Feed */}
      {feed && feed.length > 0 ? (
        <View className="mb-6">
          <SectionHeader title="Activity Feed" iconName="list-outline" />
          <FeedTimeline feed={feed} />
        </View>
      ) : null}

      {/* Internal Notes */}
      <View className="mb-2">
        <View className="flex-row justify-between items-center mb-3">
          <View className="flex-row items-center">
            <Ionicons
              name="chatbubble-outline"
              size={15}
              color={theme.colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text className="text-[13px] font-semibold uppercase tracking-wide text-text-secondary">
              Internal Notes
            </Text>
          </View>
          <TouchableOpacity
            className="flex-row items-center px-3.5 py-2 rounded-lg"
            style={{
              backgroundColor: theme.colors.actionPrimary,
              shadowColor: theme.colors.actionPrimary,
              shadowOpacity: 0.25,
              shadowOffset: { width: 0, height: 2 },
              shadowRadius: 8,
              elevation: 3,
            }}
            onPress={() => {
              return setNoteModalVisible(true);
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="add"
              size={16}
              color={theme.colors.textInverse}
              style={{ marginRight: 4 }}
            />
            <Text className="text-[13px] font-semibold text-text-inverse">
              Add Note
            </Text>
          </TouchableOpacity>
        </View>

        {notes && notes.length > 0
          ? notes.map((note: NoteItem) => {
              return (
                <View
                  key={note._id}
                  className="rounded-xl p-4 mb-2.5"
                  style={{
                    backgroundColor: theme.colors.backgroundElevated,
                    borderWidth: 1,
                    borderColor: theme.colors.borderSubtle,
                    borderTopWidth: 2,
                    borderTopColor: theme.colors.actionPrimary + "30",
                    shadowColor: "#000",
                    shadowOpacity: theme.isDark ? 0.1 : 0.03,
                    shadowOffset: { width: 0, height: 1 },
                    shadowRadius: 4,
                    elevation: 1,
                  }}
                >
                  <Text className="text-body-md text-text-primary leading-6">
                    {note.note}
                  </Text>
                  <View className="flex-row justify-between mt-2.5">
                    {note.createdByUser ? (
                      <Text className="text-body-sm text-text-tertiary">
                        {note.createdByUser.name}
                      </Text>
                    ) : null}
                    <Text className="text-body-sm text-text-tertiary">
                      {formatDateTime(note.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            })
          : null}

        {notes && notes.length === 0 ? (
          <View
            className="rounded-xl p-4 items-center"
            style={{
              backgroundColor: theme.colors.backgroundSecondary,
              borderWidth: 1,
              borderColor: theme.colors.borderSubtle,
            }}
          >
            <Text className="text-body-sm text-text-tertiary">
              No notes yet.
            </Text>
          </View>
        ) : null}
      </View>

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
