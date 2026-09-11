import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Share,
  Alert,
} from "react-native";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import ScreenIntro from "../components/ScreenIntro";
import SearchField from "../components/SearchField";
import SegmentedControl from "../components/SegmentedControl";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallSchedules } from "../hooks/useOnCallSchedules";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useNow } from "../hooks/useNow";
import { useOnCallCalendarFeedAvailability } from "../hooks/useOnCallCalendarFeedAvailability";
import {
  fetchScheduleCalendarFeed,
  getHttpStatus,
  isRouteMissingError,
} from "../api/onCallCalendar";
import { getServerUrl } from "../storage/serverUrl";
import { getFriendlyErrorMessage } from "../utils/error";
import { buildFeedLinks, type FeedLinks } from "../oncall/calendarFeedLinks";
import RosterScheduleCard from "../components/RosterScheduleCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SectionHeader from "../components/SectionHeader";
import type {
  OnCallCalendarFeedStatus,
  ProjectOnCallScheduleItem,
} from "../api/types";

/**
 * The text handed to the share sheet for a schedule's team calendar link.
 * Says whose calendar it is and that the link is a credential, because the
 * place this gets pasted is a chat channel.
 */
export function buildTeamCalendarShareMessage(
  entry: ProjectOnCallScheduleItem,
  links: FeedLinks,
): string {
  return [
    `${entry.item.name} on-call calendar (${entry.projectName}):`,
    links.https,
    "",
    "Subscribe from Google Calendar, Outlook or Apple Calendar. Anyone with this link can see the whole schedule - keep it inside the team.",
  ].join("\n");
}

/**
 * Which link to hand out for a SHARED feed. The server's own link is the
 * canonical one - a colleague may not be on the same VPN as this phone - so
 * it wins unless the server has no usable public address (HOST empty or
 * localhost), in which case the address this app reaches it on is the only
 * one that stands a chance.
 */
export function chooseTeamCalendarLinks(
  serverUrl: string,
  status: OnCallCalendarFeedStatus,
): FeedLinks | null {
  const links: FeedLinks | null = buildFeedLinks(serverUrl, status);

  if (!links) {
    return null;
  }

  if (status.hostWarning) {
    return links;
  }

  return {
    ...links,
    https: links.serverHttps,
    webcal: status.urls?.webcal ?? links.webcal,
    googleAdd: status.urls?.googleAdd ?? links.googleAdd,
    differsFromServer: false,
  };
}

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
 * Who is carrying each schedule in the selected project.
 *
 * Uncovered schedules are pulled to the top rather than sorted alphabetically
 * with the rest. A schedule with nobody on it is the only row on this screen
 * that is a problem, and a list that makes you hunt for it has buried the one
 * thing it was worth loading.
 */
