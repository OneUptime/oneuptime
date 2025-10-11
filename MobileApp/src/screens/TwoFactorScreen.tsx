import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Toast from "react-native-toast-message";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import * as AuthAPI from "@/api/auth";

export const TwoFactorScreen: React.FC = () => {
  const { verifyTotp, pendingTwoFactor, isLoading, cancelTwoFactor } =
    useAuth();
  const [code, setCode] = useState<string>("");
  const devices = useMemo<AuthAPI.TotpAuthDevice[]>(
    () => pendingTwoFactor?.totpDevices || [],
    [pendingTwoFactor],
  );

  const deviceLabel = useMemo(() => {
    if (!devices.length) {
      return "Authenticator";
    }

    return devices[0]?.name || "Authenticator";
  }, [devices]);

  const handleVerify = async () => {
    if (!pendingTwoFactor) {
      Toast.show({
        type: "error",
        text1: "Session expired",
        text2: "Please start the sign-in process again.",
      });
      return;
    }

    if (!code) {
      Toast.show({
        type: "error",
        text1: "Enter your verification code",
      });
      return;
    }

    try {
  const deviceId = devices[0]?.id;
      if (!deviceId) {
        Toast.show({
          type: "error",
          text1: "Two-factor device missing",
          text2: "Please contact your administrator.",
        });
        return;
      }

      await verifyTotp(code.trim(), deviceId);
    } catch (error) {
      const message =
        (error as { message?: string })?.message ||
        "The verification code was invalid or expired.";

      Toast.show({
        type: "error",
        text1: "Verification failed",
        text2: message,
      });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen centerContent>
        <View style={styles.card}>
          <Text style={styles.heading}>Two-factor authentication</Text>
          <Text style={styles.subtitle}>
            Enter the code from your {deviceLabel} to continue.
          </Text>

          <View style={styles.form}>
            <TextField
              label="Verification code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              returnKeyType="done"
              autoFocus
            />
            <Button
              title="Verify"
              onPress={handleVerify}
              loading={isLoading}
            />
            <Button
              title="Back to sign-in"
              variant="secondary"
              onPress={cancelTwoFactor}
              disabled={isLoading}
            />
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F1F5F9",
  },
  card: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 2,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 24,
  },
  form: {
    gap: 16,
  },
});
