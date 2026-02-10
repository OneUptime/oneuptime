import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useProject } from "../hooks/useProject";
import { useAlerts } from "../hooks/useAlerts";
import { useAlertStates } from "../hooks/useAlertDetail";
import { changeAlertState } from "../api/alerts";
import { useHaptics } from "../hooks/useHaptics";
import AlertCard from "../components/AlertCard";
import SwipeableCard from "../components/SwipeableCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { AlertsStackParamList } from "../navigation/types";
import type { AlertItem } from "../api/types";
import { useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE = 20;

type NavProp = NativeStackNavigationProp<AlertsStackParamList, "AlertsList">;

export default function AlertsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId = selectedProject?._id ?? "";
  const navigation = useNavigation<NavProp>();

  const [page, setPage] = useState(0);
  const skip = page * PAGE_SIZE;

  const { data, isLoading, isError, refetch } = useAlerts(
    projectId,
    skip,
    PAGE_SIZE,
  );
  const { data: states } = useAlertStates(projectId);
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient = useQueryClient();

  const acknowledgeState = states?.find((s) => s.isAcknowledgedState);

  const alerts = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const hasMore = skip + PAGE_SIZE < totalCount;

  const onRefresh = useCallback(async () => {
    lightImpact();
    setPage(0);
    await refetch();
  }, [refetch, lightImpact]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      setPage((prev) => prev + 1);
    }
  }, [hasMore, isLoading]);

  const handlePress = useCallback(
    (alert: AlertItem) => {
      navigation.navigate("AlertDetail", { alertId: alert._id });
    },
    [navigation],
  );

  const handleAcknowledge = useCallback(
    async (alert: AlertItem) => {
      if (!acknowledgeState) {
        return;
      }
      try {
        await changeAlertState(projectId, alert._id, acknowledgeState._id);
        await successFeedback();
        await refetch();
        await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      } catch {
        await errorFeedback();
      }
    },
    [projectId, acknowledgeState, successFeedback, errorFeedback, refetch, queryClient],
  );

  if (isLoading && alerts.length === 0) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      >
        <View style={styles.skeletonList}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      >
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textSecondary, textAlign: "center" },
          ]}
        >
          Failed to load alerts.
        </Text>
        <TouchableOpacity
          style={[
            styles.retryButton,
            { backgroundColor: theme.colors.actionPrimary },
          ]}
          onPress={() => refetch()}
        >
          <Text
            style={[
              theme.typography.bodyMedium,
              { color: theme.colors.textInverse, fontWeight: "600" },
            ]}
          >
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.backgroundPrimary },
      ]}
    >
      <FlatList
        data={alerts}
        keyExtractor={(item) => item._id}
        contentContainerStyle={
          alerts.length === 0 ? styles.emptyContainer : styles.list
        }
        renderItem={({ item }) => (
          <SwipeableCard
            rightAction={
              acknowledgeState &&
              item.currentAlertState?._id !== acknowledgeState._id
                ? {
                    label: "Acknowledge",
                    color: "#2EA043",
                    onAction: () => handleAcknowledge(item),
                  }
                : undefined
            }
          >
            <AlertCard alert={item} onPress={() => handlePress(item)} />
          </SwipeableCard>
        )}
        ListEmptyComponent={
          <EmptyState
            title="No active alerts"
            subtitle="Alerts assigned to you will appear here."
            icon="alerts"
          />
        }
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={onRefresh} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  list: {
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
  },
  skeletonList: {
    padding: 16,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
});
