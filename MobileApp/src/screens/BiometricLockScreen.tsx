import React, { useEffect } from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";
import * as LocalAuthentication from "expo-local-authentication";
import Logo from "../components/Logo";
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
    <View
      className="flex-1 items-center justify-center px-10"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
    >
      <View
        className="w-20 h-20 rounded-2xl items-center justify-center mb-6"
        style={{
          backgroundColor: theme.colors.iconBackground,
        }}
      >
        <Logo size={40} />
      </View>

      <Text
        className="text-[20px] font-bold text-center"
        style={{
          color: theme.colors.textPrimary,
          letterSpacing: -0.3,
        }}
      >
        OneUptime is Locked
      </Text>

      <Text
        className="text-[15px] mt-2 text-center"
        style={{ color: theme.colors.textSecondary }}
      >
        Use {biometricType.toLowerCase()} to unlock
      </Text>

      <View className="mt-10 w-full" style={{ maxWidth: 260 }}>
        <GradientButton
          label="Unlock"
          onPress={authenticate}
          icon="finger-print-outline"
        />
      </View>
    </View>
  );
}
