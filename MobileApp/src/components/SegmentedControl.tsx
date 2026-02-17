import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTheme } from "../theme";

interface Segment<T extends string> {
  key: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  segments: [Segment<T>, Segment<T>];
  selected: T;
  onSelect: (key: T) => void;
}

export default function SegmentedControl<T extends string>({
  segments,
  selected,
  onSelect,
}: SegmentedControlProps<T>): React.JSX.Element {
  const { theme } = useTheme();
  const activeContentColor: string = theme.isDark
    ? theme.colors.backgroundPrimary
    : "#FFFFFF";

  return (
    <View
      style={{
        flexDirection: "row",
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 8,
        borderRadius: 16,
        padding: 6,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      {segments.map((segment: Segment<T>, index: number) => {
        const isActive: boolean = segment.key === selected;
        return (
          <TouchableOpacity
            key={segment.key}
            activeOpacity={0.7}
            onPress={() => {
              return onSelect(segment.key);
            }}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 10,
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
