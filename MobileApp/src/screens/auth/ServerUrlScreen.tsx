import React, { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { setServerUrl } from "../../storage/serverUrl";
import { validateServerUrl } from "../../api/auth";
import AuthLayout from "../../components/AuthLayout";
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
    if (isLoading) {
      return;
    }
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
    <AuthLayout
      showBrand
      compact
      title="Connect your workspace"
      description="Enter your team's OneUptime address to get started."
    >
      <View
        style={{
          paddingVertical: 8,
        }}
      >
        <Text
          style={{
            fontSize: 14,
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
            minHeight: 56,
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
            accessibilityLabel="Server URL"
            accessibilityHint="Enter the full address of your OneUptime server, including https://."
            editable={!isLoading}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 16,
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
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
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
                fontSize: 14,
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
          fontSize: 14,
          textAlign: "left",
          marginTop: 24,
          lineHeight: 20,
          color: theme.colors.textTertiary,
        }}
      >
        Using OneUptime Cloud? Keep the address above. Self-hosting? Enter your
        own server URL.
      </Text>
    </AuthLayout>
  );
}
