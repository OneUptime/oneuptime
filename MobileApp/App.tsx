import React from "react";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import Styles from "./Styles";

export default function App(): React.ReactElement {
  return (
    <View style={Styles.container}>
      <Text style={Styles.title}>Welcome to OneUptime Mobile</Text>
      <Text style={Styles.subtitle}>Your monitoring app on the go</Text>
      <StatusBar style="auto" />
    </View>
  );
}
