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

/*
 * A substitution, phrased as a sentence rather than as two columns of names.
 *
 * "Priya's pages → you" and "your pages → Priya" are opposite facts that look
 * identical in a table, and getting them the wrong way round means somebody
 * goes to bed believing they are covered when they are the cover. The card
 * therefore always names the direction explicitly and marks whichever end is
 * the reader.
 */
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

  const accentBackground: string =
    state === "active"
      ? theme.colors.oncallActiveBg
      : state === "upcoming"
        ? theme.colors.severityInfoBg
        : theme.colors.oncallInactiveBg;

  const label: string =
    state === "active"
      ? "IN EFFECT"
      : state === "upcoming"
        ? "SCHEDULED"
        : "ENDED";

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
        padding: 16,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
        opacity: state === "past" ? 0.7 : 1,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View
          style={{
            paddingHorizontal: 9,
            paddingVertical: 4,
            borderRadius: 9999,
            backgroundColor: accentBackground,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: "700",
              letterSpacing: 0.6,
              color: accent,
            }}
          >
            {label}
          </Text>
        </View>

        {onCancel && state !== "past" ? (
          <Pressable
            testID={`override-cancel-${override._id}`}
            accessibilityRole="button"
            accessibilityLabel={`Cancel override: ${sentence}`}
            disabled={isCancelling}
            onPress={() => {
              onCancel(override);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.borderDefault,
              opacity: isCancelling ? 0.5 : 1,
            }}
          >
            {isCancelling ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.actionDestructive}
              />
            ) : (
              <>
                <Ionicons
                  name="close-circle-outline"
                  size={13}
                  color={theme.colors.actionDestructive}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    marginLeft: 5,
                    color: theme.colors.actionDestructive,
                  }}
                >
                  Cancel
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          marginTop: 12,
          lineHeight: 21,
          color: theme.colors.textPrimary,
        }}
      >
        {sentence}
      </Text>

      {window ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 10,
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
              flex: 1,
              color: theme.colors.textSecondary,
            }}
            numberOfLines={2}
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
          marginTop: 8,
        }}
      >
        <Ionicons
          name="folder-open-outline"
          size={13}
          color={theme.colors.textTertiary}
        />
        <Text
          style={{
            fontSize: 12,
            marginLeft: 6,
            flex: 1,
            color: theme.colors.textTertiary,
          }}
          numberOfLines={1}
        >
          {override.onCallDutyPolicy?.name
            ? `${override.projectName} · ${override.onCallDutyPolicy.name}`
            : `${override.projectName} · All on-call policies`}
        </Text>
      </View>
    </View>
  );
}
