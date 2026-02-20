import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../../theme";
import { fetchProjects } from "../../api/projects";
import { fetchSSOProvidersForProject, SSOProvider } from "../../api/sso";
import { getServerUrl } from "../../storage/serverUrl";
import {
  getCachedSsoTokens,
  storeSsoToken,
  getSsoTokens,
} from "../../storage/ssoTokens";
import type { ProjectItem, ListResponse } from "../../api/types";
import type { SettingsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<SettingsStackParamList, "ProjectsList">;

export default function ProjectsScreen({
  navigation,
}: Props): React.JSX.Element {
  const { theme } = useTheme();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [ssoTokens, setSsoTokens] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [authenticatingProjectId, setAuthenticatingProjectId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const loadData: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setError(null);

      const [projectsResponse, tokens]: [
        ListResponse<ProjectItem>,
        Record<string, string>,
      ] = await Promise.all([fetchProjects(), getSsoTokens()]);

      setProjects(projectsResponse.data);
      setSsoTokens(tokens);
    } catch {
      setError("Failed to load projects.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh SSO token state when returning from the provider selection screen
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", async () => {
      const tokens: Record<string, string> = await getSsoTokens();
      setSsoTokens(tokens);
    });
    return unsubscribe;
  }, [navigation]);

  const handleRefresh: () => void = (): void => {
    setIsRefreshing(true);
    loadData();
  };

  const openSsoAuth: (
    provider: SSOProvider,
    projectId: string,
  ) => Promise<void> = async (
    provider: SSOProvider,
    projectId: string,
  ): Promise<void> => {
    const serverUrl: string = await getServerUrl();
    const ssoUrl: string = `${serverUrl}/identity/sso/${projectId}/${provider._id}?mobile=true`;

    await WebBrowser.warmUpAsync();

    const result: WebBrowser.WebBrowserAuthSessionResult =
      await WebBrowser.openAuthSessionAsync(ssoUrl, "oneuptime://sso-callback");

    if (result.type === "success" && result.url) {
      const url: URL = new URL(result.url);
      const params: URLSearchParams = url.searchParams;

      const ssoToken: string | null = params.get("ssoToken");
      const returnedProjectId: string | null = params.get("projectId");

      if (ssoToken && returnedProjectId) {
        await storeSsoToken(returnedProjectId, ssoToken);
        setSsoTokens({ ...getCachedSsoTokens() });
      }
    }

    WebBrowser.coolDownAsync();
  };

  const handleAuthenticate: (project: ProjectItem) => Promise<void> = async (
    project: ProjectItem,
  ): Promise<void> => {
    const projectId: string = project._id;

    setAuthenticatingProjectId(projectId);
    setError(null);

    try {
      // Fetch SSO providers for this specific project (like the dashboard does)
      const providers: SSOProvider[] =
        await fetchSSOProvidersForProject(projectId);

      if (providers.length === 0) {
        setError(
          "No SSO providers are configured or enabled for this project. Please contact your admin.",
        );
        return;
      }

      if (providers.length === 1) {
        // Single provider — go directly to SSO auth
        await openSsoAuth(providers[0]!, projectId);
      } else {
        // Multiple providers — navigate to selection screen
        navigation.navigate("SSOProviderSelect", {
          projectId,
          projectName: project.name,
          providers: providers.map((p: SSOProvider) => {
            return {
              _id: p._id,
              name: p.name,
              description: p.description,
            };
          }),
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
    return Boolean(ssoTokens[projectId]);
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
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
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
        Your Projects
      </Text>

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

      {projects.length === 0 ? (
        <View
          style={{
            padding: 24,
            alignItems: "center",
            borderRadius: 16,
            backgroundColor: theme.colors.backgroundElevated,
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
      ) : (
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          {projects.map((project: ProjectItem, index: number) => {
            const requiresSso: boolean = Boolean(project.requireSsoForLogin);
            const authenticated: boolean = isProjectAuthenticated(project._id);
            const isLast: boolean = index === projects.length - 1;
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
                              fontSize: 11,
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
                    ) : null}
                  </View>
                </View>

                {requiresSso && !authenticated ? (
                  <Pressable
                    onPress={() => {
                      return handleAuthenticate(project);
                    }}
                    disabled={isAuthenticating}
                    style={{
                      marginTop: 12,
                      paddingVertical: 10,
                      borderRadius: 10,
                      backgroundColor: theme.colors.actionPrimary,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: isAuthenticating ? 0.7 : 1,
                    }}
                  >
                    {isAuthenticating ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.backgroundPrimary}
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
                          color={theme.colors.backgroundPrimary}
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: theme.colors.backgroundPrimary,
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
      )}

      <Text
        style={{
          fontSize: 12,
          marginTop: 8,
          marginLeft: 4,
          lineHeight: 16,
          color: theme.colors.textTertiary,
        }}
      >
        Projects requiring SSO need separate authentication. Tap Authenticate to
        sign in via your identity provider.
      </Text>
    </ScrollView>
  );
}
