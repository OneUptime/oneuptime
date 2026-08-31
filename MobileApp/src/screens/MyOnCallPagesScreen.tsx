import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import { useMyOnCallPages } from "../hooks/useMyOnCallPages";
import OnCallPageCard, {
  getPageSubject,
  type PageSubject,
} from "../components/OnCallPageCard";
import SegmentedControl from "../components/SegmentedControl";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { OnCallPageItem } from "../api/types";
import type {
  MainTabParamList,
  OnCallStackParamList,
} from "../navigation/types";

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

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await refetch();
  };

  /*
   * The incident and alert detail screens live in sibling tabs, so the jump
   * goes through the tab navigator. Without the parent hop this silently does
   * nothing - the route names are not on this stack.
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
      parent.navigate("Incidents", {
        screen: "IncidentDetail",
        params: { incidentId: subject.id, projectId: page.projectId },
      } as never);
      return;
    }

    if (subject.kind === "incident-episode") {
      parent.navigate("Incidents", {
        screen: "IncidentEpisodeDetail",
        params: { episodeId: subject.id, projectId: page.projectId },
      } as never);
      return;
    }

    if (subject.kind === "alert") {
      parent.navigate("Alerts", {
        screen: "AlertDetail",
        params: { alertId: subject.id, projectId: page.projectId },
      } as never);
      return;
    }

    if (subject.kind === "alert-episode") {
      parent.navigate("Alerts", {
        screen: "AlertEpisodeDetail",
        params: { episodeId: subject.id, projectId: page.projectId },
      } as never);
    }
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
          title="Could not load your pages"
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

  if (pages.length === 0) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="No pages yet"
          subtitle="On-call notifications sent to you will show up here."
          icon="alerts"
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}>
      <SegmentedControl<PageFilter>
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

      <ScrollView
        testID="my-pages-scroll"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: 56, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        {visiblePages.length === 0 ? (
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
                lineHeight: 20,
                color: theme.colors.textSecondary,
              }}
            >
              Every page sent to you has been acknowledged.
            </Text>
          </View>
        ) : (
          visiblePages.map((page: OnCallPageItem) => {
            return (
              <OnCallPageCard key={page._id} page={page} onPress={openPage} />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
