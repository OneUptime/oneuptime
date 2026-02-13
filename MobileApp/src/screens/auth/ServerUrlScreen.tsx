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
import { Ionicons } from "@expo/vector-icons";
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
      className="flex-1 bg-bg-primary"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Subtle gradient header overlay */}
      <View
        className="absolute top-0 left-0 right-0 h-[320px]"
        style={{ backgroundColor: theme.colors.headerGradient }}
      />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-7">
          <View className="items-center mb-14">
            {/* Logo icon */}
            <View
              className="w-20 h-20 rounded-[22px] items-center justify-center mb-6"
              style={{
                backgroundColor: theme.colors.accentGradientStart + "15",
                shadowColor: theme.colors.accentGradientStart,
                shadowOpacity: 0.2,
                shadowOffset: { width: 0, height: 8 },
                shadowRadius: 24,
                elevation: 8,
              }}
            >
              <Ionicons
                name="shield-checkmark"
                size={40}
                color={theme.colors.accentGradientStart}
              />
            </View>

            <Text
              className="text-text-primary font-extrabold text-[34px]"
              style={{ letterSpacing: -1.2 }}
            >
              OneUptime
            </Text>
            <Text className="text-body-md text-text-secondary mt-2 text-center leading-6">
              Connect to your OneUptime instance
            </Text>
          </View>

          {/* Form card */}
          <View
            className="w-full rounded-2xl p-5"
            style={{
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderSubtle,
              shadowColor: "#000",
              shadowOpacity: theme.isDark ? 0.3 : 0.08,
              shadowOffset: { width: 0, height: 8 },
              shadowRadius: 24,
              elevation: 6,
            }}
          >
            <Text className="text-body-sm text-text-secondary mb-2 font-semibold">
              Server URL
            </Text>
            <View
              className="flex-row items-center h-[52px] rounded-xl px-3.5"
              style={{
                backgroundColor: theme.colors.backgroundPrimary,
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
                size={20}
                color={
                  urlFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
                style={{ marginRight: 10 }}
              />
              <TextInput
                className="flex-1 text-base text-text-primary"
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
              <View className="flex-row items-center mt-2.5">
                <Ionicons
                  name="alert-circle"
                  size={14}
                  color={theme.colors.statusError}
                  style={{ marginRight: 6 }}
                />
                <Text
                  className="text-body-sm flex-1"
                  style={{ color: theme.colors.statusError }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              className="h-[52px] rounded-xl items-center justify-center mt-5"
              style={{
                backgroundColor: theme.colors.actionPrimary,
                opacity: isLoading ? 0.7 : 1,
                shadowColor: theme.colors.actionPrimary,
                shadowOpacity: 0.35,
                shadowOffset: { width: 0, height: 6 },
                shadowRadius: 16,
                elevation: 6,
              }}
              onPress={handleConnect}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color={theme.colors.textInverse} />
              ) : (
                <Text className="text-[16px] text-text-inverse font-bold">
                  Connect
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <Text className="text-caption text-text-tertiary text-center mt-7 leading-5">
            Self-hosting? Enter your OneUptime server URL above.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
