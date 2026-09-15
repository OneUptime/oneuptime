import React, { useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme";
import { radius, spacing, touchTarget } from "../../theme/tokens";
import { useScreenPadding } from "../../hooks/useScreenPadding";
import AppText from "../../components/AppText";
import Banner from "../../components/Banner";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import IconBadge from "../../components/IconBadge";
import { ListGroup } from "../../components/ListGroup";
import ScreenIntro from "../../components/ScreenIntro";
import StatusPill from "../../components/StatusPill";
import { getServerUrl } from "../../storage/serverUrl";
import {
  buildSsoLoginUrl,
  isProjectScopedKind,
  type SsoProviderKind,
} from "../../sso/providerUrl";
import {
  openSsoAuthSession,
  type SsoAuthSessionOutcome,
} from "../../sso/authSession";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../../sso/session";
import type {
  SelectableSsoProvider,
  SettingsStackParamList,
} from "../../navigation/types";
import { getInitials } from "../../utils/text";

type Props = NativeStackScreenProps<
  SettingsStackParamList,
  "SSOProviderSelect"
>;

/** The protocol a provider speaks, shown so admins' naming is not the only clue. */
function getProtocolLabel(kind: SsoProviderKind): string {
  return kind === "project-oidc" || kind === "global-oidc" ? "OIDC" : "SAML";
}

function ProjectAvatar({ name }: { name: string }): React.JSX.Element {
  const { theme } = useTheme();
  const initials: string = getInitials(name);
  return (
    <View
      testID="sso-project-avatar"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 44,
        height: 44,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.cardAccent,
      }}
    >
      {initials ? (
        <AppText variant="callout" weight="700" tone="accent">
          {initials}
        </AppText>
      ) : (
        <Ionicons
          name="folder-outline"
          size={20}
          color={theme.colors.actionPrimary}
        />
      )}
    </View>
  );
}

