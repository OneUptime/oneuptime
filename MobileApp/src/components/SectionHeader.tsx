import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

interface SectionHeaderProps {
  title: string;
  iconName: keyof typeof Ionicons.glyphMap;
}

export default function SectionHeader({
  title,
  iconName,
}: SectionHeaderProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View className="flex-row items-center mb-3">
      <Ionicons
        name={iconName}
        size={14}
        color={theme.colors.textTertiary}
        style={{ marginRight: 6 }}
      />
      <Text
        className="text-[12px] font-semibold uppercase"
        style={{
          color: theme.colors.textTertiary,
          letterSpacing: 0.8,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
