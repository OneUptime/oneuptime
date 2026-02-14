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
  useIncidentEpisodeDetail,
  useIncidentEpisodeStates,
  useIncidentEpisodeStateTimeline,
  useIncidentEpisodeNotes,
  useIncidentEpisodeFeed,
} from "../hooks/useIncidentEpisodeDetail";
import {
  changeIncidentEpisodeState,
  createIncidentEpisodeNote,
} from "../api/incidentEpisodes";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import type { IncidentsStackParamList } from "../navigation/types";
import type { IncidentState } from "../api/types";
import { useQueryClient } from "@tanstack/react-query";
import AddNoteModal from "../components/AddNoteModal";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import NotesSection from "../components/NotesSection";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<
  IncidentsStackParamList,
  "IncidentEpisodeDetail"
>;

export default function IncidentEpisodeDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { episodeId, projectId } = route.params;
  const { theme } = useTheme();
  const queryClient: ReturnType<typeof useQueryClient> = useQueryClient();

  const {
    data: episode,
    isLoading,
    refetch: refetchEpisode,
  } = useIncidentEpisodeDetail(projectId, episodeId);
  const { data: states } = useIncidentEpisodeStates(projectId);
  const { refetch: refetchTimeline } = useIncidentEpisodeStateTimeline(
    projectId,
    episodeId,
  );
  const { data: feed, refetch: refetchFeed } = useIncidentEpisodeFeed(
    projectId,
    episodeId,
  );
  const { data: notes, refetch: refetchNotes } = useIncidentEpisodeNotes(
    projectId,
    episodeId,
  );

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const onRefresh: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      await Promise.all([
        refetchEpisode(),
        refetchTimeline(),
        refetchFeed(),
        refetchNotes(),
      ]);
    }, [refetchEpisode, refetchTimeline, refetchFeed, refetchNotes]);

  const handleStateChange: (
    stateId: string,
    stateName: string,
  ) => Promise<void> = useCallback(
    async (stateId: string, stateName: string): Promise<void> => {
      if (!episode) {
        return;
      }
      const queryKey: string[] = ["incident-episode", projectId, episodeId];
      const previousData: unknown = queryClient.getQueryData(queryKey);
      const newState: IncidentState | undefined = states?.find(
        (s: IncidentState) => {
          return s._id === stateId;
        },
      );
      if (newState) {
        queryClient.setQueryData(queryKey, {
          ...episode,
          currentIncidentState: {
            _id: newState._id,
            name: newState.name,
            color: newState.color,
          },
        });
      }
      setChangingState(true);
      try {
        await changeIncidentEpisodeState(projectId, episodeId, stateId);
        await successFeedback();
        await Promise.all([refetchEpisode(), refetchTimeline(), refetchFeed()]);
        await queryClient.invalidateQueries({
          queryKey: ["incident-episodes"],
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
      refetchFeed,
      queryClient,
    ],
  );

  const handleAddNote: (noteText: string) => Promise<void> = useCallback(
    async (noteText: string): Promise<void> => {
      setSubmittingNote(true);
      try {
        await createIncidentEpisodeNote(projectId, episodeId, noteText);
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
      <View
        className="flex-1"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  if (!episode) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <Text
          className="text-[15px]"
          style={{ color: theme.colors.textSecondary }}
        >
          Episode not found.
        </Text>
      </View>
    );
  }

  const stateColor: string = episode.currentIncidentState?.color
    ? rgbToHex(episode.currentIncidentState.color)
    : theme.colors.textTertiary;

  const severityColor: string = episode.incidentSeverity?.color
    ? rgbToHex(episode.incidentSeverity.color)
    : theme.colors.textTertiary;

  const acknowledgeState: IncidentState | undefined = states?.find(
    (s: IncidentState) => {
      return s.isAcknowledgedState;
    },
  );
  const resolveState: IncidentState | undefined = states?.find(
    (s: IncidentState) => {
      return s.isResolvedState;
    },
  );

  const currentStateId: string | undefined = episode.currentIncidentState?._id;
  const isResolved: boolean = resolveState?._id === currentStateId;
  const isAcknowledged: boolean = acknowledgeState?._id === currentStateId;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      <View
        className="rounded-2xl overflow-hidden mb-5"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <View style={{ height: 3, backgroundColor: stateColor }} />
        <View className="p-5">
          <Text
            className="text-[13px] font-semibold mb-2"
            style={{ color: stateColor }}
          >
            {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
          </Text>
          <Text
            className="text-[22px] font-bold"
            style={{ color: theme.colors.textPrimary, letterSpacing: -0.5 }}
          >
            {episode.title}
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-3">
            {episode.currentIncidentState ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-md"
                style={{ backgroundColor: stateColor + "14" }}
              >
                <View
                  className="w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: stateColor }}
                />
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: stateColor }}
                >
                  {episode.currentIncidentState.name}
                </Text>
              </View>
            ) : null}
            {episode.incidentSeverity ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-md"
                style={{ backgroundColor: severityColor + "14" }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {episode.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {episode.description ? (
        <View className="mb-6">
          <SectionHeader title="Description" iconName="document-text-outline" />
          <Text
            className="text-[14px] leading-[22px]"
            style={{ color: theme.colors.textPrimary }}
          >
            {episode.description}
          </Text>
        </View>
      ) : null}

      <View className="mb-6">
        <SectionHeader title="Details" iconName="information-circle-outline" />
        <View
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.actionPrimary,
          }}
        >
          <View className="p-4">
            {episode.declaredAt ? (
              <View className="flex-row mb-3">
                <Text
                  className="text-[13px] w-[90px]"
                  style={{ color: theme.colors.textTertiary }}
                >
                  Declared
                </Text>
                <Text
                  className="text-[13px]"
                  style={{ color: theme.colors.textPrimary }}
                >
                  {formatDateTime(episode.declaredAt)}
                </Text>
              </View>
            ) : null}
            <View className="flex-row mb-3">
              <Text
                className="text-[13px] w-[90px]"
                style={{ color: theme.colors.textTertiary }}
              >
                Created
              </Text>
              <Text
                className="text-[13px]"
                style={{ color: theme.colors.textPrimary }}
              >
                {formatDateTime(episode.createdAt)}
              </Text>
            </View>
            <View className="flex-row">
              <Text
                className="text-[13px] w-[90px]"
                style={{ color: theme.colors.textTertiary }}
              >
                Incidents
              </Text>
              <Text
                className="text-[13px]"
                style={{ color: theme.colors.textPrimary }}
              >
                {episode.incidentCount ?? 0}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {!isResolved ? (
        <View className="mb-6">
          <SectionHeader title="Actions" iconName="flash-outline" />
          <View className="flex-row gap-3">
            {!isAcknowledged && !isResolved && acknowledgeState ? (
              <TouchableOpacity
                className="flex-1 flex-row py-3 rounded-xl items-center justify-center min-h-[48px]"
                style={{ backgroundColor: theme.colors.stateAcknowledged }}
                onPress={() => {
                  return handleStateChange(
                    acknowledgeState._id,
                    acknowledgeState.name,
                  );
                }}
                disabled={changingState}
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
                      className="text-[14px] font-bold"
                      style={{ color: "#FFFFFF" }}
                    >
                      Acknowledge
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            {resolveState ? (
              <TouchableOpacity
                className="flex-1 flex-row py-3 rounded-xl items-center justify-center min-h-[48px]"
                style={{ backgroundColor: theme.colors.stateResolved }}
                onPress={() => {
                  return handleStateChange(resolveState._id, resolveState.name);
                }}
                disabled={changingState}
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
                      className="text-[14px] font-bold"
                      style={{ color: "#FFFFFF" }}
                    >
                      Resolve
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {feed && feed.length > 0 ? (
        <View className="mb-6">
          <SectionHeader title="Activity Feed" iconName="list-outline" />
          <FeedTimeline feed={feed} />
        </View>
      ) : null}

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
