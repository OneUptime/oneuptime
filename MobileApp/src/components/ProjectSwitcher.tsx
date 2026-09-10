import React, { useContext, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useProject } from "../hooks/useProject";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useTheme } from "../theme";
import type { ProjectItem } from "../api/types";
import SearchField from "./SearchField";
import GradientButton from "./GradientButton";

/** Available in every workspace header; never offers an aggregate project. */
export default function ProjectSwitcher(): React.JSX.Element {
  const { theme } = useTheme();
  const {
    activeProject,
    projectList,
    selectProject,
    isLoadingProjects,
    projectLoadError,
    refreshProjects,
  } = useProject();
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState("");
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const paddingBottom: number = useScreenPadding({ tabBar: false });
  const filtered: ProjectItem[] = projectList.filter(
    (project: ProjectItem): boolean => {
      return project.name.toLowerCase().includes(search.trim().toLowerCase());
    },
  );

  const close: () => void = (): void => {
    setVisible(false);
    setSearch("");
  };

  return (
    <>
      <Pressable
        testID="project-switcher"
        accessibilityRole="button"
        accessibilityLabel={
          activeProject
            ? `Switch project, current project ${activeProject.name}`
            : "Choose project"
        }
        accessibilityHint="Select the project shown across the app."
        accessibilityState={{ expanded: visible }}
        onPress={() => {
          setSearch("");
          setVisible(true);
        }}
        style={({ pressed }: { pressed: boolean }) => {
          return {
            minHeight: 48,
            maxWidth: 250,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            opacity: pressed ? 0.7 : 1,
          };
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: theme.colors.iconBackground,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="layers-outline"
            size={18}
            color={theme.colors.actionPrimary}
          />
        </View>
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 16,
            fontWeight: "700",
            color: theme.colors.textPrimary,
          }}
        >
          {activeProject?.name ||
            (isLoadingProjects ? "Loading project…" : "Choose project")}
        </Text>
        <Ionicons
          name="chevron-down"
          size={16}
          color={theme.colors.textSecondary}
        />
      </Pressable>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        >
          <View
            accessibilityViewIsModal
            style={{ flex: 1, paddingTop: Math.max(insets?.top ?? 0, 20) }}
          >
            <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <Text
                  accessibilityRole="header"
                  style={{
                    flex: 1,
                    fontSize: 26,
                    fontWeight: "700",
                    color: theme.colors.textPrimary,
                  }}
                >
                  Switch project
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close project switcher"
                  onPress={close}
                  style={{
                    minWidth: 48,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              </View>
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 23,
                  color: theme.colors.textSecondary,
                  marginTop: 8,
                  marginBottom: 20,
                }}
              >
                Choose one workspace. Everything in the app will follow your
                selection, and we will remember it next time.
              </Text>
              <SearchField
                value={search}
                onChangeText={setSearch}
                placeholder="Search projects"
                accessibilityLabel="Search projects to switch"
              />
            </View>
            {projectLoadError ? (
              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text
                  accessible
                  accessibilityRole="alert"
                  style={{
                    fontSize: 15,
                    lineHeight: 23,
                    color: theme.colors.statusError,
                    marginBottom: 12,
                  }}
                >
                  Could not load projects. Check your connection and try again.
                </Text>
                <GradientButton
                  label="Retry loading projects"
                  variant="secondary"
                  onPress={refreshProjects}
                  loading={isLoadingProjects}
                />
              </View>
            ) : null}
            <FlatList
              testID="project-switcher-list"
              data={filtered}
              keyExtractor={(project: ProjectItem): string => {
                return project._id;
              }}
              extraData={activeProject?._id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom }}
              ListEmptyComponent={
                isLoadingProjects ? (
                  <ActivityIndicator
                    accessibilityLabel="Loading projects"
                    color={theme.colors.actionPrimary}
                    style={{ marginTop: 24 }}
                  />
                ) : (
                  <View style={{ paddingVertical: 24 }}>
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: "600",
                        color: theme.colors.textPrimary,
                      }}
                    >
                      {projectList.length === 0
                        ? "No projects available"
                        : "No matching projects"}
                    </Text>
                    <Text
                      style={{
                        fontSize: 15,
                        lineHeight: 23,
                        marginTop: 8,
                        color: theme.colors.textSecondary,
                      }}
                    >
                      {projectList.length === 0
                        ? "Ask your team to invite you to a project."
                        : "Try another name or clear the search."}
                    </Text>
                  </View>
                )
              }
              renderItem={({
                item,
              }: ListRenderItemInfo<ProjectItem>): React.JSX.Element => {
                const selected: boolean = item._id === activeProject?._id;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={item.name}
                    accessibilityState={{ checked: selected }}
                    accessibilityHint="Show only this project's services and on-call work."
                    onPress={() => {
                      selectProject(item._id);
                      close();
                    }}
                    style={({ pressed }: { pressed: boolean }) => {
                      return {
                        minHeight: 76,
                        padding: 18,
                        borderWidth: 1,
                        borderColor: selected
                          ? theme.colors.actionPrimary
                          : theme.colors.borderDefault,
                        borderRadius: 16,
                        backgroundColor: selected
                          ? theme.colors.iconBackground
                          : theme.colors.backgroundSecondary,
                        marginBottom: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        opacity: pressed ? 0.7 : 1,
                      };
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          lineHeight: 23,
                          fontWeight: "600",
                          color: theme.colors.textPrimary,
                        }}
                      >
                        {item.name}
                      </Text>
                      {selected ? (
                        <Text
                          style={{
                            fontSize: 14,
                            color: theme.colors.actionPrimary,
                            marginTop: 4,
                          }}
                        >
                          Current project
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={selected ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={
                        selected
                          ? theme.colors.actionPrimary
                          : theme.colors.textTertiary
                      }
                    />
                  </Pressable>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
