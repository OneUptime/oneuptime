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
import { useProject } from "../hooks/useProject";
import {
  useAlertEpisodeDetail,
  useAlertEpisodeStates,
  useAlertEpisodeStateTimeline,
  useAlertEpisodeNotes,
} from "../hooks/useAlertEpisodeDetail";
import {
  changeAlertEpisodeState,
  createAlertEpisodeNote,
} from "../api/alertEpisodes";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import type { AlertsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import type { AlertState, StateTimelineItem, NoteItem } from "../api/types";
import AddNoteModal from "../components/AddNoteModal";
import SkeletonCard from "../components/SkeletonCard";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<
  AlertsStackParamList,
  "AlertEpisodeDetail"
>;

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

export default function AlertEpisodeDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { episodeId } = route.params;
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId: string = selectedProject?._id ?? "";
  const queryClient: QueryClient = useQueryClient();

  const {
    data: episode,
    isLoading,
    refetch: refetchEpisode,
  } = useAlertEpisodeDetail(projectId, episodeId);
  const { data: states } = useAlertEpisodeStates(projectId);
  const { data: timeline, refetch: refetchTimeline } =
    useAlertEpisodeStateTimeline(projectId, episodeId);
  const { data: notes, refetch: refetchNotes } = useAlertEpisodeNotes(
    projectId,
    episodeId,
  );

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const onRefresh: () => Promise<void> = useCallback(async () => {
    await Promise.all([refetchEpisode(), refetchTimeline(), refetchNotes()]);
  }, [refetchEpisode, refetchTimeline, refetchNotes]);

  const handleStateChange: (
    stateId: string,
    stateName: string,
  ) => Promise<void> = useCallback(
    async (stateId: string, stateName: string) => {
      if (!episode) {
        return;
      }
      const queryKey: string[] = ["alert-episode", projectId, episodeId];
      const previousData: unknown = queryClient.getQueryData(queryKey);
      const newState: AlertState | undefined = states?.find((s: AlertState) => {
        return s._id === stateId;
      });
      if (newState) {
        queryClient.setQueryData(queryKey, {
          ...episode,
          currentAlertState: {
            _id: newState._id,
            name: newState.name,
            color: newState.color,
          },
        });
      }
      setChangingState(true);
      try {
        await changeAlertEpisodeState(projectId, episodeId, stateId);
        await successFeedback();
        await Promise.all([refetchEpisode(), refetchTimeline()]);
        await queryClient.invalidateQueries({
          queryKey: ["alert-episodes"],
        });
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
      episodeId,
      episode,
      states,
      refetchEpisode,
      refetchTimeline,
      queryClient,
    ],
  );

  const handleAddNote: (noteText: string) => Promise<void> = useCallback(
    async (noteText: string) => {
      setSubmittingNote(true);
      try {
        await createAlertEpisodeNote(projectId, episodeId, noteText);
        await refetchNotes();
        setNoteModalVisible(false);
      } catch {
        Alert.alert("Error", "Failed to add note.");
      } finally {
        setSubmittingNote(false);
      }
    },
    [projectId, episodeId, refetchNotes],
  );

  if (isLoading) {
    return (
      <View className="flex-1 bg-bg-primary">
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  if (!episode) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <Text className="text-body-md text-text-secondary">
          Episode not found.
        </Text>
      </View>
    );
  }

  const stateColor: string = episode.currentAlertState?.color
    ? rgbToHex(episode.currentAlertState.color)
    : theme.colors.textTertiary;

  const severityColor: string = episode.alertSeverity?.color
    ? rgbToHex(episode.alertSeverity.color)
    : theme.colors.textTertiary;

  const acknowledgeState: AlertState | undefined = states?.find(
    (s: AlertState) => {
      return s.isAcknowledgedState;
    },
  );
  const resolveState: AlertState | undefined = states?.find((s: AlertState) => {
    return s.isResolvedState;
  });

  const currentStateId: string | undefined = episode.currentAlertState?._id;
  const isResolved: boolean = resolveState?._id === currentStateId;
  const isAcknowledged: boolean = acknowledgeState?._id === currentStateId;

  return (
    <ScrollView
      className="bg-bg-primary"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <View
        className="self-start px-2.5 py-1 rounded-full"
        style={{ backgroundColor: stateColor + "1A" }}
      >
        <Text
          className="text-[13px] font-semibold"
          style={{ color: stateColor }}
        >
          {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
        </Text>
      </View>

      <Text
        className="text-title-lg text-text-primary mt-2"
        style={{ letterSpacing: -0.5 }}
      >
        {episode.title}
      </Text>

      {/* Badges */}
      <View className="flex-row flex-wrap gap-2 mt-3">
        {episode.currentAlertState ? (
          <View className="flex-row items-center px-2.5 py-1 rounded-full bg-bg-tertiary">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: stateColor }}
            />
            <Text className="text-[13px] font-semibold text-text-primary">
              {episode.currentAlertState.name}
            </Text>
          </View>
        ) : null}

        {episode.alertSeverity ? (
          <View
            className="flex-row items-center px-2.5 py-1 rounded-full"
            style={{ backgroundColor: severityColor + "1A" }}
          >
            <Text
              className="text-[13px] font-semibold"
              style={{ color: severityColor }}
            >
              {episode.alertSeverity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Description */}
      {episode.description ? (
        <View className="mt-6">
          <SectionHeader title="Description" iconName="document-text-outline" />
          <Text className="text-body-md text-text-primary leading-6">
            {episode.description}
          </Text>
        </View>
      ) : null}

      {/* Details */}
      <View className="mt-6">
        <SectionHeader title="Details" iconName="information-circle-outline" />

        <View
          className="rounded-2xl p-4 bg-bg-elevated border border-border-subtle overflow-hidden"
          style={{
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.actionPrimary,
          }}
        >
          <View className="flex-row mb-3">
            <Text className="text-sm w-[90px] text-text-tertiary">
              Created
            </Text>
            <Text className="text-sm text-text-primary">
              {formatDateTime(episode.createdAt)}
            </Text>
          </View>

          <View className="flex-row">
            <Text className="text-sm w-[90px] text-text-tertiary">
              Alerts
            </Text>
            <Text className="text-sm text-text-primary">
              {episode.alertCount ?? 0}
            </Text>
          </View>
        </View>
      </View>

      {/* State Change Actions */}
      {!isResolved ? (
        <View className="mt-6">
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
                  shadowRadius: 8,
                  elevation: 4,
                }}
                onPress={() => {
                  return handleStateChange(
                    acknowledgeState._id,
                    acknowledgeState.name,
                  );
                }}
                disabled={changingState}
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
                  shadowRadius: 8,
                  elevation: 4,
                }}
                onPress={() => {
                  return handleStateChange(resolveState._id, resolveState.name);
                }}
                disabled={changingState}
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

      {/* State Timeline */}
      {timeline && timeline.length > 0 ? (
        <View className="mt-6">
          <SectionHeader title="State Timeline" iconName="time-outline" />
          <View className="ml-1">
            {timeline.map((entry: StateTimelineItem, index: number) => {
              const entryColor: string = entry.alertState?.color
                ? rgbToHex(entry.alertState.color)
                : theme.colors.textTertiary;
              const isLast: boolean = index === timeline.length - 1;
              return (
                <View key={entry._id} className="flex-row">
                  <View className="items-center mr-3">
                    <View
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: entryColor }}
                    />
                    {!isLast ? (
                      <View
                        className="w-0.5 flex-1 my-1"
                        style={{
                          backgroundColor: theme.colors.borderDefault,
                        }}
                      />
                    ) : null}
                  </View>
                  <View className="flex-1 pb-4">
                    <Text className="text-body-md text-text-primary font-semibold">
                      {entry.alertState?.name ?? "Unknown"}
                    </Text>
                    <Text className="text-body-sm text-text-tertiary">
                      {formatDateTime(entry.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Internal Notes */}
      <View className="mt-6">
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
            className="flex-row items-center px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: theme.colors.actionPrimary }}
            onPress={() => {
              return setNoteModalVisible(true);
            }}
          >
            <Ionicons
              name="add"
              size={16}
              color={theme.colors.textInverse}
              style={{ marginRight: 2 }}
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
                  className="rounded-xl p-3.5 mb-2 bg-bg-elevated border border-border-subtle"
                  style={{
                    borderTopWidth: 2,
                    borderTopColor: theme.colors.actionPrimary + "30",
                  }}
                >
                  <Text className="text-body-md text-text-primary">
                    {note.note}
                  </Text>
                  <View className="flex-row justify-between mt-2">
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
          <Text className="text-body-sm text-text-tertiary">
            No notes yet.
          </Text>
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
