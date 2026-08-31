import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useProject } from "../hooks/useProject";
import { useHaptics } from "../hooks/useHaptics";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";
import type { ProjectItem } from "../api/types";
import Logo from "../components/Logo";
import GradientButton from "../components/GradientButton";
import { useOnCallDuty } from "../hooks/useOnCallDuty";
import { useNow } from "../hooks/useNow";
import { formatDuration, millisecondsUntil } from "../utils/duration";
import { getGlobalSsoToken, getSsoTokens } from "../storage/ssoTokens";
import { isProjectSsoDenied } from "../sso/ssoDenials";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;

interface StatCardProps {
  count: number | undefined;
  label: string;
  accentColor: string;
  iconName: keyof typeof Ionicons.glyphMap;

  /*
   * "We do not have this number", not merely "a request is in flight".
   *
   * The card draws "--" for it, and the two things that put a card here - a
   * count still being fetched, and a count whose request failed - are the same
   * thing as far as the responder is concerned: we cannot tell them what is
   * outstanding. Both must be kept off the "0" path, because 0 on this screen
   * is read as a verdict.
   */
  isLoading: boolean;
  onPress: () => void;
}

function StatCard({
  count,
  label,
  accentColor,
  iconName,
  isLoading,
  onPress,
}: StatCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  const handlePress: () => void = (): void => {
    lightImpact();
    onPress();
  };

  /*
   * The label has to tell the same truth the digits do. It used to announce
   * "0 Inoperational" off the same `count ?? 0` fallback that the body already
   * refuses to print while the number is unknown, so a responder on VoiceOver
   * or TalkBack was handed exactly the all-clear the sighted responder was
   * deliberately denied.
   */
  const accessibilityLabel: string = isLoading
    ? `${label}, not available yet. Tap to view.`
    : `${count ?? 0} ${label}. Tap to view.`;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={{
        borderRadius: 24,
        overflow: "hidden",
      }}
    >
      <LinearGradient
        colors={[
          theme.colors.accentGradientStart + "2B",
          theme.colors.accentGradientEnd + "1A",
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          top: -36,
          left: -20,
          width: 160,
          height: 160,
          borderRadius: 999,
        }}
      />
      <View
        style={{
          padding: 16,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          borderRadius: 22,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 16,
          elevation: 6,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: accentColor + "14",
            }}
          >
            <Ionicons name={iconName} size={18} color={accentColor} />
          </View>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={theme.colors.textTertiary}
          />
        </View>
        <Text
          style={{
            fontSize: 30,
            fontWeight: "bold",
            color: theme.colors.textPrimary,
            fontVariant: ["tabular-nums"],
            letterSpacing: -1.1,
          }}
        >
          {isLoading ? "--" : count ?? 0}
        </Text>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            marginTop: 4,
            color: theme.colors.textSecondary,
            letterSpacing: 0.3,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
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
  const { projectList, isLoadingProjects, projectLoadError, refreshProjects } =
    useProject();
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
    await Promise.all([
      refetch(),
      refreshProjects(),
      refetchOnCall(),
      checkSsoStatus(),
    ]);
  };

  if (!isLoadingProjects && projectList.length === 0) {
    /*
     * Two very different situations arrive here as the same empty list, and
     * this copy is the only thing that can tell them apart: an account that
     * genuinely holds no projects, and an account whose project fetch failed.
     * useProject now reports which one via projectLoadError. Telling a
     * responder that they "don't have access to any projects" when the request
     * simply never landed sends them to their administrator instead of to the
     * retry that would actually put their incidents back on screen.
     */
    const emptyTitle: string = projectLoadError
      ? "Could Not Load Projects"
      : "No Projects Found";
    const emptyBody: string = projectLoadError
      ? "We could not reach OneUptime to load your projects, which is not the same as you having none. Pull to refresh or retry."
      : "You don't have access to any projects. Contact your administrator or pull to refresh.";

    return (
      <ScrollView
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
              backgroundColor: "#000000",
              borderWidth: 1,
              borderColor: "#1F1F1F",
            }}
          >
            <Logo size={76} />
          </View>

          <Text
            style={{
              fontSize: 22,
              fontWeight: "bold",
              textAlign: "center",
              color: theme.colors.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            {emptyTitle}
          </Text>
          <Text
            style={{
              fontSize: 15,
              textAlign: "center",
              marginTop: 8,
              lineHeight: 22,
              maxWidth: 300,
              color: theme.colors.textSecondary,
            }}
          >
            {emptyBody}
          </Text>

          <View style={{ marginTop: 32, width: 200 }}>
            <GradientButton
              label="Retry"
              onPress={refreshProjects}
              icon="refresh-outline"
            />
          </View>
        </View>
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
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
      </View>
    );
  }

  const subtitle: string =
    projectList.length === 1
      ? projectList[0]!.name
      : `${projectList.length} Projects`;

  /*
   * Which of the ways of arriving at "not on call" this actually is.
   *
   * `isOnCall` comes back false both when every project answered and none of
   * them put this responder on duty, and when the check never landed at all -
   * and the headline, the badge and the screen-reader label would all read
   * that same false as the all-clear. "You're not on call" is the most
   * expensive sentence this app can print, because somebody reads it and stops
   * watching their phone. The on-call tab refuses to answer at all while
   * useOnCallDuty reports isError; Home has one card rather than a screen, so
   * it says the same thing in the space it has.
   */
  let onCallHeadline: string;
  let onCallSpokenStatus: string;
  let onCallDetailLine: string;
  let onCallBadgeLabel: string;

  if (onCallLoading) {
    onCallHeadline = "On-Call";
    onCallSpokenStatus = "Checking whether you are on call";
    onCallDetailLine = "Checking your duty status...";
    onCallBadgeLabel = "--";
  } else if (onCallError) {
    onCallHeadline = "Could not load your on-call status";
    onCallSpokenStatus = "Your on-call status could not be loaded";
    onCallDetailLine = "Pull to refresh or try again.";
    onCallBadgeLabel = "--";
  } else if (onCallSummary.isOnCall) {
    onCallHeadline = "You're on call";
    onCallSpokenStatus = "You are on call";
    onCallDetailLine = onCallSummaryLine;
    onCallBadgeLabel = "ON CALL";
  } else {
    onCallHeadline = "You're not on call";
    onCallSpokenStatus = "You are not on call";
    onCallDetailLine = onCallSummaryLine;
    onCallBadgeLabel = "OFF CALL";
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <View
        style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 }}
      >
        <View
          style={{
            borderRadius: 24,
            overflow: "hidden",
            padding: 20,
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowOffset: { width: 0, height: 10 },
            shadowRadius: 18,
            elevation: 7,
          }}
        >
          <LinearGradient
            colors={[
              theme.colors.accentGradientStart + "2B",
              theme.colors.accentGradientEnd + "08",
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: "absolute",
              top: -60,
              left: -20,
              right: -20,
              height: 220,
            }}
          />

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
                backgroundColor: "#000000",
                borderWidth: 1,
                borderColor: "#1F1F1F",
              }}
            >
              <Logo size={44} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: theme.colors.textSecondary,
                }}
              >
                {getGreeting()}
              </Text>
              <Text
                accessibilityRole="header"
                style={{
                  fontSize: 24,
                  fontWeight: "bold",
                  color: theme.colors.textPrimary,
                  letterSpacing: -0.6,
                }}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            <View>
              <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>
                Total active items
              </Text>
              <Text
                style={{
                  fontSize: 30,
                  fontWeight: "bold",
                  color: theme.colors.textPrimary,
                  fontVariant: ["tabular-nums"],
                  letterSpacing: -1,
                }}
              >
                {countIsKnown
                  ? (incidentCount ?? 0) +
                    (alertCount ?? 0) +
                    (incidentEpisodeCount ?? 0) +
                    (alertEpisodeCount ?? 0)
                  : "--"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {unauthenticatedSsoProjects.length > 0 ? (
        <Pressable
          onPress={() => {
            lightImpact();
            navigation.navigate("Settings", {
              screen: "ProjectsList",
            } as any);
          }}
          style={{ paddingHorizontal: 20, marginBottom: 4 }}
          accessibilityLabel="Some projects require SSO authentication. Tap to authenticate."
          accessibilityRole="button"
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 14,
              borderRadius: 16,
              backgroundColor: theme.colors.severityWarningBg,
              borderWidth: 1,
              borderColor: theme.colors.severityWarning + "33",
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.severityWarning + "1A",
                marginRight: 12,
              }}
            >
              <Ionicons
                name="shield-outline"
                size={16}
                color={theme.colors.severityWarning}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "700",
                  color: theme.colors.severityWarning,
                }}
              >
                SSO Authentication Required
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  marginTop: 2,
                  color: theme.colors.severityWarning,
                  opacity: 0.8,
                }}
                numberOfLines={1}
              >
                {unauthenticatedSsoProjects
                  .map((p: ProjectItem) => {
                    return p.name;
                  })
                  .join(", ")}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={theme.colors.severityWarning}
              style={{ marginLeft: 8 }}
            />
          </View>
        </Pressable>
      ) : null}

      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <View>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              marginBottom: 8,
              color: theme.colors.textSecondary,
              letterSpacing: 1,
            }}
          >
            On-Call
          </Text>
          <Pressable
            onPress={() => {
              lightImpact();
              navigation.navigate("OnCall");
            }}
            style={({ pressed }: { pressed: boolean }) => {
              return {
                opacity: pressed ? 0.8 : 1,
              };
            }}
            accessibilityRole="button"
            accessibilityLabel={`${onCallSpokenStatus}. ${onCallDetailLine}. Tap to open the on-call tab.`}
          >
            <View
              style={{
                borderRadius: 24,
                overflow: "hidden",
                padding: 16,
                backgroundColor: theme.colors.backgroundElevated,
                borderWidth: 1,
                borderColor: theme.colors.borderGlass,
              }}
            >
              <LinearGradient
                colors={[
                  onCallSummary.isOnCall
                    ? theme.colors.oncallActiveBg
                    : theme.colors.oncallInactiveBg,
                  theme.colors.accentGradientEnd + "06",
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 100,
                }}
              />

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flex: 1,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                      backgroundColor: onCallSummary.isOnCall
                        ? theme.colors.oncallActiveBg
                        : theme.colors.oncallInactiveBg,
                    }}
                  >
                    <Ionicons
                      name={onCallSummary.isOnCall ? "call" : "call-outline"}
                      size={18}
                      color={
                        onCallSummary.isOnCall
                          ? theme.colors.oncallActive
                          : theme.colors.textTertiary
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "bold",
                        color: theme.colors.textPrimary,
                      }}
                    >
                      {onCallHeadline}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        color: theme.colors.textSecondary,
                      }}
                      numberOfLines={2}
                    >
                      {onCallDetailLine}
                    </Text>
                  </View>
                </View>

                <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 9999,
                      backgroundColor: onCallSummary.isOnCall
                        ? theme.colors.oncallActiveBg
                        : theme.colors.oncallInactiveBg,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        letterSpacing: 0.8,
                        color: onCallSummary.isOnCall
                          ? theme.colors.oncallActive
                          : theme.colors.textTertiary,
                      }}
                    >
                      {onCallBadgeLabel}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={theme.colors.textTertiary}
                    style={{ marginTop: 6 }}
                  />
                </View>
              </View>
            </View>
          </Pressable>
        </View>

        <View>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              marginBottom: 8,
              color: theme.colors.textSecondary,
              letterSpacing: 1,
            }}
          >
            Monitors
          </Text>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <StatCard
                count={monitorCount}
                label="Total Monitors"
                accentColor={theme.colors.oncallActive}
                iconName="pulse-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Monitors");
                }}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <StatCard
                count={inoperationalMonitorCount}
                label="Inoperational"
                accentColor={theme.colors.severityCritical}
                iconName="close-circle-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Monitors");
                }}
              />
            </View>
          </View>
          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <StatCard
                count={disabledMonitorCount}
                label="Disabled"
                accentColor={theme.colors.textTertiary}
                iconName="pause-circle-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Monitors");
                }}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }} />
          </View>
        </View>

        <View>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              marginBottom: 8,
              color: theme.colors.textSecondary,
              letterSpacing: 1,
            }}
          >
            Incidents
          </Text>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <StatCard
                count={incidentCount}
                label="Active Incidents"
                accentColor={theme.colors.severityCritical}
                iconName="warning-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Incidents");
                }}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <StatCard
                count={incidentEpisodeCount}
                label="Inc. Episodes"
                accentColor={theme.colors.severityInfo}
                iconName="layers-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Incidents");
                }}
              />
            </View>
          </View>
        </View>

        <View>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              marginBottom: 8,
              color: theme.colors.textSecondary,
              letterSpacing: 1,
            }}
          >
            Alerts
          </Text>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <StatCard
                count={alertCount}
                label="Active Alerts"
                accentColor={theme.colors.severityMajor}
                iconName="alert-circle-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Alerts");
                }}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <StatCard
                count={alertEpisodeCount}
                label="Alert Episodes"
                accentColor={theme.colors.severityWarning}
                iconName="layers-outline"
                isLoading={!countIsKnown}
                onPress={() => {
                  return navigation.navigate("Alerts");
                }}
              />
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
