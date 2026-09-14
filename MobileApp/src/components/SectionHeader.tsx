import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

interface SectionHeaderProps {
  title: string;
  iconName?: keyof typeof Ionicons.glyphMap;
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
      {iconName ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 0,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 8,
            backgroundColor: "transparent",
            borderWidth: 0,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Ionicons
            name={iconName}
            size={18}
            color={theme.colors.textTertiary}
          />
        </View>
      ) : null}
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
