import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useProject } from "../hooks/useProject";
import { useHaptics } from "../hooks/useHaptics";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";

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
      className="flex-1 p-4 rounded-2xl"
      style={{
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
        borderLeftWidth: 4,
        borderLeftColor: accentColor,
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
  const { projectList } = useProject();
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
    await refetch();
  };

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
      {/* Header area with subtle background tint */}
      <View
        className="px-6 pt-6 pb-5"
        style={{ backgroundColor: theme.colors.headerGradient }}
      >
        <View className="flex-row items-center mb-1">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{
              backgroundColor: theme.colors.accentGradientStart + "15",
            }}
          >
            <Ionicons
              name="pulse"
              size={20}
              color={theme.colors.accentGradientStart}
            />
          </View>
          <View>
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
        </View>
      </View>

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
