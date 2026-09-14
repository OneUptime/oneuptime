import React, { useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useTheme } from "../theme";
import AuthLayout from "../components/AuthLayout";
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
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending: React.MutableRefObject<boolean> = useRef(false);

  const authenticate: () => Promise<void> = async (): Promise<void> => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setIsAuthenticating(true);
    setNotice(null);
    try {
      const result: LocalAuthentication.LocalAuthenticationResult =
        await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock OneUptime",
          fallbackLabel: "Use passcode",
          disableDeviceFallback: false,
        });
      if (result.success) {
        onSuccess();
      } else {
        setNotice(
          "Your app is still locked. Try again, or use your device passcode in the unlock prompt.",
        );
      }
    } catch {
      setNotice("The unlock prompt could not open. Tap Unlock to try again.");
    } finally {
      pending.current = false;
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    void authenticate();
  }, []);

  return (
    <AuthLayout
      showBrand
      title="Unlock your workspace"
      eyebrow="WELCOME BACK"
      compact
      description={`Use ${biometricType.toLowerCase()} to unlock`}
    >
      <View
        style={{
          paddingVertical: 24,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: theme.colors.borderSubtle,
          marginBottom: 24,
        }}
      >
        <Ionicons
          name="lock-closed-outline"
          size={32}
          color={theme.colors.actionPrimary}
          style={{ marginBottom: 16 }}
        />
        <Text
          style={{
            fontSize: 17,
            fontWeight: "600",
            color: theme.colors.textPrimary,
          }}
        >
          Your workspace is protected
        </Text>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 23,
            marginTop: 8,
            color: theme.colors.textSecondary,
          }}
        >
          Confirm it is you to return to your incidents and on-call work. Your
          device passcode is also available in the unlock prompt.
        </Text>
      </View>
      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontSize: 15,
            lineHeight: 23,
            marginBottom: 20,
            color: theme.colors.textSecondary,
          }}
        >
          {notice}
        </Text>
      ) : null}
      <GradientButton
        label="Unlock"
        onPress={authenticate}
        loading={isAuthenticating}
        disabled={isAuthenticating}
        icon="finger-print-outline"
      />
    </AuthLayout>
  );
}
