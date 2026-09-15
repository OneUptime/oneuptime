import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, typography } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";

/**
 * The Active / Resolved heading inside the list. It follows the shared
 * SectionHeader (title3 title, pill count) and adds a status tone, so the
 * section that still needs a responder stands apart from the finished one.
 * The heading and its count share one parent row: assistive tech and the web
 * build read them together.
 */
export function ListSectionHeader({
  title,
  count,
  isActive,
}: {
  title: string;
  count: number;
  isActive: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const tone: string = isActive
    ? theme.colors.statusError
    : theme.colors.statusSuccess;
  return (
    <View
      testID={`response-section-${isActive ? "active" : "resolved"}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        minHeight: 28,
        paddingTop: isActive ? spacing.xs : spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Ionicons
        name={isActive ? "flame" : "checkmark-done"}
        size={18}
        color={tone}
        style={{ width: 20, textAlign: "center" }}
      />
      <Text
        accessibilityRole="header"
        style={{
          ...typography.title3,
          flexShrink: 1,
          color: theme.colors.textPrimary,
        }}
      >
        {title}
      </Text>
      <View
        testID={`response-section-${isActive ? "active" : "resolved"}-count`}
        style={{
          minWidth: 24,
          paddingHorizontal: spacing.sm - 1,
          paddingVertical: 1,
          borderRadius: radius.pill,
          alignItems: "center",
          backgroundColor: isActive
            ? theme.colors.statusErrorBg
            : theme.colors.backgroundTertiary,
        }}
      >
        <Text
          style={{
            ...typography.caption,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
            color: isActive ? tone : theme.colors.textSecondary,
          }}
        >
          {count}
        </Text>
      </View>
    </View>
  );
}

export interface ViewOption<T extends string> {
  key: T;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityHint: string;
}

/**
 * Individual rows or the episodes that group them. A filled segmented track
 * makes the choice obvious at a glance. Each half is a toggle button, like the
 * state chips below it, so a screen reader hears "Episodes, button, selected"
 * and the switch is not confused with the Inbox category tabs above it.
 */
export function ViewSwitch<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: Array<ViewOption<T>>;
  selected: T;
  onSelect: (key: T) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID="response-view-switch"
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 3,
        borderRadius: radius.md,
        backgroundColor: theme.colors.backgroundTertiary,
      }}
    >
      {options.map((option: ViewOption<T>): React.JSX.Element => {
        const active: boolean = option.key === selected;
        return (
          <Pressable
            key={option.key}
            testID={`response-view-${option.key}`}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityHint={option.accessibilityHint}
            {...getToggleAccessibilityProps(active)}
            onPress={() => {
              if (!active) {
                onSelect(option.key);
              }
            }}
            style={({ pressed }: { pressed: boolean }): ViewStyle => {
              return {
                flex: 1,
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.xs + 2,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.md - 3,
                backgroundColor: active
                  ? theme.colors.backgroundElevated
                  : pressed
                    ? withAlpha(theme.colors.textPrimary, 0.06)
                    : "transparent",
                ...(active ? elevation("card", theme.dark) : {}),
              };
            }}
          >
            <Ionicons
              name={option.icon}
              size={16}
              color={
                active ? theme.colors.actionPrimary : theme.colors.textSecondary
              }
            />
            <Text
              numberOfLines={1}
              style={{
                ...typography.subhead,
                fontWeight: active ? "700" : "600",
                color: active
                  ? theme.colors.textPrimary
                  : theme.colors.textSecondary,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
