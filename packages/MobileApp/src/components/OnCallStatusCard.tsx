import React from "react";
import { ActivityIndicator, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import {
  formatDuration,
  formatShiftTime,
  millisecondsUntil,
} from "../utils/duration";
import type { OnCallDutySummary } from "../oncall/duty";
import AppText from "./AppText";
import GradientButton from "./GradientButton";

interface OnCallStatusCardProps {
  summary: OnCallDutySummary;
  now: number;
  isLoading?: boolean;

  /*
   * The duty read failed. That is "we do not know", never "off call", so it
   * has its own state instead of falling through to the empty summary.
   */
  isError?: boolean;
  onRetry?: () => void;
}

type DutyState = "loading" | "error" | "on" | "off";

interface DutyPalette {
  surface: ViewStyle;
  foreground: string;
  secondary: string;
  eyebrowText: string;
  eyebrowBackground: string;
  dot: string;
  iconColor: string;
  iconBackground: string;
  divider: string;
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
  isError = false,
  onRetry,
}: OnCallStatusCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { colors } = theme;

  const state: DutyState = isLoading
    ? "loading"
    : isError
      ? "error"
      : summary.isOnCall
        ? "on"
        : "off";

  const handoffIn: number | null = millisecondsUntil(
    summary.nextHandoffAt,
    now,
  );

  const nextShiftIn: number | null = millisecondsUntil(
    summary.nextShiftStartsAt,
    now,
  );

  const eyebrow: Record<DutyState, string> = {
    loading: "CHECKING",
    error: "STATUS UNKNOWN",
    on: "ON CALL",
    off: "OFF CALL",
  };

  const headlines: Record<DutyState, string> = {
    loading: "Checking your duty status",
    error: "Could not load your on-call status",
    on: "You're on call",
    off: "You're not on call",
  };
  const headline: string = headlines[state];

  /*
   * The subtitle is the whole value of the card, so it is built explicitly for
   * each case instead of being assembled from optional fragments - that is how
   * a screen ends up reading "Handoff in  ·  ".
   */
  let subtitle: string = "";

  if (state === "loading") {
    subtitle = "Reading your schedules and escalation rules...";
  } else if (state === "error") {
    subtitle =
      "We could not confirm whether you are on call. Pull to refresh or try again.";
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

  /*
   * On call is the only filled state. Its tints are derived from the label
   * colour rather than hard-coded white, because in dark mode the fill is
   * light and the label is dark - a white wash would vanish into it.
   */
  const elevatedSurface: ViewStyle = {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...elevation("card", theme.dark),
  };

  const palettes: Record<DutyState, DutyPalette> = {
    on: {
      surface: {
        backgroundColor: colors.actionPrimary,
        borderWidth: 0,
        ...elevation("raised", theme.dark),
      },
      foreground: colors.textInverse,
      secondary: colors.textInverse,
      eyebrowText: colors.textInverse,
      eyebrowBackground: withAlpha(colors.textInverse, 0.16),
      dot: colors.textInverse,
      iconColor: colors.textInverse,
      iconBackground: withAlpha(colors.textInverse, 0.16),
      divider: withAlpha(colors.textInverse, 0.24),
    },
    off: {
      surface: elevatedSurface,
      foreground: colors.textPrimary,
      secondary: colors.textSecondary,
      eyebrowText: colors.textSecondary,
      eyebrowBackground: colors.oncallInactiveBg,
      dot: colors.oncallInactive,
      iconColor: colors.oncallInactive,
      iconBackground: colors.oncallInactiveBg,
      divider: colors.borderSubtle,
    },
    loading: {
      surface: elevatedSurface,
      foreground: colors.textPrimary,
      secondary: colors.textSecondary,
      eyebrowText: colors.textSecondary,
      eyebrowBackground: colors.backgroundTertiary,
      dot: colors.textTertiary,
      iconColor: colors.actionPrimary,
      iconBackground: colors.cardAccent,
      divider: colors.borderSubtle,
    },
    error: {
      surface: elevatedSurface,
      foreground: colors.textPrimary,
      secondary: colors.textSecondary,
      eyebrowText: colors.statusWarning,
      eyebrowBackground: colors.statusWarningBg,
      dot: colors.statusWarning,
      iconColor: colors.statusWarning,
      iconBackground: colors.statusWarningBg,
      divider: colors.borderSubtle,
    },
  };
  const palette: DutyPalette = palettes[state];

  const icons: Record<DutyState, keyof typeof Ionicons.glyphMap> = {
    loading: "time-outline",
    error: "cloud-offline-outline",
    on: "call",
    off: "call-outline",
  };

  const showMeta: boolean =
    (state === "on" || state === "off") &&
    Boolean(handoffAtLabel || nextShiftAtLabel);

  return (
    <View
      testID="oncall-status-card"
      accessibilityLabel={`${headline}. ${subtitle}.`}
      style={[
        {
          borderRadius: radius.lg,
          padding: spacing.xl,
        },
        palette.surface,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.md,
          marginBottom: spacing.lg,
        }}
      >
        <View
          testID="oncall-status-eyebrow"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs + 2,
            paddingHorizontal: spacing.sm + 2,
            paddingVertical: spacing.xs,
            borderRadius: radius.pill,
            backgroundColor: palette.eyebrowBackground,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: palette.dot,
            }}
          />
          <AppText variant="overline" color={palette.eyebrowText}>
            {eyebrow[state]}
          </AppText>
        </View>
        <View
          testID="oncall-status-icon"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.iconBackground,
          }}
        >
          {state === "loading" ? (
            <ActivityIndicator size="small" color={palette.iconColor} />
          ) : (
            <Ionicons name={icons[state]} size={19} color={palette.iconColor} />
          )}
        </View>
      </View>
      <AppText
        accessibilityRole="header"
        variant="title"
        color={palette.foreground}
      >
        {headline}
      </AppText>
      <AppText
        variant={state === "on" || state === "off" ? "headline" : "callout"}
        color={palette.secondary}
        style={{ marginTop: spacing.xs + 2 }}
      >
        {subtitle}
      </AppText>
      {state === "error" && onRetry ? (
        <GradientButton
          testID="oncall-status-retry"
          label="Retry"
          icon="refresh-outline"
          variant="secondary"
          size="sm"
          onPress={onRetry}
          style={{ alignSelf: "flex-start", marginTop: spacing.lg }}
        />
      ) : null}
      {showMeta ? (
        <View
          testID="oncall-status-meta"
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: spacing.xxl,
            paddingTop: spacing.lg,
            marginTop: spacing.lg,
            borderTopWidth: 1,
            borderTopColor: palette.divider,
          }}
        >
          {handoffAtLabel ? (
            <MetaColumn
              iconName="log-out-outline"
              label="Handoff"
              value={handoffAtLabel}
              labelColor={palette.secondary}
              valueColor={palette.foreground}
            />
          ) : null}
          {nextShiftAtLabel ? (
            <MetaColumn
              iconName="calendar-outline"
              label="Next shift"
              value={nextShiftAtLabel}
              labelColor={palette.secondary}
              valueColor={palette.foreground}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MetaColumn({
  iconName,
  label,
  value,
  labelColor,
  valueColor,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
}): React.JSX.Element {
  return (
    <View style={{ flex: 1, minWidth: 110, gap: spacing.xs }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
      >
        <Ionicons name={iconName} size={13} color={labelColor} />
        <AppText variant="overline" color={labelColor}>
          {label}
        </AppText>
      </View>
      <AppText
        variant="callout"
        weight="600"
        color={valueColor}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </AppText>
    </View>
  );
}
