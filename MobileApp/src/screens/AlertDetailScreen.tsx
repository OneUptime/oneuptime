import React, { useState, useCallback } from "react";
import { Text, ScrollView, RefreshControl, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import QueryErrorNotice from "../components/QueryErrorNotice";
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
import {
  ResponseDetailHeader,
  ResponseActions,
  ResponseInfoRow,
  ResponseSection,
  type ResponseAction,
} from "../components/ResponseDetailLayout";
import NotesSection from "../components/NotesSection";
import RootCauseCard from "../components/RootCauseCard";
import MarkdownContent from "../components/MarkdownContent";
import { useHaptics } from "../hooks/useHaptics";

type Props = NativeStackScreenProps<AlertsStackParamList, "AlertDetail">;

export default function AlertDetailScreen({ route }: Props): React.JSX.Element {
  const { alertId, projectId } = route.params;
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: alert,
    isLoading,
    isError,
    refetch: refetchAlert,
  } = useAlertDetail(projectId, alertId);
  const {
    data: states,
    isError: statesError,
    refetch: refetchStates,
  } = useAlertStates(projectId);
  const { refetch: refetchTimeline } = useAlertStateTimeline(
    projectId,
    alertId,
  );
  const {
    data: feed,
    isError: feedError,
    refetch: refetchFeed,
  } = useAlertFeed(projectId, alertId);
  const {
    data: notes,
    isLoading: notesLoading,
    isError: notesError,
    refetch: refetchNotes,
  } = useAlertNotes(projectId, alertId);

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.allSettled([
      refetchAlert(),
      refetchStates(),
      refetchTimeline(),
      refetchFeed(),
      refetchNotes(),
    ]);
  });

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
            subtitle="This alert could not be loaded, which is not the same as it no longer existing. Try again."
            icon="alerts"
            actionLabel="Retry"
            onAction={() => {
              return refetchAlert();
            }}
          />
        </ScrollView>
      );
    }

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
          title="Alert not found"
          subtitle="This alert no longer exists, or it is not part of this project."
          icon="alerts"
        />
      </ScrollView>
    );
  }

  const stateColor: string = alert.currentAlertState?.color
    ? rgbToHex(alert.currentAlertState.color)
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
  const isResolved: boolean = Boolean(
    resolveState && resolveState._id === currentStateId,
  );
  const isAcknowledged: boolean = Boolean(
    acknowledgeState && acknowledgeState._id === currentStateId,
  );
  const rootCauseTextRaw: string = toPlainText(alert.rootCause);
  const rootCauseText: string | undefined =
    rootCauseTextRaw.trim() || undefined;
  const descriptionText: string = toPlainText(alert.description);

  const actions: ResponseAction[] = [];
  if (!isResolved && !isAcknowledged && acknowledgeState) {
    actions.push({
      label: "Acknowledge",
      accessibilityLabel: "Acknowledge alert",
      primary: true,
      onPress: () => {
        return handleStateChange(acknowledgeState._id, acknowledgeState.name);
      },
    });
  }
  if (!isResolved && resolveState) {
    actions.push({
      label: "Resolve",
      accessibilityLabel: "Resolve alert",
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
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ResponseDetailHeader
        title={alert.title}
        kind="Alert"
        number={alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
        state={alert.currentAlertState?.name}
        stateColor={stateColor}
        severity={alert.alertSeverity?.name}
      />
      {statesError ? (
        <QueryErrorNotice
          message="Unable to load the latest response actions."
          retryLabel="Retry actions"
          onRetry={refetchStates}
        />
      ) : null}
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
          ? "This alert is resolved. Review the context and team notes below."
          : isAcknowledged
            ? "A responder has acknowledged this alert. Resolve it once recovery is confirmed."
            : "Acknowledge to let your team know you are responding. Resolve once recovery is confirmed."}
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
        {alert.monitor ? (
          <ResponseInfoRow label="Monitor" value={alert.monitor.name} />
        ) : null}
        <ResponseInfoRow
          label="Created"
          value={formatDateTime(alert.createdAt)}
        />
      </ResponseSection>
      <ResponseSection title="Root Cause">
        <RootCauseCard rootCauseText={rootCauseText} />
      </ResponseSection>
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
      <NotesSection
        notes={notes}
        setNoteModalVisible={setNoteModalVisible}
        isLoading={notesLoading}
        isError={notesError}
        onRetry={refetchNotes}
      />
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
