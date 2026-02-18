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
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 40,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
          backgroundColor: theme.colors.iconBackground,
        }}
      >
        <Logo size={40} />
      </View>

      <Text
        style={{
          fontSize: 20,
          fontWeight: "bold",
          textAlign: "center",
          color: theme.colors.textPrimary,
          letterSpacing: -0.3,
        }}
      >
        OneUptime is Locked
      </Text>

      <Text
        style={{
          fontSize: 15,
          marginTop: 8,
          textAlign: "center",
          color: theme.colors.textSecondary,
        }}
      >
        Use {biometricType.toLowerCase()} to unlock
      </Text>

      <View style={{ marginTop: 40, width: "100%", maxWidth: 260 }}>
        <GradientButton
          label="Unlock"
          onPress={authenticate}
          icon="finger-print-outline"
        />
      </View>
    </View>
  );
}
