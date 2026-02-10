import React, { useState } from "react";
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
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { setServerUrl } from "../../storage/serverUrl";
import { validateServerUrl } from "../../api/auth";

type ServerUrlNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "ServerUrl"
>;

export default function ServerUrlScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { setNeedsServerUrl } = useAuth();
  const navigation: ServerUrlNavigationProp =
    useNavigation<ServerUrlNavigationProp>();
  const [url, setUrl] = useState("https://oneuptime.com");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect: () => Promise<void> = async (): Promise<void> => {
    if (!url.trim()) {
      setError("Please enter a server URL");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const normalizedUrl: string = url.trim().replace(/\/+$/, "");
      const isValid: boolean = await validateServerUrl(normalizedUrl);

      if (!isValid) {
        setError(
          "Could not connect to the server. Please check the URL and try again.",
        );
        return;
      }

      await setServerUrl(normalizedUrl);
      setNeedsServerUrl(false);
      navigation.navigate("Login");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
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
                theme.typography.bodyMedium,
                {
                  color: theme.colors.textSecondary,
                  marginTop: theme.spacing.sm,
                  textAlign: "center",
                },
              ]}
            >
              Connect to your OneUptime instance
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
              Server URL
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderColor: error
                    ? theme.colors.statusError
                    : theme.colors.borderDefault,
                  color: theme.colors.textPrimary,
                },
              ]}
              value={url}
              onChangeText={(text: string) => {
                setUrl(text);
                setError(null);
              }}
              placeholder="https://oneuptime.com"
              placeholderTextColor={theme.colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleConnect}
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
              onPress={handleConnect}
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
                  Connect
                </Text>
              )}
            </TouchableOpacity>

            <Text
              style={[
                theme.typography.caption,
                {
                  color: theme.colors.textTertiary,
                  textAlign: "center",
                  marginTop: theme.spacing.lg,
                },
              ]}
            >
              Self-hosting? Enter your OneUptime server URL above.
            </Text>
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
    marginTop: 16,
  },
});
