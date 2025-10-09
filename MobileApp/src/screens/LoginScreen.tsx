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

export const LoginScreen: React.FC = () => {
  const { login, isLoading, pendingTwoFactor } = useAuth();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const title = useMemo(() => {
    if (pendingTwoFactor) {
      return "Complete multi-factor authentication to finish signing in.";
    }

    return "Sign in to OneUptime";
  }, [pendingTwoFactor]);

  const handleSubmit = async () => {
    try {
      if (!email || !password) {
        Toast.show({
          type: "error",
          text1: "Please enter email and password",
        });
        return;
      }

      await login(email.trim(), password);
    } catch (error) {
      const message =
        (error as { message?: string })?.message ||
        "We couldn't sign you in. Check your credentials and try again.";

      Toast.show({
        type: "error",
        text1: "Sign in failed",
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
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.subtitle}>
            Use the same credentials as the OneUptime dashboard.
          </Text>

          <View style={styles.form}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="username"
              returnKeyType="next"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              returnKeyType="done"
            />
            <Button
              title={pendingTwoFactor ? "Continue" : "Sign in"}
              onPress={handleSubmit}
              loading={isLoading}
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
