import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Pressable,
  ActivityIndicator,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../../theme";
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
import AuthLayout, {
  AuthDivider,
  AuthNotice,
  AuthTextField,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import AppText from "../../components/AppText";
import Banner from "../../components/Banner";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import IconBadge from "../../components/IconBadge";
import { ListGroup } from "../../components/ListGroup";

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

const EMAIL_REQUIRED_MESSAGE: string = "Email is required.";
const EMAIL_INVALID_MESSAGE: string = "Please enter a valid email address.";

export default function SSOLoginScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { setIsAuthenticated } = useAuth();
  const navigation: SSOLoginNavigationProp =
    useNavigation<SSOLoginNavigationProp>();
  const [email, setEmail] = useState("");
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
    if (isLoadingProviders || isSSOLoading) {
      return;
    }
    const trimmedEmail: string = email.trim();

    if (!trimmedEmail) {
      setError(EMAIL_REQUIRED_MESSAGE);
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError(EMAIL_INVALID_MESSAGE);
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
        // SAML and OIDC project providers are served by different routers.
        kind: provider.kind,
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
    onPress: () => void;
  }) => React.JSX.Element = (data: {
    key: string;
    name: string;
    description?: string | undefined;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }): React.JSX.Element => {
    return (
      <Pressable
        key={data.key}
        accessibilityRole="button"
        accessibilityLabel={data.name}
        accessibilityHint="Opens your organization's secure sign-in in the browser."
        disabled={isSSOLoading}
        onPress={data.onPress}
        style={({ pressed }: { pressed: boolean }): ViewStyle => {
          return {
            minHeight: 64,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            backgroundColor: pressed
              ? theme.colors.backgroundTertiary
              : "transparent",
          };
        }}
      >
        <IconBadge name={data.icon} />
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
          <AppText variant="headline">{data.name}</AppText>
          {data.description ? (
            <AppText variant="footnote" tone="secondary">
              {data.description}
            </AppText>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textTertiary}
        />
      </Pressable>
    );
  };

  const renderError: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (!error) {
        return null;
      }

      return (
        <AuthNotice
          tone="danger"
          message={error}
          style={{ marginTop: spacing.md }}
        />
      );
    };

  const renderAuthenticating: () => React.JSX.Element =
    (): React.JSX.Element => {
      return (
        <Card
          style={{
            alignItems: "center",
            gap: spacing.md,
            paddingVertical: spacing.xxxl,
          }}
        >
          <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
          <AppText
            variant="subhead"
            tone="secondary"
            accessibilityLiveRegion="polite"
          >
            Authenticating...
          </AppText>
        </Card>
      );
    };

  const renderGlobalSection: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (isLoadingGlobal) {
        return (
          <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
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
        <View>
          <ListGroup title="Sign in with your organization">
            {globalProviders.map((provider: GlobalSSOProvider) => {
              return renderProviderRow({
                key: provider._id,
                name: provider.name,
                description: provider.description,
                icon: "globe-outline",
                onPress: () => {
                  return handleGlobalSSOLogin(provider);
                },
              });
            })}
          </ListGroup>

          <AuthDivider label="Or continue with email" />
        </View>
      );
    };

  const renderEmailStep: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <View>
        {renderGlobalSection()}

        <View style={{ gap: spacing.xl }}>
          <AuthTextField
            label="Email"
            containerTestID="sso-email-field"
            icon="mail-outline"
            accessibilityLabel="Email"
            value={email}
            editable={!isLoadingProviders && !isSSOLoading}
            /*
             * Only the address checks outline the field. A provider that
             * refused the sign-in is not something wrong with what was typed.
             */
            invalid={
              error === EMAIL_REQUIRED_MESSAGE ||
              error === EMAIL_INVALID_MESSAGE
            }
            onChangeText={(text: string) => {
              setEmail(text);
              setError(null);
            }}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={handleFetchProviders}
          />

          {error ? <AuthNotice tone="danger" message={error} /> : null}

          <GradientButton
            label="Continue"
            onPress={handleFetchProviders}
            loading={isLoadingProviders}
            disabled={isLoadingProviders}
            style={authPrimaryButtonStyle}
          />
        </View>
      </View>
    );
  };

  const renderProjectStep: () => React.JSX.Element = (): React.JSX.Element => {
    if (isSSOLoading) {
      return renderAuthenticating();
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
      <View style={{ gap: spacing.xl }}>
        {Object.entries(grouped).map(
          ([projectId, group]: [
            string,
            { projectName: string; items: Array<SSOProvider> },
          ]) => {
            return (
              <ListGroup key={projectId} title={group.projectName}>
                {group.items.map((provider: SSOProvider) => {
                  return renderProviderRow({
                    key: provider._id,
                    name: provider.name,
                    description: provider.description,
                    icon: "shield-checkmark-outline",
                    onPress: () => {
                      return handleSSOLogin(provider);
                    },
                  });
                })}
              </ListGroup>
            );
          },
        )}

        {renderError()}
      </View>
    );
  };

  return (
    <AuthLayout
      title="Sign in with your team"
      compact
      eyebrow="SINGLE SIGN-ON"
      icon="business-outline"
      description={
        providers
          ? "Select your SSO provider"
          : "Choose your provider or enter your email"
      }
    >
      {isSSOLoading && !providers
        ? renderAuthenticating()
        : providers
          ? renderProjectStep()
          : renderEmailStep()}

      <Banner
        tone="neutral"
        icon="lock-closed-outline"
        message="Your provider opens in a secure browser. After signing in, you will return to OneUptime automatically."
        style={{ marginTop: spacing.xxl }}
      />

      <GradientButton
        label={providers ? "Use a different email" : "Back to Login"}
        onPress={handleBack}
        variant="secondary"
        icon="arrow-back"
        style={{ marginTop: spacing.lg }}
      />
    </AuthLayout>
  );
}
