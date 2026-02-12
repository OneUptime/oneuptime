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

  return (
    <View
      className="flex-row mx-4 mt-3 mb-1 rounded-[10px] p-1"
      style={{ backgroundColor: theme.colors.backgroundSecondary }}
    >
      {segments.map((segment: Segment<T>) => {
        const isActive: boolean = segment.key === selected;
        return (
          <TouchableOpacity
            key={segment.key}
            className="flex-1 items-center py-2 rounded-lg"
            style={
              isActive
                ? {
                    backgroundColor: theme.colors.backgroundPrimary,
                    shadowColor: "#000",
                    shadowOpacity: 0.08,
                    shadowOffset: { width: 0, height: 1 },
                    shadowRadius: 2,
                    elevation: 2,
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
                color: isActive
                  ? theme.colors.textPrimary
                  : theme.colors.textTertiary,
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
