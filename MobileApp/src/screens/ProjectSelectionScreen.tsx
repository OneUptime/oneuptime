import React from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
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
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textSecondary, marginTop: theme.spacing.md },
          ]}
        >
          Loading projects...
        </Text>
      </View>
    );
  }

  if (projectList.length === 0) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      >
        <Text
          style={[
            theme.typography.titleSmall,
            { color: theme.colors.textPrimary, textAlign: "center" },
          ]}
        >
          No Projects Found
        </Text>
        <Text
          style={[
            theme.typography.bodyMedium,
            {
              color: theme.colors.textSecondary,
              textAlign: "center",
              marginTop: theme.spacing.sm,
            },
          ]}
        >
          {"You don't have access to any projects."}
        </Text>
        <TouchableOpacity
          style={[
            styles.retryButton,
            { backgroundColor: theme.colors.actionPrimary },
          ]}
          onPress={refreshProjects}
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
      <View style={styles.header}>
        <Text
          style={[
            theme.typography.titleLarge,
            { color: theme.colors.textPrimary },
          ]}
        >
          Select Project
        </Text>
        <Text
          style={[
            theme.typography.bodyMedium,
            { color: theme.colors.textSecondary, marginTop: theme.spacing.xs },
          ]}
        >
          Choose a project to view incidents and alerts.
        </Text>
      </View>

      <FlatList
        data={projectList}
        keyExtractor={(item: ProjectItem) => {
          return item._id;
        }}
        contentContainerStyle={styles.list}
        renderItem={({ item }: ListRenderItemInfo<ProjectItem>) => {
          return (
            <TouchableOpacity
              style={[
                styles.projectCard,
                theme.shadows.sm,
                {
                  backgroundColor: theme.colors.backgroundElevated,
                },
              ]}
              onPress={() => {
                return handleSelect(item);
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.projectDot,
                  { backgroundColor: theme.colors.actionPrimary },
                ]}
              />
              <View style={styles.projectInfo}>
                <Text
                  style={[
                    theme.typography.bodyLarge,
                    { color: theme.colors.textPrimary, fontWeight: "600" },
                  ]}
                >
                  {item.name}
                </Text>
                {item.slug ? (
                  <Text
                    style={[
                      theme.typography.bodySmall,
                      { color: theme.colors.textTertiary },
                    ]}
                  >
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  list: {
    padding: 20,
    paddingTop: 12,
  },
  projectCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    marginBottom: 12,
  },
  projectDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 12,
  },
  projectInfo: {
    flex: 1,
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
});
