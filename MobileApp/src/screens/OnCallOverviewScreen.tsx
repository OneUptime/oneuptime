import React from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallDuty } from "../hooks/useOnCallDuty";
import { useOnCallOverrides } from "../hooks/useOnCallOverrides";
import { useMyShifts } from "../hooks/useMyShifts";
import { useOnCallCalendarFeedAvailability } from "../hooks/useOnCallCalendarFeedAvailability";
import { useNow } from "../hooks/useNow";
import OnCallStatusCard from "../components/OnCallStatusCard";
import ShiftCard from "../components/ShiftCard";
import MyShiftCard from "../components/MyShiftCard";
import QuickActionTile from "../components/QuickActionTile";
import SectionHeader from "../components/SectionHeader";
import SkeletonCard from "../components/SkeletonCard";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import IconBadge from "../components/IconBadge";
import { ListGroup, ListItem } from "../components/ListGroup";
import {
  buildCoverParams,
  groupShiftsByDay,
  type ShiftDayGroup,
} from "../oncall/shiftGroups";
import type { OnCallStackParamList } from "../navigation/types";
import type { MyOnCallShift, OnCallShift } from "../api/types";

type OnCallNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "OnCallOverview"
>;

const SCREEN_TITLE: string = "On call";
const SCREEN_DESCRIPTION: string = "Your duty, coverage and upcoming shifts.";

/*
 * The on-call tab.
 *
 * It is ordered by urgency, not by data model: duty status first (with a live
 * countdown), then the two actions somebody actually takes from a handset,
 * then the shifts behind the countdown, then the standing assignments that
 * have no shift at all. The policy list - which used to be the whole screen -
 * is now one row at the bottom, because "which escalation rule names me" is a
 * configuration question and this is not a configuration screen.
 */
