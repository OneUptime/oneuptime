import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme";
import { useScreenPadding } from "../../hooks/useScreenPadding";
import ScreenIntro from "../../components/ScreenIntro";
import GradientButton from "../../components/GradientButton";
import { fetchProjects } from "../../api/projects";
import {
  fetchAllGlobalProviders,
  fetchSSOProvidersForProject,
  GlobalSSOProvider,
  SSOProvider,
  type SsoDiscoveryResult,
} from "../../api/sso";
import { getServerUrl } from "../../storage/serverUrl";
import { getSsoTokens, getGlobalSsoToken } from "../../storage/ssoTokens";
import {
  getSsoDeniedProjectIds,
  subscribeToSsoDenials,
} from "../../sso/ssoDenials";
import { buildSsoLoginUrl, isProjectScopedKind } from "../../sso/providerUrl";
import {
  openSsoAuthSession,
  type SsoAuthSessionOutcome,
} from "../../sso/authSession";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../../sso/session";
import type { ProjectItem, ListResponse } from "../../api/types";
import type {
  SelectableSsoProvider,
  SettingsStackParamList,
} from "../../navigation/types";

type Props = NativeStackScreenProps<SettingsStackParamList, "ProjectsList">;

export default function ProjectsScreen({
  navigation,
}: Props): React.JSX.Element {
  const { theme } = useTheme();
  const paddingBottom: number = useScreenPadding();
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [ssoTokens, setSsoTokens] = useState<Record<string, string>>({});
  const [globalSsoToken, setGlobalSsoToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [authenticatingProjectId, setAuthenticatingProjectId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [deniedProjectIds, setDeniedProjectIds] = useState<Array<string>>(
    getSsoDeniedProjectIds(),
  );

  // The API client records denials as requests fail; mirror them into state.
  useEffect(() => {
    return subscribeToSsoDenials((): void => {
      setDeniedProjectIds(getSsoDeniedProjectIds());
    });
  }, []);

  const loadData: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setError(null);

      const [projectsResponse, tokens, globalToken]: [
        ListResponse<ProjectItem>,
        Record<string, string>,
        string | null,
      ] = await Promise.all([
        fetchProjects(),
        getSsoTokens(),
        getGlobalSsoToken(),
      ]);

      setProjects(projectsResponse.data);
      setSsoTokens(tokens);
      setGlobalSsoToken(globalToken);
    } catch {
      setError("Failed to load projects.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  /*
   * Re-reads the stored SSO tokens. Both reads drop anything that has expired,
   * so this doubles as the eviction pass that turns a lapsed token back into a
   * visible "Authenticate with SSO" button instead of a project that claims to
   * be authenticated and 406s on every request.
   */
  const refreshSsoState: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const [tokens, globalToken]: [Record<string, string>, string | null] =
        await Promise.all([getSsoTokens(), getGlobalSsoToken()]);
      setSsoTokens(tokens);
      setGlobalSsoToken(globalToken);
    }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh SSO token state when returning from the provider selection screen
  useEffect(() => {
    const unsubscribe: () => void = navigation.addListener("focus", () => {
      refreshSsoState();
    });
    return unsubscribe;
  }, [navigation, refreshSsoState]);

  const handleRefresh: () => void = (): void => {
    setIsRefreshing(true);
    loadData();
  };

  const openSsoAuth: (
    provider: SelectableSsoProvider,
    projectId: string,
  ) => Promise<void> = async (
    provider: SelectableSsoProvider,
    projectId: string,
  ): Promise<void> => {
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

    const completed: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      outcome.url,
    );

    if (completed.status === "error") {
      setError(completed.message);
      return;
    }

    await refreshSsoState();
  };

  /*
   * A project that enforces SSO can be satisfied two ways: by a provider
   * configured inside the project, or by an instance-wide Global SSO/OIDC
   * provider the admin set up. Only the first was ever offered here, so on an
   * instance whose identity provider is global, an authenticated user hit a
   * dead end - "No SSO providers are configured" - with no way forward short
   * of signing out entirely.
   */
  const handleAuthenticate: (project: ProjectItem) => Promise<void> = async (
    project: ProjectItem,
  ): Promise<void> => {
    const projectId: string = project._id;

    setAuthenticatingProjectId(projectId);
    setError(null);

    try {
      const [projectResult, globalResult]: [
        SsoDiscoveryResult<SSOProvider>,
        SsoDiscoveryResult<GlobalSSOProvider>,
      ] = await Promise.all([
        fetchSSOProvidersForProject(projectId)
          .then(
            (
              providers: Array<SSOProvider>,
            ): SsoDiscoveryResult<SSOProvider> => {
              return { providers, failed: false };
            },
          )
          .catch((error: unknown): SsoDiscoveryResult<SSOProvider> => {
            const status: number | undefined = (
              error as { response?: { status?: number } } | undefined
            )?.response?.status;
            return {
              providers: [],
              failed: typeof status !== "number" || status >= 500,
            };
          }),
        fetchAllGlobalProviders(),
      ]);

      const selectable: Array<SelectableSsoProvider> = [
        ...globalResult.providers.map((provider: GlobalSSOProvider) => {
          return {
            _id: provider._id,
            name: provider.name,
            description: provider.description,
            kind: provider.type,
          };
        }),
        ...projectResult.providers.map((provider: SSOProvider) => {
          return {
            _id: provider._id,
            name: provider.name,
            description: provider.description,
            // "project" (SAML) or "project-oidc" - different routers.
            kind: provider.kind,
          };
        }),
      ];

      if (selectable.length === 0) {
        setError(
          projectResult.failed || globalResult.failed
            ? "Could not load SSO providers. Check your connection and try again."
            : "No SSO providers are configured or enabled for this project. Please contact your admin.",
        );
        return;
      }

      if (selectable.length === 1) {
        // Single provider - go straight to it rather than showing a list of one.
        await openSsoAuth(selectable[0]!, projectId);
      } else {
        navigation.navigate("SSOProviderSelect", {
          projectId,
          projectName: project.name,
          providers: selectable,
        });
      }
    } catch {
      setError("SSO authentication failed. Please try again.");
    } finally {
      setAuthenticatingProjectId(null);
    }
  };

  const isProjectAuthenticated: (projectId: string) => boolean = (
    projectId: string,
  ): boolean => {
    /*
     * The server has the last word. A stored token - global or per-project -
     * is only evidence; if the server has actually refused this project on SSO
     * grounds (expired token, disabled provider, a provider restricted to
     * other projects) then it is not authenticated no matter what is in
     * storage, and the user needs the button rather than a green badge.
     */
    if (deniedProjectIds.includes(projectId)) {
      return false;
    }

    // Otherwise a global SSO token satisfies enforcement for every project.
    return Boolean(ssoTokens[projectId] || globalSsoToken);
  };

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
        <Text
          style={{
            fontSize: 15,
            color: theme.colors.textSecondary,
            marginTop: 16,
          }}
        >
          Loading your projects…
        </Text>
      </View>
    );
  }

  const visibleProjects: Array<ProjectItem> = projects.filter(
    (project: ProjectItem): boolean => {
      return project.name.toLowerCase().includes(search.trim().toLowerCase());
    },
  );
  const needsSignIn: number = projects.filter(
    (project: ProjectItem): boolean => {
      return (
        Boolean(project.requireSsoForLogin) &&
        !isProjectAuthenticated(project._id)
      );
    },
  ).length;

  return (
    <ScrollView
      testID="projects-scroll"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ScreenIntro
        title="Project access"
        compact
        description="Manage your access. Switch projects from the name at the top of any screen."
      />
      {projects.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontSize: 14,
              lineHeight: 21,
              color:
                needsSignIn > 0
                  ? theme.colors.severityWarning
                  : theme.colors.textSecondary,
              marginBottom: 16,
            }}
          >
            {projects.length} {projects.length === 1 ? "project" : "projects"} ·{" "}
            {needsSignIn > 0
              ? `${needsSignIn} need SSO sign-in`
              : "All projects ready"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 52,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.colors.borderDefault,
              backgroundColor: theme.colors.backgroundSecondary,
              paddingHorizontal: 14,
            }}
          >
            <Ionicons
              name="search-outline"
              size={20}
              color={theme.colors.textTertiary}
              style={{ marginRight: 10 }}
            />
            <TextInput
              accessibilityLabel="Search projects"
              placeholder="Search projects"
              placeholderTextColor={theme.colors.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              returnKeyType="search"
              style={{
                flex: 1,
                paddingVertical: 14,
                fontSize: 16,
                color: theme.colors.textPrimary,
              }}
            />
            {search ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear project search"
                onPress={() => {
                  setSearch("");
                }}
                style={{
                  minWidth: 48,
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {error ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
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
      {error && projects.length === 0 ? (
        <View style={{ marginBottom: 20 }}>
          <GradientButton
            label="Retry loading projects"
            onPress={loadData}
            variant="secondary"
          />
        </View>
      ) : null}

      {projects.length === 0 && !error ? (
        <View
          style={{
            padding: 24,
            alignItems: "center",
            borderRadius: 12,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Ionicons
            name="folder-open-outline"
            size={32}
            color={theme.colors.textTertiary}
          />
          <Text
            style={{
              fontSize: 14,
              marginTop: 8,
              color: theme.colors.textSecondary,
            }}
          >
            No projects found.
          </Text>
        </View>
      ) : projects.length > 0 && visibleProjects.length === 0 ? (
        <View
          style={{
            padding: 24,
            borderRadius: 12,
            backgroundColor: theme.colors.backgroundSecondary,
          }}
        >
          <Text
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: theme.colors.textPrimary,
            }}
          >
            No matching projects
          </Text>
          <Text
            style={{
              fontSize: 15,
              lineHeight: 23,
              marginTop: 8,
              color: theme.colors.textSecondary,
            }}
          >
            Try another name or clear the search to see all your projects.
          </Text>
        </View>
      ) : projects.length > 0 ? (
        <View
          style={{
            borderRadius: 14,
            overflow: "hidden",
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          {visibleProjects.map((project: ProjectItem, index: number) => {
            const requiresSso: boolean = Boolean(project.requireSsoForLogin);
            const authenticated: boolean = isProjectAuthenticated(project._id);
            const isLast: boolean = index === visibleProjects.length - 1;
            const isAuthenticating: boolean =
              authenticatingProjectId === project._id;

            return (
              <View
                key={project._id}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 16,
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
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: theme.colors.iconBackground,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 14,
                    }}
                  >
                    <Ionicons
                      name="folder-outline"
                      size={18}
                      color={theme.colors.actionPrimary}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: "700",
                        color: theme.colors.textPrimary,
                        letterSpacing: -0.3,
                      }}
                    >
                      {project.name}
                    </Text>

                    {requiresSso ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginTop: 6,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 6,
                            backgroundColor: authenticated
                              ? theme.colors.statusSuccessBg
                              : theme.colors.severityWarningBg,
                          }}
                        >
                          <Ionicons
                            name={
                              authenticated
                                ? "checkmark-circle"
                                : "shield-outline"
                            }
                            size={12}
                            color={
                              authenticated
                                ? theme.colors.statusSuccess
                                : theme.colors.severityWarning
                            }
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "600",
                              color: authenticated
                                ? theme.colors.statusSuccess
                                : theme.colors.severityWarning,
                            }}
                          >
                            {authenticated ? "Authenticated" : "SSO Required"}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <Text
                        style={{
                          fontSize: 14,
                          color: theme.colors.textSecondary,
                          marginTop: 6,
                        }}
                      >
                        Ready to use
                      </Text>
                    )}
                  </View>
                </View>

                {requiresSso && !authenticated ? (
                  <Pressable
                    onPress={() => {
                      return handleAuthenticate(project);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Authenticate with SSO for ${project.name}`}
                    /*
                     * Disabled for EVERY row while any row is authenticating,
                     * not just the busy one: expo-web-browser allows a single
                     * auth session at a time and throws
                     * "WebBrowser is already open" on a second tap.
                     */
                    disabled={authenticatingProjectId !== null}
                    accessibilityState={{
                      disabled: authenticatingProjectId !== null,
                      busy: isAuthenticating,
                    }}
                    aria-disabled={authenticatingProjectId !== null}
                    aria-busy={isAuthenticating}
                    style={{
                      marginTop: 12,
                      minHeight: 52,
                      paddingVertical: 10,
                      borderRadius: 10,
                      backgroundColor: theme.colors.actionPrimary,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: authenticatingProjectId !== null ? 0.7 : 1,
                    }}
                  >
                    {isAuthenticating ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.textInverse}
                      />
                    ) : (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={14}
                          color={theme.colors.textInverse}
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "700",
                            color: theme.colors.textInverse,
                          }}
                        >
                          Authenticate with SSO
                        </Text>
                      </View>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <Text
        style={{
          fontSize: 14,
          marginTop: 20,
          marginLeft: 4,
          lineHeight: 21,
          color: theme.colors.textTertiary,
        }}
      >
        Projects requiring SSO need separate authentication. Tap Authenticate to
        sign in via your identity provider.
      </Text>
    </ScrollView>
  );
}
