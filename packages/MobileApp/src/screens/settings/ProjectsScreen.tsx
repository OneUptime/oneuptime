import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
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
import IconBadge from "../../components/IconBadge";
import { ListGroup } from "../../components/ListGroup";
import ScreenIntro from "../../components/ScreenIntro";
import SearchField from "../../components/SearchField";
import StatusPill from "../../components/StatusPill";
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
import { getInitials } from "../../utils/text";

type Props = NativeStackScreenProps<SettingsStackParamList, "ProjectsList">;

function ProjectAvatar({
  name,
  testID,
}: {
  name: string;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const initials: string = getInitials(name);
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.cardAccent,
      }}
    >
      {initials ? (
        <AppText variant="subhead" weight="700" tone="accent">
          {initials}
        </AppText>
      ) : (
        <Ionicons
          name="folder-outline"
          size={18}
          color={theme.colors.actionPrimary}
        />
      )}
    </View>
  );
}

/** A centred icon, title and explanation inside a card. */
function ProjectsPlaceholder({
  icon,
  title,
  message,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <Card testID={testID} padding={spacing.xxl}>
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <IconBadge name={icon} size="lg" shape="circle" />
        <AppText
          accessibilityRole="header"
          variant="headline"
          align="center"
          style={{ marginTop: spacing.xs }}
        >
          {title}
        </AppText>
        <AppText variant="subhead" tone="secondary" align="center">
          {message}
        </AppText>
      </View>
    </Card>
  );
}

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
        testID="projects-loading"
        accessibilityLiveRegion="polite"
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: spacing.lg,
          padding: spacing.xl,
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
        <AppText variant="callout" tone="secondary" align="center">
          Loading your projects…
        </AppText>
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
  const accessSummary: string = `${projects.length} ${
    projects.length === 1 ? "project" : "projects"
  } · ${needsSignIn > 0 ? `${needsSignIn} need SSO sign-in` : "All projects ready"}`;
  const anyRequiresSso: boolean = projects.some(
    (project: ProjectItem): boolean => {
      return Boolean(project.requireSsoForLogin);
    },
  );

  return (
    <ScrollView
      testID="projects-scroll"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom,
        gap: spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.actionPrimary}
          colors={[theme.colors.actionPrimary]}
          progressBackgroundColor={theme.colors.backgroundElevated}
        />
      }
    >
      <ScreenIntro
        title="Project access"
        compact
        description="Manage your access. Switch projects from the name at the top of any screen."
        style={{ marginBottom: 0 }}
      />
      {projects.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <View
            testID="projects-summary"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Ionicons
              name={
                needsSignIn > 0 ? "shield-half-outline" : "checkmark-circle"
              }
              size={16}
              color={
                needsSignIn > 0
                  ? theme.colors.statusWarning
                  : theme.colors.statusSuccess
              }
            />
            <AppText
              accessibilityLiveRegion="polite"
              variant="subhead"
              weight={needsSignIn > 0 ? "600" : undefined}
              tone={needsSignIn > 0 ? "warning" : "secondary"}
              style={{ flex: 1 }}
            >
              {accessSummary}
            </AppText>
          </View>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search projects"
            accessibilityLabel="Search projects"
          />
        </View>
      ) : null}

      {error ? (
        <View accessibilityLiveRegion="polite" collapsable={false}>
          <Banner testID="projects-error" tone="danger" message={error} />
        </View>
      ) : null}
      {error && projects.length === 0 ? (
        <GradientButton
          label="Retry loading projects"
          icon="refresh"
          onPress={loadData}
          variant="primary"
        />
      ) : null}

      {projects.length === 0 && !error ? (
        <ProjectsPlaceholder
          testID="projects-empty"
          icon="folder-open-outline"
          title="No projects found."
          message="Ask your team to invite you to a project, then pull down to refresh."
        />
      ) : projects.length > 0 && visibleProjects.length === 0 ? (
        <ProjectsPlaceholder
          testID="projects-no-match"
          icon="search-outline"
          title="No matching projects"
          message="Try another name or clear the search to see all your projects."
        />
      ) : projects.length > 0 ? (
        <ListGroup testID="projects-list">
          {visibleProjects.map((project: ProjectItem) => {
            const requiresSso: boolean = Boolean(project.requireSsoForLogin);
            const authenticated: boolean = isProjectAuthenticated(project._id);
            const isAuthenticating: boolean =
              authenticatingProjectId === project._id;
            const anyAuthenticating: boolean = authenticatingProjectId !== null;

            return (
              <View
                key={project._id}
                testID={`project-row-${project._id}`}
                style={{
                  padding: spacing.lg,
                  gap: spacing.md,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                  }}
                >
                  <ProjectAvatar
                    name={project.name}
                    testID={`project-avatar-${project._id}`}
                  />

                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      gap: spacing.xs,
                      alignItems: "flex-start",
                    }}
                  >
                    <AppText variant="headline" numberOfLines={2}>
                      {project.name}
                    </AppText>

                    {requiresSso ? (
                      <StatusPill
                        testID={`project-sso-status-${project._id}`}
                        size="sm"
                        tone={authenticated ? "success" : "warning"}
                        dotColor={
                          authenticated
                            ? theme.colors.statusSuccess
                            : theme.colors.statusWarning
                        }
                        label={authenticated ? "Authenticated" : "SSO Required"}
                      />
                    ) : (
                      <AppText variant="footnote" tone="secondary">
                        Ready to use
                      </AppText>
                    )}
                  </View>
                </View>

                {requiresSso && !authenticated ? (
                  <Pressable
                    testID={`project-authenticate-${project._id}`}
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
                    disabled={anyAuthenticating}
                    accessibilityState={{
                      disabled: anyAuthenticating,
                      busy: isAuthenticating,
                    }}
                    aria-disabled={anyAuthenticating}
                    aria-busy={isAuthenticating}
                    style={({
                      pressed,
                    }: {
                      pressed: boolean;
                    }): StyleProp<ViewStyle> => {
                      return {
                        minHeight: touchTarget,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor:
                          pressed && !anyAuthenticating
                            ? theme.colors.actionPrimaryPressed
                            : theme.colors.actionPrimary,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity:
                          anyAuthenticating && !isAuthenticating ? 0.55 : 1,
                      };
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
                          gap: spacing.sm,
                        }}
                      >
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={16}
                          color={theme.colors.textInverse}
                        />
                        <AppText
                          variant="callout"
                          weight="600"
                          tone="inverse"
                          style={{ flexShrink: 1 }}
                        >
                          Authenticate with SSO
                        </AppText>
                      </View>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ListGroup>
      ) : null}

      {anyRequiresSso ? (
        <AppText
          variant="footnote"
          tone="secondary"
          style={{ marginHorizontal: spacing.xs }}
        >
          Projects requiring SSO need separate authentication. Tap Authenticate
          to sign in via your identity provider.
        </AppText>
      ) : null}
    </ScrollView>
  );
}
