import React from "react";
import { View, TouchableOpacity, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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
      className="flex-row mx-4 mt-3 mb-1 rounded-xl p-1"
      style={{ backgroundColor: theme.colors.backgroundSecondary }}
    >
      {segments.map((segment: Segment<T>) => {
        const isActive: boolean = segment.key === selected;
        return (
          <TouchableOpacity
            key={segment.key}
            className="flex-1 items-center py-2.5 rounded-[10px] overflow-hidden"
            style={
              isActive
                ? {
                    shadowColor: theme.colors.accentGradientStart,
                    shadowOpacity: 0.3,
                    shadowOffset: { width: 0, height: 2 },
                    shadowRadius: 6,
                    elevation: 3,
                  }
                : undefined
            }
            onPress={() => {
              return onSelect(segment.key);
            }}
            activeOpacity={0.7}
          >
            {isActive ? (
              <LinearGradient
                colors={[
                  theme.colors.accentGradientStart,
                  theme.colors.accentGradientEnd,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
            ) : null}
            <Text
              className="text-body-sm font-semibold"
              style={{
                color: isActive ? "#FFFFFF" : theme.colors.textTertiary,
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
