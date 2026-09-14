import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
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
    <View style={{ marginTop: 12, gap: 4 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
                  minHeight: 48,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: active
                    ? theme.colors.actionPrimary
                    : theme.colors.borderSubtle,
                  backgroundColor: pressed
                    ? theme.colors.backgroundTertiary
                    : active
                      ? theme.colors.cardAccent
                      : theme.colors.backgroundElevated,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                };
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 20,
                  fontWeight: "600",
                  color: active
                    ? theme.colors.actionPrimary
                    : theme.colors.textSecondary,
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
            minHeight: onReset ? 48 : 32,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: 20,
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
              style={{
                minHeight: 48,
                paddingHorizontal: 8,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Ionicons
                name="refresh-outline"
                size={14}
                color={theme.colors.actionPrimary}
              />
              <Text
                style={{
                  fontSize: 13,
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
