import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useActiveProject } from "../hooks/useProject";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallDuty } from "../hooks/useOnCallDuty";
import { useNow } from "../hooks/useNow";
import type { MainTabParamList } from "../navigation/types";
import type { ProjectItem } from "../api/types";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import IconBadge from "../components/IconBadge";
import { ListGroup, ListItem } from "../components/ListGroup";
import QueryErrorNotice from "../components/QueryErrorNotice";
import ScreenIntro from "../components/ScreenIntro";
import SectionHeader from "../components/SectionHeader";
import StatusPill, { type StatusTone } from "../components/StatusPill";
import { formatDuration, millisecondsUntil } from "../utils/duration";
import { withAlpha } from "../utils/color";
import { getGlobalSsoToken, getSsoTokens } from "../storage/ssoTokens";
import { isProjectSsoDenied } from "../sso/ssoDenials";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;

/*
 * Every count on Home is either a number the server reported or "--". The
 * placeholder is not decoration: a count that is still loading, or whose
 * request failed, arrives from useAllProjectCounts as a fallback 0, and on
 * this screen a 0 reads as "nothing needs you".
 */
function formatCount(count: number | undefined, known: boolean): string {
  return known ? String(count ?? 0) : "--";
}

function countAccessibilityLabel(
  label: string,
  count: number | undefined,
  known: boolean,
): string {
  return known
    ? `${count ?? 0} ${label}. Tap to view.`
    : `${label}, not available yet. Tap to view.`;
}

interface AttentionTileProps {
  label: string;
  count: number | undefined;
  known: boolean;
  /** Still waiting for the counts, as opposed to having failed to get them. */
  checking: boolean;
  accentColor: string;
  iconName: keyof typeof Ionicons.glyphMap;
  stacked: boolean;
  accessibilityHint: string;
  testID: string;
  onPress: () => void;
}

/** One of the two large "Needs attention" tiles: a count first, then what it counts. */
function AttentionTile({
  label,
  count,
  known,
  checking,
  accentColor,
  iconName,
  stacked,
  accessibilityHint,
  testID,
  onPress,
}: AttentionTileProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();
  const active: boolean = known && (count ?? 0) > 0;

  /*
   * The word carries the verdict and the dot only repeats it. "All clear" is
   * only ever said about a count the server actually reported.
   */
  const statusLine: string = !known
    ? checking
      ? "Checking…"
      : "Unavailable"
    : active
      ? "Needs response"
      : "All clear";
  const statusDotColor: string = !known
    ? theme.colors.textTertiary
    : active
      ? accentColor
      : theme.colors.statusSuccess;

  return (
    <Card
      testID={testID}
      onPress={() => {
        lightImpact();
        onPress();
      }}
      accessibilityLabel={countAccessibilityLabel(label, count, known)}
      accessibilityHint={accessibilityHint}
      style={[
        {
          flex: stacked ? undefined : 1,
          minHeight: 156,
          gap: spacing.xs,
        },
        active
          ? { borderColor: withAlpha(accentColor, theme.dark ? 0.5 : 0.32) }
          : null,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.sm,
        }}
      >
        <IconBadge name={iconName} color={accentColor} />
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textTertiary}
        />
      </View>
      <AppText
        testID={`${testID}-count`}
        variant="largeTitle"
        color={active ? accentColor : theme.colors.textPrimary}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {formatCount(count, known)}
      </AppText>
      <AppText variant="headline">{label}</AppText>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs + 2,
        }}
      >
        <View
          testID={`${testID}-status-dot`}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: statusDotColor,
          }}
        />
        <AppText variant="footnote" tone="secondary">
          {statusLine}
        </AppText>
      </View>
    </Card>
  );
}

interface CountRowProps {
  label: string;
  count: number | undefined;
  known: boolean;
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  /** Colour for a non-zero count that deserves a second look. */
  highlightColor?: string;
  accessibilityHint: string;
  testID: string;
  onPress: () => void;
}

