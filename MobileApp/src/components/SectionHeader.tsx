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
        accessibilityRole="header"
        style={{
          fontSize: 18,
          fontWeight: "700",
          flex: 1,
          color: theme.colors.textPrimary,
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
