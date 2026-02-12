import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { getServerUrl } from "../../storage/serverUrl";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";

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
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-6">
          <View className="items-center mb-12">
            <Text
              className="text-text-primary font-extrabold text-[32px]"
              style={{ letterSpacing: -1 }}
            >
              OneUptime
            </Text>
            <Text className="text-body-md text-text-secondary mt-1">
              On-Call Management
            </Text>
            <Text className="text-body-sm text-text-tertiary mt-1">
              {serverUrl}
            </Text>
          </View>

          <View className="w-full">
            <Text className="text-body-sm text-text-secondary mb-1.5 font-medium">
              Email
            </Text>
            <TextInput
              className="h-14 rounded-xl px-4 text-base bg-bg-primary text-text-primary"
              style={{
                borderWidth: 1.5,
                borderColor: emailFocused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
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

            <Text className="text-body-sm text-text-secondary mb-1.5 mt-4 font-medium">
              Password
            </Text>
            <TextInput
              className="h-14 rounded-xl px-4 text-base bg-bg-primary text-text-primary"
              style={{
                borderWidth: 1.5,
                borderColor: passwordFocused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
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

            {error ? (
              <Text
                className="text-body-sm mt-2"
                style={{ color: theme.colors.statusError }}
              >
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              className="h-[52px] rounded-xl items-center justify-center mt-6"
              style={{
                backgroundColor: theme.colors.actionPrimary,
                opacity: isLoading ? 0.7 : 1,
                shadowColor: theme.colors.actionPrimary,
                shadowOpacity: 0.3,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 12,
                elevation: 4,
              }}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={theme.colors.textInverse} />
              ) : (
                <Text className="text-body-md text-text-inverse font-bold">
                  Log In
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              className="items-center mt-6 py-2"
              onPress={handleChangeServer}
            >
              <Text
                className="text-body-sm font-medium"
                style={{
                  color: theme.colors.actionPrimary,
                  textDecorationLine: "underline",
                }}
              >
                Change Server
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
