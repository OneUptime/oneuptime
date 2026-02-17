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
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 14,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 8,
          backgroundColor: theme.colors.iconBackground,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <Ionicons
          name={iconName}
          size={13}
          color={theme.colors.actionPrimary}
        />
      </View>
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          textTransform: "uppercase",
          color: theme.colors.textSecondary,
          letterSpacing: 1,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
