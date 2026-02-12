import React, { useState } from "react";
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
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-6">
          <View className="items-center mb-12">
            <Text className="text-text-primary font-extrabold text-[28px] tracking-tight">
              OneUptime
            </Text>
            <Text className="text-body-md text-text-secondary mt-2 text-center">
              Connect to your OneUptime instance
            </Text>
          </View>

          <View className="w-full">
            <Text className="text-body-sm text-text-secondary mb-1">
              Server URL
            </Text>
            <TextInput
              className="h-14 border rounded-[14px] px-4 text-base bg-bg-primary text-text-primary"
              style={{
                borderColor: error
                  ? theme.colors.statusError
                  : theme.colors.borderDefault,
              }}
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
              <Text className="text-body-sm mt-2" style={{ color: theme.colors.statusError }}>
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              className="h-[52px] rounded-[14px] items-center justify-center mt-6 shadow-md"
              style={{
                backgroundColor: theme.colors.actionPrimary,
                opacity: isLoading ? 0.7 : 1,
              }}
              onPress={handleConnect}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={theme.colors.textInverse} />
              ) : (
                <Text className="text-body-md text-text-inverse font-bold">
                  Connect
                </Text>
              )}
            </TouchableOpacity>

            <Text className="text-caption text-text-tertiary text-center mt-6">
              Self-hosting? Enter your OneUptime server URL above.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
