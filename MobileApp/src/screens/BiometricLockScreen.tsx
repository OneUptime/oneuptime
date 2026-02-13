import React, { useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import * as LocalAuthentication from "expo-local-authentication";

interface BiometricLockScreenProps {
  onSuccess: () => void;
  biometricType: string;
}

export default function BiometricLockScreen({
  onSuccess,
  biometricType,
}: BiometricLockScreenProps): React.JSX.Element {
  const { theme } = useTheme();

  const authenticate: () => Promise<void> = async (): Promise<void> => {
    const result: LocalAuthentication.LocalAuthenticationResult =
      await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock OneUptime",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });
    if (result.success) {
      onSuccess();
    }
  };

  // Auto-prompt on mount
  useEffect(() => {
    authenticate();
  }, []);

  return (
    <View className="flex-1 items-center justify-center px-10 bg-bg-primary">
      {/* Outer glow ring */}
      <View
        className="w-[120px] h-[120px] rounded-full items-center justify-center"
        style={{ backgroundColor: theme.colors.surfaceGlow }}
      >
        {/* Inner icon container */}
        <View
          className="w-[88px] h-[88px] rounded-[22px] items-center justify-center"
          style={{
            backgroundColor: theme.colors.actionPrimary + "18",
            shadowColor: theme.colors.actionPrimary,
            shadowOpacity: 0.2,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 24,
            elevation: 8,
          }}
        >
          <Ionicons
            name="lock-closed"
            size={40}
            color={theme.colors.actionPrimary}
          />
        </View>
      </View>

      <Text
        className="text-title-md text-text-primary mt-7 text-center"
        style={{ letterSpacing: -0.3 }}
      >
        OneUptime is Locked
      </Text>

      <Text className="text-body-md text-text-secondary mt-2.5 text-center leading-6">
        Use {biometricType.toLowerCase()} to unlock
      </Text>

      <TouchableOpacity
        className="mt-10 py-4 w-full rounded-xl items-center"
        style={{
          backgroundColor: theme.colors.actionPrimary,
          shadowColor: theme.colors.actionPrimary,
          shadowOpacity: 0.35,
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 16,
          elevation: 6,
          maxWidth: 280,
        }}
        onPress={authenticate}
        activeOpacity={0.85}
      >
        <View className="flex-row items-center">
          <Ionicons
            name="finger-print-outline"
            size={20}
            color="#FFFFFF"
            style={{ marginRight: 8 }}
          />
          <Text className="text-[17px] font-semibold text-white">Unlock</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}
