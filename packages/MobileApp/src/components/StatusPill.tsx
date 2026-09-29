import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme, type Theme } from "../theme";
import { radius, spacing } from "../theme/tokens";
import AppText from "./AppText";

export type StatusTone =
  | "neutral"
  | "danger"
  | "warning"
  | "success"
  | "info"
  | "accent";

interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  /** Colour of the leading dot, e.g. a state colour configured on the server. */
  dotColor?: string;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function getToneColors(
  theme: Theme,
  tone: StatusTone,
): { text: string; background: string } {
  const tones: Record<StatusTone, { text: string; background: string }> = {
    neutral: {
      text: theme.colors.textSecondary,
      background: theme.colors.backgroundTertiary,
    },
    danger: {
      text: theme.colors.statusError,
      background: theme.colors.statusErrorBg,
    },
    warning: {
      text: theme.colors.statusWarning,
      background: theme.colors.statusWarningBg,
    },
    success: {
      text: theme.colors.statusSuccess,
      background: theme.colors.statusSuccessBg,
    },
    info: {
      text: theme.colors.statusInfo,
      background: theme.colors.statusInfoBg,
    },
    accent: {
      text: theme.colors.actionPrimary,
      background: theme.colors.cardAccent,
    },
  };
  return tones[tone];
}

/**
 * A compact status label. The text always carries the meaning; colour and the
 * optional dot only reinforce it.
 */
export default function StatusPill({
  label,
  tone = "neutral",
  dotColor,
  size = "md",
  style,
  testID,
}: StatusPillProps): React.JSX.Element {
  const { theme } = useTheme();
  const colors: { text: string; background: string } = getToneColors(
    theme,
    tone,
  );

  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: spacing.xs + 2,
          paddingHorizontal: size === "sm" ? spacing.sm : spacing.sm + 2,
          paddingVertical: size === "sm" ? 2 : spacing.xs,
          borderRadius: radius.pill,
          backgroundColor: colors.background,
        },
        style,
      ]}
    >
      {dotColor ? (
        <View
          testID={testID ? `${testID}-dot` : undefined}
          style={{
            width: size === "sm" ? 6 : 8,
            height: size === "sm" ? 6 : 8,
            borderRadius: 4,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
      <AppText
        variant={size === "sm" ? "caption" : "footnote"}
        weight="600"
        color={colors.text}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </View>
  );
}
