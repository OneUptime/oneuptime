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
import { useTheme } from "../../theme";
import { fetchProjects } from "../../api/projects";
import { fetchSSOProviders, SSOProvider } from "../../api/sso";
import { getServerUrl } from "../../storage/serverUrl";
import { getTokens } from "../../storage/keychain";
import {
  getCachedSsoTokens,
  storeSsoToken,
  getSsoTokens,
} from "../../storage/ssoTokens";
import type { ProjectItem, ListResponse } from "../../api/types";

interface DecodedToken {
  email?: string;
}

function decodeTokenPayload(token: string): DecodedToken | null {
  try {
    const parts: string[] = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    const payload: string = atob(parts[1]!);
    return JSON.parse(payload) as DecodedToken;
  } catch {
    return null;
  }
}

export default function ProjectsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [ssoTokens, setSsoTokens] = useState<Record<string, string>>({});
  const [ssoProviders, setSsoProviders] = useState<SSOProvider[]>([]);
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

      // Get user email from stored access token
      const storedTokens: { accessToken: string; refreshToken: string } | null =
        await getTokens();
      if (storedTokens?.accessToken) {
        const decoded: DecodedToken | null = decodeTokenPayload(
          storedTokens.accessToken,
        );
        if (decoded?.email) {
          try {
            const providers: SSOProvider[] = await fetchSSOProviders(
              decoded.email,
            );
            setSsoProviders(providers);
          } catch {
            // SSO providers fetch failed — not critical
          }
        }
      }
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

  const handleRefresh: () => void = (): void => {
    setIsRefreshing(true);
    loadData();
  };

  const handleAuthenticate: (project: ProjectItem) => Promise<void> = async (
    project: ProjectItem,
  ): Promise<void> => {
    const projectId: string = project._id;

    // Find SSO provider for this project
    const provider: SSOProvider | undefined = ssoProviders.find(
      (p: SSOProvider) => {
        return p.projectId === projectId;
      },
    );

    if (!provider) {
      setError("No SSO provider found for this project.");
      return;
    }

    setAuthenticatingProjectId(projectId);
    setError(null);

    try {
      const serverUrl: string = await getServerUrl();
      const ssoUrl: string = `${serverUrl}/identity/sso/${provider.projectId}/${provider._id}?mobile=true`;

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
          setSsoTokens({ ...getCachedSsoTokens() });
        }
      }
    } catch {
      setError("SSO authentication failed. Please try again.");
    } finally {
      setAuthenticatingProjectId(null);
      WebBrowser.coolDownAsync();
    }
  };

  const isProjectAuthenticated: (projectId: string) => boolean = (
    projectId: string,
  ): boolean => {
    return Boolean(ssoTokens[projectId]);
  };

  const hasProvider: (projectId: string) => boolean = (
    projectId: string,
  ): boolean => {
    return ssoProviders.some((p: SSOProvider) => {
      return p.projectId === projectId;
    });
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
                  paddingVertical: 14,
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
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: theme.colors.textPrimary,
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
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            marginRight: 6,
                            backgroundColor: authenticated
                              ? "#22C55E"
                              : "#F59E0B",
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "500",
                            color: authenticated ? "#22C55E" : "#F59E0B",
                          }}
                        >
                          {authenticated ? "Authenticated" : "SSO Required"}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {requiresSso && !authenticated && hasProvider(project._id) ? (
                    <Pressable
                      onPress={() => {
                        return handleAuthenticate(project);
                      }}
                      disabled={isAuthenticating}
                      style={({ pressed }: { pressed: boolean }) => {
                        return {
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 10,
                          backgroundColor: theme.colors.actionPrimary,
                          opacity: pressed || isAuthenticating ? 0.7 : 1,
                        };
                      }}
                    >
                      {isAuthenticating ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: "#FFFFFF",
                          }}
                        >
                          Authenticate
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
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
