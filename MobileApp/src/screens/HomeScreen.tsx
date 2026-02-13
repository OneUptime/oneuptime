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
      className="flex-1 flex-row items-center p-4 rounded-2xl bg-bg-elevated border border-border-subtle"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: accentColor,
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 2,
      }}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
      accessibilityRole="button"
    >
      <View
        className="w-11 h-11 rounded-xl items-center justify-center mr-3"
        style={{ backgroundColor: accentColor + "1A" }}
      >
        <Ionicons name={iconName} size={22} color={accentColor} />
      </View>
      <View className="flex-1">
        <Text
          className="text-[28px] font-bold text-text-primary"
          style={{ fontVariant: ["tabular-nums"], letterSpacing: -1 }}
        >
          {isLoading ? "--" : count ?? 0}
        </Text>
        <Text
          className="text-[12px] font-medium text-text-secondary"
          style={{ letterSpacing: 0.2 }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={theme.colors.textTertiary}
      />
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
      contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {/* Greeting Header */}
      <Text
        className="text-body-md text-text-secondary"
        style={{ letterSpacing: 0.2 }}
      >
        {getGreeting()}
      </Text>
      <Text
        className="text-title-lg text-text-primary mt-0.5"
        accessibilityRole="header"
        style={{ letterSpacing: -0.5 }}
      >
        {subtitle}
      </Text>

      {/* Stat Cards - 2x2 Grid */}
      <View className="gap-3 mt-5">
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
