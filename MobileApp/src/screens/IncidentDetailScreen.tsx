import React, { useState, useCallback } from "react";
import {
  ScrollView,
  RefreshControl,
  Alert,
  type ViewStyle,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import QueryErrorNotice from "../components/QueryErrorNotice";
import {
  useIncidentDetail,
  useIncidentStates,
  useIncidentStateTimeline,
  useIncidentFeed,
} from "../hooks/useIncidentDetail";
import { useIncidentNotes } from "../hooks/useIncidentNotes";
import { changeIncidentState } from "../api/incidents";
import { createIncidentNote } from "../api/incidentNotes";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import { toPlainText } from "../utils/text";
import type { IncidentsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import AddNoteModal from "../components/AddNoteModal";
import EmptyState from "../components/EmptyState";
import FeedTimeline from "../components/FeedTimeline";
import {
  ResponseDetailHeader,
  ResponseDetailSkeleton,
  ResponseActions,
  ResponseGuidance,
  ResponseInfoRow,
  ResponseSection,
  describeResponseAge,
  getResponseStage,
  getResponseStageAppearance,
  responseActionIcons,
  type ResponseAction,
  type ResponseStage,
} from "../components/ResponseDetailLayout";
import NotesSection from "../components/NotesSection";
import RootCauseCard from "../components/RootCauseCard";
import MarkdownContent from "../components/MarkdownContent";
import { useHaptics } from "../hooks/useHaptics";
import type { IncidentItem, IncidentState, NamedEntity } from "../api/types";

type Props = NativeStackScreenProps<IncidentsStackParamList, "IncidentDetail">;

export default function IncidentDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { incidentId, projectId } = route.params;
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: incident,
    isLoading,
    isError,
    refetch: refetchIncident,
  } = useIncidentDetail(projectId, incidentId);
  const {
    data: states,
    isError: statesError,
    refetch: refetchStates,
  } = useIncidentStates(projectId);
  const { refetch: refetchTimeline } = useIncidentStateTimeline(
    projectId,
    incidentId,
  );
  const {
    data: feed,
    isError: feedError,
    refetch: refetchFeed,
  } = useIncidentFeed(projectId, incidentId);
  const {
    data: notes,
    isLoading: notesLoading,
    isError: notesError,
    refetch: refetchNotes,
  } = useIncidentNotes(projectId, incidentId);

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.allSettled([
      refetchIncident(),
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
      if (!incident) {
        return;
      }
      const queryKey: string[] = ["incident", projectId, incidentId];
      const previousData: IncidentItem | undefined =
        queryClient.getQueryData(queryKey);
      const newState: IncidentState | undefined = states?.find(
        (s: IncidentState) => {
          return s._id === stateId;
        },
      );
      if (newState) {
        queryClient.setQueryData(queryKey, {
          ...incident,
          currentIncidentState: {
            _id: newState._id,
            name: newState.name,
            color: newState.color,
          },
        });
      }
      setChangingState(true);
      try {
        await changeIncidentState(projectId, incidentId, stateId);
        await successFeedback();
        await Promise.all([
          refetchIncident(),
          refetchTimeline(),
          refetchFeed(),
        ]);
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
      incidentId,
      incident,
      states,
      refetchIncident,
      refetchTimeline,
      refetchFeed,
      queryClient,
    ],
  );

  const handleAddNote: (noteText: string) => Promise<void> = useCallback(
    async (noteText: string) => {
      setSubmittingNote(true);
      try {
        await createIncidentNote(projectId, incidentId, noteText);
        await refetchNotes();
        setNoteModalVisible(false);
      } catch {
        Alert.alert("Error", "Failed to add note.");
      } finally {
        setSubmittingNote(false);
      }
    },
    [projectId, incidentId, refetchNotes],
  );

  /*
   * The loading, failed and missing states share the page's gutters so the
   * layout does not jump when the incident lands.
   */
  const placeholderContainerStyle: ViewStyle = {
    padding: spacing.xl,
    paddingBottom: bottomPadding,
    flexGrow: 1,
  };

  if (isLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={placeholderContainerStyle}
      >
        <ResponseDetailSkeleton />
      </ScrollView>
    );
  }

  /*
   * Nothing to show, and the two reasons for that are not the same reason.
   *
   * This screen is where a page lands: the responder tapped a push
   * notification about an incident that is still burning. "Incident not
   * found." was every one of those endings - the token expired, the gateway
   * was down, the train went into a tunnel - and it told the responder the
   * page they were woken for does not exist, with nothing to press. Checkout
   * was still down.
   *
   * So a failure that might clear says so and offers another go, and only a
   * request that succeeded and found nothing is allowed to say the incident is
   * gone. Telling them apart takes no cleverness now: `fetchIncidentById`
   * resolves `null` for an incident that is not there, so a deleted incident
   * reaches us as settled data and `isError` means only that the request
   * failed.
   *
   * Note the guard is inside `!incident`: a refresh that fails while the
   * incident is already on screen must not replace it with an error page,
   * because a stale incident is worth vastly more here than an apology.
   */
  if (!incident) {
    if (isError) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
          contentContainerStyle={placeholderContainerStyle}
        >
          <EmptyState
            title="Something went wrong"
            subtitle="This incident could not be loaded, which is not the same as it no longer existing. Try again."
            icon="error"
            actionLabel="Retry"
            onAction={() => {
              return refetchIncident();
            }}
          />
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={placeholderContainerStyle}
      >
        <EmptyState
          title="Incident not found"
          subtitle="This incident no longer exists, or it is not part of this project."
          icon="incidents"
        />
      </ScrollView>
    );
  }

  const stateColor: string = incident.currentIncidentState?.color
    ? rgbToHex(incident.currentIncidentState.color)
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

  const currentStateId: string | undefined = incident.currentIncidentState?._id;
  const isResolved: boolean = Boolean(
    resolveState && resolveState._id === currentStateId,
  );
  const isAcknowledged: boolean = Boolean(
    acknowledgeState && acknowledgeState._id === currentStateId,
  );
  const rootCauseTextRaw: string = toPlainText(incident.rootCause);
  const rootCauseText: string | undefined =
    rootCauseTextRaw.trim() || undefined;
  const descriptionText: string = toPlainText(incident.description);

  const actions: ResponseAction[] = [];
  if (!isResolved && !isAcknowledged && acknowledgeState) {
    actions.push({
      label: "Acknowledge",
      accessibilityLabel: "Acknowledge incident",
      icon: responseActionIcons.acknowledge,
      primary: true,
      onPress: () => {
        return handleStateChange(acknowledgeState._id, acknowledgeState.name);
      },
    });
  }
  if (!isResolved && resolveState) {
    actions.push({
      label: "Resolve",
      accessibilityLabel: "Resolve incident",
      icon: responseActionIcons.resolve,
      primary: isAcknowledged || !acknowledgeState,
      onPress: () => {
        return handleStateChange(resolveState._id, resolveState.name);
      },
    });
  }

  const stage: ResponseStage = getResponseStage(isResolved, isAcknowledged);
  const guidanceMessage: string =
    stage === "resolved"
      ? "This incident is resolved. Review the context and team notes below."
      : stage === "acknowledged"
        ? "A responder has acknowledged this incident. Resolve it once recovery is confirmed."
        : "Acknowledge to let your team know you are responding. Resolve once recovery is confirmed.";

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      testID="detail-scroll"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
          colors={[theme.colors.actionPrimary]}
          progressBackgroundColor={theme.colors.backgroundElevated}
        />
      }
    >
      <ResponseDetailHeader
        title={incident.title}
        kind="Incident"
        number={
          incident.incidentNumberWithPrefix || `#${incident.incidentNumber}`
        }
        state={incident.currentIncidentState?.name}
        stateColor={stateColor}
        severity={incident.incidentSeverity?.name}
        severityColor={
          incident.incidentSeverity?.color
            ? rgbToHex(incident.incidentSeverity.color)
            : undefined
        }
        meta={
          incident.declaredAt
            ? describeResponseAge("Declared", incident.declaredAt)
            : describeResponseAge("Created", incident.createdAt)
        }
      />
      {statesError ? (
        <QueryErrorNotice
          message="Unable to load the latest response actions."
          retryLabel="Retry actions"
          onRetry={refetchStates}
        />
      ) : null}
      <ResponseGuidance
        {...getResponseStageAppearance(stage)}
        message={guidanceMessage}
      >
        {actions.length > 0 ? (
          <ResponseActions
            actions={actions}
            busy={changingState}
            style={{ marginBottom: 0 }}
          />
        ) : null}
      </ResponseGuidance>
      {descriptionText ? (
        <ResponseSection title="Description" iconName="document-text-outline">
          <MarkdownContent content={descriptionText} />
        </ResponseSection>
      ) : null}
      <ResponseSection title="Details" iconName="information-circle-outline">
        {incident.declaredAt ? (
          <ResponseInfoRow
            label="Declared"
            value={formatDateTime(incident.declaredAt)}
          />
        ) : null}
        <ResponseInfoRow
          label="Created"
          value={formatDateTime(incident.createdAt)}
        />
        {incident.monitors?.length > 0 ? (
          <ResponseInfoRow
            label="Monitors"
            value={incident.monitors
              .map((monitor: NamedEntity) => {
                return monitor.name;
              })
              .join(", ")}
          />
        ) : null}
      </ResponseSection>
      <ResponseSection title="Root Cause" iconName="bulb-outline">
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
        <ResponseSection title="Activity Feed" iconName="pulse-outline">
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
