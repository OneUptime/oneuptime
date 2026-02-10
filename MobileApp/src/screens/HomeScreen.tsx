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
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;

export default function HomeScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId = selectedProject?._id ?? "";
  const navigation = useNavigation<HomeNavProp>();

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

  const onRefresh = async (): Promise<void> => {
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
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      <Text
        style={[theme.typography.titleLarge, { color: theme.colors.textPrimary }]}
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

      <View style={styles.cardRow}>
        <TouchableOpacity
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
          onPress={() => navigation.navigate("Incidents")}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.cardCount, { color: theme.colors.severityCritical }]}
          >
            {loadingIncidents ? "-" : (incidentCount ?? 0)}
          </Text>
          <Text
            style={[styles.cardLabel, { color: theme.colors.textSecondary }]}
          >
            Active Incidents
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
          onPress={() => navigation.navigate("Alerts")}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.cardCount, { color: theme.colors.severityMajor }]}
          >
            {loadingAlerts ? "-" : (alertCount ?? 0)}
          </Text>
          <Text
            style={[styles.cardLabel, { color: theme.colors.textSecondary }]}
          >
            Active Alerts
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardRow}>
        <TouchableOpacity
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
          onPress={() => navigation.navigate("IncidentEpisodes")}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.cardCount, { color: theme.colors.severityCritical }]}
          >
            {loadingIncidentEpisodes ? "-" : (incidentEpisodeCount ?? 0)}
          </Text>
          <Text
            style={[styles.cardLabel, { color: theme.colors.textSecondary }]}
          >
            Inc Episodes
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
          onPress={() => navigation.navigate("AlertEpisodes")}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.cardCount, { color: theme.colors.severityMajor }]}
          >
            {loadingAlertEpisodes ? "-" : (alertEpisodeCount ?? 0)}
          </Text>
          <Text
            style={[styles.cardLabel, { color: theme.colors.textSecondary }]}
          >
            Alert Episodes
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[
          styles.linkCard,
          {
            backgroundColor: theme.colors.backgroundSecondary,
            borderColor: theme.colors.borderSubtle,
          },
        ]}
        onPress={() => navigation.navigate("Incidents")}
        activeOpacity={0.7}
      >
        <Text
          style={[
            theme.typography.bodyLarge,
            { color: theme.colors.textPrimary, fontWeight: "600" },
          ]}
        >
          View All Incidents
        </Text>
        <Text style={[styles.arrow, { color: theme.colors.textTertiary }]}>
          &gt;
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.linkCard,
          {
            backgroundColor: theme.colors.backgroundSecondary,
            borderColor: theme.colors.borderSubtle,
          },
        ]}
        onPress={() => navigation.navigate("Alerts")}
        activeOpacity={0.7}
      >
        <Text
          style={[
            theme.typography.bodyLarge,
            { color: theme.colors.textPrimary, fontWeight: "600" },
          ]}
        >
          View All Alerts
        </Text>
        <Text style={[styles.arrow, { color: theme.colors.textTertiary }]}>
          &gt;
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.linkCard,
          {
            backgroundColor: theme.colors.backgroundSecondary,
            borderColor: theme.colors.borderSubtle,
          },
        ]}
        onPress={() => navigation.navigate("IncidentEpisodes")}
        activeOpacity={0.7}
      >
        <Text
          style={[
            theme.typography.bodyLarge,
            { color: theme.colors.textPrimary, fontWeight: "600" },
          ]}
        >
          View Incident Episodes
        </Text>
        <Text style={[styles.arrow, { color: theme.colors.textTertiary }]}>
          &gt;
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.linkCard,
          {
            backgroundColor: theme.colors.backgroundSecondary,
            borderColor: theme.colors.borderSubtle,
          },
        ]}
        onPress={() => navigation.navigate("AlertEpisodes")}
        activeOpacity={0.7}
      >
        <Text
          style={[
            theme.typography.bodyLarge,
            { color: theme.colors.textPrimary, fontWeight: "600" },
          ]}
        >
          View Alert Episodes
        </Text>
        <Text style={[styles.arrow, { color: theme.colors.textTertiary }]}>
          &gt;
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  summaryCard: {
    flex: 1,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  cardCount: {
    fontSize: 36,
    fontWeight: "700",
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 4,
  },
  linkCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  arrow: {
    fontSize: 18,
    fontWeight: "600",
  },
});
