import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
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
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  const handlePress: () => void = (): void => {
    lightImpact();
    onPress();
  };

  return (
    <TouchableOpacity
      style={[
        styles.summaryCard,
        theme.shadows.md,
        {
          backgroundColor: theme.colors.backgroundElevated,
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
      accessibilityRole="button"
    >
      <Text style={[styles.cardCount, { color }]}>
        {isLoading ? "--" : count ?? 0}
      </Text>
      <Text style={[styles.cardLabel, { color: theme.colors.textSecondary }]}>
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
  const { theme } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.linkCard,
        theme.shadows.sm,
        {
          backgroundColor: theme.colors.backgroundElevated,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <Text style={[styles.linkLabel, { color: theme.colors.textPrimary }]}>
        {label}
      </Text>
      <Text style={[styles.chevron, { color: theme.colors.textTertiary }]}>
        ›
      </Text>
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
      style={[{ backgroundColor: theme.colors.backgroundPrimary }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {/* Header */}
      <Text
        style={[
          theme.typography.titleLarge,
          { color: theme.colors.textPrimary },
        ]}
        accessibilityRole="header"
      >
        {selectedProject?.name ?? "OneUptime"}
      </Text>
      <Text
        style={[
          theme.typography.bodyMedium,
          { color: theme.colors.textSecondary, marginTop: theme.spacing.xs },
        ]}
      >
        Project overview
      </Text>

      {/* Stats Grid */}
      <View style={styles.cardRow}>
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

      <View style={styles.cardRow}>
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

      {/* Quick Links */}
      <View style={styles.quickLinksSection}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
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

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  summaryCard: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    alignItems: "center",
  },
  cardCount: {
    fontSize: 40,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "500",
    marginTop: 4,
  },
  quickLinksSection: {
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
    marginLeft: 4,
  },
  linkCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    marginBottom: 10,
  },
  linkLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  chevron: {
    fontSize: 24,
    fontWeight: "300",
  },
});