export default function SSOProviderSelectScreen({
  route,
  navigation,
}: Props): React.JSX.Element {
  const { theme } = useTheme();
  const paddingBottom: number = useScreenPadding();
  const { projectId, projectName, providers } = route.params;
  const [authenticatingId, setAuthenticatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectProvider: (
    provider: SelectableSsoProvider,
  ) => Promise<void> = async (
    provider: SelectableSsoProvider,
  ): Promise<void> => {
    setAuthenticatingId(provider._id);
    setError(null);

    try {
      const serverUrl: string = await getServerUrl();

      const ssoUrl: string = buildSsoLoginUrl(serverUrl, {
        kind: provider.kind,
        providerId: provider._id,
        projectId: isProjectScopedKind(provider.kind) ? projectId : undefined,
      });

      const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(ssoUrl);

      if (outcome.status === "cancelled") {
        return;
      }

      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }

      /*
       * Both flavours land here. A global login returns one instance-wide
       * token, a project login returns one bound to this project; the session
       * module stores whichever arrived. Previously this screen looked only
       * for `ssoToken`, so a global login completed on the server and then
       * vanished without a word on the device.
       */
      const completed: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
        outcome.url,
      );

      if (completed.status === "error") {
        setError(completed.message);
        return;
      }

      navigation.goBack();
    } catch {
      setError("SSO authentication failed. Please try again.");
    } finally {
      setAuthenticatingId(null);
    }
  };

  const globalProviders: Array<SelectableSsoProvider> = providers.filter(
    (provider: SelectableSsoProvider) => {
      return !isProjectScopedKind(provider.kind);
    },
  );
  const projectProviders: Array<SelectableSsoProvider> = providers.filter(
    (provider: SelectableSsoProvider) => {
      return isProjectScopedKind(provider.kind);
    },
  );

  const renderProviderRow: (
    provider: SelectableSsoProvider,
  ) => React.JSX.Element = (
    provider: SelectableSsoProvider,
  ): React.JSX.Element => {
    const isAuthenticating: boolean = authenticatingId === provider._id;
    const anyAuthenticating: boolean = authenticatingId !== null;
    const projectScoped: boolean = isProjectScopedKind(provider.kind);

    return (
      <Pressable
        key={provider._id}
        testID={`sso-provider-${provider._id}`}
        accessibilityRole="button"
        accessibilityLabel={provider.name}
        accessibilityHint="Opens your provider in a secure browser and returns you here after sign-in."
        accessibilityState={{
          disabled: anyAuthenticating,
          busy: isAuthenticating,
        }}
        aria-disabled={anyAuthenticating}
        aria-busy={isAuthenticating}
        onPress={() => {
          return handleSelectProvider(provider);
        }}
        disabled={anyAuthenticating}
        style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
          return {
            opacity: anyAuthenticating && !isAuthenticating ? 0.55 : 1,
            backgroundColor:
              pressed || isAuthenticating
                ? theme.colors.backgroundTertiary
                : "transparent",
          };
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            minHeight: touchTarget + spacing.lg,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md + 2,
          }}
        >
          <IconBadge
            name={
              projectScoped ? "shield-checkmark-outline" : "business-outline"
            }
          />
          <View
            style={{
              flex: 1,
              minWidth: 0,
              gap: spacing.xs,
              alignItems: "flex-start",
            }}
          >
            <AppText variant="headline">{provider.name}</AppText>
            {provider.description ? (
              <AppText variant="footnote" tone="secondary">
                {provider.description}
              </AppText>
            ) : null}
            <StatusPill
              testID={`sso-provider-protocol-${provider._id}`}
              size="sm"
              tone="neutral"
              label={getProtocolLabel(provider.kind)}
            />
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
  };

  return (
    <ScrollView
      testID="sso-provider-scroll"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom,
        gap: spacing.lg,
      }}
    >
      <ScreenIntro
        title="Choose your provider"
        compact
        description="Continue with your work account."
        style={{ marginBottom: 0 }}
      />

      <Card testID="sso-project-card">
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <ProjectAvatar name={projectName} />
          <View
            style={{
              flex: 1,
              minWidth: 0,
              gap: spacing.xs,
              alignItems: "flex-start",
            }}
          >
            <AppText variant="headline" numberOfLines={2}>
              {projectName}
            </AppText>
            <AppText variant="footnote" tone="secondary">
              Select an SSO provider to sign in
            </AppText>
          </View>
        </View>
      </Card>

      <View accessibilityLiveRegion="polite" collapsable={false}>
        <Banner
          testID="sso-provider-browser-notice"
          tone={authenticatingId ? "accent" : "info"}
          icon={authenticatingId ? "open-outline" : "lock-closed-outline"}
          message={
            authenticatingId
              ? "Continue signing in with your provider in the browser…"
              : "A secure browser will open for sign-in. You will return to your projects when you are done."
          }
        />
      </View>

      {error ? (
        <View accessibilityLiveRegion="polite" collapsable={false}>
          <Banner testID="sso-provider-error" tone="danger" message={error} />
        </View>
      ) : null}

      {providers.length === 0 ? (
        <Card testID="sso-provider-empty" padding={spacing.xxl}>
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <IconBadge name="key-outline" size="lg" shape="circle" />
            <AppText
              accessibilityRole="header"
              variant="headline"
              align="center"
              style={{ marginTop: spacing.xs }}
            >
              No providers available
            </AppText>
            <AppText variant="subhead" tone="secondary" align="center">
              No single sign-on provider is enabled for this project. Ask your
              admin to set one up, then try again.
            </AppText>
            <GradientButton
              label="Back to projects"
              variant="tonal"
              icon="arrow-back"
              onPress={() => {
                navigation.goBack();
              }}
              style={{ marginTop: spacing.md, alignSelf: "stretch" }}
            />
          </View>
        </Card>
      ) : null}

      {globalProviders.length > 0 ? (
        <ListGroup title="Your organization" testID="sso-provider-global">
          {globalProviders.map(renderProviderRow)}
        </ListGroup>
      ) : null}

      {projectProviders.length > 0 ? (
        <ListGroup
          title={
            globalProviders.length > 0 ? "This project" : "Available providers"
          }
          testID="sso-provider-project"
        >
          {projectProviders.map(renderProviderRow)}
        </ListGroup>
      ) : null}
    </ScrollView>
  );
}
