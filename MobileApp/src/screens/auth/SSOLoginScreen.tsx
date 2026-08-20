import React, { useState, useEffect, useCallback } from "react";
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
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import {
  fetchAllGlobalProviders,
  fetchProjectProvidersForEmail,
  SSOProvider,
  GlobalSSOProvider,
  type SsoDiscoveryResult,
} from "../../api/sso";
import { getServerUrl } from "../../storage/serverUrl";
import { buildSsoLoginUrl } from "../../sso/providerUrl";
import {
  openSsoAuthSession,
  type SsoAuthSessionOutcome,
} from "../../sso/authSession";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../../sso/session";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import Logo from "../../components/Logo";
import GradientButton from "../../components/GradientButton";

type SSOLoginNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "SSOLogin"
>;

/*
 * Deliberately permissive - the server is the authority on whether an address
 * federates. This only exists to stop an obvious typo being reported back to
 * the user as "no SSO providers found", which sends people looking for an
 * admin instead of at their own keyboard.
 */
const EMAIL_PATTERN: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [isLoadingGlobal, setIsLoadingGlobal] = useState(true);

  /*
   * Global SSO/OIDC providers are configured on the admin dashboard and are
   * NOT bound to an email domain, so they are discovered on mount and offered
   * before the email field - exactly as the web login page does. Requiring an
   * email first (as this screen used to) makes an instance whose only identity
   * provider is a global one look like it has no SSO at all.
   */
  const loadGlobalProviders: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoadingGlobal(true);

      const result: SsoDiscoveryResult<GlobalSSOProvider> =
        await fetchAllGlobalProviders();

      setGlobalProviders(result.providers);
      setIsLoadingGlobal(false);
    }, []);

  useEffect((): void => {
    loadGlobalProviders();
  }, [loadGlobalProviders]);

  const handleFetchProviders: () => Promise<void> = async (): Promise<void> => {
    const trimmedEmail: string = email.trim();

    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setError(null);
    setIsLoadingProviders(true);

    try {
      const result: SsoDiscoveryResult<SSOProvider> =
        await fetchProjectProvidersForEmail(trimmedEmail);

      /*
       * A failed request and an empty result mean different things and need
       * different words. Collapsing both into "no providers for this email"
       * used to send people to their admin when the real problem was that the
       * phone could not reach the server.
       */
      if (result.failed) {
        setError(
          "Could not reach the server to look up SSO providers. Check your connection and try again.",
        );
        return;
      }

      if (result.providers.length === 0) {
        setError(`No SSO configuration found for the email: ${trimmedEmail}`);
        return;
      }

      setProviders(result.providers);
    } finally {
      setIsLoadingProviders(false);
    }
  };

  /**
   * Runs a login in the auth browser and, if it produced a callback, persists
   * whatever tokens came back.
   */
  const startSSOFlow: (ssoUrl: string) => Promise<void> = async (
    ssoUrl: string,
  ): Promise<void> => {
    setError(null);
    setIsSSOLoading(true);

    try {
      const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(ssoUrl);

      if (outcome.status === "cancelled") {
        return;
      }

      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }

      const completed: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
        outcome.url,
      );

      if (completed.status === "error") {
        setError(completed.message);
        return;
      }

      setIsAuthenticated(true);
    } finally {
      setIsSSOLoading(false);
    }
  };

  /*
   * Building the URL can throw - buildSsoLoginUrl rejects a project target
   * with no project id, which a discovery payload missing `projectId` would
   * produce. Outside a try/catch that throw escapes the async onPress as an
   * unhandled rejection and the row simply does nothing when tapped, with no
   * spinner and no message. Turn it into something the user can read.
   */
  const startSSOFlowForUrl: (
    build: () => Promise<string>,
  ) => Promise<void> = async (build: () => Promise<string>): Promise<void> => {
    let ssoUrl: string;

    try {
      ssoUrl = await build();
    } catch {
      setError(
        "This SSO provider is misconfigured and cannot be used. Please contact your admin.",
      );
      return;
    }

    await startSSOFlow(ssoUrl);
  };

  const handleSSOLogin: (provider: SSOProvider) => Promise<void> = async (
    provider: SSOProvider,
  ): Promise<void> => {
    await startSSOFlowForUrl(async (): Promise<string> => {
      const serverUrl: string = await getServerUrl();

      return buildSsoLoginUrl(serverUrl, {
        kind: "project",
        providerId: provider._id,
        projectId: provider.projectId,
      });
    });
  };

  const handleGlobalSSOLogin: (
    provider: GlobalSSOProvider,
  ) => Promise<void> = async (provider: GlobalSSOProvider): Promise<void> => {
    await startSSOFlowForUrl(async (): Promise<string> => {
      const serverUrl: string = await getServerUrl();

      return buildSsoLoginUrl(serverUrl, {
        kind: provider.type,
        providerId: provider._id,
      });
    });
  };

  const handleBack: () => void = (): void => {
    if (providers) {
      setProviders(null);
      setError(null);
    } else {
      navigation.navigate("Login");
    }
  };

  const renderProviderRow: (data: {
    key: string;
    name: string;
    description?: string | undefined;
    icon: keyof typeof Ionicons.glyphMap;
    isLast: boolean;
    onPress: () => void;
  }) => React.JSX.Element = (data: {
    key: string;
    name: string;
    description?: string | undefined;
    icon: keyof typeof Ionicons.glyphMap;
    isLast: boolean;
    onPress: () => void;
  }): React.JSX.Element => {
    return (
      <Pressable
        key={data.key}
        accessibilityRole="button"
        accessibilityLabel={data.name}
        onPress={data.onPress}
        style={{
          marginBottom: data.isLast ? 0 : 10,
          borderRadius: 14,
          backgroundColor: theme.colors.backgroundSecondary,
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
              backgroundColor: theme.colors.iconBackground,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
            }}
          >
            <Ionicons
              name={data.icon}
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
              {data.name}
            </Text>
            {data.description ? (
              <Text
                style={{
                  fontSize: 13,
                  marginTop: 2,
                  color: theme.colors.textSecondary,
                }}
              >
                {data.description}
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
  };

  const renderError: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (!error) {
        return null;
      }

      return (
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
      );
    };

  const renderGlobalSection: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (isLoadingGlobal) {
        return (
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <ActivityIndicator
              size="small"
              color={theme.colors.actionPrimary}
            />
          </View>
        );
      }

      if (globalProviders.length === 0) {
        return null;
      }

      return (
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              marginBottom: 10,
              color: theme.colors.textSecondary,
            }}
          >
            Sign in with your organization
          </Text>

          {globalProviders.map((provider: GlobalSSOProvider, index: number) => {
            return renderProviderRow({
              key: provider._id,
              name: provider.name,
              description: provider.description,
              icon: "globe-outline",
              isLast: index === globalProviders.length - 1,
              onPress: () => {
                return handleGlobalSSOLogin(provider);
              },
            });
          })}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 24,
            }}
          >
            <View
              style={{
                flex: 1,
                height: 1,
                backgroundColor: theme.colors.borderDefault,
              }}
            />
            <Text
              style={{
                marginHorizontal: 12,
                fontSize: 12,
                color: theme.colors.textTertiary,
              }}
            >
              Or continue with email
            </Text>
            <View
              style={{
                flex: 1,
                height: 1,
                backgroundColor: theme.colors.borderDefault,
              }}
            />
          </View>
        </View>
      );
    };

  const renderEmailStep: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View>
        {renderGlobalSection()}

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
            accessibilityLabel="Email"
            onSubmitEditing={handleFetchProviders}
          />
        </View>

        {renderError()}

        <View style={{ marginTop: 24 }}>
          <GradientButton
            label="Continue"
            onPress={handleFetchProviders}
            loading={isLoadingProviders}
            disabled={isLoadingProviders}
          />
        </View>
      </View>
    );
  };

  const renderProjectStep: () => React.JSX.Element = (): React.JSX.Element => {
    if (isSSOLoading) {
      return (
        <View style={{ alignItems: "center", paddingVertical: 32 }}>
          <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
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
      );
    }

    // Group providers by the project they belong to.
    const grouped: Record<
      string,
      { projectName: string; items: Array<SSOProvider> }
    > = {};

    for (const provider of providers || []) {
      const key: string = provider.projectId;
      const projectName: string = provider.project?.name || "Unknown Project";

      if (!grouped[key]) {
        grouped[key] = { projectName, items: [] };
      }

      grouped[key]!.items.push(provider);
    }

    return (
      <View>
        {Object.entries(grouped).map(
          ([projectId, group]: [
            string,
            { projectName: string; items: Array<SSOProvider> },
          ]) => {
            return (
              <View key={projectId} style={{ marginBottom: 20 }}>
                <Text
                  style={{
                    fontSize: 17,
                    fontWeight: "700",
                    color: theme.colors.textPrimary,
                    marginBottom: 10,
                    paddingHorizontal: 4,
                    letterSpacing: -0.3,
                  }}
                >
                  {group.projectName}
                </Text>

                {group.items.map((provider: SSOProvider, index: number) => {
                  return renderProviderRow({
                    key: provider._id,
                    name: provider.name,
                    description: provider.description,
                    icon: "shield-checkmark-outline",
                    isLast: index === group.items.length - 1,
                    onPress: () => {
                      return handleSSOLogin(provider);
                    },
                  });
                })}
              </View>
            );
          },
        )}

        {renderError()}
      </View>
    );
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
                : "Choose your provider or enter your email"}
            </Text>
          </View>

          {isSSOLoading && !providers ? (
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
          ) : providers ? (
            renderProjectStep()
          ) : (
            renderEmailStep()
          )}

          <View style={{ marginTop: 16 }}>
            <GradientButton
              label={providers ? "Use a different email" : "Back to Login"}
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
