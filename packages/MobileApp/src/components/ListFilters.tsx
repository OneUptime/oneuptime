import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, touchTarget, typography } from "../theme/tokens";
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";

interface FilterOption<T extends string> {
  key: T;
  label: string;
  accessibilityLabel: string;
}

interface ListFiltersProps<T extends string> {
  options: Array<FilterOption<T>>;
  selected: T;
  onSelect: (key: T) => void;
  resultCount?: number;
  onReset?: () => void;
}

/** Keep the current filter, result count and way back to the full list together. */
export default function ListFilters<T extends string>({
  options,
  selected,
  onSelect,
  resultCount,
  onReset,
}: ListFiltersProps<T>): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
      {/*
       * Chips wrap rather than scroll sideways: a filter hidden past the edge
       * of a small phone is a filter nobody finds.
       */}
      <View
        testID="list-filter-chips"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}
      >
        {options.map((option: FilterOption<T>) => {
          const active: boolean = option.key === selected;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={option.accessibilityLabel}
              {...getToggleAccessibilityProps(active)}
              onPress={() => {
                return onSelect(option.key);
              }}
              style={({ pressed }: { pressed: boolean }) => {
                return {
                  minHeight: touchTarget,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active
                    ? theme.colors.actionPrimary
                    : theme.colors.borderDefault,
                  backgroundColor: active
                    ? theme.colors.actionPrimary
                    : pressed
                      ? theme.colors.backgroundTertiary
                      : theme.colors.backgroundElevated,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.xs + 2,
                };
              }}
            >
              {active ? (
                <Ionicons
                  name="checkmark"
                  size={15}
                  color={theme.colors.textInverse}
                />
              ) : null}
              <Text
                style={{
                  ...typography.subhead,
                  fontWeight: "600",
                  color: active
                    ? theme.colors.textInverse
                    : theme.colors.textPrimary,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {resultCount !== undefined || onReset ? (
        <View
          style={{
            minHeight: onReset ? touchTarget : 32,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={{
              ...typography.footnote,
              flex: 1,
              color: theme.colors.textSecondary,
            }}
          >
            {resultCount !== undefined
              ? `${resultCount} ${resultCount === 1 ? "result" : "results"}`
              : ""}
          </Text>
          {onReset ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              onPress={onReset}
              hitSlop={8}
              style={{
                minHeight: touchTarget,
                paddingHorizontal: spacing.sm,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
              }}
            >
              <Ionicons
                name="close-circle-outline"
                size={16}
                color={theme.colors.actionPrimary}
              />
              <Text
                style={{
                  ...typography.footnote,
                  fontWeight: "600",
                  color: theme.colors.actionPrimary,
                }}
              >
                Reset
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
