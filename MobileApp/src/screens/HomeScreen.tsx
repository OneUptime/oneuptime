import React from "react";
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
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";
import Logo from "../components/Logo";
import GradientButton from "../components/GradientButton";
import { useAllProjectOnCallPolicies } from "../hooks/useAllProjectOnCallPolicies";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;

interface StatCardProps {
  count: number | undefined;
  label: string;
  accentColor: string;
  iconName: keyof typeof Ionicons.glyphMap;
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

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handlePress}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
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
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
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
  const { projectList, isLoadingProjects, refreshProjects } = useProject();
  const navigation: HomeNavProp = useNavigation<HomeNavProp>();

  const {
    incidentCount,
    alertCount,
    incidentEpisodeCount,
    alertEpisodeCount,
    isLoading: anyLoading,
    refetch,
  } = useAllProjectCounts();

  const {
    totalAssignments,
    projects: onCallProjects,
    isLoading: onCallLoading,
    refetch: refetchOnCall,
  } = useAllProjectOnCallPolicies();

  const { lightImpact } = useHaptics();

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await Promise.all([refetch(), refreshProjects(), refetchOnCall()]);
  };

  if (!isLoadingProjects && projectList.length === 0) {
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
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
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
            No Projects Found
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
            You don&apos;t have access to any projects. Contact your
            administrator or pull to refresh.
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
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
      </View>
    );
  }

  const subtitle: string =
    projectList.length === 1
      ? projectList[0]!.name
      : `${projectList.length} Projects`;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 }}>
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
              <Text
                style={{ fontSize: 12, color: theme.colors.textTertiary }}
              >
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
                {(incidentCount ?? 0) +
                  (alertCount ?? 0) +
                  (incidentEpisodeCount ?? 0) +
                  (alertEpisodeCount ?? 0)}
              </Text>
            </View>
          </View>
        </View>
      </View>

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
            style={({ pressed }: { pressed: boolean }) => ({
              opacity: pressed ? 0.8 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel="View my on-call assignments"
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
                theme.colors.oncallActiveBg,
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

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                    backgroundColor: theme.colors.oncallActiveBg,
                  }}
                >
                  <Ionicons
                    name="call-outline"
                    size={18}
                    color={theme.colors.oncallActive}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 15, fontWeight: "bold", color: theme.colors.textPrimary }}
                  >
                    My On-Call Policies
                  </Text>
                  <Text
                    style={{ fontSize: 12, marginTop: 2, color: theme.colors.textSecondary }}
                  >
                    {onCallLoading
                      ? "Loading assignments..."
                      : totalAssignments > 0
                        ? `${totalAssignments} active ${totalAssignments === 1 ? "assignment" : "assignments"} across ${onCallProjects.length} ${onCallProjects.length === 1 ? "project" : "projects"}`
                        : "You are not currently on-call"}
                  </Text>
                </View>
              </View>

              <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
                <Text
                  style={{
                    fontSize: 28,
                    fontWeight: "bold",
                    color: theme.colors.textPrimary,
                    fontVariant: ["tabular-nums"],
                    letterSpacing: -1,
                  }}
                >
                  {onCallLoading ? "--" : totalAssignments}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={theme.colors.textTertiary}
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
            Incidents
          </Text>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <StatCard
                count={incidentCount}
                label="Active Incidents"
                accentColor={theme.colors.severityCritical}
                iconName="warning-outline"
                isLoading={anyLoading}
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
                isLoading={anyLoading}
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
                isLoading={anyLoading}
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
                isLoading={anyLoading}
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
