import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Text,
  ListRenderItemInfo,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useProject } from "../hooks/useProject";
import { useAlertEpisodes } from "../hooks/useAlertEpisodes";
import { useHaptics } from "../hooks/useHaptics";
import EpisodeCard from "../components/EpisodeCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import type { AlertEpisodesStackParamList } from "../navigation/types";
import type { AlertEpisodeItem } from "../api/types";

const PAGE_SIZE: number = 20;

type NavProp = NativeStackNavigationProp<
  AlertEpisodesStackParamList,
  "AlertEpisodesList"
>;

export default function AlertEpisodesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectedProject } = useProject();
  const projectId: string = selectedProject?._id ?? "";
  const navigation: NavProp = useNavigation<NavProp>();

  const { lightImpact } = useHaptics();
  const [page, setPage] = useState(0);
  const skip: number = page * PAGE_SIZE;

  const { data, isLoading, isError, refetch } = useAlertEpisodes(
    projectId,
    skip,
    PAGE_SIZE,
  );

  const episodes: AlertEpisodeItem[] = data?.data ?? [];
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

  const handlePress: (episode: AlertEpisodeItem) => void = useCallback(
    (episode: AlertEpisodeItem) => {
      navigation.navigate("AlertEpisodeDetail", {
        episodeId: episode._id,
      });
    },
    [navigation],
  );

  if (isLoading && episodes.length === 0) {
    return (
      <View className="flex-1 bg-bg-primary">
        <View className="p-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center px-8 bg-bg-primary">
        <Text className="text-body-md text-text-secondary text-center">
          Failed to load alert episodes.
        </Text>
        <TouchableOpacity
          className="mt-4 px-6 py-3 rounded-[10px] shadow-md"
          style={{ backgroundColor: theme.colors.actionPrimary }}
          onPress={() => {
            return refetch();
          }}
        >
          <Text className="text-body-md text-text-inverse font-semibold">
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-primary">
      <FlatList
        data={episodes}
        keyExtractor={(item: AlertEpisodeItem) => {
          return item._id;
        }}
        contentContainerStyle={
          episodes.length === 0 ? { flex: 1 } : { padding: 16 }
        }
        renderItem={({ item }: ListRenderItemInfo<AlertEpisodeItem>) => {
          return (
            <EpisodeCard
              episode={item}
              type="alert"
              onPress={() => {
                return handlePress(item);
              }}
            />
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title="No alert episodes"
            subtitle="Alert episodes for this project will appear here."
            icon="episodes"
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
