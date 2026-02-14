import React from "react";
import { View, TouchableOpacity, Text } from "react-native";
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
      className="flex-row mx-4 mt-3 mb-2 rounded-2xl p-1.5"
      style={{
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      {segments.map((segment: Segment<T>) => {
        const isActive: boolean = segment.key === selected;
        return (
          <TouchableOpacity
            key={segment.key}
            className="flex-1 items-center py-2.5 rounded-xl"
            style={
              isActive
                ? {
                    backgroundColor: theme.colors.actionPrimary,
                    shadowColor: theme.colors.actionPrimary,
                    shadowOpacity: theme.isDark ? 0.28 : 0.18,
                    shadowOffset: { width: 0, height: 5 },
                    shadowRadius: 10,
                    elevation: 4,
                  }
                : undefined
            }
            onPress={() => {
              return onSelect(segment.key);
            }}
            activeOpacity={0.7}
          >
            <Text
              className="text-body-sm font-semibold"
              style={{
                color: isActive ? activeContentColor : theme.colors.textSecondary,
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
