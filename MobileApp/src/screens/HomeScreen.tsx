import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
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
import GlassCard from "../components/GlassCard";
import GradientHeader from "../components/GradientHeader";
import GradientButton from "../components/GradientButton";

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
      className="flex-1 overflow-hidden rounded-2xl"
      style={{
        shadowColor: "#000",
        shadowOpacity: theme.isDark ? 0.2 : 0.06,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
        elevation: 3,
      }}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
      accessibilityRole="button"
    >
      <GlassCard opaque>
        <View className="flex-row">
          <LinearGradient
            colors={[accentColor, accentColor + "40"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ width: 3 }}
          />
          <View className="flex-1 p-4">
            <View className="flex-row items-center justify-between mb-3">
              <View
                className="w-10 h-10 rounded-xl items-center justify-center"
                style={{ backgroundColor: accentColor + "18" }}
              >
                <Ionicons name={iconName} size={20} color={accentColor} />
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.colors.textTertiary}
              />
            </View>
            <Text
              className="text-[32px] font-bold text-text-primary"
              style={{ fontVariant: ["tabular-nums"], letterSpacing: -1.2 }}
            >
              {isLoading ? "--" : count ?? 0}
            </Text>
            <Text
              className="text-[12px] font-medium text-text-secondary mt-0.5"
              style={{ letterSpacing: 0.3 }}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        </View>
      </GlassCard>
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

  const { lightImpact } = useHaptics();

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await Promise.all([refetch(), refreshProjects()]);
  };

  // No projects state
  if (!isLoadingProjects && projectList.length === 0) {
    return (
      <ScrollView
        className="bg-bg-primary"
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        <GradientHeader height={400} />
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-28 h-28 rounded-full items-center justify-center mb-6"
            style={{ backgroundColor: theme.colors.surfaceGlow }}
          >
            <View
              className="w-20 h-20 rounded-[22px] items-center justify-center"
              style={{
                backgroundColor: theme.colors.backgroundTertiary,
                shadowColor: "#000000",
                shadowOpacity: 0.3,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 16,
                elevation: 6,
              }}
            >
              <Logo size={48} />
            </View>
          </View>

          <Text
            className="text-title-lg text-text-primary text-center"
            style={{ letterSpacing: -0.5 }}
          >
            No Projects Found
          </Text>
          <Text className="text-body-md text-text-secondary text-center mt-3 leading-6 max-w-[300px]">
            You don&apos;t have access to any projects. Contact your
            administrator or pull to refresh.
          </Text>

          <View className="mt-8 w-[200px]">
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

  // Loading state
  if (isLoadingProjects) {
    return (
      <View className="flex-1 bg-bg-primary items-center justify-center">
        <GradientHeader height={400} />
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
      className="bg-bg-primary"
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {/* Header area with gradient background */}
      <LinearGradient
        colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        className="px-6 pt-6 pb-5"
      >
        <View className="flex-row items-center mb-1">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{
              backgroundColor: theme.colors.iconBackground,
            }}
          >
            <Logo size={24} />
          </View>
          <View className="flex-1">
            <Text
              className="text-body-md text-text-secondary"
              style={{ letterSpacing: 0.2 }}
            >
              {getGreeting()}
            </Text>
            <Text
              className="text-title-lg text-text-primary"
              accessibilityRole="header"
              style={{ letterSpacing: -0.5 }}
            >
              {subtitle}
            </Text>
          </View>
          <Text
            className="text-[11px] font-semibold text-text-tertiary"
            style={{ letterSpacing: 0.5 }}
          >
            OneUptime
          </Text>
        </View>
      </LinearGradient>

      {/* Stat Cards - 2x2 Grid */}
      <View className="gap-3 px-6 mt-2">
        <View className="flex-row gap-3">
          <StatCard
            count={incidentCount}
            label="Active Incidents"
            accentColor={theme.colors.severityCritical}
            iconName="warning"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Incidents");
            }}
          />
          <StatCard
            count={alertCount}
            label="Active Alerts"
            accentColor={theme.colors.severityMajor}
            iconName="notifications"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Alerts");
            }}
          />
        </View>

        <View className="flex-row gap-3">
          <StatCard
            count={incidentEpisodeCount}
            label="Inc. Episodes"
            accentColor={theme.colors.severityInfo}
            iconName="layers"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Incidents");
            }}
          />
          <StatCard
            count={alertEpisodeCount}
            label="Alert Episodes"
            accentColor={theme.colors.severityWarning}
            iconName="albums"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Alerts");
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
