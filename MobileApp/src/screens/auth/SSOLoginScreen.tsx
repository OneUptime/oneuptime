import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import {
  fetchSSOProviders,
  fetchGlobalSSOProviders,
  fetchGlobalOIDCProviders,
  SSOProvider,
  GlobalSSOProvider,
} from "../../api/sso";
import { getServerUrl } from "../../storage/serverUrl";
import { storeTokens } from "../../storage/keychain";
import { storeSsoToken, storeGlobalSsoToken } from "../../storage/ssoTokens";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import Logo from "../../components/Logo";
import GradientButton from "../../components/GradientButton";

type SSOLoginNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "SSOLogin"
>;

export default function SSOLoginScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { setIsAuthenticated } = useAuth();
  const navigation: SSOLoginNavigationProp =
    useNavigation<SSOLoginNavigationProp>();
  const [email, setEmail] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Array<SSOProvider> | null>(null);
  const [globalProviders, setGlobalProviders] = useState<
    Array<GlobalSSOProvider>
  >([]);

  useEffect(() => {
    return () => {
      WebBrowser.coolDownAsync();
    };
  }, []);

  const handleFetchProviders: () => Promise<void> = async (): Promise<void> => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setError(null);
    setIsLoadingProviders(true);

    try {
      /*
       * Project SSO providers are scoped to the email; global SSO/OIDC
       * providers are instance-wide and discovered independently. Fetch all
       * in parallel and let any individual source fail gracefully.
       */
      const [projectResult, globalSSOResult, globalOIDCResult]: [
        Array<SSOProvider>,
        Array<GlobalSSOProvider>,
        Array<GlobalSSOProvider>,
      ] = await Promise.all([
        fetchSSOProviders(email.trim()).catch(() => {
          return [] as Array<SSOProvider>;
        }),
        fetchGlobalSSOProviders().catch(() => {
          return [] as Array<GlobalSSOProvider>;
        }),
        fetchGlobalOIDCProviders().catch(() => {
          return [] as Array<GlobalSSOProvider>;
        }),
      ]);

      const global: Array<GlobalSSOProvider> = [
        ...globalSSOResult,
        ...globalOIDCResult,
      ];

      if (projectResult.length === 0 && global.length === 0) {
        setError("No SSO providers found for this email.");
        return;
      }

      setGlobalProviders(global);
      setProviders(projectResult);
    } catch {
      setError(
        "Could not find SSO providers. Please check your email and try again.",
      );
    } finally {
      setIsLoadingProviders(false);
    }
  };

  /**
   * Parses the `oneuptime://sso-callback` deep-link params, persists the auth
   * tokens and every per-project SSO token, then marks the user authenticated.
   * Returns true on success.
   */
  const handleSSOCallback: (callbackUrl: string) => Promise<boolean> = async (
    callbackUrl: string,
  ): Promise<boolean> => {
    const url: URL = new URL(callbackUrl);
    const params: URLSearchParams = url.searchParams;

    const accessToken: string | null = params.get("accessToken");
    const refreshToken: string | null = params.get("refreshToken");
    const refreshTokenExpiresAt: string | null = params.get(
      "refreshTokenExpiresAt",
    );

    if (!accessToken || !refreshToken || !refreshTokenExpiresAt) {
      setError("Authentication failed. Missing token data.");
      return false;
    }

    await storeTokens({
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
    });

    /*
     * Global SSO/OIDC login returns a single global token (not bound to a
     * project). Store it so the API client can send the `x-global-sso-token`
     * header; it satisfies SSO enforcement for every project the user belongs
     * to.
     */
    const globalSsoToken: string | null = params.get("globalSsoToken");
    if (globalSsoToken) {
      await storeGlobalSsoToken(globalSsoToken);
    }

    /*
     * Project SSO login returns a single per-project ssoToken/projectId pair.
     */
    const ssoToken: string | null = params.get("ssoToken");
    const projectId: string | null = params.get("projectId");

    if (ssoToken && projectId) {
      await storeSsoToken(projectId, ssoToken);
    }

    setIsAuthenticated(true);
    return true;
  };

  /**
   * Opens an IdP login URL in the auth session browser and handles the result
   * via the shared `sso-callback` handler.
   */
  const startSSOFlow: (ssoUrl: string) => Promise<void> = async (
    ssoUrl: string,
  ): Promise<void> => {
    setError(null);
    setIsSSOLoading(true);

    try {
      await WebBrowser.warmUpAsync();

      const result: WebBrowser.WebBrowserAuthSessionResult =
        await WebBrowser.openAuthSessionAsync(
          ssoUrl,
          "oneuptime://sso-callback",
        );

      if (result.type === "cancel" || result.type === "dismiss") {
        setIsSSOLoading(false);
        return;
      }

      if (result.type === "success" && result.url) {
        await handleSSOCallback(result.url);
      }
    } catch {
      setError("SSO authentication failed. Please try again.");
    } finally {
      setIsSSOLoading(false);
      WebBrowser.coolDownAsync();
    }
  };

  const handleSSOLogin: (provider: SSOProvider) => Promise<void> = async (
    provider: SSOProvider,
  ): Promise<void> => {
    const serverUrl: string = await getServerUrl();
    const ssoUrl: string = `${serverUrl}/identity/sso/${provider.projectId}/${provider._id}?mobile=true`;
    await startSSOFlow(ssoUrl);
  };

  const handleGlobalSSOLogin: (
    provider: GlobalSSOProvider,
  ) => Promise<void> = async (provider: GlobalSSOProvider): Promise<void> => {
    const serverUrl: string = await getServerUrl();
    const path: string =
      provider.type === "oidc" ? "global-oidc" : "global-sso";
    const ssoUrl: string = `${serverUrl}/identity/${path}/${provider._id}?mobile=true`;
    await startSSOFlow(ssoUrl);
  };

  const handleBack: () => void = (): void => {
    if (providers) {
      setProviders(null);
      setGlobalProviders([]);
      setError(null);
    } else {
      navigation.navigate("Login");
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
          <View style={{ alignItems: "center", marginBottom: 48 }}>
            <View
              style={{
                borderWidth: 2,
                borderColor: theme.colors.borderDefault,
                borderRadius: 20,
                marginBottom: 20,
                overflow: "hidden",
              }}
            >
              <Logo size={90} />
            </View>

            <Text
              style={{
                fontSize: 30,
                fontWeight: "bold",
                color: theme.colors.textPrimary,
                letterSpacing: -1,
              }}
            >
              SSO Login
            </Text>
            <Text
              style={{
                fontSize: 15,
                marginTop: 4,
                color: theme.colors.textSecondary,
              }}
            >
              {providers
                ? "Select your SSO provider"
                : "Enter your email to find SSO providers"}
            </Text>
          </View>

          {!providers ? (
            <View>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  marginBottom: 8,
                  color: theme.colors.textSecondary,
                }}
              >
                Email
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
                  borderColor: emailFocused
                    ? theme.colors.actionPrimary
                    : theme.colors.borderDefault,
                }}
              >
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={
                    emailFocused
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
                  returnKeyType="go"
                  onSubmitEditing={handleFetchProviders}
                />
              </View>

              {error ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    marginTop: 12,
                  }}
                >
                  <Ionicons
                    name="alert-circle"
                    size={14}
                    color={theme.colors.statusError}
                    style={{ marginRight: 6, marginTop: 2 }}
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
                  label="Continue"
                  onPress={handleFetchProviders}
                  loading={isLoadingProviders}
                  disabled={isLoadingProviders}
                />
              </View>
            </View>
          ) : (
            <View>
              {isSSOLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <ActivityIndicator
                    size="large"
                    color={theme.colors.actionPrimary}
                  />
                  <Text
                    style={{
                      marginTop: 12,
                      fontSize: 14,
                      color: theme.colors.textSecondary,
                    }}
                  >
                    Authenticating...
                  </Text>
                </View>
              ) : (
                <>
                  {(() => {
                    // Group providers by project
                    const grouped: Record<
                      string,
                      { projectName: string; items: SSOProvider[] }
                    > = {};

                    for (const provider of providers) {
                      const key: string = provider.projectId;
                      const projectName: string =
                        provider.project?.name || "Unknown Project";

                      if (!grouped[key]) {
                        grouped[key] = { projectName, items: [] };
                      }

                      grouped[key]!.items.push(provider);
                    }

                    return Object.entries(grouped).map(
                      ([projectId, group]: [
                        string,
                        { projectName: string; items: SSOProvider[] },
                      ]) => {
                        return (
                          <View key={projectId} style={{ marginBottom: 20 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                marginBottom: 10,
                                paddingHorizontal: 4,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 17,
                                  fontWeight: "700",
                                  color: theme.colors.textPrimary,
                                  flex: 1,
                                  letterSpacing: -0.3,
                                }}
                              >
                                {group.projectName}
                              </Text>
                            </View>

                            {group.items.map(
                              (provider: SSOProvider, index: number) => {
                                return (
                                  <Pressable
                                    key={provider._id}
                                    onPress={() => {
                                      return handleSSOLogin(provider);
                                    }}
                                    style={{
                                      marginBottom:
                                        index < group.items.length - 1 ? 10 : 0,
                                      borderRadius: 14,
                                      backgroundColor:
                                        theme.colors.backgroundSecondary,
                                      borderWidth: 1,
                                      borderColor: theme.colors.borderDefault,
                                      overflow: "hidden",
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
                                          backgroundColor:
                                            theme.colors.iconBackground,
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
                                      <View style={{ flex: 1 }}>
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
                                              marginTop: 2,
                                              color: theme.colors.textSecondary,
                                            }}
                                          >
                                            {provider.description}
                                          </Text>
                                        ) : null}
                                      </View>
                                      <Ionicons
                                        name="chevron-forward"
                                        size={18}
                                        color={theme.colors.textTertiary}
                                      />
                                    </View>
                                  </Pressable>
                                );
                              },
                            )}
                          </View>
                        );
                      },
                    );
                  })()}

                  {globalProviders.length > 0 ? (
                    <View style={{ marginBottom: 20 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginBottom: 10,
                          paddingHorizontal: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 17,
                            fontWeight: "700",
                            color: theme.colors.textPrimary,
                            flex: 1,
                            letterSpacing: -0.3,
                          }}
                        >
                          Global SSO
                        </Text>
                      </View>

                      {globalProviders.map(
                        (provider: GlobalSSOProvider, index: number) => {
                          return (
                            <Pressable
                              key={provider._id}
                              onPress={() => {
                                return handleGlobalSSOLogin(provider);
                              }}
                              style={{
                                marginBottom:
                                  index < globalProviders.length - 1 ? 10 : 0,
                                borderRadius: 14,
                                backgroundColor:
                                  theme.colors.backgroundSecondary,
                                borderWidth: 1,
                                borderColor: theme.colors.borderDefault,
                                overflow: "hidden",
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
                                    backgroundColor:
                                      theme.colors.iconBackground,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginRight: 12,
                                  }}
                                >
                                  <Ionicons
                                    name="globe-outline"
                                    size={18}
                                    color={theme.colors.actionPrimary}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
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
                                        marginTop: 2,
                                        color: theme.colors.textSecondary,
                                      }}
                                    >
                                      {provider.description}
                                    </Text>
                                  ) : null}
                                </View>
                                <Ionicons
                                  name="chevron-forward"
                                  size={18}
                                  color={theme.colors.textTertiary}
                                />
                              </View>
                            </Pressable>
                          );
                        },
                      )}
                    </View>
                  ) : null}
                </>
              )}

              {error ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    marginTop: 4,
                    marginBottom: 12,
                  }}
                >
                  <Ionicons
                    name="alert-circle"
                    size={14}
                    color={theme.colors.statusError}
                    style={{ marginRight: 6, marginTop: 2 }}
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
            </View>
          )}

          <View style={{ marginTop: 16 }}>
            <GradientButton
              label={providers ? "Use email and password" : "Back to Login"}
              onPress={handleBack}
              variant="secondary"
              icon="arrow-back-outline"
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