/** A grouped-list row that opens a filtered list and shows how many it holds. */
function CountRow({
  label,
  count,
  known,
  iconName,
  iconColor,
  highlightColor,
  accessibilityHint,
  testID,
  onPress,
}: CountRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();
  const highlighted: boolean =
    Boolean(highlightColor) && known && (count ?? 0) > 0;

  return (
    <ListItem
      testID={testID}
      title={label}
      icon={iconName}
      iconColor={iconColor}
      showChevron
      accessibilityLabel={countAccessibilityLabel(label, count, known)}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        lightImpact();
        onPress();
      }}
      trailing={
        <AppText
          testID={`${testID}-count`}
          variant="title3"
          weight="700"
          color={
            highlighted
              ? highlightColor
              : known
                ? theme.colors.textPrimary
                : theme.colors.textTertiary
          }
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {formatCount(count, known)}
        </AppText>
      }
    />
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
  const { fontScale } = useWindowDimensions();
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
  const countsChecking: boolean = anyLoading && !countsError;

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

  const refreshControl: React.JSX.Element = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.actionPrimary}
      colors={[theme.colors.actionPrimary]}
      progressBackgroundColor={theme.colors.backgroundElevated}
    />
  );

  if (!isLoadingProjects && projectList.length === 0) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomPadding }}
        refreshControl={refreshControl}
      >
        <EmptyState
          icon={projectLoadError ? "error" : "default"}
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
  const onCallTone: StatusTone = onCallError
    ? "warning"
    : dutyActive
      ? "success"
      : "neutral";
  const onCallIconColor: string = onCallError
    ? theme.colors.statusWarning
    : dutyActive
      ? theme.colors.oncallActive
      : theme.colors.actionPrimary;
  const stackTiles: boolean = fontScale > 1.3;

  return (
    <ScrollView
      testID="home-scroll"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
        gap: spacing.xxl,
      }}
      refreshControl={refreshControl}
    >
      <ScreenIntro
        eyebrow={getGreeting()}
        title="Overview"
        description="Your response queue and service health."
        style={{ marginBottom: 0 }}
      />
      {unauthenticatedSsoProjects.length > 0 ? (
        <Banner
          testID="home-sso-banner"
          tone="warning"
          icon="key-outline"
          title="SSO Authentication Required"
          message={`Sign in with SSO to see activity from ${unauthenticatedSsoProjects
            .map((project: ProjectItem) => {
              return project.name;
            })
            .join(", ")}.`}
          accessibilityLabel="Some projects require SSO authentication. Tap to authenticate."
          onPress={() => {
            lightImpact();
            navigation.navigate("Settings", {
              screen: "ProjectsList",
              initial: false,
            });
          }}
        />
      ) : null}
      <View>
        <SectionHeader title="Needs attention" iconName="flash-outline" />
        {countsError ? (
          <QueryErrorNotice
            message="Counts are unavailable. Open a list or retry to check the latest status."
            retryLabel="Retry counts"
            onRetry={refetch}
          />
        ) : null}
        <View
          style={{
            flexDirection: stackTiles ? "column" : "row",
            gap: spacing.md,
          }}
        >
          <AttentionTile
            testID="home-tile-incidents"
            count={incidentCount}
            label="Active Incidents"
            accentColor={theme.colors.severityCritical}
            iconName="warning-outline"
            known={countIsKnown}
            checking={countsChecking}
            stacked={stackTiles}
            accessibilityHint="Opens active incidents in the inbox"
            onPress={() => {
              return navigation.navigate("Inbox", {
                screen: "InboxList",
                params: {
                  initialView: "incidents",
                  initialSegment: "incidents",
                  initialFilter: "active",
                },
              });
            }}
          />
          <AttentionTile
            testID="home-tile-alerts"
            count={alertCount}
            label="Active Alerts"
            accentColor={theme.colors.severityMajor}
            iconName="notifications-outline"
            known={countIsKnown}
            checking={countsChecking}
            stacked={stackTiles}
            accessibilityHint="Opens active alerts in the inbox"
            onPress={() => {
              return navigation.navigate("Inbox", {
                screen: "InboxList",
                params: {
                  initialView: "alerts",
                  initialSegment: "alerts",
                  initialFilter: "active",
                },
              });
            }}
          />
        </View>
      </View>
      <Card
        testID="home-oncall-card"
        accessibilityLabel={`${onCallSpokenStatus}. ${onCallDetailLine}. Tap to open the on-call tab.`}
        onPress={() => {
          lightImpact();
          navigation.navigate("OnCall");
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <IconBadge
            testID="home-oncall-icon"
            name={dutyActive ? "call" : "call-outline"}
            color={onCallIconColor}
            size="lg"
            shape="circle"
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <StatusPill
              testID="home-oncall-status"
              label={onCallBadgeLabel}
              tone={onCallTone}
              dotColor={dutyActive ? theme.colors.oncallActive : undefined}
              size="sm"
            />
            <AppText variant="title3">{onCallHeadline}</AppText>
            <AppText variant="subhead" tone="secondary">
              {onCallDetailLine}
            </AppText>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={theme.colors.textTertiary}
          />
        </View>
      </Card>
      <View>
        <SectionHeader title="Service health" iconName="pulse-outline" />
        <ListGroup testID="home-service-health">
          <CountRow
            testID="home-row-monitor-issues"
            count={inoperationalMonitorCount}
            label="Monitor issues"
            iconColor={theme.colors.statusError}
            highlightColor={theme.colors.statusError}
            iconName="alert-circle-outline"
            known={countIsKnown}
            accessibilityHint="Opens monitors that report a problem"
            onPress={() => {
              return navigation.navigate("Monitors", {
                screen: "MonitorsList",
                params: { initialFilter: "issues" },
              });
            }}
          />
          <CountRow
            testID="home-row-all-monitors"
            count={monitorCount}
            label="All monitors"
            iconColor={theme.colors.statusSuccess}
            iconName="pulse-outline"
            known={countIsKnown}
            accessibilityHint="Opens every monitor"
            onPress={() => {
              return navigation.navigate("Monitors", {
                screen: "MonitorsList",
                params: { initialFilter: "all" },
              });
            }}
          />
          <CountRow
            testID="home-row-disabled-monitors"
            count={disabledMonitorCount}
            label="Disabled monitors"
            iconColor={theme.colors.textSecondary}
            iconName="pause-circle-outline"
            known={countIsKnown}
            accessibilityHint="Opens monitors whose checks are switched off"
            onPress={() => {
              return navigation.navigate("Monitors", {
                screen: "MonitorsList",
                params: { initialFilter: "disabled" },
              });
            }}
          />
        </ListGroup>
      </View>
      <View>
        <SectionHeader title="Grouped events" iconName="layers-outline" />
        <AppText
          variant="subhead"
          tone="secondary"
          style={{ marginTop: -spacing.xs, marginBottom: spacing.md }}
        >
          Episodes bring related incidents or alerts together.
        </AppText>
        <ListGroup testID="home-grouped-events">
          <CountRow
            testID="home-row-incident-episodes"
            count={incidentEpisodeCount}
            label="Incident Episodes"
            iconColor={theme.colors.severityCritical}
            iconName="layers-outline"
            known={countIsKnown}
            accessibilityHint="Opens active incident episodes in the inbox"
            onPress={() => {
              return navigation.navigate("Inbox", {
                screen: "InboxList",
                params: {
                  initialView: "incidents",
                  initialSegment: "episodes",
                  initialFilter: "active",
                },
              });
            }}
          />
          <CountRow
            testID="home-row-alert-episodes"
            count={alertEpisodeCount}
            label="Alert Episodes"
            iconColor={theme.colors.severityMajor}
            iconName="layers-outline"
            known={countIsKnown}
            accessibilityHint="Opens active alert episodes in the inbox"
            onPress={() => {
              return navigation.navigate("Inbox", {
                screen: "InboxList",
                params: {
                  initialView: "alerts",
                  initialSegment: "episodes",
                  initialFilter: "active",
                },
              });
            }}
          />
        </ListGroup>
      </View>
    </ScrollView>
  );
}
