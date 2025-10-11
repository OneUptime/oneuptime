import React from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View, ViewStyle, TextStyle } from "react-native";

export default function App(): React.ReactElement {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to OneUptime Mobile</Text>
      <Text style={styles.subtitle}>Your monitoring app on the go</Text>
      <StatusBar style="auto" />
    </View>
  );
}

type StylesType = {
  container: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
};

const styles: StylesType = StyleSheet.create<StylesType>({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
});
