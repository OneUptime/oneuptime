import React, { useContext, useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { elevation, typography } from "../theme/tokens";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function OfflineBanner(): React.JSX.Element | null {
  const { theme } = useTheme();
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const slideAnim: Animated.Value = useRef(new Animated.Value(-60)).current;

  const isOffline: boolean = !isConnected || isInternetReachable === false;

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
      /*
       * The banner is an absolutely positioned strip across the very top of
       * the screen - App.tsx renders it above the whole navigator - and it is
       * purely informational: there is nothing on it to press. Without this it
       * is still a touch target, so for as long as the device is offline it
       * eats every tap that lands in that strip, the navigation header's back
       * button included. Being offline is exactly when a responder jabs at the
       * screen hardest, so a banner that silently deadens the top of the app
       * reads as the app having frozen.
       */
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        /* Clear the status bar and notch on any device, not a guessed 50 points. */
        paddingTop: (insets?.top ?? 0) + 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
        backgroundColor: theme.colors.statusError,
        transform: [{ translateY: slideAnim }],
        ...elevation("raised", theme.dark),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name="cloud-offline-outline"
          size={16}
          color={theme.colors.textInverse}
          style={{ marginRight: 8 }}
        />
        <Text
          style={{
            ...typography.subhead,
            fontWeight: "600",
            color: theme.colors.textInverse,
          }}
        >
          No internet connection
        </Text>
      </View>
    </Animated.View>
  );
}
