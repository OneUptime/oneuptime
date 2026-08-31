import React from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
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
import EmptyState from "../components/EmptyState";
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

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await Promise.all([
      duty.refetch(),
      overrides.refetch(),
      myShifts.refetch(),
    ]);
  };

  if (duty.isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
        >
          <SkeletonCard lines={4} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (duty.isError) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="Could not load your on-call status"
          subtitle="Pull to refresh or try again."
          icon="alerts"
          actionLabel="Retry"
          onAction={() => {
            return duty.refetch();
          }}
        />
      </View>
    );
  }

  const allShifts: OnCallShift[] = [
    ...duty.summary.activeShifts,
    ...duty.summary.upcomingShifts,
  ];

  return (
    <ScrollView
      testID="oncall-overview-scroll"
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
      <OnCallStatusCard summary={duty.summary} now={now} />

      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <QuickActionTile
          testID="quick-action-cover"
          label="Cover for me"
          sublabel="Route my pages to a teammate"
          iconName="swap-horizontal-outline"
          accentColor={theme.colors.severityInfo}
          onPress={() => {
            navigation.navigate("CreateOnCallOverride");
          }}
        />
        <QuickActionTile
          testID="quick-action-roster"
          label="Who's on call"
          sublabel="Every schedule, right now"
          iconName="people-outline"
          accentColor={theme.colors.oncallActive}
          onPress={() => {
            navigation.navigate("WhoIsOnCall");
          }}
        />
      </View>

      {activeOverrideCount > 0 ? (
        <Pressable
          testID="active-override-banner"
          accessibilityRole="button"
          accessibilityLabel={`${activeOverrideCount} override${
            activeOverrideCount === 1 ? "" : "s"
          } in effect. Tap to review.`}
          onPress={() => {
            lightImpact();
            navigation.navigate("OnCallOverrides");
          }}
          style={{ marginTop: 16 }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 14,
              borderRadius: 16,
              backgroundColor: theme.colors.severityInfoBg,
              borderWidth: 1,
              borderColor: theme.colors.severityInfo + "33",
            }}
          >
            <Ionicons
              name="swap-horizontal"
              size={16}
              color={theme.colors.severityInfo}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: "600",
                marginLeft: 10,
                color: theme.colors.severityInfo,
              }}
              numberOfLines={2}
            >
              {activeOverrideCount === 1
                ? "1 override is in effect right now"
                : `${activeOverrideCount} overrides are in effect right now`}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={theme.colors.severityInfo}
            />
          </View>
        </Pressable>
      ) : null}

      <View style={{ marginTop: 28 }}>
        <SectionHeader title="Your shifts" iconName="calendar-outline" />

        {useServerShifts ? (
          <View testID="my-shifts-list" style={{ gap: 12 }}>
            {shiftGroups.map((group: ShiftDayGroup) => {
              return (
                <View key={group.key} testID={`shift-day-${group.key}`}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      marginBottom: 8,
                      marginLeft: 4,
                      color: theme.colors.textTertiary,
                    }}
                  >
                    {group.label}
                  </Text>
                  <View style={{ gap: 12 }}>
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
              <Text
                testID="my-shifts-truncated"
                style={{
                  fontSize: 12,
                  marginLeft: 4,
                  color: theme.colors.textTertiary,
                }}
              >
                The server could not expand every schedule; some shifts may be
                missing from this list.
              </Text>
            ) : null}
          </View>
        ) : allShifts.length === 0 ? (
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
              You are not on the roster of any on-call schedule right now, and
              none of them has you queued up next.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
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
        <View style={{ marginTop: 28 }}>
          <SectionHeader
            title="Standing assignments"
            iconName="person-outline"
          />
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
              {duty.summary.standingAssignmentCount === 1
                ? "1 escalation rule pages you directly, with no shift window. You are reachable through it at any time."
                : `${duty.summary.standingAssignmentCount} escalation rules page you directly, with no shift window. You are reachable through them at any time.`}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: 28, gap: 12 }}>
        <SectionHeader title="More" iconName="ellipsis-horizontal" />

        <NavigationRow
          testID="row-policies"
          iconName="git-branch-outline"
          title="My on-call policies"
          subtitle={`${
            duty.summary.standingAssignmentCount +
            duty.summary.scheduleAssignmentCount
          } active ${
            duty.summary.standingAssignmentCount +
              duty.summary.scheduleAssignmentCount ===
            1
              ? "assignment"
              : "assignments"
          }`}
          onPress={() => {
            navigation.navigate("OnCallList");
          }}
        />

        <NavigationRow
          testID="row-overrides"
          iconName="swap-horizontal-outline"
          title="Overrides"
          subtitle="Cover arrangements across your projects"
          onPress={() => {
            navigation.navigate("OnCallOverrides");
          }}
        />

        <NavigationRow
          testID="row-pages"
          iconName="notifications-outline"
          title="Pages sent to me"
          subtitle="Every notification, and whether it was acknowledged"
          onPress={() => {
            navigation.navigate("MyOnCallPages");
          }}
        />

        {calendarFeed.isAvailable ? (
          <NavigationRow
            testID="row-calendar"
            iconName="calendar-outline"
            title="Add shifts to my calendar"
            subtitle="Subscribe from Google, Outlook or Apple Calendar"
            onPress={() => {
              navigation.navigate("OnCallCalendarFeed");
            }}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function NavigationRow({
  iconName,
  title,
  subtitle,
  onPress,
  testID,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => {
        lightImpact();
        onPress();
      }}
      style={({ pressed }: { pressed: boolean }) => {
        return { opacity: pressed ? 0.8 : 1 };
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          borderRadius: 18,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
            backgroundColor: theme.colors.iconBackground,
          }}
        >
          <Ionicons
            name={iconName}
            size={15}
            color={theme.colors.actionPrimary}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.textPrimary,
            }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            style={{
              fontSize: 12,
              marginTop: 2,
              color: theme.colors.textTertiary,
            }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>

        <Ionicons
          name="chevron-forward"
          size={14}
          color={theme.colors.textTertiary}
        />
      </View>
    </Pressable>
  );
}
