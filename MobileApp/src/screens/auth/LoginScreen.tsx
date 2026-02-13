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
import GradientHeader from "../../components/GradientHeader";
import GlassCard from "../../components/GlassCard";
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
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <GradientHeader />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-7">
          <View className="items-center mb-12">
            <View
              className="w-20 h-20 rounded-[22px] items-center justify-center mb-6"
              style={{
                backgroundColor: theme.colors.backgroundTertiary,
                shadowColor: "#000000",
                shadowOpacity: 0.3,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 16,
                elevation: 6,
              }}
            >
              <Logo size={48} />
            </View>

            <Text
              className="text-text-primary font-extrabold text-[34px]"
              style={{ letterSpacing: -1.2 }}
            >
              OneUptime
            </Text>
            <Text className="text-body-md text-text-secondary mt-1">
              On-Call Management
            </Text>

            {serverUrl ? (
              <View
                className="mt-2 px-4 py-1.5 rounded-full"
                style={{
                  backgroundColor: theme.colors.backgroundGlass,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                }}
              >
                <Text className="text-body-sm text-text-tertiary">
                  {serverUrl}
                </Text>
              </View>
            ) : null}
          </View>

          <GlassCard style={{ padding: 20 }}>
            <Text className="text-body-sm text-text-secondary mb-2 font-semibold">
              Email
            </Text>
            <View
              className="flex-row items-center h-[52px] rounded-xl px-3.5"
              style={{
                backgroundColor: theme.colors.backgroundPrimary,
                borderWidth: 1.5,
                borderColor: emailFocused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
              }}
            >
              <Ionicons
                name="mail-outline"
                size={20}
                color={
                  emailFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
                style={{ marginRight: 10 }}
              />
              <TextInput
                className="flex-1 text-base text-text-primary"
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

            <Text className="text-body-sm text-text-secondary mb-2 mt-4 font-semibold">
              Password
            </Text>
            <View
              className="flex-row items-center h-[52px] rounded-xl px-3.5"
              style={{
                backgroundColor: theme.colors.backgroundPrimary,
                borderWidth: 1.5,
                borderColor: passwordFocused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
              }}
            >
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={
                  passwordFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
                style={{ marginRight: 10 }}
              />
              <TextInput
                className="flex-1 text-base text-text-primary"
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
              <View className="flex-row items-start mt-2.5">
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color={theme.colors.statusError}
                  style={{ marginRight: 6, marginTop: 2 }}
                />
                <Text
                  className="text-body-sm flex-1"
                  style={{ color: theme.colors.statusError }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <View className="mt-5">
              <GradientButton
                label="Log In"
                onPress={handleLogin}
                loading={isLoading}
                disabled={isLoading}
              />
            </View>
          </GlassCard>

          <View className="mt-5">
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
