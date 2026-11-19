import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { radius, spacing, typography } from "../../theme/tokens";

interface FilterButtonProps {
  // How many of the list's filters are on: drawn as a badge, and read out.
  activeCount: number;
  onPress: () => void;
  // What the list holds, for the screen reader: "Filter incidents".
  noun: string;
  testID?: string;
}

/**
 * The button beside a list's search that opens its filters. It keeps its
 * word: an icon alone, named only for a screen reader, is found by guessing.
 * While filters are on it is tinted and carries their number, so a list
 * that hides rows always says so beside its search.
 */
export default function FilterButton({
  activeCount,
  onPress,
  noun,
  testID = "list-filter-button",
}: FilterButtonProps): React.JSX.Element {
  const { theme } = useTheme();
  const active: boolean = activeCount > 0;
  const contentColor: string = active
    ? theme.colors.actionPrimary
    : theme.colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `Filter ${noun}, ${activeCount} ${activeCount === 1 ? "filter" : "filters"} on`
          : `Filter ${noun}`
      }
      accessibilityHint="Filter by owner, state, severity and more"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          minHeight: 48,
          minWidth: 48,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          borderWidth: active ? 2 : 1,
          borderColor: active
            ? theme.colors.actionPrimary
            : theme.colors.borderDefault,
          backgroundColor: pressed
            ? theme.colors.backgroundTertiary
            : active
              ? theme.colors.cardAccent
              : theme.colors.backgroundElevated,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xs + 2,
        };
      }}
    >
      <Ionicons name="options-outline" size={18} color={contentColor} />
      <Text
        style={{
          ...typography.subhead,
          fontWeight: "600",
          color: contentColor,
        }}
      >
        Filter
      </Text>
      {active ? (
        <View
          testID={`${testID}-count`}
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: spacing.xs + 1,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.actionPrimary,
          }}
        >
          <Text
            style={{
              ...typography.caption,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
              color: theme.colors.textInverse,
            }}
          >
            {String(activeCount)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
