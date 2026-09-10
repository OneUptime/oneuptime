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
  onShareCalendar?: (entry: ProjectOnCallScheduleItem) => void;
  isSharingCalendar?: boolean;
}

export function displayNameForUser(user: OnCallUserRef | null): string {
  return user ? user.name || user.email || "Unnamed user" : "Nobody";
}

/** Current coverage and the next handoff remain separate, explicit facts. */
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
    currentUserId && schedule.currentUserOnRoster?._id === currentUserId,
  );
  const accent: string = isCovered
    ? theme.colors.oncallActive
    : theme.colors.severityWarning;
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
        padding: 18,
        backgroundColor: theme.colors.backgroundElevated,
        borderLeftWidth: isCovered ? 0 : 3,
        borderLeftColor: accent,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          style={{
            flex: 1,
            fontSize: 17,
            fontWeight: "600",
            lineHeight: 24,
            letterSpacing: -0.2,
            color: theme.colors.textPrimary,
          }}
        >
          {schedule.name}
        </Text>
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
            aria-disabled={isSharingCalendar}
            aria-busy={isSharingCalendar}
            onPress={(): void => {
              onShareCalendar(entry);
            }}
            style={({ pressed }: { pressed: boolean }) => {
              return {
                width: 48,
                height: 48,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed
                  ? theme.colors.backgroundTertiary
                  : theme.colors.iconBackground,
                opacity: isSharingCalendar ? 0.6 : 1,
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
                size={19}
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
          gap: 12,
          marginTop: 14,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isCovered
              ? theme.colors.oncallActiveBg
              : theme.colors.severityWarningBg,
          }}
        >
          <Ionicons
            name={isCovered ? "person-outline" : "person-remove-outline"}
            size={18}
            color={accent}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontSize: 13,
              lineHeight: 19,
              color: theme.colors.textSecondary,
            }}
          >
            On call now
          </Text>
          <Text
            style={{
              fontSize: 16,
              lineHeight: 23,
              fontWeight: "600",
              color: isCovered ? theme.colors.textPrimary : accent,
            }}
          >
            {isCovered
              ? displayNameForUser(schedule.currentUserOnRoster)
              : "Nobody on call"}
          </Text>
        </View>
        {isMe ? (
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: theme.colors.oncallActive,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: theme.colors.oncallActiveBg,
            }}
          >
            YOU
          </Text>
        ) : null}
      </View>
      {handoffLabel || schedule.nextUserOnRoster ? (
        <View
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: theme.colors.borderSubtle,
            gap: 7,
          }}
        >
          {handoffLabel ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 20,
                  color: theme.colors.textSecondary,
                }}
              >
                Handoff
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 20,
                  fontWeight: "600",
                  color: theme.colors.textPrimary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {handoffLabel}
              </Text>
            </View>
          ) : null}
          {schedule.nextUserOnRoster ? (
            <Text
              style={{
                fontSize: 14,
                lineHeight: 21,
                color: theme.colors.textSecondary,
              }}
            >{`Next: ${displayNameForUser(schedule.nextUserOnRoster)}${nextStartLabel ? ` · ${nextStartLabel}` : ""}`}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
