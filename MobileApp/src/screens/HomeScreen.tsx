import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useActiveProject } from "../hooks/useProject";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallDuty } from "../hooks/useOnCallDuty";
import { useNow } from "../hooks/useNow";
import type { MainTabParamList } from "../navigation/types";
import type { ProjectItem } from "../api/types";
import GradientButton from "../components/GradientButton";
import ScreenIntro from "../components/ScreenIntro";
import EmptyState from "../components/EmptyState";
import SectionHeader from "../components/SectionHeader";
import { formatDuration, millisecondsUntil } from "../utils/duration";
import { getGlobalSsoToken, getSsoTokens } from "../storage/ssoTokens";
import { isProjectSsoDenied } from "../sso/ssoDenials";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;
interface StatCardProps {
  count: number | undefined;
  label: string;
  accentColor: string;
  iconName: keyof typeof Ionicons.glyphMap;
  isLoading: boolean;
  onPress: () => void;
  compact?: boolean;
}
function StatCard({
  count,
  label,
  accentColor,
  iconName,
  isLoading,
  onPress,
  compact = false,
}: StatCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();
  return (
    <Pressable
      onPress={() => {
        lightImpact();
        onPress();
      }}
      accessibilityLabel={
        isLoading
          ? `${label}, not available yet. Tap to view.`
          : `${count ?? 0} ${label}. Tap to view.`
      }
      accessibilityRole="button"
      style={({ pressed }: { pressed: boolean }) => {
        return {
          flex: compact ? undefined : 1,
          minWidth: compact ? undefined : 128,
          padding: 16,
          borderRadius: 16,
          gap: compact ? 12 : 14,
          flexDirection: compact ? "row" : "column",
          alignItems: compact ? "center" : undefined,
          backgroundColor: pressed
            ? theme.colors.backgroundTertiary
            : theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        };
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: accentColor + "18",
        }}
      >
        <Ionicons name={iconName} size={19} color={accentColor} />
      </View>
      {compact ? (
        <Text
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: "600",
            color: theme.colors.textPrimary,
          }}
        >
          {label}
        </Text>
      ) : null}
      <Text
        style={{
          fontSize: compact ? 24 : 36,
          fontWeight: "700",
          fontVariant: ["tabular-nums"],
          letterSpacing: -1,
          color: theme.colors.textPrimary,
        }}
      >
        {isLoading ? "--" : count ?? 0}
      </Text>
      {!compact ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              lineHeight: 20,
              fontWeight: "600",
              color: theme.colors.textSecondary,
            }}
          >
            {label}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={16}
            color={theme.colors.textSecondary}
          />
        </View>
      ) : (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.textTertiary}
        />
      )}
    </Pressable>
  );
}
function getGreeting(): string {
  const hour: number = new Date().getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

export default function HomeScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const [refreshing, setRefreshing] = useState(false);
  const { projectList, isLoadingProjects, projectLoadError, refreshProjects } =
    useActiveProject();
  const navigation: HomeNavProp = useNavigation<HomeNavProp>();

  const {
    incidentCount,
    alertCount,
    incidentEpisodeCount,
    alertEpisodeCount,
    monitorCount,
    disabledMonitorCount,
    inoperationalMonitorCount,
    isLoading: anyLoading,
    isError: countsError,
    refetch,
  } = useAllProjectCounts();

  const now: number = useNow();

  /*
   * The Home card used to count assignments. A count is not what somebody
   * checking their phone at 7am wants to know - whether they are on, and for
   * how much longer, is - so the card leads with the duty state and the
   * countdown and keeps the count as a secondary detail.
   */
  const {
    summary: onCallSummary,
    isLoading: onCallLoading,
    isError: onCallError,
    refetch: refetchOnCall,
  } = useOnCallDuty();

  const totalAssignments: number =
    onCallSummary.standingAssignmentCount +
    onCallSummary.scheduleAssignmentCount;

  /*
   * Same precedence as the on-call tab's status card: a real handoff time
   * beats everything, then a next-shift time, and only then the assignment
   * count. The card never invents a handoff for a standing assignment, which
   * has none.
   */
  const onCallSummaryLine: string = useMemo((): string => {
    const handoffIn: number | null = millisecondsUntil(
      onCallSummary.nextHandoffAt,
      now,
    );

    if (onCallSummary.isOnCall && handoffIn !== null) {
      return `Handoff in ${formatDuration(handoffIn)}`;
    }

    if (onCallSummary.isOnCall) {
      return totalAssignments === 1
        ? "1 active assignment · no scheduled handoff"
        : `${totalAssignments} active assignments · no scheduled handoff`;
    }

    const nextShiftIn: number | null = millisecondsUntil(
      onCallSummary.nextShiftStartsAt,
      now,
    );

    if (nextShiftIn !== null) {
      return `Next shift starts in ${formatDuration(nextShiftIn)}`;
    }

    return "No active on-call assignments";
  }, [onCallSummary, now, totalAssignments]);

  /*
   * Whether Home is allowed to print a count at all.
   *
   * Every count out of useAllProjectCounts falls back to 0 when its query has
   * no data, so a request that FAILED arrives here as the same number as a
   * genuinely quiet night. On this screen that 0 is not a datum, it is a
   * verdict - "there is nothing to respond to" - and it is the one verdict the
   * app must never reach by accident. isError is the hook's only way of saying
   * otherwise, and it is deliberately coarse (any of the seven requests), so
   * it retires the whole set of numbers rather than pretending we know which
   * of them is real.
   */
  const countIsKnown: boolean = !anyLoading && !countsError;

  const { lightImpact } = useHaptics();

  const [unauthenticatedSsoProjects, setUnauthenticatedSsoProjects] = useState<
    ProjectItem[]
  >([]);

  const checkSsoStatus: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const ssoTokens: Record<string, string> = await getSsoTokens();
      // A global SSO token satisfies enforcement for every project.
      const globalSsoToken: string | null = await getGlobalSsoToken();
      const unauthenticated: ProjectItem[] = projectList.filter(
        (p: ProjectItem) => {
          if (!p.requireSsoForLogin) {
            return false;
          }

          /*
           * A denial recorded by the API client outranks anything in storage:
           * the server has already refused this project, so a stored token
           * (expired, or issued by a provider that has since been disabled or
           * restricted) does not make it authenticated.
           */
          if (isProjectSsoDenied(p._id)) {
            return true;
          }

          return !ssoTokens[p._id] && !globalSsoToken;
        },
      );
      setUnauthenticatedSsoProjects(unauthenticated);
    }, [projectList]);

  useEffect((): void => {
    checkSsoStatus();
  }, [checkSsoStatus]);

  /*
   * The Home tab stays mounted while the user goes off to Settings to complete
   * an SSO login, so a plain effect keyed on projectList never re-runs and the
   * banner keeps demanding SSO for a project that is now authenticated. Re-check
   * whenever the tab regains focus - which is exactly when the user comes back
   * from the login they just finished.
   */
  useFocusEffect(
    useCallback((): void => {
      checkSsoStatus();
    }, [checkSsoStatus]),
  );

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    setRefreshing(true);
    try {
      await Promise.all([
        refetch(),
        refreshProjects(),
        refetchOnCall(),
        checkSsoStatus(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  if (!isLoadingProjects && projectList.length === 0) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomPadding }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        <EmptyState
          title={
            projectLoadError ? "Could Not Load Projects" : "No Projects Found"
          }
          subtitle={
            projectLoadError
              ? "We could not reach OneUptime to load your projects, which is not the same as you having none. Pull to refresh or retry."
              : "You don't have access to any projects. Contact your administrator or pull to refresh."
          }
          actionLabel="Retry"
          onAction={refreshProjects}
        />
      </ScrollView>
    );
  }
  if (isLoadingProjects) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <ActivityIndicator
          accessibilityLabel="Loading your projects"
          size="large"
          color={theme.colors.actionPrimary}
        />
      </View>
    );
  }
  const dutyKnown: boolean = !onCallLoading && !onCallError;
  const dutyActive: boolean = dutyKnown && onCallSummary.isOnCall;
  const dutyColor: string = dutyActive
    ? theme.colors.oncallActive
    : theme.colors.textSecondary;
  const onCallHeadline: string = onCallLoading
    ? "On-Call"
    : onCallError
      ? "Could not load your on-call status"
      : dutyActive
        ? "You're on call"
        : "You're not on call";
  const onCallSpokenStatus: string = onCallLoading
    ? "Checking whether you are on call"
    : onCallError
      ? "Your on-call status could not be loaded"
      : dutyActive
        ? "You are on call"
        : "You are not on call";
  const onCallDetailLine: string = onCallLoading
    ? "Checking your duty status..."
    : onCallError
      ? "Pull to refresh or try again."
      : onCallSummaryLine;
  const onCallBadgeLabel: string = !dutyKnown
    ? "--"
    : dutyActive
      ? "ON CALL"
      : "OFF CALL";
  return (
    <ScrollView
      testID="home-scroll"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: 20,
        paddingBottom: bottomPadding,
        gap: 28,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <View>
        <ScreenIntro
          eyebrow={getGreeting()}
          title="Your overview"
          description="Check active issues and your next handoff."
          style={{ marginBottom: 0 }}
        />
      </View>
      {unauthenticatedSsoProjects.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Some projects require SSO authentication. Tap to authenticate."
          onPress={() => {
            lightImpact();
            navigation.navigate("Settings", {
              screen: "ProjectsList",
              initial: false,
            });
          }}
          style={{
            padding: 16,
            borderRadius: 16,
            gap: 8,
            backgroundColor: theme.colors.severityWarningBg,
            borderWidth: 1,
            borderColor: theme.colors.severityWarning + "55",
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: theme.colors.severityWarning,
            }}
          >
            SSO Authentication Required
          </Text>
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {unauthenticatedSsoProjects
              .map((project: ProjectItem) => {
                return project.name;
              })
              .join(", ")}
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.actionPrimary,
            }}
          >
            Connect projects →
          </Text>
        </Pressable>
      ) : null}
      <View>
        <SectionHeader title="Your on-call status" iconName="call-outline" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${onCallSpokenStatus}. ${onCallDetailLine}. Tap to open the on-call tab.`}
          onPress={() => {
            lightImpact();
            navigation.navigate("OnCall");
          }}
          style={({ pressed }: { pressed: boolean }) => {
            return {
              padding: 20,
              borderRadius: 16,
              backgroundColor: pressed
                ? theme.colors.backgroundTertiary
                : theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: dutyActive
                ? theme.colors.oncallActive + "60"
                : theme.colors.borderGlass,
              gap: 12,
            };
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: dutyColor,
              }}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 1,
                color: dutyColor,
              }}
            >
              {onCallBadgeLabel}
            </Text>
            <Ionicons
              name="arrow-forward"
              size={20}
              color={theme.colors.textSecondary}
            />
          </View>
          <Text
            style={{
              fontSize: 23,
              lineHeight: 30,
              fontWeight: "700",
              letterSpacing: -0.4,
              color: theme.colors.textPrimary,
            }}
          >
            {onCallHeadline}
          </Text>
          <Text
            style={{
              fontSize: 15,
              lineHeight: 22,
              color: theme.colors.textSecondary,
            }}
          >
            {onCallDetailLine}
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.actionPrimary,
            }}
          >
            View shifts & coverage
          </Text>
        </Pressable>
      </View>
      <View>
        <SectionHeader title="Needs attention" iconName="flash-outline" />
        {countsError ? (
          <View style={{ marginBottom: 16, gap: 12 }}>
            <Text
              accessibilityRole="alert"
              style={{
                fontSize: 14,
                lineHeight: 21,
                color: theme.colors.severityWarning,
              }}
            >
              Counts are unavailable. Open a list or retry to check the latest
              status.
            </Text>
            <GradientButton
              label="Retry counts"
              variant="secondary"
              onPress={refetch}
              icon="refresh-outline"
            />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          <StatCard
            count={incidentCount}
            label="Active Incidents"
            accentColor={theme.colors.severityCritical}
            iconName="warning-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Incidents", {
                screen: "IncidentsList",
                params: {
                  initialSegment: "incidents",
                  initialFilter: "active",
                },
              });
            }}
          />
          <StatCard
            count={alertCount}
            label="Active Alerts"
            accentColor={theme.colors.severityMajor}
            iconName="notifications-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Alerts", {
                screen: "AlertsList",
                params: { initialSegment: "alerts", initialFilter: "active" },
              });
            }}
          />
        </View>
      </View>
      <View>
        <SectionHeader title="Service health" iconName="pulse-outline" />
        <View style={{ gap: 10 }}>
          <StatCard
            compact
            count={inoperationalMonitorCount}
            label="Inoperational"
            accentColor={theme.colors.severityCritical}
            iconName="alert-circle-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Monitors", {
                screen: "MonitorsList",
                params: { initialFilter: "issues" },
              });
            }}
          />
          <StatCard
            compact
            count={monitorCount}
            label="Total Monitors"
            accentColor={theme.colors.oncallActive}
            iconName="pulse-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Monitors", {
                screen: "MonitorsList",
                params: { initialFilter: "all" },
              });
            }}
          />
          <StatCard
            compact
            count={disabledMonitorCount}
            label="Disabled"
            accentColor={theme.colors.textTertiary}
            iconName="pause-circle-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Monitors", {
                screen: "MonitorsList",
                params: { initialFilter: "disabled" },
              });
            }}
          />
        </View>
      </View>
      <View>
        <SectionHeader title="Grouped events" iconName="layers-outline" />
        <Text
          style={{
            fontSize: 14,
            lineHeight: 22,
            color: theme.colors.textSecondary,
            marginBottom: 14,
          }}
        >
          Episodes bring related incidents or alerts together.
        </Text>
        <View style={{ gap: 10 }}>
          <StatCard
            compact
            count={incidentEpisodeCount}
            label="Incident Episodes"
            accentColor={theme.colors.actionPrimary}
            iconName="layers-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Incidents", {
                screen: "IncidentsList",
                params: { initialSegment: "episodes", initialFilter: "active" },
              });
            }}
          />
          <StatCard
            compact
            count={alertEpisodeCount}
            label="Alert Episodes"
            accentColor={theme.colors.actionPrimary}
            iconName="layers-outline"
            isLoading={!countIsKnown}
            onPress={() => {
              navigation.navigate("Alerts", {
                screen: "AlertsList",
                params: { initialSegment: "episodes", initialFilter: "active" },
              });
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
