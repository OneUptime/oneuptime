import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { formatShiftTime, formatTimeUntil } from "../utils/duration";
import type { OnCallUserRef, ProjectOnCallScheduleItem } from "../api/types";

interface RosterScheduleCardProps {
  entry: ProjectOnCallScheduleItem;
  currentUserId: string | null;
  now: number;
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
        borderRadius: 18,
        padding: 16,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "600",
              color: theme.colors.textPrimary,
            }}
            numberOfLines={1}
          >
            {schedule.name}
          </Text>
          <Text
            style={{
              fontSize: 12,
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
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 0.5,
                color: theme.colors.oncallActive,
              }}
            >
              YOU
            </Text>
          </View>
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
            width: 34,
            height: 34,
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
              fontSize: 11,
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
              fontSize: 14,
              fontWeight: "600",
              marginTop: 2,
              color: isCovered ? theme.colors.textPrimary : accent,
            }}
            numberOfLines={1}
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
                fontSize: 11,
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
                fontSize: 13,
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
              fontSize: 12,
              marginLeft: 6,
              flex: 1,
              color: theme.colors.textSecondary,
            }}
            numberOfLines={1}
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
