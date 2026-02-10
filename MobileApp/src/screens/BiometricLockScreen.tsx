import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
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

  const authenticate = async (): Promise<void> => {
    const result = await LocalAuthentication.authenticateAsync({
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
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.backgroundPrimary },
      ]}
    >
      {/* Lock icon */}
      <View
        style={[
          styles.iconContainer,
          { borderColor: theme.colors.borderDefault },
        ]}
      >
        <View
          style={[
            styles.lockBody,
            { backgroundColor: theme.colors.textTertiary },
          ]}
        />
        <View
          style={[
            styles.lockShackle,
            { borderColor: theme.colors.textTertiary },
          ]}
        />
      </View>

      <Text
        style={[
          theme.typography.titleMedium,
          {
            color: theme.colors.textPrimary,
            marginTop: 24,
            textAlign: "center",
          },
        ]}
      >
        OneUptime is Locked
      </Text>

      <Text
        style={[
          theme.typography.bodyMedium,
          {
            color: theme.colors.textSecondary,
            marginTop: 8,
            textAlign: "center",
          },
        ]}
      >
        Use {biometricType.toLowerCase()} to unlock
      </Text>

      <TouchableOpacity
        style={[
          styles.unlockButton,
          { backgroundColor: theme.colors.actionPrimary },
        ]}
        onPress={authenticate}
        activeOpacity={0.8}
      >
        <Text style={[styles.unlockButtonText, { color: "#FFFFFF" }]}>
          Unlock
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  lockBody: {
    width: 28,
    height: 22,
    borderRadius: 4,
    marginTop: 8,
  },
  lockShackle: {
    width: 20,
    height: 16,
    borderWidth: 3,
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    position: "absolute",
    top: 16,
  },
  unlockButton: {
    marginTop: 32,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 200,
    alignItems: "center",
  },
  unlockButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
