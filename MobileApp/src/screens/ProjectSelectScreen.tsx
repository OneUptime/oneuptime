import React from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Toast from "react-native-toast-message";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/hooks/useProject";
import { useProjectsQuery } from "@/hooks/useProjectsQuery";
import { Project } from "@/types/models";

export const ProjectSelectScreen: React.FC = () => {
  const { user, logout, isLoading: isAuthLoading } = useAuth();
  const { setProject, isLoading: isProjectLoading } = useProject();
  const {
    data: projects,
    isFetching,
    refetch,
    isRefetching,
    isLoading: isQueryLoading,
  } = useProjectsQuery(Boolean(user));

  const handleSelect = async (project: Project) => {
    try {
      await setProject(project);
      Toast.show({
        type: "success",
        text1: `Working in ${project.name}`,
      });
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Could not switch project",
        text2: (error as { message?: string })?.message,
      });
    }
  };

  const renderItem = ({ item }: { item: Project }) => (
    <TouchableOpacity
      key={item.id}
      style={styles.projectCard}
      onPress={() => handleSelect(item)}
    >
      <Text style={styles.projectName}>{item.name}</Text>
      {item.slug ? <Text style={styles.projectSlug}>{item.slug}</Text> : null}
    </TouchableOpacity>
  );

  const loading =
    isQueryLoading || isFetching || isRefetching || isProjectLoading;

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Choose a project</Text>
          <Text style={styles.subtitle}>
            {user?.email ? `Signed in as ${user.email}` : "Select a project to continue."}
          </Text>
        </View>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => {
            void logout();
          }}
          loading={isAuthLoading}
          style={styles.logoutButton}
        />
      </View>

      <FlatList
        data={projects || []}
        keyExtractor={(item: Project) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={isFetching || isRefetching}
            onRefresh={() => {
              void refetch();
            }}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#2D63F7" />
            </View>
          ) : (
            <View style={styles.loadingContainer}>
              <Text style={styles.emptyStateTitle}>No projects found</Text>
              <Text style={styles.emptyStateSubtitle}>
                Ask your administrator to add you to a project.
              </Text>
            </View>
          )
        }
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    gap: 16,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 14,
    color: "#475569",
    marginTop: 4,
  },
  logoutButton: {
    minWidth: 110,
  },
  listContainer: {
    paddingBottom: 32,
    gap: 12,
  },
  projectCard: {
    padding: 20,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 12,
  },
  projectName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0F172A",
  },
  projectSlug: {
    fontSize: 14,
    color: "#64748B",
    marginTop: 4,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0F172A",
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    maxWidth: 260,
  },
});
