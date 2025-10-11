import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";

export const MonitorsScreen: React.FC = () => {
  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.title}>Monitors</Text>
        <Text style={styles.subtitle}>
          View important monitor statuses and uptime metrics at a glance.
        </Text>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 14,
    color: "#475569",
  },
});
