import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Text,
  StyleSheet,
  ListRenderItemInfo,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme, type Theme } from "../theme";
import { useProject } from "../hooks/useProject";
import { useIncidents } from "../hooks/useIncidents";
import { useIncidentStates } from "../hooks/useIncidentDetail";
import { changeIncidentState } from "../api/incidents";
import { useHaptics } from "../hooks/useHaptics";
import IncidentCard from "../components/IncidentCard";
import SwipeableCard from "../components/SwipeableCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { IncidentsStackParamList } from "../navigation/types";
import type { IncidentItem, IncidentState } from "../api/types";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

const PAGE_SIZE: number = 20;

type NavProp = NativeStackNavigationProp<
  IncidentsStackParamList,
  "IncidentsList"
>;

export default function IncidentsScreen(): React.JSX.Element {
  const { theme }: { theme: Theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId: string = selectedProject?._id ?? "";
  const navigation: NativeStackNavigationProp<
    IncidentsStackParamList,
    "IncidentsList"
  > = useNavigation<NavProp>();

  const [page, setPage] = useState(0);
  const skip: number = page * PAGE_SIZE;

  const { data, isLoading, isError, refetch } = useIncidents(
    projectId,
    skip,
    PAGE_SIZE,
  );
  const { data: states } = useIncidentStates(projectId);
  const { successFeedback, errorFeedback, lightImpact } = useHaptics();
  const queryClient: QueryClient = useQueryClient();

  const acknowledgeState: IncidentState | undefined = states?.find(
    (s: IncidentState) => {
      return s.isAcknowledgedState;
    },
  );

  const incidents: IncidentItem[] = data?.data ?? [];
  const totalCount: number = data?.count ?? 0;
  const hasMore: boolean = skip + PAGE_SIZE < totalCount;

  const onRefresh: () => Promise<void> = useCallback(async () => {
    lightImpact();
    setPage(0);
    await refetch();
  }, [refetch, lightImpact]);

  const loadMore: () => void = useCallback(() => {
    if (hasMore && !isLoading) {
      setPage((prev: number) => {
        return prev + 1;
      });
    }
  }, [hasMore, isLoading]);

  const handlePress: (incident: IncidentItem) => void = useCallback(
    (incident: IncidentItem) => {
      navigation.navigate("IncidentDetail", { incidentId: incident._id });
    },
    [navigation],
  );

  const handleAcknowledge: (incident: IncidentItem) => Promise<void> =
    useCallback(
      async (incident: IncidentItem) => {
        if (!acknowledgeState) {
          return;
        }
        try {
          await changeIncidentState(
            projectId,
            incident._id,
            acknowledgeState._id,
          );
          await successFeedback();
          await refetch();
          await queryClient.invalidateQueries({ queryKey: ["incidents"] });
        } catch {
          await errorFeedback();
        }
      },
      [
        projectId,
        acknowledgeState,
        successFeedback,
        errorFeedback,
        refetch,
        queryClient,
      ],
    );

  if (isLoading && incidents.length === 0) {
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
          Failed to load incidents.
        </Text>
        <TouchableOpacity
          style={[
            styles.retryButton,
            { backgroundColor: theme.colors.actionPrimary },
          ]}
          onPress={() => {
            return refetch();
          }}
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
        data={incidents}
        keyExtractor={(item: IncidentItem) => {
          return item._id;
        }}
        contentContainerStyle={
          incidents.length === 0 ? styles.emptyContainer : styles.list
        }
        renderItem={({ item }: ListRenderItemInfo<IncidentItem>) => {
          return (
            <SwipeableCard
              rightAction={
                acknowledgeState &&
                item.currentIncidentState?._id !== acknowledgeState._id
                  ? {
                      label: "Acknowledge",
                      color: "#2EA043",
                      onAction: () => {
                        return handleAcknowledge(item);
                      },
                    }
                  : undefined
              }
            >
              <IncidentCard
                incident={item}
                onPress={() => {
                  return handlePress(item);
                }}
              />
            </SwipeableCard>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title="No active incidents"
            subtitle="Incidents assigned to you will appear here."
            icon="incidents"
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

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
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
