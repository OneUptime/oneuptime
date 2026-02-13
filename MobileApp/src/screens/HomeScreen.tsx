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
import { useTheme } from "../theme";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useProject } from "../hooks/useProject";
import { useHaptics } from "../hooks/useHaptics";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";
import Logo from "../components/Logo";
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
      className="flex-1 rounded-2xl overflow-hidden"
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
      accessibilityRole="button"
    >
      <View
        className="p-4"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          borderRadius: 16,
        }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View
            className="w-9 h-9 rounded-xl items-center justify-center"
            style={{ backgroundColor: accentColor + "14" }}
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
          className="text-[28px] font-bold"
          style={{
            color: theme.colors.textPrimary,
            fontVariant: ["tabular-nums"],
            letterSpacing: -1,
          }}
        >
          {isLoading ? "--" : count ?? 0}
        </Text>
        <Text
          className="text-[12px] font-medium mt-1"
          style={{
            color: theme.colors.textSecondary,
            letterSpacing: 0.2,
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

  const { lightImpact } = useHaptics();

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await Promise.all([refetch(), refreshProjects()]);
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
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-20 h-20 rounded-2xl items-center justify-center mb-6"
            style={{
              backgroundColor: theme.colors.iconBackground,
            }}
          >
            <Logo size={40} />
          </View>

          <Text
            className="text-[22px] font-bold text-center"
            style={{
              color: theme.colors.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            No Projects Found
          </Text>
          <Text
            className="text-[15px] text-center mt-2 leading-[22px] max-w-[300px]"
            style={{ color: theme.colors.textSecondary }}
          >
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

  if (isLoadingProjects) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
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
      <View className="px-5 pt-4 pb-4">
        <View className="flex-row items-center">
          <View
            className="w-10 h-10 rounded-xl items-center justify-center mr-3"
            style={{
              backgroundColor: theme.colors.iconBackground,
            }}
          >
            <Logo size={22} />
          </View>
          <View className="flex-1">
            <Text
              className="text-[13px] font-medium"
              style={{
                color: theme.colors.textTertiary,
              }}
            >
              {getGreeting()}
            </Text>
            <Text
              className="text-[22px] font-bold"
              accessibilityRole="header"
              style={{
                color: theme.colors.textPrimary,
                letterSpacing: -0.5,
              }}
            >
              {subtitle}
            </Text>
          </View>
        </View>
      </View>

      <View className="gap-3 px-5">
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
