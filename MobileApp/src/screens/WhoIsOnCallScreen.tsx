import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TextInput,
} from "react-native";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallSchedules } from "../hooks/useOnCallSchedules";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useNow } from "../hooks/useNow";
import RosterScheduleCard from "../components/RosterScheduleCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SectionHeader from "../components/SectionHeader";
import type { ProjectOnCallScheduleItem } from "../api/types";

export function matchesRosterSearch(
  entry: ProjectOnCallScheduleItem,
  searchTerm: string,
): boolean {
  const term: string = searchTerm.trim().toLowerCase();

  if (!term) {
    return true;
  }

  const haystack: string = [
    entry.item.name,
    entry.projectName,
    entry.item.currentUserOnRoster?.name ?? "",
    entry.item.currentUserOnRoster?.email ?? "",
    entry.item.nextUserOnRoster?.name ?? "",
    entry.item.nextUserOnRoster?.email ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

/*
 * Who is carrying every schedule, across every project.
 *
 * Uncovered schedules are pulled to the top rather than sorted alphabetically
 * with the rest. A schedule with nobody on it is the only row on this screen
 * that is a problem, and a list that makes you hunt for it has buried the one
 * thing it was worth loading.
 */
export default function WhoIsOnCallScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();
  const now: number = useNow();
  const currentUserId: string | null = useCurrentUserId();
  const { schedules, isLoading, isError, refetch } = useOnCallSchedules();

  const [searchTerm, setSearchTerm] = useState<string>("");

  const { uncovered, covered } = useMemo((): {
    uncovered: ProjectOnCallScheduleItem[];
    covered: ProjectOnCallScheduleItem[];
  } => {
    const matching: ProjectOnCallScheduleItem[] = schedules.filter(
      (entry: ProjectOnCallScheduleItem) => {
        return matchesRosterSearch(entry, searchTerm);
      },
    );

    const sortByName: (
      a: ProjectOnCallScheduleItem,
      b: ProjectOnCallScheduleItem,
    ) => number = (
      a: ProjectOnCallScheduleItem,
      b: ProjectOnCallScheduleItem,
    ): number => {
      const byProject: number = a.projectName.localeCompare(b.projectName);
      return byProject !== 0
        ? byProject
        : a.item.name.localeCompare(b.item.name);
    };

    return {
      uncovered: matching
        .filter((entry: ProjectOnCallScheduleItem) => {
          return !entry.item.currentUserOnRoster;
        })
        .sort(sortByName),
      covered: matching
        .filter((entry: ProjectOnCallScheduleItem) => {
          return Boolean(entry.item.currentUserOnRoster);
        })
        .sort(sortByName),
    };
  }, [schedules, searchTerm]);

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await refetch();
  };

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
        >
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (isError) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="Could not load the on-call roster"
          subtitle="Pull to refresh or try again."
          icon="alerts"
          actionLabel="Retry"
          onAction={() => {
            return refetch();
          }}
        />
      </View>
    );
  }

  if (schedules.length === 0) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="No on-call schedules"
          subtitle="None of your projects has an on-call schedule yet."
          icon="alerts"
        />
      </View>
    );
  }

  return (
    <ScrollView
      testID="who-is-on-call-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <TextInput
        testID="roster-search"
        placeholder="Search schedules, projects or people"
        placeholderTextColor={theme.colors.textTertiary}
        value={searchTerm}
        onChangeText={setSearchTerm}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          height: 44,
          borderRadius: 12,
          paddingHorizontal: 14,
          marginBottom: 20,
          fontSize: 14,
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      />

      {uncovered.length > 0 ? (
        <View testID="section-uncovered" style={{ marginBottom: 28 }}>
          <SectionHeader title="Nobody on call" iconName="warning-outline" />
          <View style={{ gap: 12 }}>
            {uncovered.map((entry: ProjectOnCallScheduleItem) => {
              return (
                <RosterScheduleCard
                  key={`${entry.projectId}-${entry.item._id}`}
                  entry={entry}
                  currentUserId={currentUserId}
                  now={now}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {covered.length > 0 ? (
        <View testID="section-covered">
          <SectionHeader title="On call now" iconName="people-outline" />
          <View style={{ gap: 12 }}>
            {covered.map((entry: ProjectOnCallScheduleItem) => {
              return (
                <RosterScheduleCard
                  key={`${entry.projectId}-${entry.item._id}`}
                  entry={entry}
                  currentUserId={currentUserId}
                  now={now}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {uncovered.length === 0 && covered.length === 0 ? (
        <View
          style={{
            borderRadius: 18,
            padding: 18,
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              color: theme.colors.textSecondary,
            }}
          >
            No schedules match that search.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
