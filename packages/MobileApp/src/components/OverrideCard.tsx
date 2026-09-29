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
import { formatShiftWindow, formatTimeUntil } from "../utils/duration";
import { displayNameForUser } from "./RosterScheduleCard";
import type { OnCallOverrideItem } from "../api/types";
import AppText from "./AppText";
import Card from "./Card";
import StatusPill, { getToneColors, type StatusTone } from "./StatusPill";

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
  const { colors } = theme;
  const tone: StatusTone =
    state === "active" ? "success" : state === "upcoming" ? "info" : "neutral";
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
  const canCancel: boolean = Boolean(onCancel) && state !== "past";

  return (
    <Card
      testID={`override-card-${override._id}`}
      variant={state === "past" ? "outlined" : "elevated"}
    >
      <StatusPill
        testID={`override-status-${override._id}`}
        label={label}
        tone={tone}
        size="sm"
        dotColor={getToneColors(theme, tone).text}
      />
      <AppText
        variant="headline"
        color={state === "past" ? colors.textSecondary : colors.textPrimary}
        style={{ fontSize: 17, lineHeight: 23, marginTop: spacing.sm + 2 }}
      >
        {sentence}
      </AppText>
      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        {window ? (
          <MetaLine iconName="time-outline">
            {window}
            {endsIn ? ` · ends ${endsIn}` : ""}
          </MetaLine>
        ) : null}
        <MetaLine iconName="git-branch-outline">
          {override.onCallDutyPolicy?.name || "All on-call policies"}
        </MetaLine>
      </View>
      {canCancel && onCancel ? (
        <View
          style={{
            marginTop: spacing.md,
            paddingTop: spacing.xs,
            borderTopWidth: 1,
            borderTopColor: colors.borderSubtle,
            alignItems: "flex-end",
          }}
        >
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
            style={({ pressed }: { pressed: boolean }): ViewStyle => {
              return {
                minHeight: touchTarget,
                minWidth: 76,
                marginTop: spacing.xs,
                marginRight: -spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.xs + 2,
                backgroundColor: pressed ? colors.statusErrorBg : "transparent",
                opacity: isCancelling ? 0.5 : 1,
              };
            }}
          >
            {isCancelling ? (
              <ActivityIndicator
                size="small"
                color={colors.actionDestructive}
              />
            ) : (
              <>
                <Ionicons
                  name="close-circle-outline"
                  size={18}
                  color={colors.actionDestructive}
                />
                <AppText
                  variant="subhead"
                  weight="600"
                  color={colors.actionDestructive}
                >
                  Cancel override
                </AppText>
              </>
            )}
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

function MetaLine({
  iconName,
  children,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.xs + 2,
      }}
    >
      <Ionicons
        name={iconName}
        size={15}
        color={theme.colors.textTertiary}
        style={{ marginTop: 3 }}
      />
      <AppText variant="subhead" tone="secondary" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}
