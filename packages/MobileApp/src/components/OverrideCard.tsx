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

  /*
   * Edit (#7897): who covers, and its times as far as they may still
   * change. Never for one that has ended: it is history.
   */
  onEdit?: (override: OnCallOverrideItem) => void;

  // End now, for one under way: coming back early.
  onEndNow?: (override: OnCallOverrideItem) => void;
  isEnding?: boolean;
}

/** A substitution names the direction: being covered is not covering someone. */
export default function OverrideCard({
  override,
  state,
  currentUserId,
  now,
  onCancel,
  isCancelling = false,
  onEdit,
  onEndNow,
  isEnding = false,
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
  /*
   * An override that names nobody to cover skips the person away: each of
   * their turns in a schedule goes to the next person in the rotation, so
   * "pages go to Nobody" would say the opposite of what happens.
   */
  const isSkip: boolean = !override.routeAlertsToUser;
  const sentence: string = isSkip
    ? `${fromName} turns go to the next person in the rotation`
    : `${fromName} pages go to ${toName}`;
  const window: string | null = formatShiftWindow(
    override.startsAt,
    override.endsAt,
    now,
  );
  const endsIn: string | null =
    state === "active" ? formatTimeUntil(override.endsAt, now) : null;
  const canCancel: boolean = Boolean(onCancel) && state !== "past";
  const canEdit: boolean = Boolean(onEdit) && state !== "past";
  const canEndNow: boolean = Boolean(onEndNow) && state === "active";
  const hasActions: boolean = canCancel || canEdit || canEndNow;

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
      {hasActions ? (
        <View
          style={{
            marginTop: spacing.md,
            paddingTop: spacing.xs,
            borderTopWidth: 1,
            borderTopColor: colors.borderSubtle,
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: spacing.xs,
          }}
        >
          {canEdit && onEdit ? (
            <CardAction
              testID={`override-edit-${override._id}`}
              label="Edit"
              accessibilityLabel={`Edit override: ${sentence}`}
              iconName="create-outline"
              color={colors.actionPrimary}
              pressedBackground={colors.backgroundTertiary}
              onPress={(): void => {
                onEdit(override);
              }}
            />
          ) : null}
          {/*
           * End now on one under way (#7897): the override keeps its record
           * and the policy's feed says it changed. Cancel - a delete - is
           * for one that has not started, which has nothing to end.
           */}
          {canEndNow && onEndNow ? (
            <CardAction
              testID={`override-end-now-${override._id}`}
              label="End now"
              accessibilityLabel={`End override now: ${sentence}`}
              iconName="stop-circle-outline"
              color={colors.actionDestructive}
              pressedBackground={colors.statusErrorBg}
              isBusy={isEnding}
              onPress={(): void => {
                onEndNow(override);
              }}
            />
          ) : null}
          {canCancel && onCancel ? (
            <CardAction
              testID={`override-cancel-${override._id}`}
              label="Cancel override"
              accessibilityLabel={`Cancel override: ${sentence}`}
              iconName="close-circle-outline"
              color={colors.actionDestructive}
              pressedBackground={colors.statusErrorBg}
              isBusy={isCancelling}
              onPress={(): void => {
                onCancel(override);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

// One action at a card's foot: its words beside an icon, a finger's height.
function CardAction({
  testID,
  label,
  accessibilityLabel,
  iconName,
  color,
  pressedBackground,
  isBusy = false,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel: string;
  iconName: keyof typeof Ionicons.glyphMap;
  color: string;
  pressedBackground: string;
  isBusy?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={isBusy}
      accessibilityState={{ disabled: isBusy, busy: isBusy }}
      aria-disabled={isBusy}
      aria-busy={isBusy}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          minHeight: touchTarget,
          minWidth: 76,
          marginTop: spacing.xs,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xs + 2,
          backgroundColor: pressed ? pressedBackground : "transparent",
          opacity: isBusy ? 0.5 : 1,
        };
      }}
    >
      {isBusy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <>
          <Ionicons name={iconName} size={18} color={color} />
          <AppText variant="subhead" weight="600" color={color}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
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
