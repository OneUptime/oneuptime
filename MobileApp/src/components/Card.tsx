import React from "react";
import {
  Pressable,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";

export type CardVariant = "elevated" | "outlined" | "tinted";

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  /** Background for the tinted variant; defaults to the soft accent. */
  tint?: string;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  testID?: string;
}

/** The one surface every grouped piece of content sits on. */
export default function Card({
  children,
  variant = "elevated",
  tint,
  padding = spacing.lg,
  style,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  testID,
}: CardProps): React.JSX.Element {
  const { theme } = useTheme();

  const surface: ViewStyle = {
    borderRadius: radius.lg,
    padding,
    backgroundColor:
      variant === "tinted"
        ? tint ?? theme.colors.cardAccent
        : theme.colors.backgroundElevated,
    borderWidth: variant === "tinted" ? 0 : 1,
    borderColor: theme.colors.borderSubtle,
    ...(variant === "elevated" ? elevation("card", theme.dark) : {}),
  };

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        style={[surface, style]}
      >
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
        return [
          surface,
          pressed
            ? variant === "tinted"
              ? // A tinted card keeps its meaning while pressed; greying it
                // out would flash a status card neutral on every tap.
                { opacity: 0.8, transform: [{ scale: 0.99 }] }
              : {
                  backgroundColor: theme.colors.backgroundTertiary,
                  transform: [{ scale: 0.99 }],
                }
            : null,
          style,
        ];
      }}
    >
      {children}
    </Pressable>
  );
}
