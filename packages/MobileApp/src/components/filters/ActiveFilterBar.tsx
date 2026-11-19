import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { radius, spacing, typography } from "../../theme/tokens";
import type { FilterFacet } from "../../filters/recordFilters";

export interface ActiveFilterItem {
  facet: FilterFacet;
  // The facet's name: "Owner", "Severity".
  title: string;
  // What it is set to, in words: "You", "Critical or Major".
  summary: string;
}

interface ActiveFilterBarProps {
  items: Array<ActiveFilterItem>;
  onOpen: (facet: FilterFacet) => void;
  onRemove: (facet: FilterFacet) => void;
}

/**
 * The filters that are on, under the search: each says what it keeps
 * ("Owner: You"), opens the sheet when pressed, and comes off with its own
 * cross. The name and the cross are two buttons side by side in one pill,
 * never one inside the other, so each is reached and read on its own.
 */
export default function ActiveFilterBar({
  items,
  onOpen,
  onRemove,
}: ActiveFilterBarProps): React.JSX.Element | null {
  const { theme } = useTheme();
  if (items.length === 0) {
    return null;
  }
  return (
    <View
      testID="active-filter-bar"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.sm,
        marginTop: spacing.md,
      }}
    >
      {items.map((item: ActiveFilterItem): React.JSX.Element => {
        return (
          <View
            key={item.facet}
            testID={`active-filter-${item.facet}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              maxWidth: "100%",
              minHeight: 44,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: theme.colors.actionPrimary,
              backgroundColor: theme.colors.cardAccent,
            }}
          >
            <Pressable
              testID={`active-filter-${item.facet}-open`}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}: ${item.summary}`}
              accessibilityHint="Opens the filters"
              onPress={(): void => {
                onOpen(item.facet);
              }}
              style={({ pressed }: { pressed: boolean }): ViewStyle => {
                return {
                  flexShrink: 1,
                  minHeight: 44,
                  justifyContent: "center",
                  paddingLeft: spacing.md,
                  paddingRight: spacing.xs,
                  borderTopLeftRadius: radius.pill,
                  borderBottomLeftRadius: radius.pill,
                  opacity: pressed ? 0.7 : 1,
                };
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  ...typography.footnote,
                  color: theme.colors.actionPrimary,
                }}
              >
                <Text style={{ fontWeight: "700" }}>{item.title}:</Text>{" "}
                {item.summary}
              </Text>
            </Pressable>
            <Pressable
              testID={`active-filter-${item.facet}-remove`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.title} filter`}
              onPress={(): void => {
                onRemove(item.facet);
              }}
              hitSlop={{ top: 4, bottom: 4, right: 4 }}
              style={({ pressed }: { pressed: boolean }): ViewStyle => {
                return {
                  minWidth: 36,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingRight: spacing.xs,
                  borderTopRightRadius: radius.pill,
                  borderBottomRightRadius: radius.pill,
                  opacity: pressed ? 0.6 : 1,
                };
              }}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={theme.colors.actionPrimary}
              />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
