import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import {
  formatDuration,
  formatShiftTime,
  millisecondsUntil,
} from "../utils/duration";
import type { OnCallDutySummary } from "../oncall/duty";

interface OnCallStatusCardProps {
  summary: OnCallDutySummary;
  now: number;
  isLoading?: boolean;
}

/*
 * The one thing this screen exists to say.
 *
 * Two numbers matter and they are both times, not counts: how long until you
 * are off, and how long until you are on. The count of policies is deliberately
 * secondary - it never changed anybody's evening.
 *
 * The card refuses to invent a handoff it does not have. A responder on call
 * through a direct escalation assignment has no end time at all, so it says
 * "no scheduled handoff" rather than borrowing a boundary from an unrelated
 * schedule. Being wrong about when someone can stop carrying the phone is the
 * one failure this component must not have.
 */
export default function OnCallStatusCard({
  summary,
  now,
  isLoading = false,
}: OnCallStatusCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const accent: string = summary.isOnCall
    ? theme.colors.oncallActive
    : theme.colors.textTertiary;

  const accentBackground: string = summary.isOnCall
    ? theme.colors.oncallActiveBg
    : theme.colors.oncallInactiveBg;

  const handoffIn: number | null = millisecondsUntil(
    summary.nextHandoffAt,
    now,
  );

  const nextShiftIn: number | null = millisecondsUntil(
    summary.nextShiftStartsAt,
    now,
  );

  const headline: string = isLoading
    ? "Checking your duty status"
    : summary.isOnCall
      ? "You're on call"
      : "You're not on call";

  /*
   * The subtitle is the whole value of the card, so it is built explicitly for
   * each case instead of being assembled from optional fragments - that is how
   * a screen ends up reading "Handoff in  ·  ".
   */
  let subtitle: string = "";

  if (isLoading) {
    subtitle = "Reading your schedules and escalation rules...";
  } else if (summary.isOnCall && handoffIn !== null) {
    subtitle = `Handoff in ${formatDuration(handoffIn)}`;
  } else if (summary.isOnCall && summary.standingAssignmentCount > 0) {
    subtitle = "Standing assignment — no scheduled handoff";
  } else if (summary.isOnCall) {
    subtitle = "On duty — no scheduled handoff";
  } else if (nextShiftIn !== null) {
    subtitle = `Next shift starts in ${formatDuration(nextShiftIn)}`;
  } else {
    subtitle = "No upcoming shifts on your schedules";
  }

  const handoffAtLabel: string | null = formatShiftTime(
    summary.nextHandoffAt,
    now,
  );

  const nextShiftAtLabel: string | null = formatShiftTime(
    summary.nextShiftStartsAt,
    now,
  );

  return (
    <View
      testID="oncall-status-card"
      accessibilityLabel={`${headline}. ${subtitle}.`}
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor:
          summary.isOnCall && !isLoading
            ? theme.colors.oncallActive + "66"
            : theme.colors.borderSubtle,
      }}
    >
      <View style={{ padding: 20 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 9999,
              backgroundColor: accentBackground,
            }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 9999,
                marginRight: 7,
                backgroundColor: accent,
              }}
            />
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 0.8,
                color: accent,
              }}
            >
              {isLoading
                ? "CHECKING"
                : summary.isOnCall
                  ? "ON CALL"
                  : "OFF CALL"}
            </Text>
          </View>

          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: accentBackground,
            }}
          >
            <Ionicons
              name={summary.isOnCall ? "call" : "call-outline"}
              size={18}
              color={accent}
            />
          </View>
        </View>

        <Text
          accessibilityRole="header"
          style={{
            fontSize: 28,
            fontWeight: "bold",
            marginTop: 16,
            letterSpacing: -0.6,
            color: theme.colors.textPrimary,
          }}
        >
          {headline}
        </Text>

        <Text
          style={{
            fontSize: 16,
            marginTop: 8,
            lineHeight: 24,
            color: theme.colors.textSecondary,
          }}
        >
          {subtitle}
        </Text>

        {!isLoading && (handoffAtLabel || nextShiftAtLabel) ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 16,
              marginTop: 18,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: theme.colors.borderSubtle,
            }}
          >
            {handoffAtLabel ? (
              <MetaColumn
                iconName="log-out-outline"
                label="Handoff"
                value={handoffAtLabel}
              />
            ) : null}

            {nextShiftAtLabel ? (
              <MetaColumn
                iconName="calendar-outline"
                label="Next shift"
                value={nextShiftAtLabel}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MetaColumn({
  iconName,
  label,
  value,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, minWidth: 110 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Ionicons name={iconName} size={12} color={theme.colors.textTertiary} />
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            marginLeft: 5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: theme.colors.textTertiary,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          marginTop: 4,
          color: theme.colors.textPrimary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
