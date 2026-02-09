import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

interface ProjectBadgeProps {
  name: string;
  color?: string;
}

export default function ProjectBadge({
  name,
  color,
}: ProjectBadgeProps): React.JSX.Element {
  const { theme } = useTheme();

  const dotColor = color || theme.colors.actionPrimary;

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text
        style={[
          theme.typography.bodySmall,
          { color: theme.colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
});
