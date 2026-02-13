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
import type { IncidentsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import AddNoteModal from "../components/AddNoteModal";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import NotesSection from "../components/NotesSection";
import GlassCard from "../components/GlassCard";
import { useHaptics } from "../hooks/useHaptics";
import type {
  IncidentItem,
  IncidentState,
  NoteItem,
  NamedEntity,
} from "../api/types";

type Props = NativeStackScreenProps<IncidentsStackParamList, "IncidentDetail">;

export default function IncidentDetailScreen({
  route,
}: Props): React.JSX.Element {
  const { incidentId, projectId } = route.params;
  const { theme } = useTheme();
  const queryClient: QueryClient = useQueryClient();

  const {
    data: incident,
    isLoading,
    refetch: refetchIncident,
  } = useIncidentDetail(projectId, incidentId);
  const { data: states } = useIncidentStates(projectId);
  const { refetch: refetchTimeline } = useIncidentStateTimeline(
    projectId,
    incidentId,
  );
  const { data: feed, refetch: refetchFeed } = useIncidentFeed(
    projectId,
    incidentId,
  );
  const { data: notes, refetch: refetchNotes } = useIncidentNotes(
    projectId,
    incidentId,
  );

  const { successFeedback, errorFeedback } = useHaptics();
  const [changingState, setChangingState] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const onRefresh: () => Promise<void> = useCallback(async () => {
    await Promise.all([
      refetchIncident(),
      refetchTimeline(),
      refetchFeed(),
      refetchNotes(),
    ]);
  }, [refetchIncident, refetchTimeline, refetchFeed, refetchNotes]);

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

  if (isLoading) {
    return (
      <View className="flex-1 bg-bg-primary">
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  if (!incident) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <Text className="text-body-md text-text-secondary">
          Incident not found.
        </Text>
      </View>
    );
  }

  const stateColor: string = incident.currentIncidentState?.color
    ? rgbToHex(incident.currentIncidentState.color)
    : theme.colors.textTertiary;

  const severityColor: string = incident.incidentSeverity?.color
    ? rgbToHex(incident.incidentSeverity.color)
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
              {incident.incidentNumberWithPrefix ||
                `#${incident.incidentNumber}`}
            </Text>
          </View>

          <Text
            className="text-title-lg text-text-primary"
            style={{ letterSpacing: -0.5 }}
          >
            {incident.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {incident.currentIncidentState ? (
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
                  {incident.currentIncidentState.name}
                </Text>
              </View>
            ) : null}

            {incident.incidentSeverity ? (
              <View
                className="flex-row items-center px-3 py-1.5 rounded-full"
                style={{ backgroundColor: severityColor + "1A" }}
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {incident.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </LinearGradient>
      </GlassCard>

      {/* Description */}
      {incident.description ? (
        <View className="mb-6">
          <SectionHeader title="Description" iconName="document-text-outline" />
          <Text className="text-body-md text-text-primary leading-6">
            {incident.description}
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
            {incident.declaredAt ? (
              <View className="flex-row mb-3">
                <Text className="text-sm w-[90px] text-text-tertiary">
                  Declared
                </Text>
                <Text className="text-sm text-text-primary">
                  {formatDateTime(incident.declaredAt)}
                </Text>
              </View>
            ) : null}

            <View className="flex-row mb-3">
              <Text className="text-sm w-[90px] text-text-tertiary">
                Created
              </Text>
              <Text className="text-sm text-text-primary">
                {formatDateTime(incident.createdAt)}
              </Text>
            </View>

            {incident.monitors?.length > 0 ? (
              <View className="flex-row">
                <Text className="text-sm w-[90px] text-text-tertiary">
                  Monitors
                </Text>
                <Text className="text-sm text-text-primary flex-1">
                  {incident.monitors
                    .map((m: NamedEntity) => {
                      return m.name;
                    })
                    .join(", ")}
                </Text>
              </View>
            ) : null}
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
                accessibilityLabel="Acknowledge incident"
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
                accessibilityLabel="Resolve incident"
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
      <NotesSection
        notes={notes}
        noteModalVisible={noteModalVisible}
        setNoteModalVisible={setNoteModalVisible}
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