export default function OnCallOverviewScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const { lightImpact } = useHaptics();
  const navigation: OnCallNavProp = useNavigation<OnCallNavProp>();
  const now: number = useNow();

  const duty: ReturnType<typeof useOnCallDuty> = useOnCallDuty();
  const overrides: ReturnType<typeof useOnCallOverrides> =
    useOnCallOverrides(now);
  const myShifts: ReturnType<typeof useMyShifts> = useMyShifts({ now });
  const calendarFeed: ReturnType<typeof useOnCallCalendarFeedAvailability> =
    useOnCallCalendarFeedAvailability();

  const activeOverrideCount: number = overrides.active.length;

  /*
   * The server's materialized shifts win whenever it produced any. When it
   * could not answer (an older server, the render cap, an outage) OR it
   * answered with nothing, the roster-derived list stays: the roster looks
   * further ahead than the fortnight asked for here, so an empty fortnight
   * can still have a "next up" on it worth showing.
   */
  const useServerShifts: boolean =
    myShifts.isSuccess && myShifts.shifts.length > 0;

  const shiftGroups: ShiftDayGroup[] = useServerShifts
    ? groupShiftsByDay(myShifts.shifts, now)
    : [];

  const requestCover: (shift: MyOnCallShift) => void = (
    shift: MyOnCallShift,
  ): void => {
    navigation.navigate("CreateOnCallOverride", buildCoverParams(shift));
  };

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    await Promise.allSettled([
      duty.refetch(),
      overrides.refetch(),
      myShifts.refetch(),
    ]);
  });

  const contentContainerStyle: {
    padding: number;
    paddingBottom: number;
    gap: number;
  } = {
    padding: spacing.xl,
    paddingBottom: bottomPadding,
    gap: spacing.lg,
  };

  if (duty.isLoading) {
    /*
     * The hero is shown in its "checking" state rather than skipped, so the
     * layout does not jump - and it says nothing about duty until it knows.
     */
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={contentContainerStyle}
        >
          <ScreenIntro
            title={SCREEN_TITLE}
            description={SCREEN_DESCRIPTION}
            style={{ marginBottom: spacing.xs }}
          />
          <OnCallStatusCard summary={duty.summary} now={now} isLoading />
          <View>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={3} />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (duty.isError) {
    return (
      <ScrollView
        testID="oncall-overview-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{ ...contentContainerStyle, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        <ScreenIntro
          title={SCREEN_TITLE}
          description={SCREEN_DESCRIPTION}
          style={{ marginBottom: spacing.xs }}
        />
        <OnCallStatusCard
          summary={duty.summary}
          now={now}
          isError
          onRetry={onRefresh}
        />
      </ScrollView>
    );
  }

  const allShifts: OnCallShift[] = [
    ...duty.summary.activeShifts,
    ...duty.summary.upcomingShifts,
  ];
  const shiftCount: number = useServerShifts
    ? myShifts.shifts.length
    : allShifts.length;
  const policyAssignmentCount: number =
    duty.summary.standingAssignmentCount + duty.summary.scheduleAssignmentCount;

  return (
    <ScrollView
      testID="oncall-overview-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ScreenIntro
        title={SCREEN_TITLE}
        description={SCREEN_DESCRIPTION}
        style={{ marginBottom: spacing.xs }}
      />
      <OnCallStatusCard summary={duty.summary} now={now} />

      {activeOverrideCount > 0 ? (
        <Banner
          testID="active-override-banner"
          tone="info"
          icon="swap-horizontal"
          accessibilityLabel={`${activeOverrideCount} override${
            activeOverrideCount === 1 ? "" : "s"
          } in effect. Tap to review.`}
          message={
            activeOverrideCount === 1
              ? "1 override is in effect right now"
              : `${activeOverrideCount} overrides are in effect right now`
          }
          onPress={() => {
            lightImpact();
            navigation.navigate("OnCallOverrides");
          }}
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <QuickActionTile
          testID="quick-action-cover"
          label="Cover for me"
          sublabel="Arrange a handoff"
          iconName="swap-horizontal-outline"
          accentColor={theme.colors.actionPrimary}
          onPress={() => {
            navigation.navigate("CreateOnCallOverride");
          }}
        />
        <QuickActionTile
          testID="quick-action-roster"
          label="Who's on call"
          sublabel="See the team roster"
          iconName="people-outline"
          accentColor={theme.colors.oncallActive}
          onPress={() => {
            navigation.navigate("WhoIsOnCall");
          }}
        />
      </View>

      <ListGroup testID="pages-group">
        <ListItem
          testID="row-pages"
          icon="notifications-outline"
          title="Pages sent to me"
          subtitle="Your recent response requests"
          onPress={() => {
            lightImpact();
            navigation.navigate("MyOnCallPages");
          }}
        />
      </ListGroup>

      <View style={{ marginTop: spacing.md }}>
        <SectionHeader
          title="Your shifts"
          iconName="calendar-outline"
          count={shiftCount > 0 ? shiftCount : undefined}
        />

        {useServerShifts ? (
          <View testID="my-shifts-list" style={{ gap: spacing.lg }}>
            {shiftGroups.map((group: ShiftDayGroup) => {
              return (
                <View
                  key={group.key}
                  testID={`shift-day-${group.key}`}
                  style={{ gap: spacing.sm }}
                >
                  <AppText
                    variant="overline"
                    tone="secondary"
                    accessibilityRole="header"
                    style={{ marginLeft: spacing.xs }}
                  >
                    {group.label}
                  </AppText>
                  <View style={{ gap: spacing.md }}>
                    {group.shifts.map((shift: MyOnCallShift) => {
                      return (
                        <MyShiftCard
                          key={shift.shiftKey}
                          shift={shift}
                          now={now}
                          onRequestCover={requestCover}
                        />
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {myShifts.truncated ? (
              <Banner
                testID="my-shifts-truncated"
                tone="warning"
                message="The server could not expand every schedule; some shifts may be missing from this list."
              />
            ) : null}
          </View>
        ) : allShifts.length === 0 ? (
          <Card testID="no-shifts-card" variant="outlined">
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.md,
              }}
            >
              <IconBadge
                name="calendar-clear-outline"
                color={theme.colors.textSecondary}
              />
              <View style={{ flex: 1, gap: spacing.xxs }}>
                <AppText variant="headline">Nothing scheduled</AppText>
                <AppText variant="subhead" tone="secondary">
                  No current or upcoming roster shifts. Standing assignments, if
                  any, are shown below.
                </AppText>
              </View>
            </View>
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            {allShifts.map((shift: OnCallShift) => {
              return (
                <ShiftCard
                  key={`${shift.scheduleId}-${shift.status}`}
                  shift={shift}
                  now={now}
                />
              );
            })}
          </View>
        )}
      </View>

      {duty.summary.standingAssignmentCount > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <SectionHeader
            title="Standing assignments"
            iconName="person-outline"
            count={duty.summary.standingAssignmentCount}
          />
          <Card testID="standing-assignments-card">
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.md,
              }}
            >
              <IconBadge
                name="git-branch-outline"
                color={theme.colors.actionPrimary}
              />
              <AppText variant="subhead" tone="secondary" style={{ flex: 1 }}>
                {duty.summary.standingAssignmentCount === 1
                  ? "1 escalation rule pages you directly, with no shift window. You are reachable through it at any time."
                  : `${duty.summary.standingAssignmentCount} escalation rules page you directly, with no shift window. You are reachable through them at any time.`}
              </AppText>
            </View>
          </Card>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <SectionHeader title="Manage on-call" iconName="options-outline" />
        <ListGroup testID="manage-oncall-group">
          <ListItem
            testID="row-policies"
            icon="git-branch-outline"
            title="My on-call policies"
            subtitle={`${policyAssignmentCount} active ${
              policyAssignmentCount === 1 ? "assignment" : "assignments"
            }`}
            onPress={() => {
              lightImpact();
              navigation.navigate("OnCallList");
            }}
          />
          <ListItem
            testID="row-overrides"
            icon="swap-horizontal-outline"
            title="Coverage & overrides"
            subtitle="Review active, scheduled and past cover"
            onPress={() => {
              lightImpact();
              navigation.navigate("OnCallOverrides");
            }}
          />
          {calendarFeed.isAvailable ? (
            <ListItem
              testID="row-calendar"
              icon="calendar-outline"
              title="Add shifts to my calendar"
              subtitle="Subscribe from Google, Outlook or Apple Calendar"
              onPress={() => {
                lightImpact();
                navigation.navigate("OnCallCalendarFeed");
              }}
            />
          ) : null}
        </ListGroup>
      </View>
    </ScrollView>
  );
}
