import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { formatShiftWindow, formatTimeUntil } from "../utils/duration";
import { displayNameForUser } from "./RosterScheduleCard";
import type { OnCallOverrideItem } from "../api/types";

interface OverrideCardProps {
  override: OnCallOverrideItem;
  state: "active" | "upcoming" | "past";
  currentUserId: string | null;
  now: number;
  onCancel?: (override: OnCallOverrideItem) => void;
  isCancelling?: boolean;
}

/** A substitution names the direction: being covered is not covering someone. */
export default function OverrideCard({
  override,
  state,
  currentUserId,
  now,
  onCancel,
  isCancelling = false,
}: OverrideCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const accent: string =
    state === "active"
      ? theme.colors.oncallActive
      : state === "upcoming"
        ? theme.colors.severityInfo
        : theme.colors.textTertiary;
  const label: string =
    state === "active"
      ? "In effect"
      : state === "upcoming"
        ? "Scheduled"
        : "Ended";
  const fromIsMe: boolean = Boolean(
    currentUserId && override.overrideUser?._id === currentUserId,
  );
  const toIsMe: boolean = Boolean(
    currentUserId && override.routeAlertsToUser?._id === currentUserId,
  );
  const fromName: string = fromIsMe
    ? "Your"
    : `${displayNameForUser(override.overrideUser)}'s`;
  const toName: string = toIsMe
    ? "you"
    : displayNameForUser(override.routeAlertsToUser);
  const sentence: string = `${fromName} pages go to ${toName}`;
  const window: string | null = formatShiftWindow(
    override.startsAt,
    override.endsAt,
    now,
  );
  const endsIn: string | null =
    state === "active" ? formatTimeUntil(override.endsAt, now) : null;

  return (
    <View
      testID={`override-card-${override._id}`}
      style={{
        borderRadius: 18,
        padding: 18,
        backgroundColor: theme.colors.backgroundElevated,
        gap: 11,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: accent,
          }}
        />
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            fontWeight: "600",
            color: accent,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 17,
          fontWeight: "600",
          lineHeight: 24,
          letterSpacing: -0.2,
          color: theme.colors.textPrimary,
        }}
      >
        {sentence}
      </Text>
      {window ? (
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}
        >
          <Ionicons
            name="time-outline"
            size={15}
            color={theme.colors.textSecondary}
            style={{ marginTop: 3 }}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {window}
            {endsIn ? ` · ends ${endsIn}` : ""}
          </Text>
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderTopWidth: 1,
          borderTopColor: theme.colors.borderSubtle,
          paddingTop: 10,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 14,
            lineHeight: 21,
            color: theme.colors.textSecondary,
          }}
        >
          {override.onCallDutyPolicy?.name || "All on-call policies"}
        </Text>
        {onCancel && state !== "past" ? (
          <Pressable
            testID={`override-cancel-${override._id}`}
            accessibilityRole="button"
            accessibilityLabel={`Cancel override: ${sentence}`}
            disabled={isCancelling}
            accessibilityState={{ disabled: isCancelling, busy: isCancelling }}
            aria-disabled={isCancelling}
            aria-busy={isCancelling}
            onPress={(): void => {
              onCancel(override);
            }}
            style={({ pressed }: { pressed: boolean }) => {
              return {
                minHeight: 48,
                minWidth: 76,
                paddingHorizontal: 12,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed
                  ? theme.colors.statusErrorBg
                  : theme.colors.backgroundPrimary,
                opacity: isCancelling ? 0.5 : 1,
              };
            }}
          >
            {isCancelling ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.actionDestructive}
              />
            ) : (
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: theme.colors.actionDestructive,
                }}
              >
                Cancel
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
