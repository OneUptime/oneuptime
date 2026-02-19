import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { getServerUrl } from "../../storage/serverUrl";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import Logo from "../../components/Logo";
import GradientButton from "../../components/GradientButton";

type LoginNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "Login"
>;

export default function LoginScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { login, setNeedsServerUrl } = useAuth();
  const navigation: LoginNavigationProp = useNavigation<LoginNavigationProp>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrlState] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  useEffect(() => {
    getServerUrl().then(setServerUrlState);
  }, []);

  const handleLogin: () => Promise<void> = async (): Promise<void> => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response: LoginResponse = await login(email.trim(), password);

      if (response.twoFactorRequired) {
        setError(
          "Two-factor authentication is not yet supported in the mobile app. Please disable 2FA temporarily or use the web dashboard.",
        );
      }
    } catch (err: any) {
      const message: string =
        err?.response?.data?.message ||
        err?.message ||
        "Login failed. Please check your credentials.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSSOLogin: () => void = (): void => {
    navigation.navigate("SSOLogin");
  };

  const handleChangeServer: () => void = (): void => {
    setNeedsServerUrl(true);
    navigation.navigate("ServerUrl");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28 }}
        >
          <View style={{ alignItems: "center", marginBottom: 48 }}>
            <View
              style={{
                borderWidth: 2,
                borderColor: theme.colors.borderDefault,
                borderRadius: 20,
                marginBottom: 20,
                overflow: "hidden",
              }}
            >
              <Logo size={90} />
            </View>

            <Text
              style={{
                fontSize: 30,
                fontWeight: "bold",
                color: theme.colors.textPrimary,
                letterSpacing: -1,
              }}
            >
              OneUptime
            </Text>
            <Text
              style={{
                fontSize: 15,
                marginTop: 4,
                color: theme.colors.textSecondary,
              }}
            >
              Sign in to continue
            </Text>

            {serverUrl ? (
              <View
                style={{
                  marginTop: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              >
                <Text
                  style={{ fontSize: 12, color: theme.colors.textTertiary }}
                >
                  {serverUrl}
                </Text>
              </View>
            ) : null}
          </View>

          <View>
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                marginBottom: 8,
                color: theme.colors.textSecondary,
              }}
            >
              Email
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                height: 48,
                borderRadius: 12,
                paddingHorizontal: 14,
                backgroundColor: theme.colors.backgroundSecondary,
                borderWidth: 1.5,
                borderColor: emailFocused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
              }}
            >
              <Ionicons
                name="mail-outline"
                size={18}
                color={
                  emailFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
                style={{ marginRight: 10 }}
              />
              <TextInput
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: theme.colors.textPrimary,
                }}
                value={email}
                onChangeText={(text: string) => {
                  setEmail(text);
                  setError(null);
                }}
                onFocus={() => {
                  return setEmailFocused(true);
                }}
                onBlur={() => {
                  return setEmailFocused(false);
                }}
                placeholder="you@example.com"
                placeholderTextColor={theme.colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
              />
            </View>

            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                marginBottom: 8,
                marginTop: 16,
                color: theme.colors.textSecondary,
              }}
            >
              Password
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                height: 48,
                borderRadius: 12,
                paddingHorizontal: 14,
                backgroundColor: theme.colors.backgroundSecondary,
                borderWidth: 1.5,
                borderColor: passwordFocused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
              }}
            >
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={
                  passwordFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
                style={{ marginRight: 10 }}
              />
              <TextInput
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: theme.colors.textPrimary,
                }}
                value={password}
                onChangeText={(text: string) => {
                  setPassword(text);
                  setError(null);
                }}
                onFocus={() => {
                  return setPasswordFocused(true);
                }}
                onBlur={() => {
                  return setPasswordFocused(false);
                }}
                placeholder="Your password"
                placeholderTextColor={theme.colors.textTertiary}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
            </View>

            {error ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  marginTop: 12,
                }}
              >
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color={theme.colors.statusError}
                  style={{ marginRight: 6, marginTop: 2 }}
                />
                <Text
                  style={{
                    fontSize: 13,
                    flex: 1,
                    color: theme.colors.statusError,
                  }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 24 }}>
              <GradientButton
                label="Sign In"
                onPress={handleLogin}
                loading={isLoading}
                disabled={isLoading}
              />
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            <GradientButton
              label="Sign in with SSO"
              onPress={handleSSOLogin}
              variant="secondary"
              icon="shield-checkmark-outline"
            />
          </View>

          <View style={{ marginTop: 12 }}>
            <GradientButton
              label="Change Server"
              onPress={handleChangeServer}
              variant="secondary"
              icon="swap-horizontal-outline"
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
