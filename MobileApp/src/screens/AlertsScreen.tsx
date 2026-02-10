import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

export default function AlertsScreen(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.backgroundPrimary },
      ]}
    >
      <Text style={[theme.typography.titleMedium, { color: theme.colors.textPrimary }]}>
        Alerts
      </Text>
      <Text
        style={[
          theme.typography.bodyMedium,
          { color: theme.colors.textSecondary, marginTop: theme.spacing.sm },
        ]}
      >
        Coming soon
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