export default function WhoIsOnCallScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const { lightImpact } = useHaptics();
  const now: number = useNow();
  const currentUserId: string | null = useCurrentUserId();
  const { schedules, isLoading, isError, refetch } = useOnCallSchedules();
  const calendarFeed: ReturnType<typeof useOnCallCalendarFeedAvailability> =
    useOnCallCalendarFeedAvailability();

  const [searchTerm, setSearchTerm] = useState<string>("");
  const [coverageFilter, setCoverageFilter] = useState<
    "all" | "uncovered" | "covered"
  >("all");
  const [sharingScheduleId, setSharingScheduleId] = useState<string | null>(
    null,
  );

  /*
   * "Share team calendar link": fetch the schedule's shared feed and hand it
   * to the share sheet. Publishing lives on the web (it needs edit rights and
   * a settings form); from a phone the useful half is getting an existing
   * link to a colleague, and saying plainly when there is none.
   */
  const shareTeamCalendar: (
    entry: ProjectOnCallScheduleItem,
  ) => Promise<void> = async (
    entry: ProjectOnCallScheduleItem,
  ): Promise<void> => {
    lightImpact();
    setSharingScheduleId(entry.item._id);

    try {
      const [status, serverUrl]: [OnCallCalendarFeedStatus, string] =
        await Promise.all([
          fetchScheduleCalendarFeed(entry.projectId, entry.item._id),
          getServerUrl(),
        ]);

      if (!status.exists || !status.urls) {
        Alert.alert(
          "No shared link yet",
          `${entry.item.name} has no shared calendar link. Ask an editor to publish one from the schedule's page on the web.`,
        );
        return;
      }

      if (!status.isEnabled) {
        Alert.alert(
          "Shared link is switched off",
          `The shared calendar link for ${entry.item.name} is disabled, so it would show an empty calendar. Ask an editor to enable it on the web.`,
        );
        return;
      }

      const links: FeedLinks | null = chooseTeamCalendarLinks(
        serverUrl,
        status,
      );

      if (!links) {
        Alert.alert(
          "No shared link yet",
          "The server did not return a usable link for this schedule.",
        );
        return;
      }

      await Share.share({
        title: `${entry.item.name} on-call calendar`,
        message: buildTeamCalendarShareMessage(entry, links),
      });
    } catch (err: unknown) {
      if (isRouteMissingError(err)) {
        Alert.alert(
          "Not available on this server",
          "This OneUptime server does not offer calendar feeds yet.",
        );
        return;
      }

      if (getHttpStatus(err) === 403) {
        Alert.alert(
          "No access",
          `You cannot read the shared calendar link for ${entry.item.name}.`,
        );
        return;
      }

      Alert.alert("Could not fetch the link", getFriendlyErrorMessage(err));
    } finally {
      setSharingScheduleId(null);
    }
  };

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
          contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
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
          subtitle="The selected project has no on-call schedules yet."
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
      contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ScreenIntro
        title="Who's on call"
        description="A clear view of your team’s coverage."
      />
      <View
        testID="coverage-summary"
        style={{
          padding: 16,
          marginBottom: 20,
          borderRadius: 12,
          backgroundColor: theme.colors.cardAccent,
          borderLeftWidth: 3,
          borderLeftColor: theme.colors.actionPrimary,
        }}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: 16,
            fontWeight: "700",
          }}
        >
          {
            schedules.filter((entry: ProjectOnCallScheduleItem) => {
              return Boolean(entry.item.currentUserOnRoster);
            }).length
          }{" "}
          of {schedules.length} schedules covered
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 14,
            lineHeight: 21,
            marginTop: 6,
          }}
        >
          {schedules.some((entry: ProjectOnCallScheduleItem) => {
            return !entry.item.currentUserOnRoster;
          })
            ? "Schedules with nobody on call appear first. Check these gaps with your team."
            : "Every schedule has someone on call right now."}
        </Text>
      </View>
      <SearchField
        testID="roster-search"
        placeholder="Search schedules, projects or people"
        accessibilityLabel="Search schedules, projects or people"
        value={searchTerm}
        onChangeText={setSearchTerm}
      />
      <View style={{ marginTop: 12, marginBottom: 24 }}>
        <SegmentedControl<"all" | "uncovered" | "covered">
          style={{ marginHorizontal: 0, marginTop: 0 }}
          segments={[
            { key: "all", label: `All (${uncovered.length + covered.length})` },
            { key: "uncovered", label: `Needs cover (${uncovered.length})` },
            { key: "covered", label: `On call (${covered.length})` },
          ]}
          selected={coverageFilter}
          onSelect={(value: "all" | "uncovered" | "covered") => {
            lightImpact();
            setCoverageFilter(value);
          }}
        />
      </View>

      {uncovered.length > 0 && coverageFilter !== "covered" ? (
        <View testID="section-uncovered" style={{ marginBottom: 28 }}>
          <SectionHeader title="Nobody on call" iconName="warning-outline" />
          <View style={{ gap: 0, borderRadius: 16, overflow: "hidden" }}>
            {uncovered.map((entry: ProjectOnCallScheduleItem) => {
              return (
                <RosterScheduleCard
                  key={`${entry.projectId}-${entry.item._id}`}
                  entry={entry}
                  currentUserId={currentUserId}
                  now={now}
                  onShareCalendar={
                    calendarFeed.isAvailable ? shareTeamCalendar : undefined
                  }
                  isSharingCalendar={sharingScheduleId === entry.item._id}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {covered.length > 0 && coverageFilter !== "uncovered" ? (
        <View testID="section-covered">
          <SectionHeader title="On call now" iconName="people-outline" />
          <View style={{ gap: 0, borderRadius: 16, overflow: "hidden" }}>
            {covered.map((entry: ProjectOnCallScheduleItem) => {
              return (
                <RosterScheduleCard
                  key={`${entry.projectId}-${entry.item._id}`}
                  entry={entry}
                  currentUserId={currentUserId}
                  now={now}
                  onShareCalendar={
                    calendarFeed.isAvailable ? shareTeamCalendar : undefined
                  }
                  isSharingCalendar={sharingScheduleId === entry.item._id}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {(
        coverageFilter === "uncovered"
          ? uncovered.length === 0
          : coverageFilter === "covered"
            ? covered.length === 0
            : uncovered.length === 0 && covered.length === 0
      ) ? (
        <View
          style={{
            borderRadius: 16,
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
            {searchTerm.trim()
              ? "No schedules match that search."
              : coverageFilter === "uncovered"
                ? "No coverage gaps. Every schedule has someone on call."
                : "No schedules are covered right now."}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
