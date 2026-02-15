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
import { toPlainText } from "../utils/text";
import type { IncidentsStackParamList } from "../navigation/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import AddNoteModal from "../components/AddNoteModal";
import FeedTimeline from "../components/FeedTimeline";
import SkeletonCard from "../components/SkeletonCard";
import SectionHeader from "../components/SectionHeader";
import NotesSection from "../components/NotesSection";
import RootCauseCard from "../components/RootCauseCard";
import { useHaptics } from "../hooks/useHaptics";
import type { IncidentItem, IncidentState, NamedEntity } from "../api/types";

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
      <View
        className="flex-1"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <SkeletonCard variant="detail" />
      </View>
    );
  }

  if (!incident) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <Text
          className="text-[15px]"
          style={{ color: theme.colors.textSecondary }}
        >
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
  const rootCauseTextRaw: string = toPlainText(incident.rootCause);
  const rootCauseText: string | undefined =
    rootCauseTextRaw.trim() || undefined;
  const descriptionText: string = toPlainText(incident.description);

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
      {/* Header card */}
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
        <View
          style={{
            height: 3,
            backgroundColor: stateColor,
          }}
        />
        <View className="p-5">
          <Text
            className="text-[13px] font-semibold mb-2"
            style={{ color: stateColor }}
          >
            {incident.incidentNumberWithPrefix || `#${incident.incidentNumber}`}
          </Text>

          <Text
            className="text-[24px] font-bold"
            style={{
              color: theme.colors.textPrimary,
              letterSpacing: -0.6,
            }}
          >
            {incident.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {incident.currentIncidentState ? (
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
                  {incident.currentIncidentState.name}
                </Text>
              </View>
            ) : null}

            {incident.incidentSeverity ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-md"
                style={{ backgroundColor: severityColor + "14" }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {incident.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Description */}
      {descriptionText ? (
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
              {descriptionText}
            </Text>
          </View>
        </View>
      ) : null}

      <View className="mb-6">
        <SectionHeader title="Root Cause" iconName="bulb-outline" />
        <RootCauseCard rootCauseText={rootCauseText} />
      </View>

      {/* Details */}
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
            {incident.declaredAt ? (
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
                  {formatDateTime(incident.declaredAt)}
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
                {formatDateTime(incident.createdAt)}
              </Text>
            </View>

            {incident.monitors?.length > 0 ? (
              <View className="flex-row">
                <Text
                  className="text-[13px] w-[90px]"
                  style={{ color: theme.colors.textTertiary }}
                >
                  Monitors
                </Text>
                <Text
                  className="text-[13px] flex-1"
                  style={{ color: theme.colors.textPrimary }}
                >
                  {incident.monitors
                    .map((m: NamedEntity) => {
                      return m.name;
                    })
                    .join(", ")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* State Change Actions */}
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
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Acknowledge incident"
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
                    return handleStateChange(
                      resolveState._id,
                      resolveState.name,
                    );
                  }}
                  disabled={changingState}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Resolve incident"
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
