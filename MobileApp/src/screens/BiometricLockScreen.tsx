import React, { useEffect } from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import * as LocalAuthentication from "expo-local-authentication";
import Logo from "../components/Logo";
import GradientHeader from "../components/GradientHeader";
import GradientButton from "../components/GradientButton";

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

  useEffect(() => {
    authenticate();
  }, []);

  return (
    <View className="flex-1 items-center justify-center px-10 bg-bg-primary">
      <GradientHeader height={400} />

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
          <Logo size={48} />
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

      <View className="mt-10 w-full" style={{ maxWidth: 280 }}>
        <GradientButton
          label="Unlock"
          onPress={authenticate}
          icon="finger-print-outline"
        />
      </View>
    </View>
  );
}
