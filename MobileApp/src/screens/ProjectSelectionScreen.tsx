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
        <Text
          className="text-title-sm text-text-primary text-center"
          style={{ letterSpacing: -0.3 }}
        >
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
        <Text
          className="text-title-lg text-text-primary"
          style={{ letterSpacing: -0.5 }}
        >
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
          const initial: string = (item.name || "P").charAt(0).toUpperCase();
          return (
            <TouchableOpacity
              className="flex-row items-center p-4 rounded-2xl mb-3 bg-bg-elevated border border-border-subtle"
              style={{
                shadowColor: "#000",
                shadowOpacity: 0.04,
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 8,
                elevation: 2,
              }}
              onPress={() => {
                return handleSelect(item);
              }}
              activeOpacity={0.7}
            >
              <View
                className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                style={{ backgroundColor: theme.colors.actionPrimary }}
              >
                <Text className="text-[17px] font-bold text-white">
                  {initial}
                </Text>
              </View>
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
