import React, { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function OfflineBanner(): React.JSX.Element | null {
  const { theme } = useTheme();
  const { isConnected, isInternetReachable } = useNetworkStatus();
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
      className="absolute top-0 left-0 right-0 z-[100] pt-[50px] pb-2.5 px-4"
      style={{
        backgroundColor: theme.colors.statusError,
        transform: [{ translateY: slideAnim }],
        shadowColor: theme.colors.statusError,
        shadowOpacity: 0.3,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      <View className="flex-row items-center justify-center">
        <Ionicons
          name="cloud-offline-outline"
          size={16}
          color="#FFFFFF"
          style={{ marginRight: 8, opacity: 0.9 }}
        />
        <Text className="text-[13px] font-semibold tracking-tight text-white">
          No internet connection
        </Text>
      </View>
    </Animated.View>
  );
}
