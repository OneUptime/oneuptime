import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { radius, spacing, touchTarget, typography } from "../../theme/tokens";
import getToggleAccessibilityProps from "../../utils/getToggleAccessibilityProps";

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  // The value's own colour, as the project set it: a dot before its name.
  dotColor?: string;
  // An icon before the name, for a value with no colour of its own.
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * One value in the filter sheet: a toggle, so several of a facet can be on
 * at once ("Critical or Major"). It is drawn as the list's own quick chips
 * are (ListFilters), filled with a check while on, so the two read as one
 * family of controls. 48 points tall; the label wraps rather than being cut.
 */
export default function FilterChip({
  label,
  selected,
  onPress,
  dotColor,
  icon,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: FilterChipProps): React.JSX.Element {
  const { theme } = useTheme();
  const contentColor: string = selected
    ? theme.colors.textInverse
    : theme.colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      {...getToggleAccessibilityProps(selected)}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          minHeight: touchTarget,
          maxWidth: "100%",
          paddingHorizontal: spacing.lg - 2,
          paddingVertical: spacing.xs,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: selected
            ? theme.colors.actionPrimary
            : theme.colors.borderDefault,
          backgroundColor: selected
            ? pressed
              ? theme.colors.actionPrimaryPressed
              : theme.colors.actionPrimary
            : pressed
              ? theme.colors.backgroundTertiary
              : theme.colors.backgroundElevated,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs + 2,
        };
      }}
    >
      {selected ? (
        <Ionicons name="checkmark" size={15} color={contentColor} />
      ) : icon ? (
        <Ionicons name={icon} size={15} color={theme.colors.textSecondary} />
      ) : null}
      {dotColor ? (
        <View
          testID={testID ? `${testID}-dot` : undefined}
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: dotColor,
            // A pale colour still shows on the filled chip and on the card.
            borderWidth: 1,
            borderColor: selected
              ? theme.colors.textInverse
              : theme.colors.borderSubtle,
          }}
        />
      ) : null}
      <Text
        style={{
          ...typography.subhead,
          fontWeight: "600",
          flexShrink: 1,
          color: contentColor,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
