import React from "react";
import {
  View,
  Pressable,
  ActivityIndicator,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, touchTarget } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import { formatShiftTime, formatTimeUntil } from "../utils/duration";
import type { OnCallUserRef, ProjectOnCallScheduleItem } from "../api/types";
import AppText from "./AppText";
import Card from "./Card";
import StatusPill from "./StatusPill";

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

/**
 * One or two letters for an avatar: the first letters of the first two words
 * of a name, or the first character of an email address.
 */
export function getInitials(label: string): string {
  const trimmed: string = label.trim();

  if (!trimmed) {
    return "?";
  }

  if (trimmed.includes("@") && !trimmed.includes(" ")) {
    return trimmed.charAt(0).toUpperCase();
  }

  const words: string[] = trimmed.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word: string) => {
      return word.charAt(0);
    })
    .join("")
    .toUpperCase();
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
  const { colors } = theme;
  const schedule: ProjectOnCallScheduleItem["item"] = entry.item;
  const isCovered: boolean = Boolean(schedule.currentUserOnRoster);
  const isMe: boolean = Boolean(
    currentUserId && schedule.currentUserOnRoster?._id === currentUserId,
  );
  const currentName: string = displayNameForUser(schedule.currentUserOnRoster);
  const handoffLabel: string | null = formatTimeUntil(
    schedule.rosterHandoffAt,
    now,
  );
  const nextStartLabel: string | null = formatShiftTime(
    schedule.rosterNextStartAt,
    now,
  );

  return (
    <Card
      testID={`roster-card-${schedule._id}`}
      style={
        isCovered
          ? undefined
          : { borderColor: withAlpha(colors.statusWarning, 0.45) }
      }
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
      >
        <AppText
          variant="headline"
          style={{ flex: 1, fontSize: 17, lineHeight: 23 }}
        >
          {schedule.name}
        </AppText>
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
            style={({ pressed }: { pressed: boolean }): ViewStyle => {
              return {
                width: touchTarget,
                height: touchTarget,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed
                  ? colors.backgroundTertiary
                  : colors.cardAccent,
                opacity: isSharingCalendar ? 0.6 : 1,
              };
            }}
          >
            {isSharingCalendar ? (
              <ActivityIndicator size="small" color={colors.actionPrimary} />
            ) : (
              <Ionicons
                name="share-outline"
                size={19}
                color={colors.actionPrimary}
              />
            )}
          </Pressable>
        ) : null}
      </View>

      <View
        testID={`roster-coverage-${schedule._id}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          marginTop: spacing.md,
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: isCovered
            ? colors.backgroundTertiary
            : colors.statusWarningBg,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isCovered
              ? colors.oncallActiveBg
              : withAlpha(colors.statusWarning, theme.dark ? 0.2 : 0.14),
          }}
        >
          {isCovered ? (
            <AppText
              variant="subhead"
              weight="700"
              color={colors.oncallActive}
              accessible={false}
            >
              {getInitials(currentName)}
            </AppText>
          ) : (
            <Ionicons
              name="person-remove-outline"
              size={18}
              color={colors.statusWarning}
            />
          )}
        </View>
        <View style={{ flex: 1, gap: spacing.xxs }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs + 2,
            }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: isCovered
                  ? colors.oncallActive
                  : colors.statusWarning,
              }}
            />
            <AppText
              variant="caption"
              color={isCovered ? colors.textSecondary : colors.statusWarning}
            >
              {isCovered ? "On call now" : "Coverage gap"}
            </AppText>
          </View>
          <AppText
            variant="headline"
            color={isCovered ? colors.textPrimary : colors.statusWarning}
          >
            {isCovered ? currentName : "Nobody on call"}
          </AppText>
        </View>
        {isMe ? <StatusPill label="YOU" tone="success" size="sm" /> : null}
      </View>

      {handoffLabel || schedule.nextUserOnRoster ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {handoffLabel ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs + 2,
              }}
            >
              <Ionicons
                name="log-out-outline"
                size={15}
                color={colors.textTertiary}
              />
              <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
                Handoff
              </AppText>
              <AppText
                variant="footnote"
                weight="600"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {handoffLabel}
              </AppText>
            </View>
          ) : null}
          {schedule.nextUserOnRoster ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.xs + 2,
              }}
            >
              <Ionicons
                name="arrow-forward-circle-outline"
                size={15}
                color={colors.textTertiary}
                style={{ marginTop: 1 }}
              />
              <AppText
                variant="footnote"
                tone="secondary"
                style={{ flex: 1 }}
              >{`Next: ${displayNameForUser(schedule.nextUserOnRoster)}${nextStartLabel ? ` · ${nextStartLabel}` : ""}`}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
