import React from "react";
import { View, Text, TouchableOpacity, type ViewStyle } from "react-native";
import { useTheme } from "../theme";

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
  const activeContentColor: string = theme.colors.backgroundPrimary;

  return (
    <View
      style={{
        flexDirection: "row",
        marginHorizontal: 20,
        marginTop: 12,
        marginBottom: 8,
        borderRadius: 16,
        padding: 6,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
        ...style,
      }}
    >
      {segments.map((segment: Segment<T>, index: number) => {
        const isActive: boolean = segment.key === selected;
        return (
          <TouchableOpacity
            key={segment.key}
            activeOpacity={0.7}
            /*
             * Which of the two segments is showing is conveyed visually by a
             * filled background and nothing else, and a filled background is
             * not something a screen reader can read out. Without the role and
             * the selected state, VoiceOver and TalkBack announce two
             * identical, unrelated buttons - "Alerts", "Episodes" - and give a
             * responder no way to tell which list is under them.
             */
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected: isActive }}
            onPress={() => {
              return onSelect(segment.key);
            }}
            style={{
              flex: 1,
              minHeight: 48,
              justifyContent: "center",
              alignItems: "center",
              paddingVertical: 10,
              paddingHorizontal: 8,
              borderRadius: 12,
              marginLeft: index > 0 ? 4 : 0,
              backgroundColor: isActive
                ? theme.colors.actionPrimary
                : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                textAlign: "center",
                fontWeight: "600",
                color: isActive
                  ? activeContentColor
                  : theme.colors.textSecondary,
                letterSpacing: 0.2,
              }}
            >
              {segment.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
