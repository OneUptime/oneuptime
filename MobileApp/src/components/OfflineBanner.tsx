import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useTheme } from "../theme";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function OfflineBanner(): React.JSX.Element | null {
  const { theme } = useTheme();
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const slideAnim = useRef(new Animated.Value(-60)).current;

  const isOffline = !isConnected || isInternetReachable === false;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: isOffline ? 0 : -60,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [isOffline, slideAnim]);

  if (!isOffline) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.statusError,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.dot} />
        <Text style={[styles.text, { color: "#FFFFFF" }]}>
          No internet connection
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingTop: 50,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
    marginRight: 8,
    opacity: 0.8,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
