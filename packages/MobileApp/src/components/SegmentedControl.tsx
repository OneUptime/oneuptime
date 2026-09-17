import React from "react";
import { View, Text, Pressable, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { elevation, radius, spacing, typography } from "../theme/tokens";

interface Segment<T extends string> {
  key: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  segments: Array<Segment<T>>;
  selected: T;
  onSelect: (key: T) => void;
  style?: ViewStyle;
}

export default function SegmentedControl<T extends string>({
  segments,
  selected,
  onSelect,
  style,
}: SegmentedControlProps<T>): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        marginHorizontal: spacing.xl,
        marginTop: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: radius.md,
        padding: 3,
        gap: 3,
        backgroundColor: theme.colors.backgroundTertiary,
        ...style,
      }}
    >
      {segments.map((segment: Segment<T>) => {
        const isActive: boolean = segment.key === selected;
        return (
          <Pressable
            key={segment.key}
            /*
             * Which segment is showing is conveyed visually by a filled
             * background, which a screen reader cannot read out. Without the
             * role and the selected state, VoiceOver and TalkBack announce
             * identical, unrelated buttons and give a responder no way to tell
             * which list is under them.
             */
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected: isActive }}
            aria-selected={isActive}
            onPress={() => {
              return onSelect(segment.key);
            }}
            style={({ pressed }: { pressed: boolean }): ViewStyle => {
              return {
                flex: 1,
                minHeight: 44,
                justifyContent: "center",
                alignItems: "center",
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.md - 3,
                backgroundColor: isActive
                  ? theme.colors.backgroundElevated
                  : "transparent",
                opacity: pressed && !isActive ? 0.6 : 1,
                ...(isActive ? elevation("card", theme.dark) : {}),
              };
            }}
          >
            <Text
              style={{
                ...typography.subhead,
                textAlign: "center",
                fontWeight: isActive ? "700" : "500",
                color: isActive
                  ? theme.colors.textPrimary
                  : theme.colors.textSecondary,
              }}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
