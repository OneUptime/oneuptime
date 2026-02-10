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
import { useAlertEpisodes } from "../hooks/useAlertEpisodes";
import EpisodeCard from "../components/EpisodeCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { AlertEpisodesStackParamList } from "../navigation/types";
import type { AlertEpisodeItem } from "../api/types";

const PAGE_SIZE = 20;

type NavProp = NativeStackNavigationProp<
  AlertEpisodesStackParamList,
  "AlertEpisodesList"
>;

export default function AlertEpisodesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId = selectedProject?._id ?? "";
  const navigation = useNavigation<NavProp>();

  const [page, setPage] = useState(0);
  const skip = page * PAGE_SIZE;

  const { data, isLoading, isError, refetch } = useAlertEpisodes(
    projectId,
    skip,
    PAGE_SIZE,
  );

  const episodes = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const hasMore = skip + PAGE_SIZE < totalCount;

  const onRefresh = useCallback(async () => {
    setPage(0);
    await refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      setPage((prev) => prev + 1);
    }
  }, [hasMore, isLoading]);

  const handlePress = useCallback(
    (episode: AlertEpisodeItem) => {
      navigation.navigate("AlertEpisodeDetail", {
        episodeId: episode._id,
      });
    },
    [navigation],
  );

  if (isLoading && episodes.length === 0) {
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
          Failed to load alert episodes.
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
        data={episodes}
        keyExtractor={(item) => item._id}
        contentContainerStyle={
          episodes.length === 0 ? styles.emptyContainer : styles.list
        }
        renderItem={({ item }) => (
          <EpisodeCard
            episode={item}
            type="alert"
            onPress={() => handlePress(item)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No Alert Episodes"
            subtitle="There are no alert episodes for this project."
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
