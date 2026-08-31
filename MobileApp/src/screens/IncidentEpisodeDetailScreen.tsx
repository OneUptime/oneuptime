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
import { toPlainText } from "../utils/text";
import type { IncidentsStackParamList } from "../navigation/types";
import type { IncidentState } from "../api/types";
import { useQueryClient } from "@tanstack/react-query";
import AddNoteModal from "../components/AddNoteModal";
import EmptyState from "../components/EmptyState";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import NotesSection from "../components/NotesSection";
import RootCauseCard from "../components/RootCauseCard";
import MarkdownContent from "../components/MarkdownContent";
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
    isError,
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
        /*
         * The episode list is not the only list this just falsified. An
         * episode is a bundle of incidents, and changing the episode's state
         * changes the state of every incident inside it server-side - so the
         * moment a responder resolves an episode, every cached row on the
         * Incidents tab that belongs to it is wrong.
         *
         * Invalidating only ["incident-episodes"] left the responder
         * returning to a list where the episode reads Resolved and its member
         * incidents still read as open. On an on-call app that is not
         * cosmetic: an incident that looks unresolved is an incident somebody
         * goes and works, or one that makes a responder doubt that their
         * resolve landed. The incident detail screen already invalidates
         * ["incidents"] after the same kind of state change; the episode
         * screen has the same duty and had simply never been given it.
         */
        await queryClient.invalidateQueries({ queryKey: ["incidents"] });
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
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  /*
   * "We asked, and this episode does not exist" and "we could not ask" are
   * different facts, and they used to arrive at the same sentence. A responder
   * who has just been paged and taps through over a flaky connection was told
   * the episode was not found - so the page looked spurious, or already
   * cleaned up by somebody else, and there was nothing on screen to press to
   * find out otherwise. The only recovery was to back out and hope the list
   * still held the row.
   *
   * A failure gets its own screen and a retry, because the honest answer is
   * "ask again". A deleted episode falls through to the sentence below, which
   * is the one case where "not found" is the truth and a retry button would be
   * a lie. Nothing here has to guess which is which: `fetchIncidentEpisodeById`
   * resolves `null` for an episode that is not there, so that miss arrives as
   * settled data and `isError` is left meaning only "the request failed".
   *
   * The `!episode` guard keeps this specific to a failure that left us with
   * nothing: react-query holds the last good payload through a failed refetch,
   * and stale episode data on screen beats an error page for somebody who is
   * mid-response.
   */
  if (isError && !episode) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="Something went wrong"
          subtitle="This incident episode could not be loaded, which is not the same as it no longer existing. Try again."
          icon="episodes"
          actionLabel="Retry"
          onAction={() => {
            return refetchEpisode();
          }}
        />
      </View>
    );
  }

  if (!episode) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>
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
  const rootCauseTextRaw: string = toPlainText(episode.rootCause);
  const rootCauseText: string | undefined =
    rootCauseTextRaw.trim() || undefined;
  const descriptionText: string = toPlainText(episode.description);

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
        <View style={{ height: 3, backgroundColor: stateColor }} />
        <View style={{ padding: 20 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              marginBottom: 8,
              color: stateColor,
            }}
          >
            {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
          </Text>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: theme.colors.textPrimary,
              letterSpacing: -0.6,
            }}
          >
            {episode.title}
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
            }}
          >
            {episode.currentIncidentState ? (
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
                  {episode.currentIncidentState.name}
                </Text>
              </View>
            ) : null}
            {episode.incidentSeverity ? (
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
                  {episode.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

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
            {episode.declaredAt ? (
              <View style={{ flexDirection: "row", marginBottom: 12 }}>
                <Text
                  style={{
                    fontSize: 13,
                    width: 90,
                    color: theme.colors.textTertiary,
                  }}
                >
                  Declared
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.textPrimary,
                  }}
                >
                  {formatDateTime(episode.declaredAt)}
                </Text>
              </View>
            ) : null}
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
                {formatDateTime(episode.createdAt)}
              </Text>
            </View>
            <View style={{ flexDirection: "row" }}>
              <Text
                style={{
                  fontSize: 13,
                  width: 90,
                  color: theme.colors.textTertiary,
                }}
              >
                Incidents
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textPrimary,
                }}
              >
                {episode.incidentCount ?? 0}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/*
       * These two controls are the whole point of the screen, and they were
       * the two least legible things on it to a screen-reader user. Neither
       * carried a role or a name, so VoiceOver and TalkBack announced them
       * from their children - and the instant a change went in flight those
       * children became a bare ActivityIndicator, leaving the responder
       * swiping across two unlabelled shapes on the one screen where pressing
       * the wrong one has consequences.
       *
       * The names are therefore explicit, and they carry the in-flight fact
       * rather than dropping it. "state change in progress" is deliberately
       * not "acknowledging" or "resolving": `changingState` is a single flag
       * for both buttons, so it says only what is actually known - that a
       * change is in the air - instead of guessing which one was pressed.
       */}
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
                    accessibilityLabel={
                      changingState
                        ? "Acknowledge incident episode, state change in progress"
                        : "Acknowledge incident episode"
                    }
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
                    accessibilityLabel={
                      changingState
                        ? "Resolve incident episode, state change in progress"
                        : "Resolve incident episode"
                    }
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

      {feed && feed.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
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
