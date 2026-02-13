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
      className="flex-1"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-7">
          <View className="items-center mb-14">
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
              className="text-[15px] mt-2 text-center leading-[22px]"
              style={{ color: theme.colors.textSecondary }}
            >
              Connect to your OneUptime instance
            </Text>
          </View>

          <View>
            <Text
              className="text-[13px] font-semibold mb-2"
              style={{ color: theme.colors.textSecondary }}
            >
              Server URL
            </Text>
            <View
              className="flex-row items-center h-[48px] rounded-xl px-3.5"
              style={{
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
                className="flex-1 text-[15px]"
                style={{ color: theme.colors.textPrimary }}
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
              <View className="flex-row items-center mt-3">
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color={theme.colors.statusError}
                  style={{ marginRight: 6 }}
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
                label="Connect"
                onPress={handleConnect}
                loading={isLoading}
                disabled={isLoading}
              />
            </View>
          </View>

          <Text
            className="text-[12px] text-center mt-6 leading-5"
            style={{ color: theme.colors.textTertiary }}
          >
            Self-hosting? Enter your OneUptime server URL above.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
