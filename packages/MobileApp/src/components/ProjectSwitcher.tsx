import React, { useContext, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
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
import { elevation, radius, spacing } from "../theme/tokens";
import AppText from "./AppText";
import Banner from "./Banner";
import GradientButton from "./GradientButton";
import IconBadge from "./IconBadge";
import SearchField from "./SearchField";
import { getInitials } from "../utils/text";

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
  const { width, height } = useWindowDimensions();
  const paddingBottom: number = useScreenPadding({ tabBar: false });
  const filtered: ProjectItem[] = projectList.filter(
    (project: ProjectItem): boolean => {
      return project.name.toLowerCase().includes(search.trim().toLowerCase());
    },
  );
  const activeInitials: string = getInitials(activeProject?.name);

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
        aria-expanded={visible}
        hitSlop={4}
        onPress={() => {
          setSearch("");
          setVisible(true);
        }}
        style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
          return {
            minHeight: 44,
            maxWidth: Math.min(300, Math.max(160, width - 128)),
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingLeft: spacing.xs,
            paddingRight: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.pill,
            backgroundColor: pressed
              ? theme.colors.backgroundTertiary
              : theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderSubtle,
            ...elevation("card", theme.dark),
          };
        }}
      >
        <View
          testID="project-switcher-avatar"
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: theme.colors.actionPrimary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {activeInitials ? (
            <AppText
              variant="footnote"
              weight="800"
              tone="inverse"
              maxFontSizeMultiplier={1.3}
            >
              {activeInitials}
            </AppText>
          ) : (
            <Ionicons
              name="layers-outline"
              size={16}
              color={theme.colors.textInverse}
            />
          )}
        </View>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <AppText
            variant="caption"
            tone="secondary"
            weight="600"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            Project
          </AppText>
          <AppText
            variant="subhead"
            weight="700"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
          >
            {activeProject?.name ||
              (isLoadingProjects ? "Loading project…" : "Choose project")}
          </AppText>
        </View>
        <Ionicons
          name="chevron-down"
          size={16}
          color={theme.colors.textSecondary}
        />
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: theme.colors.overlay,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss project switcher"
            onPress={close}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            }}
          />
          <View
            testID="project-switcher-sheet"
            accessibilityViewIsModal
            style={{
              height: Math.min(660, height - (insets?.top ?? 0) - 32),
              flexShrink: 1,
              width: "100%",
              maxWidth: 640,
              alignSelf: "center",
              backgroundColor: theme.colors.backgroundSecondary,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderWidth: theme.dark ? 1 : 0,
              borderBottomWidth: 0,
              borderColor: theme.colors.borderSubtle,
              paddingTop: spacing.md,
              overflow: "hidden",
              ...elevation("overlay", theme.dark),
            }}
          >
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.borderDefault,
                alignSelf: "center",
                marginBottom: spacing.sm,
              }}
            />
            <View
              style={{
                paddingHorizontal: spacing.xl,
                paddingBottom: spacing.lg,
                gap: spacing.md,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                }}
              >
                <AppText
                  accessibilityRole="header"
                  variant="title2"
                  style={{ flex: 1 }}
                >
                  Switch project
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close project switcher"
                  onPress={close}
                  style={({
                    pressed,
                  }: {
                    pressed: boolean;
                  }): StyleProp<ViewStyle> => {
                    return {
                      minWidth: 48,
                      minHeight: 48,
                      marginRight: -spacing.sm,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.6 : 1,
                    };
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.colors.backgroundTertiary,
                    }}
                  >
                    <Ionicons
                      name="close"
                      size={18}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                </Pressable>
              </View>
              <AppText variant="subhead" tone="secondary">
                One project at a time. Your selection stays with you when you
                reopen the app.
              </AppText>
              <SearchField
                value={search}
                onChangeText={setSearch}
                placeholder="Search projects"
                accessibilityLabel="Search projects to switch"
              />
            </View>
            {projectLoadError ? (
              <View
                testID="project-switcher-error"
                style={{
                  paddingHorizontal: spacing.xl,
                  paddingBottom: spacing.lg,
                  gap: spacing.md,
                }}
              >
                <Banner
                  tone="danger"
                  message="Could not load projects. Check your connection and try again."
                />
                <GradientButton
                  label="Retry loading projects"
                  variant="secondary"
                  icon="refresh"
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
              contentContainerStyle={{
                paddingHorizontal: spacing.xl,
                paddingBottom,
                gap: spacing.sm + 2,
              }}
              ListEmptyComponent={
                isLoadingProjects ? (
                  <ActivityIndicator
                    accessibilityLabel="Loading projects"
                    color={theme.colors.actionPrimary}
                    style={{ marginTop: spacing.xxl }}
                  />
                ) : (
                  <View
                    testID="project-switcher-empty"
                    style={{
                      alignItems: "center",
                      gap: spacing.sm,
                      paddingVertical: spacing.xxl,
                      paddingHorizontal: spacing.lg,
                    }}
                  >
                    <IconBadge
                      name={
                        projectList.length === 0
                          ? "folder-open-outline"
                          : "search-outline"
                      }
                      size="lg"
                      shape="circle"
                    />
                    <AppText
                      variant="headline"
                      align="center"
                      style={{ marginTop: spacing.xs }}
                    >
                      {projectList.length === 0
                        ? "No projects available"
                        : "No matching projects"}
                    </AppText>
                    <AppText variant="subhead" tone="secondary" align="center">
                      {projectList.length === 0
                        ? "Ask your team to invite you to a project."
                        : "Try another name or clear the search."}
                    </AppText>
                  </View>
                )
              }
              renderItem={({
                item,
              }: ListRenderItemInfo<ProjectItem>): React.JSX.Element => {
                const selected: boolean = item._id === activeProject?._id;
                const initials: string = getInitials(item.name);
                return (
                  <Pressable
                    testID={`project-switcher-option-${item._id}`}
                    accessibilityRole="radio"
                    accessibilityLabel={item.name}
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    accessibilityHint="Show only this project's services and on-call work."
                    onPress={() => {
                      selectProject(item._id);
                      close();
                    }}
                    style={({
                      pressed,
                    }: {
                      pressed: boolean;
                    }): StyleProp<ViewStyle> => {
                      return {
                        minHeight: 72,
                        // The thicker selected border must not shift the row.
                        paddingHorizontal: spacing.lg - (selected ? 1 : 0),
                        paddingVertical: spacing.md - (selected ? 1 : 0),
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected
                          ? theme.colors.actionPrimary
                          : theme.colors.borderSubtle,
                        borderRadius: radius.lg,
                        backgroundColor: selected
                          ? theme.colors.cardAccent
                          : pressed
                            ? theme.colors.backgroundTertiary
                            : theme.colors.backgroundElevated,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.md,
                      };
                    }}
                  >
                    <View
                      testID={`project-switcher-option-avatar-${item._id}`}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: radius.md,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected
                          ? theme.colors.actionPrimary
                          : theme.colors.cardAccent,
                      }}
                    >
                      {initials ? (
                        <AppText
                          variant="subhead"
                          weight="700"
                          color={
                            selected
                              ? theme.colors.textInverse
                              : theme.colors.actionPrimary
                          }
                          maxFontSizeMultiplier={1.3}
                        >
                          {initials}
                        </AppText>
                      ) : (
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={
                            selected
                              ? theme.colors.textInverse
                              : theme.colors.actionPrimary
                          }
                        />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
                      <AppText variant="headline" numberOfLines={2}>
                        {item.name}
                      </AppText>
                      {selected ? (
                        <AppText variant="footnote" weight="600" tone="accent">
                          Current project
                        </AppText>
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
