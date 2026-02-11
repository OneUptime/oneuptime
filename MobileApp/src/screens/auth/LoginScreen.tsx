import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ViewStyle,
  TextStyle,
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
      style={[styles.flex, { backgroundColor: theme.colors.backgroundPrimary }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text
              style={[
                theme.typography.titleLarge,
                { color: theme.colors.textPrimary },
              ]}
            >
              OneUptime
            </Text>
            <Text
              style={[
                theme.typography.bodySmall,
                {
                  color: theme.colors.textTertiary,
                  marginTop: theme.spacing.xs,
                },
              ]}
            >
              {serverUrl}
            </Text>
          </View>

          <View style={styles.form}>
            <Text
              style={[
                theme.typography.bodySmall,
                {
                  color: theme.colors.textSecondary,
                  marginBottom: theme.spacing.xs,
                },
              ]}
            >
              Email
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderColor: theme.colors.borderDefault,
                  color: theme.colors.textPrimary,
                },
              ]}
              value={email}
              onChangeText={(text: string) => {
                setEmail(text);
                setError(null);
              }}
              placeholder="you@example.com"
              placeholderTextColor={theme.colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
            />

            <Text
              style={[
                theme.typography.bodySmall,
                {
                  color: theme.colors.textSecondary,
                  marginBottom: theme.spacing.xs,
                  marginTop: theme.spacing.md,
                },
              ]}
            >
              Password
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderColor: theme.colors.borderDefault,
                  color: theme.colors.textPrimary,
                },
              ]}
              value={password}
              onChangeText={(text: string) => {
                setPassword(text);
                setError(null);
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
                style={[
                  theme.typography.bodySmall,
                  {
                    color: theme.colors.statusError,
                    marginTop: theme.spacing.sm,
                  },
                ]}
              >
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.button,
                {
                  backgroundColor: theme.colors.actionPrimary,
                  opacity: isLoading ? 0.7 : 1,
                },
              ]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={theme.colors.textInverse} />
              ) : (
                <Text
                  style={[
                    theme.typography.bodyMedium,
                    { color: theme.colors.textInverse, fontWeight: "600" },
                  ]}
                >
                  Log In
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.changeServer}
              onPress={handleChangeServer}
            >
              <Text
                style={[
                  theme.typography.bodySmall,
                  { color: theme.colors.actionPrimary },
                ]}
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

const styles: {
  flex: ViewStyle;
  scrollContent: ViewStyle;
  container: ViewStyle;
  header: ViewStyle;
  form: ViewStyle;
  input: TextStyle;
  button: ViewStyle;
  changeServer: ViewStyle;
} = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  form: {
    width: "100%",
  },
  input: {
    height: 56,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  changeServer: {
    alignItems: "center",
    marginTop: 24,
    paddingVertical: 8,
  },
});
