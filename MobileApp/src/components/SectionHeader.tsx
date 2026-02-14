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
    <View className="flex-row items-center mb-3.5">
      <View
        className="w-6 h-6 rounded-lg items-center justify-center mr-2"
        style={{
          backgroundColor: theme.colors.iconBackground,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <Ionicons name={iconName} size={13} color={theme.colors.actionPrimary} />
      </View>
      <Text
        className="text-[12px] font-semibold uppercase"
        style={{
          color: theme.colors.textSecondary,
          letterSpacing: 1,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
