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
import { LinearGradient } from "expo-linear-gradient";
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
import GlassCard from "../components/GlassCard";
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
      className="bg-bg-primary"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      {/* Header with glass card */}
      <GlassCard style={{ marginBottom: 20 }}>
        <LinearGradient
          colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className="p-5"
        >
          <View
            className="self-start px-3 py-1.5 rounded-full mb-3"
            style={{ backgroundColor: stateColor + "1A" }}
          >
            <Text
              className="text-[13px] font-bold"
              style={{ color: stateColor }}
            >
              {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
            </Text>
          </View>

          <Text
            className="text-title-lg text-text-primary"
            style={{ letterSpacing: -0.5 }}
          >
            {episode.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {episode.currentIncidentState ? (
              <View
                className="flex-row items-center px-3 py-1.5 rounded-full"
                style={{
                  backgroundColor: theme.colors.backgroundGlass,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                }}
              >
                <View
                  className="w-2.5 h-2.5 rounded-full mr-2"
                  style={{ backgroundColor: stateColor }}
                />
                <Text className="text-[13px] font-semibold text-text-primary">
                  {episode.currentIncidentState.name}
                </Text>
              </View>
            ) : null}

            {episode.incidentSeverity ? (
              <View
                className="flex-row items-center px-3 py-1.5 rounded-full"
                style={{ backgroundColor: severityColor + "1A" }}
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {episode.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </LinearGradient>
      </GlassCard>

      {/* Description */}
      {episode.description ? (
        <View className="mb-6">
          <SectionHeader title="Description" iconName="document-text-outline" />
          <Text className="text-body-md text-text-primary leading-6">
            {episode.description}
          </Text>
        </View>
      ) : null}

      {/* Details */}
      <View className="mb-6">
        <SectionHeader title="Details" iconName="information-circle-outline" />
        <GlassCard
          style={{
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.actionPrimary,
          }}
        >
          <View className="p-4">
            {episode.declaredAt ? (
              <View className="flex-row mb-3">
                <Text className="text-sm w-[90px] text-text-tertiary">
                  Declared
                </Text>
                <Text className="text-sm text-text-primary">
                  {formatDateTime(episode.declaredAt)}
                </Text>
              </View>
            ) : null}

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
                Incidents
              </Text>
              <Text className="text-sm text-text-primary">
                {episode.incidentCount ?? 0}
              </Text>
            </View>
          </View>
        </GlassCard>
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

      {/* Activity Feed */}
      {feed && feed.length > 0 ? (
        <View className="mb-6">
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
