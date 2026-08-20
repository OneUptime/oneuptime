import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme";
import { getServerUrl } from "../../storage/serverUrl";
import { buildSsoLoginUrl, isProjectScopedKind } from "../../sso/providerUrl";
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

  const renderProviderList: (
    items: Array<SelectableSsoProvider>,
  ) => React.JSX.Element = (
    items: Array<SelectableSsoProvider>,
  ): React.JSX.Element => {
    return (
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        {items.map((provider: SelectableSsoProvider, index: number) => {
          const isLast: boolean = index === items.length - 1;
          const isAuthenticating: boolean = authenticatingId === provider._id;

          return (
            <Pressable
              key={provider._id}
              accessibilityRole="button"
              accessibilityLabel={provider.name}
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
                    name={
                      isProjectScopedKind(provider.kind)
                        ? "shield-checkmark-outline"
                        : "globe-outline"
                    }
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
        })}
      </View>
    );
  };

  const renderSectionHeading: (label: string) => React.JSX.Element = (
    label: string,
  ): React.JSX.Element => {
    return (
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
        {label}
      </Text>
    );
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

      {globalProviders.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          {renderSectionHeading("Your organization")}
          {renderProviderList(globalProviders)}
        </View>
      ) : null}

      {projectProviders.length > 0 ? (
        <View>
          {renderSectionHeading(
            globalProviders.length > 0 ? "This project" : "Available providers",
          )}
          {renderProviderList(projectProviders)}
        </View>
      ) : null}
    </ScrollView>
  );
}
