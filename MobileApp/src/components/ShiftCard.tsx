import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import {
  formatDuration,
  formatShiftWindow,
  millisecondsUntil,
} from "../utils/duration";
import type { OnCallShift } from "../api/types";

interface ShiftCardProps {
  shift: OnCallShift;
  now: number;
}

/*
 * One row of "when am I on this schedule".
 *
 * An active shift leads with time remaining, an upcoming one with time until
 * it starts - the same card, but the number in the badge is the number the
 * reader is actually asking for in each case.
 */
export default function ShiftCard({
  shift,
  now,
}: ShiftCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const isActive: boolean = shift.status === "active";

  const accent: string = isActive
    ? theme.colors.oncallActive
    : theme.colors.severityInfo;

  const accentBackground: string = isActive
    ? theme.colors.oncallActiveBg
    : theme.colors.severityInfoBg;

  const remaining: number | null = millisecondsUntil(
    isActive ? shift.endsAt : shift.startsAt,
    now,
  );

  const badgeText: string =
    remaining === null
      ? isActive
        ? "On now"
        : "Scheduled"
      : isActive
        ? `${formatDuration(remaining)} left`
        : `in ${formatDuration(remaining)}`;

  const window: string | null = formatShiftWindow(
    shift.startsAt,
    shift.endsAt,
    now,
  );

  return (
    <View
      testID={`shift-card-${shift.scheduleId}-${shift.status}`}
      style={{
        borderRadius: 18,
        padding: 16,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
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
            <Ionicons name="calendar-outline" size={15} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: theme.colors.textPrimary,
              }}
              numberOfLines={1}
            >
              {shift.scheduleName}
            </Text>
            <Text
              style={{
                fontSize: 12,
                marginTop: 2,
                color: theme.colors.textTertiary,
              }}
              numberOfLines={1}
            >
              {shift.projectName}
            </Text>
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 9999,
            marginLeft: 10,
            backgroundColor: accentBackground,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: accent,
              fontVariant: ["tabular-nums"],
            }}
          >
            {badgeText}
          </Text>
        </View>
      </View>

      {window ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <Ionicons
            name="time-outline"
            size={13}
            color={theme.colors.textTertiary}
          />
          <Text
            style={{
              fontSize: 12,
              marginLeft: 6,
              color: theme.colors.textSecondary,
            }}
            numberOfLines={1}
          >
            {window}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
