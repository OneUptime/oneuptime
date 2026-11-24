import React, { useState } from "react";
import { View, ScrollView, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useContentGutters } from "../layout/WindowLayoutProvider";
import type { ContentGutters } from "../layout/windowLayout";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallOverrides } from "../hooks/useOnCallOverrides";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useNow } from "../hooks/useNow";
import OverrideCard from "../components/OverrideCard";
import SectionHeader from "../components/SectionHeader";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import GradientButton from "../components/GradientButton";
import AppText from "../components/AppText";
import Card from "../components/Card";
import IconBadge from "../components/IconBadge";
import { getFriendlyErrorMessage } from "../utils/error";
import { describeEndNow, type EndNowQuestion } from "../oncall/overrideEndNow";
import { useSelectedProjectId } from "../hooks/useProject";
import {
  useOverrideTeamLimits,
  type OverrideTeamLimitOf,
} from "../hooks/useOverrideTeamLimits";
import {
  useOverrideTeamPeople,
  type OverrideTeamPeopleState,
} from "../hooks/useOverrideTeamPeople";
import {
  getMemberIdsOfTeams,
  getOverrideTeamLock,
  type OverrideTeamLimit,
} from "../oncall/overrideTeamAccess";
import type { OnCallStackParamList } from "../navigation/types";
import type { OnCallOverrideItem } from "../api/types";

type OverridesNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "OnCallOverrides"
>;

/*
 * Every cover arrangement, split by whether it is doing anything right now.
 *
 * Cancelling is confirmed rather than immediate: an override is the only thing
 * standing between a colleague and a 3am page, and an accidental tap that
 * silently puts it back on them is not a mistake they can see happening.
 *
 * Each one that has not ended has Edit (#7897): who covers, and its times
 * as far as they may still change, held to the dashboard's rules. One under
 * way has End now - coming back early - asked first like Cancel; Cancel
 * calls off one that has not started.
 *
 * For someone who manages the user overrides of their own teams' people
 * only, one that names anybody else says why in place of those (#9883).
 */
