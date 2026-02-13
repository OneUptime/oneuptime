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

  const handleChangeServer: () => void = (): void => {
    setNeedsServerUrl(true);
    navigation.navigate("ServerUrl");
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-7">
          <View className="items-center mb-12">
            <View
              className="w-16 h-16 rounded-2xl items-center justify-center mb-5"
              style={{
                backgroundColor: theme.colors.iconBackground,
              }}
            >
              <Logo size={36} />
            </View>

            <Text
              className="text-[30px] font-bold"
              style={{
                color: theme.colors.textPrimary,
                letterSpacing: -1,
              }}
            >
              OneUptime
            </Text>
            <Text
              className="text-[15px] mt-1"
              style={{ color: theme.colors.textSecondary }}
            >
              Sign in to continue
            </Text>

            {serverUrl ? (
              <View
                className="mt-3 px-3 py-1 rounded-lg"
                style={{
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              >
                <Text
                  className="text-[12px]"
                  style={{ color: theme.colors.textTertiary }}
                >
                  {serverUrl}
                </Text>
              </View>
            ) : null}
          </View>

          <View>
            <Text
              className="text-[13px] font-semibold mb-2"
              style={{ color: theme.colors.textSecondary }}
            >
              Email
            </Text>
            <View
              className="flex-row items-center h-[48px] rounded-xl px-3.5"
              style={{
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
                className="flex-1 text-[15px]"
                style={{ color: theme.colors.textPrimary }}
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
              className="text-[13px] font-semibold mb-2 mt-4"
              style={{ color: theme.colors.textSecondary }}
            >
              Password
            </Text>
            <View
              className="flex-row items-center h-[48px] rounded-xl px-3.5"
              style={{
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
                className="flex-1 text-[15px]"
                style={{ color: theme.colors.textPrimary }}
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
              <View className="flex-row items-start mt-3">
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color={theme.colors.statusError}
                  style={{ marginRight: 6, marginTop: 2 }}
                />
                <Text
                  className="text-[13px] flex-1"
                  style={{ color: theme.colors.statusError }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <View className="mt-6">
              <GradientButton
                label="Sign In"
                onPress={handleLogin}
                loading={isLoading}
                disabled={isLoading}
              />
            </View>
          </View>

          <View className="mt-4">
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
