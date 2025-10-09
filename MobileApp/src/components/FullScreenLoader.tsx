import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export const FullScreenLoader: React.FC = () => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2D63F7" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
});
