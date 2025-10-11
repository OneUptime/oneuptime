import React from "react";
import { SafeAreaView, StyleSheet, View, ViewProps } from "react-native";

interface ScreenProps extends Omit<ViewProps, "style"> {
  children: React.ReactNode;
  centerContent?: boolean;
  style?: ViewProps["style"];
}

export const Screen: React.FC<ScreenProps> = ({
  children,
  centerContent = false,
  style,
  ...rest
}: ScreenProps) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View
        style={[styles.container, centerContent ? styles.center : null, style]}
        {...rest}
      >
        {children}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  container: {
    flex: 1,
    padding: 24,
  },
  center: {
    justifyContent: "center",
  },
});
