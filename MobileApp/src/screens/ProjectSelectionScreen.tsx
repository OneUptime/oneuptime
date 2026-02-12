import React from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ListRenderItemInfo,
} from "react-native";
import { useTheme } from "../theme";
import { useProject } from "../hooks/useProject";
import type { ProjectItem } from "../api/types";

export default function ProjectSelectionScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { projectList, isLoadingProjects, selectProject, refreshProjects } =
    useProject();

  const handleSelect: (project: ProjectItem) => Promise<void> = async (
    project: ProjectItem,
  ): Promise<void> => {
    await selectProject(project);
  };

  if (isLoadingProjects) {
    return (
      <View className="flex-1 items-center justify-center px-8 bg-bg-primary">
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
        <Text className="text-body-md text-text-secondary mt-4">
          Loading projects...
        </Text>
      </View>
    );
  }

  if (projectList.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-8 bg-bg-primary">
        <Text className="text-title-sm text-text-primary text-center">
          No Projects Found
        </Text>
        <Text className="text-body-md text-text-secondary text-center mt-2">
          {"You don't have access to any projects."}
        </Text>
        <TouchableOpacity
          className="mt-6 px-8 py-3.5 rounded-xl"
          style={{ backgroundColor: theme.colors.actionPrimary }}
          onPress={refreshProjects}
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
      <View className="px-5 pt-4 pb-2">
        <Text className="text-title-lg text-text-primary">
          Select Project
        </Text>
        <Text className="text-body-md text-text-secondary mt-1">
          Choose a project to view incidents and alerts.
        </Text>
      </View>

      <FlatList
        data={projectList}
        keyExtractor={(item: ProjectItem) => {
          return item._id;
        }}
        contentContainerStyle={{ padding: 20, paddingTop: 12 }}
        renderItem={({ item }: ListRenderItemInfo<ProjectItem>) => {
          return (
            <TouchableOpacity
              className="flex-row items-center p-[18px] rounded-2xl mb-3 bg-bg-elevated shadow-sm"
              onPress={() => {
                return handleSelect(item);
              }}
              activeOpacity={0.7}
            >
              <View
                className="w-3.5 h-3.5 rounded-full mr-3"
                style={{ backgroundColor: theme.colors.actionPrimary }}
              />
              <View className="flex-1">
                <Text className="text-body-lg text-text-primary font-semibold">
                  {item.name}
                </Text>
                {item.slug ? (
                  <Text className="text-body-sm text-text-tertiary">
                    {item.slug}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
