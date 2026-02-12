import React, { useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
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
      {/* Lock icon */}
      <View
        className="w-20 h-20 rounded-full items-center justify-center"
        style={{ borderWidth: 1.5, borderColor: theme.colors.borderDefault }}
      >
        <View
          className="w-7 h-[22px] rounded mt-2"
          style={{ backgroundColor: theme.colors.textTertiary }}
        />
        <View
          className="w-5 h-4 absolute top-4"
          style={{
            borderWidth: 3,
            borderBottomWidth: 0,
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            borderColor: theme.colors.textTertiary,
          }}
        />
      </View>

      <Text className="text-title-md text-text-primary mt-6 text-center">
        OneUptime is Locked
      </Text>

      <Text className="text-body-md text-text-secondary mt-2 text-center">
        Use {biometricType.toLowerCase()} to unlock
      </Text>

      <TouchableOpacity
        className="mt-8 py-4 px-12 rounded-[14px] min-w-[200px] items-center shadow-md"
        style={{ backgroundColor: theme.colors.actionPrimary }}
        onPress={authenticate}
        activeOpacity={0.8}
      >
        <Text className="text-[17px] font-semibold text-white">Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}
