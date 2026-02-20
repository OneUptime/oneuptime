import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme";
import { getServerUrl } from "../../storage/serverUrl";
import { getCachedSsoTokens, storeSsoToken } from "../../storage/ssoTokens";
import type { SettingsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<
  SettingsStackParamList,
  "SSOProviderSelect"
>;

export default function SSOProviderSelectScreen({
  route,
  navigation,
}: Props): React.JSX.Element {
  const { theme } = useTheme();
  const { projectId, projectName, providers } = route.params;
  const [authenticatingId, setAuthenticatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectProvider: (provider: {
    _id: string;
    name: string;
    description?: string;
  }) => Promise<void> = async (provider: {
    _id: string;
    name: string;
    description?: string;
  }): Promise<void> => {
    setAuthenticatingId(provider._id);
    setError(null);

    try {
      const serverUrl: string = await getServerUrl();
      const ssoUrl: string = `${serverUrl}/identity/sso/${projectId}/${provider._id}?mobile=true`;

      await WebBrowser.warmUpAsync();

      const result: WebBrowser.WebBrowserAuthSessionResult =
        await WebBrowser.openAuthSessionAsync(
          ssoUrl,
          "oneuptime://sso-callback",
        );

      if (result.type === "success" && result.url) {
        const url: URL = new URL(result.url);
        const params: URLSearchParams = url.searchParams;

        const ssoToken: string | null = params.get("ssoToken");
        const returnedProjectId: string | null = params.get("projectId");

        if (ssoToken && returnedProjectId) {
          await storeSsoToken(returnedProjectId, ssoToken);
          // Force refresh cached tokens
          getCachedSsoTokens();
          navigation.goBack();
          return;
        }
      }
    } catch {
      setError("SSO authentication failed. Please try again.");
    } finally {
      setAuthenticatingId(null);
      WebBrowser.coolDownAsync();
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 20,
          padding: 16,
          borderRadius: 14,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: theme.colors.accentCyanBg,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 14,
          }}
        >
          <Ionicons
            name="business-outline"
            size={18}
            color={theme.colors.accentCyan}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: theme.colors.textPrimary,
              letterSpacing: -0.3,
            }}
          >
            {projectName}
          </Text>
          <Text
            style={{
              fontSize: 13,
              marginTop: 2,
              color: theme.colors.textSecondary,
            }}
          >
            Select an SSO provider to sign in
          </Text>
        </View>
      </View>

      {error ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            backgroundColor: theme.colors.statusErrorBg,
          }}
        >
          <Ionicons
            name="alert-circle"
            size={16}
            color={theme.colors.statusError}
            style={{ marginRight: 8, marginTop: 1 }}
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

      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          textTransform: "uppercase",
          marginBottom: 8,
          marginLeft: 4,
          color: theme.colors.textTertiary,
          letterSpacing: 0.8,
        }}
      >
        Available Providers
      </Text>

      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        {providers.map(
          (
            provider: { _id: string; name: string; description?: string },
            index: number,
          ) => {
            const isLast: boolean = index === providers.length - 1;
            const isAuthenticating: boolean = authenticatingId === provider._id;

            return (
              <Pressable
                key={provider._id}
                onPress={() => {
                  return handleSelectProvider(provider);
                }}
                disabled={authenticatingId !== null}
                style={{
                  opacity:
                    authenticatingId !== null && !isAuthenticating ? 0.6 : 1,
                  ...(!isLast
                    ? {
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.borderSubtle,
                      }
                    : {}),
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: theme.colors.iconBackground,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={18}
                      color={theme.colors.actionPrimary}
                    />
                  </View>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: theme.colors.textPrimary,
                      }}
                    >
                      {provider.name}
                    </Text>
                    {provider.description ? (
                      <Text
                        style={{
                          fontSize: 13,
                          marginTop: 3,
                          color: theme.colors.textSecondary,
                        }}
                      >
                        {provider.description}
                      </Text>
                    ) : null}
                  </View>

                  {isAuthenticating ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.actionPrimary}
                    />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={theme.colors.textTertiary}
                    />
                  )}
                </View>
              </Pressable>
            );
          },
        )}
      </View>
    </ScrollView>
  );
}
