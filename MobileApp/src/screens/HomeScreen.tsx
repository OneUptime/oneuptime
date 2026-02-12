import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useTheme } from "../theme";
import { useProject } from "../hooks/useProject";
import { useUnresolvedIncidentCount } from "../hooks/useIncidents";
import { useUnresolvedAlertCount } from "../hooks/useAlerts";
import { useUnresolvedIncidentEpisodeCount } from "../hooks/useIncidentEpisodes";
import { useUnresolvedAlertEpisodeCount } from "../hooks/useAlertEpisodes";
import { useHaptics } from "../hooks/useHaptics";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;

interface StatCardProps {
  count: number | undefined;
  label: string;
  color: string;
  isLoading: boolean;
  onPress: () => void;
}

function StatCard({
  count,
  label,
  color,
  isLoading,
  onPress,
}: StatCardProps): React.JSX.Element {
  const { lightImpact } = useHaptics();

  const handlePress: () => void = (): void => {
    lightImpact();
    onPress();
  };

  return (
    <TouchableOpacity
      className="flex-1 p-5 rounded-2xl items-center bg-bg-elevated shadow-md"
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
      accessibilityRole="button"
    >
      <Text
        className="text-[40px] font-bold"
        style={{ color, fontVariant: ["tabular-nums"] }}
      >
        {isLoading ? "--" : count ?? 0}
      </Text>
      <Text className="text-sm font-medium mt-1 text-text-secondary">
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface QuickLinkProps {
  label: string;
  onPress: () => void;
}

function QuickLink({ label, onPress }: QuickLinkProps): React.JSX.Element {
  return (
    <TouchableOpacity
      className="flex-row justify-between items-center p-[18px] rounded-2xl mb-2.5 bg-bg-elevated shadow-sm"
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <Text className="text-base font-medium text-text-primary">{label}</Text>
      <Text className="text-2xl font-light text-text-tertiary">{">"}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId: string = selectedProject?._id ?? "";
  const navigation: HomeNavProp = useNavigation<HomeNavProp>();

  const {
    data: incidentCount,
    isLoading: loadingIncidents,
    refetch: refetchIncidents,
  } = useUnresolvedIncidentCount(projectId);

  const {
    data: alertCount,
    isLoading: loadingAlerts,
    refetch: refetchAlerts,
  } = useUnresolvedAlertCount(projectId);

  const {
    data: incidentEpisodeCount,
    isLoading: loadingIncidentEpisodes,
    refetch: refetchIncidentEpisodes,
  } = useUnresolvedIncidentEpisodeCount(projectId);

  const {
    data: alertEpisodeCount,
    isLoading: loadingAlertEpisodes,
    refetch: refetchAlertEpisodes,
  } = useUnresolvedAlertEpisodeCount(projectId);

  const { lightImpact } = useHaptics();

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await Promise.all([
      refetchIncidents(),
      refetchAlerts(),
      refetchIncidentEpisodes(),
      refetchAlertEpisodes(),
    ]);
  };

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
      <Text className="text-title-lg text-text-primary" accessibilityRole="header">
        {selectedProject?.name ?? "OneUptime"}
      </Text>
      <Text className="text-body-md text-text-secondary mt-1">
        Project overview
      </Text>

      <View className="flex-row gap-3 mt-4">
        <StatCard
          count={incidentCount}
          label="Active Incidents"
          color={theme.colors.severityCritical}
          isLoading={loadingIncidents}
          onPress={() => {
            return navigation.navigate("Incidents");
          }}
        />
        <StatCard
          count={alertCount}
          label="Active Alerts"
          color={theme.colors.severityMajor}
          isLoading={loadingAlerts}
          onPress={() => {
            return navigation.navigate("Alerts");
          }}
        />
      </View>

      <View className="flex-row gap-3 mt-4">
        <StatCard
          count={incidentEpisodeCount}
          label="Inc Episodes"
          color={theme.colors.severityCritical}
          isLoading={loadingIncidentEpisodes}
          onPress={() => {
            return navigation.navigate("IncidentEpisodes");
          }}
        />
        <StatCard
          count={alertEpisodeCount}
          label="Alert Episodes"
          color={theme.colors.severityMajor}
          isLoading={loadingAlertEpisodes}
          onPress={() => {
            return navigation.navigate("AlertEpisodes");
          }}
        />
      </View>

      <View className="mt-8">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-3 ml-1 text-text-secondary">
          Quick Links
        </Text>
        <QuickLink
          label="View All Incidents"
          onPress={() => {
            return navigation.navigate("Incidents");
          }}
        />
        <QuickLink
          label="View All Alerts"
          onPress={() => {
            return navigation.navigate("Alerts");
          }}
        />
        <QuickLink
          label="Incident Episodes"
          onPress={() => {
            return navigation.navigate("IncidentEpisodes");
          }}
        />
        <QuickLink
          label="Alert Episodes"
          onPress={() => {
            return navigation.navigate("AlertEpisodes");
          }}
        />
      </View>
    </ScrollView>
  );
}
