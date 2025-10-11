import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";

export const AlertsScreen: React.FC = () => {
  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.title}>Alerts</Text>
        <Text style={styles.subtitle}>
          Track active alerts and respond quickly. Detailed data will live here.
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
