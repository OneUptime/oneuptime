import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { formatShiftTime, formatTimeUntil } from "../utils/duration";
import type { OnCallUserRef, ProjectOnCallScheduleItem } from "../api/types";

interface RosterScheduleCardProps {
  entry: ProjectOnCallScheduleItem;
  currentUserId: string | null;
  now: number;

  /*
   * When given, the card offers "Share team calendar link" - the shared feed
   * an editor published for this schedule, handed to a colleague through the
   * share sheet. Absent on servers that predate calendar feeds.
   */
  onShareCalendar?: (entry: ProjectOnCallScheduleItem) => void;
  isSharingCalendar?: boolean;
}

export function displayNameForUser(user: OnCallUserRef | null): string {
  if (!user) {
    return "Nobody";
  }

  return user.name || user.email || "Unnamed user";
}

/*
 * Who is carrying this schedule's phone, and who takes it next.
 *
 * The uncovered case is called out rather than left blank. A schedule with no
 * current user pages nobody, and "—" in a table has never once made that land
 * with the person reading it at 2am.
 */
export default function RosterScheduleCard({
  entry,
  currentUserId,
  now,
  onShareCalendar,
  isSharingCalendar = false,
}: RosterScheduleCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const schedule: ProjectOnCallScheduleItem["item"] = entry.item;

  const isCovered: boolean = Boolean(schedule.currentUserOnRoster);

  const isMe: boolean = Boolean(
    currentUserId &&
      schedule.currentUserOnRoster &&
      schedule.currentUserOnRoster._id === currentUserId,
  );

  const accent: string = isCovered
    ? theme.colors.oncallActive
    : theme.colors.severityWarning;

  const accentBackground: string = isCovered
    ? theme.colors.oncallActiveBg
    : theme.colors.severityWarningBg;

  const handoffLabel: string | null = formatTimeUntil(
    schedule.rosterHandoffAt,
    now,
  );

  const nextStartLabel: string | null = formatShiftTime(
    schedule.rosterNextStartAt,
    now,
  );

  return (
    <View
      testID={`roster-card-${schedule._id}`}
      style={{
        borderRadius: 16,
        padding: 18,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: isCovered
          ? theme.colors.borderSubtle
          : theme.colors.severityWarning + "66",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: theme.colors.textPrimary,
            }}
            numberOfLines={2}
          >
            {schedule.name}
          </Text>
          <Text
            style={{
              fontSize: 14,
              marginTop: 2,
              color: theme.colors.textTertiary,
            }}
            numberOfLines={1}
          >
            {entry.projectName}
          </Text>
        </View>

        {isMe ? (
          <View
            style={{
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 9999,
              backgroundColor: theme.colors.oncallActiveBg,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 0.5,
                color: theme.colors.oncallActive,
              }}
            >
              YOU
            </Text>
          </View>
        ) : null}

        {onShareCalendar ? (
          <Pressable
            testID={`roster-share-${schedule._id}`}
            accessibilityRole="button"
            accessibilityLabel={`Share team calendar link for ${schedule.name}`}
            disabled={isSharingCalendar}
            accessibilityState={{
              disabled: isSharingCalendar,
              busy: isSharingCalendar,
            }}
            onPress={() => {
              onShareCalendar(entry);
            }}
            hitSlop={8}
            style={({ pressed }: { pressed: boolean }) => {
              return {
                width: 48,
                height: 48,
                borderRadius: 14,
                marginLeft: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.iconBackground,
                opacity: pressed || isSharingCalendar ? 0.6 : 1,
              };
            }}
          >
            {isSharingCalendar ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.actionPrimary}
              />
            ) : (
              <Ionicons
                name="share-outline"
                size={20}
                color={theme.colors.actionPrimary}
              />
            )}
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: theme.colors.borderSubtle,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 10,
            backgroundColor: accentBackground,
          }}
        >
          <Ionicons
            name={isCovered ? "person" : "person-remove-outline"}
            size={15}
            color={accent}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: theme.colors.textTertiary,
            }}
          >
            On call now
          </Text>
          <Text
            style={{
              fontSize: 17,
              fontWeight: "600",
              marginTop: 2,
              color: isCovered ? theme.colors.textPrimary : accent,
            }}
            numberOfLines={2}
          >
            {isCovered
              ? displayNameForUser(schedule.currentUserOnRoster)
              : "Nobody on call"}
          </Text>
        </View>

        {handoffLabel ? (
          <View style={{ alignItems: "flex-end", marginLeft: 10 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: theme.colors.textTertiary,
              }}
            >
              Handoff
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                marginTop: 2,
                color: theme.colors.textSecondary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {handoffLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {schedule.nextUserOnRoster ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <Ionicons
            name="arrow-forward-circle-outline"
            size={13}
            color={theme.colors.textTertiary}
          />
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              marginLeft: 6,
              flex: 1,
              color: theme.colors.textSecondary,
            }}
          >
            {`Next: ${displayNameForUser(schedule.nextUserOnRoster)}${
              nextStartLabel ? ` · ${nextStartLabel}` : ""
            }`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
