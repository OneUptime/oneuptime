import React, { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
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
      className="absolute top-0 left-0 right-0 z-[100] pt-[50px] pb-2 px-4"
      style={{
        backgroundColor: theme.colors.statusError,
        transform: [{ translateY: slideAnim }],
      }}
    >
      <View className="flex-row items-center justify-center">
        <View className="w-1.5 h-1.5 rounded-full bg-white mr-2 opacity-80" />
        <Text className="text-[13px] font-semibold tracking-tight text-white">
          No internet connection
        </Text>
      </View>
    </Animated.View>
  );
}
