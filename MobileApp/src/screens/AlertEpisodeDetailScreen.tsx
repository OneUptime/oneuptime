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
  useAlertEpisodeDetail,
  useAlertEpisodeStates,
  useAlertEpisodeStateTimeline,
  useAlertEpisodeNotes,
  useAlertEpisodeFeed,
} from "../hooks/useAlertEpisodeDetail";
import {
  changeAlertEpisodeState,
  createAlertEpisodeNote,
} from "../api/alertEpisodes";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import type { AlertsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import type { AlertState } from "../api/types";
import AddNoteModal from "../components/AddNoteModal";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import NotesSection from "../components/NotesSection";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<AlertsStackParamList, "AlertEpisodeDetail">;

export default function AlertEpisodeDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { episodeId, projectId } = route.params;
  const { theme } = useTheme();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: episode,
    isLoading,
    refetch: refetchEpisode,
  } = useAlertEpisodeDetail(projectId, episodeId);
  const { data: states } = useAlertEpisodeStates(projectId);
  const { refetch: refetchTimeline } = useAlertEpisodeStateTimeline(
    projectId,
    episodeId,
  );
  const { data: feed, refetch: refetchFeed } = useAlertEpisodeFeed(
    projectId,
    episodeId,
  );
  const { data: notes, refetch: refetchNotes } = useAlertEpisodeNotes(
    projectId,
    episodeId,
  );

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const onRefresh: () => Promise<void> = useCallback(async () => {
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
        await Promise.all([refetchEpisode(), refetchTimeline(), refetchFeed()]);
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
      refetchFeed,
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
  const rootCauseText: string | undefined = episode.rootCause?.trim();

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
      <View
        className="rounded-3xl overflow-hidden mb-5"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: theme.isDark ? "#000" : stateColor,
          shadowOpacity: theme.isDark ? 0.28 : 0.12,
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
        <View style={{ height: 3, backgroundColor: stateColor }} />
        <View className="p-5">
          <Text
            className="text-[13px] font-semibold mb-2"
            style={{ color: stateColor }}
          >
            {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
          </Text>
          <Text
            className="text-[24px] font-bold"
            style={{ color: theme.colors.textPrimary, letterSpacing: -0.6 }}
          >
            {episode.title}
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-3">
            {episode.currentAlertState ? (
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
                  {episode.currentAlertState.name}
                </Text>
              </View>
            ) : null}
            {episode.alertSeverity ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-md"
                style={{ backgroundColor: severityColor + "14" }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {episode.alertSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {episode.description ? (
        <View className="mb-6">
          <SectionHeader title="Description" iconName="document-text-outline" />
          <View
            className="rounded-2xl p-4"
            style={{
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <Text
              className="text-[14px] leading-[22px]"
              style={{ color: theme.colors.textPrimary }}
            >
              {episode.description}
            </Text>
          </View>
        </View>
      ) : null}

      <View className="mb-6">
        <SectionHeader title="Root Cause" iconName="git-branch-outline" />
        <View
          className="rounded-2xl p-4"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Text
            className="text-[14px] leading-[22px]"
            style={{
              color: rootCauseText
                ? theme.colors.textPrimary
                : theme.colors.textTertiary,
            }}
          >
            {rootCauseText || "No root cause documented yet."}
          </Text>
        </View>
      </View>

      <View className="mb-6">
        <SectionHeader title="Details" iconName="information-circle-outline" />
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View className="p-4">
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
                Alerts
              </Text>
              <Text
                className="text-[13px]"
                style={{ color: theme.colors.textPrimary }}
              >
                {episode.alertCount ?? 0}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {!isResolved ? (
        <View className="mb-6">
          <SectionHeader title="Actions" iconName="flash-outline" />
          <View
            className="rounded-2xl p-3"
            style={{
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <View className="flex-row gap-3">
            {!isAcknowledged && !isResolved && acknowledgeState ? (
              <TouchableOpacity
                className="flex-1 flex-row py-3 rounded-xl items-center justify-center min-h-[48px] overflow-hidden"
                style={{
                  backgroundColor: theme.colors.stateAcknowledged,
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
                className="flex-1 flex-row py-3 rounded-xl items-center justify-center min-h-[48px] overflow-hidden"
                style={{
                  backgroundColor: theme.colors.stateResolved,
                }}
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
