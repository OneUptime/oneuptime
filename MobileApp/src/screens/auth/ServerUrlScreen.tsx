import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { setServerUrl } from "../../storage/serverUrl";
import { validateServerUrl } from "../../api/auth";
import Logo from "../../components/Logo";
import GradientButton from "../../components/GradientButton";

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
  const [urlFocused, setUrlFocused] = useState(false);

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
          <View style={{ alignItems: "center", marginBottom: 56 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
                backgroundColor: theme.colors.iconBackground,
              }}
            >
              <Logo size={36} />
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
                marginTop: 8,
                textAlign: "center",
                lineHeight: 22,
                color: theme.colors.textSecondary,
              }}
            >
              Connect to your OneUptime instance
            </Text>
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
              Server URL
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
                borderColor: error
                  ? theme.colors.statusError
                  : urlFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.borderDefault,
              }}
            >
              <Ionicons
                name="globe-outline"
                size={18}
                color={
                  urlFocused
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
                value={url}
                onChangeText={(text: string) => {
                  setUrl(text);
                  setError(null);
                }}
                onFocus={() => {
                  return setUrlFocused(true);
                }}
                onBlur={() => {
                  return setUrlFocused(false);
                }}
                placeholder="https://oneuptime.com"
                placeholderTextColor={theme.colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleConnect}
              />
            </View>

            {error ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 12,
                }}
              >
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color={theme.colors.statusError}
                  style={{ marginRight: 6 }}
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
                label="Connect"
                onPress={handleConnect}
                loading={isLoading}
                disabled={isLoading}
              />
            </View>
          </View>

          <Text
            style={{
              fontSize: 12,
              textAlign: "center",
              marginTop: 24,
              lineHeight: 20,
              color: theme.colors.textTertiary,
            }}
          >
            Self-hosting? Enter your OneUptime server URL above.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
