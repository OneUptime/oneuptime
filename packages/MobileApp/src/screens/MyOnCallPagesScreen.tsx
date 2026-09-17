import React, { useMemo, useState } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useMyOnCallPages } from "../hooks/useMyOnCallPages";
import OnCallPageCard, {
  getPageSubject,
  type PageSubject,
} from "../components/OnCallPageCard";
import SegmentedControl from "../components/SegmentedControl";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import Banner from "../components/Banner";
import Card from "../components/Card";
import type { OnCallPageItem } from "../api/types";
import type {
  MainTabParamList,
  OnCallStackParamList,
} from "../navigation/types";
import { buildInboxDetailNavigation } from "../navigation/inboxNavigation";

type MyPagesNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "MyOnCallPages"
>;

type TabNavProp = BottomTabNavigationProp<MainTabParamList>;

type PageFilter = "all" | "unacknowledged";

/*
 * "Did that page reach me, and did anyone answer it?"
 *
 * The unacknowledged filter is the reason this screen exists. A responder
 * coming back to their phone after a bad night wants the shortlist, not the
 * feed - and the same list, filtered, is how a team spots pages that were
 * delivered to somebody who was never going to see them.
 */
export default function MyOnCallPagesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const { lightImpact, selectionFeedback } = useHaptics();
  const navigation: MyPagesNavProp = useNavigation<MyPagesNavProp>();

  const { pages, isLoading, isError, refetch } = useMyOnCallPages();
  const [filter, setFilter] = useState<PageFilter>("all");

  const visiblePages: OnCallPageItem[] = useMemo(() => {
    if (filter === "all") {
      return pages;
    }

    return pages.filter((page: OnCallPageItem) => {
      return !page.acknowledgedAt;
    });
  }, [pages, filter]);

  const unacknowledgedCount: number = useMemo(() => {
    return pages.filter((page: OnCallPageItem) => {
      return !page.acknowledgedAt;
    }).length;
  }, [pages]);

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    await refetch();
  });

  /*
   * The incident and alert detail screens live in sibling tabs, so the jump
   * goes through the tab navigator. Without the parent hop this silently does
   * nothing - the route names are not on this stack. Keep the sibling stack's
   * initial inbox route so Back also works when this is its first visit.
   */
  const openPage: (page: OnCallPageItem) => void = (
    page: OnCallPageItem,
  ): void => {
    const subject: PageSubject = getPageSubject(page);

    if (!subject.id) {
      return;
    }

    lightImpact();

    const parent: TabNavProp | undefined = navigation.getParent<TabNavProp>();

    if (!parent) {
      return;
    }

    if (subject.kind === "incident") {
      parent.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "IncidentDetail",
          params: { incidentId: subject.id, projectId: page.projectId },
        }) as never,
      );
      return;
    }

    if (subject.kind === "incident-episode") {
      parent.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "IncidentEpisodeDetail",
          params: { episodeId: subject.id, projectId: page.projectId },
        }) as never,
      );
      return;
    }

    if (subject.kind === "alert") {
      parent.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "AlertDetail",
          params: { alertId: subject.id, projectId: page.projectId },
        }) as never,
      );
      return;
    }

    if (subject.kind === "alert-episode") {
      parent.navigate(
        "Inbox",
        buildInboxDetailNavigation({
          name: "AlertEpisodeDetail",
          params: { episodeId: subject.id, projectId: page.projectId },
        }) as never,
      );
    }
  };

  const intro: React.JSX.Element = (
    <ScreenIntro
      title="My pages"
      description="Your response history, all in one place."
    />
  );

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: spacing.xl,
            paddingBottom: bottomPadding,
          }}
        >
          {intro}
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (isError || pages.length === 0) {
    return (
      <ScrollView
        testID="my-pages-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        {intro}
        <EmptyState
          title={isError ? "Could not load your pages" : "No pages yet"}
          subtitle={
            isError
              ? "Pull to refresh or try again."
              : "On-call notifications sent to you will show up here. Pull to refresh for new pages."
          }
          icon={isError ? "error" : "alerts"}
          actionLabel={isError ? "Retry" : "Refresh"}
          onAction={onRefresh}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      testID="my-pages-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {intro}
      <Banner
        testID="pages-summary"
        tone={unacknowledgedCount > 0 ? "warning" : "success"}
        icon={unacknowledgedCount > 0 ? "alert-circle" : "checkmark-circle"}
        title={
          unacknowledgedCount === 0
            ? "All listed pages acknowledged"
            : `${unacknowledgedCount} ${unacknowledgedCount === 1 ? "page needs" : "pages need"} a response`
        }
        message={
          unacknowledgedCount === 0
            ? "You can review your notification history below."
            : "Use the unacknowledged filter to focus on pages that have not been answered."
        }
        style={{ marginBottom: spacing.lg }}
      />
      <SegmentedControl<PageFilter>
        style={{ marginHorizontal: 0, marginTop: 0, marginBottom: 0 }}
        segments={[
          { key: "all", label: `All (${pages.length})` },
          {
            key: "unacknowledged",
            label: `Unacknowledged (${unacknowledgedCount})`,
          },
        ]}
        selected={filter}
        onSelect={(key: PageFilter) => {
          selectionFeedback();
          setFilter(key);
        }}
      />

      <View
        testID="pages-list"
        style={{ marginTop: spacing.xl, gap: spacing.md }}
      >
        {visiblePages.length === 0 ? (
          <Card testID="pages-filter-empty" variant="outlined">
            <EmptyState
              compact
              icon="success"
              title="All caught up"
              subtitle="Every page in this list has been acknowledged."
            />
          </Card>
        ) : (
          visiblePages.map((page: OnCallPageItem) => {
            return (
              <OnCallPageCard key={page._id} page={page} onPress={openPage} />
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
