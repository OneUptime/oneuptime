import React, { useState, useCallback } from "react";
import { Text, ScrollView, RefreshControl, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
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
import { toPlainText } from "../utils/text";
import type { AlertsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import type { AlertState } from "../api/types";
import AddNoteModal from "../components/AddNoteModal";
import EmptyState from "../components/EmptyState";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import {
  ResponseDetailHeader,
  ResponseActions,
  ResponseInfoRow,
  ResponseSection,
  type ResponseAction,
} from "../components/ResponseDetailLayout";
import NotesSection from "../components/NotesSection";
import MarkdownContent from "../components/MarkdownContent";
import RootCauseCard from "../components/RootCauseCard";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<AlertsStackParamList, "AlertEpisodeDetail">;

export default function AlertEpisodeDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { episodeId, projectId } = route.params;
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: episode,
    isLoading,
    isError,
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
        /*
         * The episode list is not the only list this just falsified. An
         * episode is a bundle of alerts, and changing the episode's state
         * changes the state of every alert inside it server-side - so the
         * moment a responder resolves an episode, every cached row on the
         * Alerts tab that belongs to it is wrong.
         *
         * Invalidating only ["alert-episodes"] left the responder returning
         * to a list where the episode reads Resolved and its member alerts
         * still read as open. On an on-call app that is not cosmetic: an
         * alert that looks unresolved is an alert somebody goes and works,
         * or one that makes a responder doubt that their resolve landed. The
         * alert detail screen already invalidates ["alerts"] after the same
         * kind of state change; the episode screen has the same duty and had
         * simply never been given it.
         */
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
   * a lie. Nothing here has to guess which is which: `fetchAlertEpisodeById`
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
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
      >
        <EmptyState
          title="Something went wrong"
          subtitle="This alert episode could not be loaded, which is not the same as it no longer existing. Try again."
          icon="episodes"
          actionLabel="Retry"
          onAction={() => {
            return refetchEpisode();
          }}
        />
      </ScrollView>
    );
  }

  if (!episode) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
      >
        <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>
          Episode not found.
        </Text>
      </ScrollView>
    );
  }

  const stateColor: string = episode.currentAlertState?.color
    ? rgbToHex(episode.currentAlertState.color)
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
  const isResolved: boolean = Boolean(
    resolveState && resolveState._id === currentStateId,
  );
  const isAcknowledged: boolean = Boolean(
    acknowledgeState && acknowledgeState._id === currentStateId,
  );
  const rootCauseTextRaw: string = toPlainText(episode.rootCause);
  const rootCauseText: string | undefined =
    rootCauseTextRaw.trim() || undefined;
  const descriptionText: string = toPlainText(episode.description);

  const actions: ResponseAction[] = [];
  if (!isResolved && !isAcknowledged && acknowledgeState) {
    actions.push({
      label: "Acknowledge",
      accessibilityLabel: "Acknowledge alert episode",
      busyAccessibilityLabel:
        "Acknowledge alert episode, state change in progress",
      primary: true,
      onPress: () => {
        return handleStateChange(acknowledgeState._id, acknowledgeState.name);
      },
    });
  }
  if (!isResolved && resolveState) {
    actions.push({
      label: "Resolve",
      accessibilityLabel: "Resolve alert episode",
      busyAccessibilityLabel: "Resolve alert episode, state change in progress",
      primary: isAcknowledged || !acknowledgeState,
      onPress: () => {
        return handleStateChange(resolveState._id, resolveState.name);
      },
    });
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      testID="detail-scroll"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ResponseDetailHeader
        title={episode.title}
        kind="Alert episode"
        number={episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
        state={episode.currentAlertState?.name}
        stateColor={stateColor}
        severity={episode.alertSeverity?.name}
      />
      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: theme.colors.textSecondary,
          fontSize: 15,
          lineHeight: 23,
          marginBottom: 22,
        }}
      >
        {isResolved
          ? "This alert episode is resolved. Review the context and team notes below."
          : isAcknowledged
            ? "A responder has acknowledged this alert episode. Resolve it once recovery is confirmed."
            : "Actions on this episode apply to its grouped alerts. Acknowledge to take responsibility, or resolve when recovery is confirmed."}
      </Text>
      {actions.length > 0 ? (
        <ResponseActions actions={actions} busy={changingState} />
      ) : null}
      {descriptionText ? (
        <ResponseSection title="Description">
          <MarkdownContent content={descriptionText} />
        </ResponseSection>
      ) : null}
      <ResponseSection title="Details">
        <ResponseInfoRow
          label="Created"
          value={formatDateTime(episode.createdAt)}
        />
        <ResponseInfoRow label="Alerts" value={episode.alertCount ?? 0} />
      </ResponseSection>
      <ResponseSection title="Root Cause">
        <RootCauseCard rootCauseText={rootCauseText} />
      </ResponseSection>
      {feed && feed.length > 0 ? (
        <ResponseSection title="Activity Feed">
          <FeedTimeline feed={feed} />
        </ResponseSection>
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
