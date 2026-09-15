import React from "react";
import {
  Text,
  ActivityIndicator,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tonal"
  | "destructive"
  | "ghost";

interface GradientButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  style?: StyleProp<ViewStyle>;

  /*
   * Needed because the label is not always a stable handle. A button whose
   * text changes with state -- "Generate Backup Codes" becoming a spinner, for
   * one -- cannot be found by its label at the moment a test needs to press
   * it, and finding it by position is how a test starts passing for the wrong
   * reason.
   */
  testID?: string;
}

/**
 * The app's button. The name is historical; it no longer draws a gradient.
 *
 * primary: the one main action on a screen. secondary: an outlined
 * alternative. tonal: a softer accent action. destructive: irreversible or
 * risky actions. ghost: low-emphasis text actions.
 */
export default function GradientButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon,
  variant = "primary",
  size = "md",
  style,
  testID,
}: GradientButtonProps): React.JSX.Element {
  const { theme } = useTheme();
  const isDisabled: boolean = disabled || loading;

  const palette: Record<
    ButtonVariant,
    { background: string; pressed: string; content: string; border?: string }
  > = {
    primary: {
      background: theme.colors.actionPrimary,
      pressed: theme.colors.actionPrimaryPressed,
      content: theme.colors.textInverse,
    },
    secondary: {
      background: theme.colors.backgroundElevated,
      pressed: theme.colors.backgroundTertiary,
      content: theme.colors.textPrimary,
      border: theme.colors.borderDefault,
    },
    tonal: {
      background: theme.colors.cardAccent,
      pressed: theme.colors.backgroundTertiary,
      content: theme.colors.actionPrimary,
    },
    destructive: {
      background: theme.colors.actionDestructive,
      pressed: theme.colors.actionDestructivePressed,
      content: theme.colors.textInverse,
    },
    ghost: {
      background: "transparent",
      pressed: theme.colors.backgroundTertiary,
      content: theme.colors.actionPrimary,
    },
  };
  const colors: {
    background: string;
    pressed: string;
    content: string;
    border?: string;
  } = palette[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      /*
       * Named explicitly because the label is not always rendered. While
       * `loading` the text is replaced by a spinner, and a Pressable with no
       * text inside it has no accessible name at all - so the control a
       * responder is waiting on becomes an unlabelled button at the exact
       * moment they ask what it is doing.
       */
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      aria-disabled={isDisabled}
      aria-busy={loading}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
        return [
          {
            minHeight: size === "sm" ? 44 : 50,
            paddingHorizontal: size === "sm" ? spacing.md : spacing.lg + 2,
            paddingVertical: size === "sm" ? spacing.sm : spacing.md,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              pressed && !isDisabled ? colors.pressed : colors.background,
            borderWidth: colors.border ? 1 : 0,
            borderColor: colors.border,
            opacity: isDisabled ? 0.55 : 1,
          },
          style,
        ];
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
        }}
      >
        {loading ? (
          <ActivityIndicator color={colors.content} />
        ) : (
          <>
            {icon ? (
              <Ionicons
                name={icon}
                size={size === "sm" ? 16 : 18}
                color={colors.content}
              />
            ) : null}
            <Text
              style={[
                size === "sm" ? typography.subhead : typography.callout,
                {
                  fontWeight: "600",
                  color: colors.content,
                  textAlign: "center",
                  flexShrink: 1,
                },
              ]}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}