export default function OnCallOverridesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const { lightImpact, successFeedback, errorFeedback } = useHaptics();
  const navigation: OverridesNavProp = useNavigation<OverridesNavProp>();
  const now: number = useNow();
  const currentUserId: string | null = useCurrentUserId();

  const overrides: ReturnType<typeof useOnCallOverrides> =
    useOnCallOverrides(now);

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);

  /*
   * For someone who manages the user overrides of their own teams' people
   * only (Manage On-Call Policy User Overrides for Own Team, issue #9883):
   * the server refuses any change to an override that names anybody outside
   * those teams, so its card says why in place of Edit, End now and Cancel
   * (oncall/overrideTeamAccess). An edit and a delete, of a global override
   * and of a policy's, may each be reached by different grants. Until the
   * teams' members are known nothing is locked: the server decides.
   */
  const projectId: string | null = useSelectedProjectId();
  const teamLimitOf: OverrideTeamLimitOf = useOverrideTeamLimits(projectId);
  const teamLimits: Record<
    "update" | "delete",
    { global: OverrideTeamLimit | null; policy: OverrideTeamLimit | null }
  > = {
    update: {
      global: teamLimitOf("update", true),
      policy: teamLimitOf("update", false),
    },
    delete: {
      global: teamLimitOf("delete", true),
      policy: teamLimitOf("delete", false),
    },
  };
  const limitedTeamIds: Array<string> = Array.from(
    new Set<string>(
      [
        teamLimits.update.global,
        teamLimits.update.policy,
        teamLimits.delete.global,
        teamLimits.delete.policy,
      ].flatMap((limit: OverrideTeamLimit | null): Array<string> => {
        return limit ? limit.teamIds : [];
      }),
    ),
  ).sort();
  const isTeamLimited: boolean = [
    teamLimits.update.global,
    teamLimits.update.policy,
    teamLimits.delete.global,
    teamLimits.delete.policy,
  ].some((limit: OverrideTeamLimit | null): boolean => {
    return Boolean(limit);
  });
  const hasChangeableOverrides: boolean =
    overrides.active.length > 0 || overrides.upcoming.length > 0;
  const teamPeople: OverrideTeamPeopleState = useOverrideTeamPeople({
    projectId,
    teamIds: isTeamLimited && hasChangeableOverrides ? limitedTeamIds : null,
  });

  // Why an edit (Edit, End now) or the delete (Cancel) of `override` is locked, or null.
  const getTeamLock: (
    override: OnCallOverrideItem,
    action: "update" | "delete",
  ) => string | null = (
    override: OnCallOverrideItem,
    action: "update" | "delete",
  ): string | null => {
    if (
      !projectId ||
      override.projectId.toLowerCase() !== projectId.toLowerCase()
    ) {
      return null;
    }

    const limit: OverrideTeamLimit | null =
      override.onCallDutyPolicyId || override.onCallDutyPolicy?._id
        ? teamLimits[action].policy
        : teamLimits[action].global;

    return getOverrideTeamLock({
      action: action,
      limit: limit,
      memberIds: limit
        ? getMemberIdsOfTeams(teamPeople.membersByTeam, limit.teamIds)
        : null,
      people: {
        awayUserId: override.overrideUser?._id,
        coverUserId: override.routeAlertsToUser?._id,
      },
    });
  };

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    await overrides.refetch();
  });

  const performCancel: (override: OnCallOverrideItem) => Promise<void> = async (
    override: OnCallOverrideItem,
  ): Promise<void> => {
    setCancellingId(override._id);

    try {
      await overrides.cancelOverride(override);
      successFeedback();
    } catch (err: unknown) {
      errorFeedback();
      Alert.alert("Could not cancel override", getFriendlyErrorMessage(err));
    } finally {
      setCancellingId(null);
    }
  };

  const confirmCancel: (override: OnCallOverrideItem) => void = (
    override: OnCallOverrideItem,
  ): void => {
    Alert.alert(
      "Cancel this override?",
      "Pages will go back to whoever the schedule says is on call.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel override",
          style: "destructive",
          onPress: () => {
            performCancel(override);
          },
        },
      ],
    );
  };

  const performEndNow: (override: OnCallOverrideItem) => Promise<void> = async (
    override: OnCallOverrideItem,
  ): Promise<void> => {
    setEndingId(override._id);

    try {
      await overrides.endOverrideNow(override);
      successFeedback();
    } catch (err: unknown) {
      errorFeedback();
      Alert.alert("Could not end override", getFriendlyErrorMessage(err));
    } finally {
      setEndingId(null);
    }
  };

  /*
   * End now (#7897): one question first, as on the dashboard, saying what
   * happens to the time left and who is paged from then on.
   */
  const confirmEndNow: (override: OnCallOverrideItem) => void = (
    override: OnCallOverrideItem,
  ): void => {
    const question: EndNowQuestion = describeEndNow(
      override,
      currentUserId,
      Date.now(),
    );

    Alert.alert(question.title, question.message, [
      { text: "Keep it", style: "cancel" },
      {
        text: "End now",
        style: "destructive",
        onPress: () => {
          performEndNow(override);
        },
      },
    ]);
  };

  const openEdit: (override: OnCallOverrideItem) => void = (
    override: OnCallOverrideItem,
  ): void => {
    lightImpact();
    navigation.navigate("EditOnCallOverride", { override });
  };

  const intro: React.JSX.Element = (
    <ScreenIntro
      title="Coverage"
      description="Know who is covering, and make the next handoff simple."
    />
  );

  if (overrides.isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: spacing.xl,
            ...gutters,
            paddingBottom: bottomPadding,
          }}
        >
          {intro}
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (overrides.isError) {
    return (
      <ScrollView
        testID="overrides-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          ...gutters,
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
          title="Could not load overrides"
          subtitle="Pull to refresh or try again."
          icon="error"
          actionLabel="Retry"
          onAction={onRefresh}
        />
      </ScrollView>
    );
  }

  const hasAny: boolean =
    overrides.active.length > 0 ||
    overrides.upcoming.length > 0 ||
    overrides.past.length > 0;

  const renderSection: (
    title: string,
    iconName: keyof typeof Ionicons.glyphMap,
    items: OnCallOverrideItem[],
    state: "active" | "upcoming" | "past",
  ) => React.JSX.Element | null = (
    title: string,
    iconName: keyof typeof Ionicons.glyphMap,
    items: OnCallOverrideItem[],
    state: "active" | "upcoming" | "past",
  ): React.JSX.Element | null => {
    if (items.length === 0) {
      return null;
    }

    return (
      <View
        testID={`overrides-section-${state}`}
        style={{ marginTop: spacing.xxl }}
      >
        <SectionHeader title={title} iconName={iconName} count={items.length} />
        <View style={{ gap: spacing.md }}>
          {items.map((override: OnCallOverrideItem) => {
            return (
              <OverrideCard
                key={override._id}
                override={override}
                state={state}
                currentUserId={currentUserId}
                now={now}
                /*
                 * One under way is ended with End now, which keeps its
                 * record; one to come is called off with Cancel. Neither,
                 * nor Edit, for one that has ended.
                 */
                onCancel={state === "upcoming" ? confirmCancel : undefined}
                isCancelling={cancellingId === override._id}
                onEdit={state === "past" ? undefined : openEdit}
                onEndNow={state === "active" ? confirmEndNow : undefined}
                isEnding={endingId === override._id}
                editLockedReason={
                  state === "past" ? null : getTeamLock(override, "update")
                }
                cancelLockedReason={
                  state === "upcoming" ? getTeamLock(override, "delete") : null
                }
              />
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      testID="overrides-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        ...gutters,
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
      {hasAny ? (
        <View
          testID="coverage-counts"
          style={{
            flexDirection: "row",
            gap: spacing.md,
            marginBottom: spacing.lg,
          }}
        >
          <StatTile
            testID="coverage-count-active"
            iconName="shield-checkmark-outline"
            color={theme.colors.oncallActive}
            value={overrides.active.length}
            label="Active now"
          />
          <StatTile
            testID="coverage-count-upcoming"
            iconName="calendar-outline"
            color={theme.colors.statusInfo}
            value={overrides.upcoming.length}
            label="Scheduled"
          />
        </View>
      ) : null}
      <GradientButton
        testID="new-override"
        label="Arrange coverage"
        icon="add-outline"
        onPress={() => {
          lightImpact();
          navigation.navigate("CreateOnCallOverride");
        }}
      />

      {!hasAny ? (
        <Card
          testID="overrides-empty"
          variant="outlined"
          style={{ marginTop: spacing.xxl }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.md,
            }}
          >
            <IconBadge
              name="swap-horizontal-outline"
              color={theme.colors.actionPrimary}
            />
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <AppText variant="headline">No overrides yet</AppText>
              <AppText variant="subhead" tone="secondary">
                Create one when you need somebody else to take your pages, or
                when you are covering for a teammate.
              </AppText>
            </View>
          </View>
        </Card>
      ) : null}

      {renderSection(
        "In effect now",
        "radio-button-on-outline",
        overrides.active,
        "active",
      )}
      {renderSection(
        "Scheduled",
        "calendar-outline",
        overrides.upcoming,
        "upcoming",
      )}
      {renderSection("Ended", "time-outline", overrides.past, "past")}
    </ScrollView>
  );
}

function StatTile({
  iconName,
  color,
  value,
  label,
  testID,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  color: string;
  value: number;
  label: string;
  testID: string;
}): React.JSX.Element {
  return (
    <Card
      testID={testID}
      accessibilityLabel={`${value} ${label.toLowerCase()}`}
      style={{ flex: 1, gap: spacing.sm }}
    >
      <IconBadge name={iconName} color={color} size="sm" />
      <View>
        <AppText variant="title" style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </AppText>
        <AppText variant="footnote" tone="secondary">
          {label}
        </AppText>
      </View>
    </Card>
  );
}
