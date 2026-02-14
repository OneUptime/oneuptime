import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import { useAllProjectOnCallPolicies } from "../hooks/useAllProjectOnCallPolicies";
import EmptyState from "../components/EmptyState";
import SkeletonCard from "../components/SkeletonCard";
import type {
  OnCallAssignmentItem,
  OnCallAssignmentType,
  ProjectOnCallAssignments,
} from "../api/types";

interface AssignmentBadgeConfig {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  background: string;
}

function getAssignmentBadge(
  type: OnCallAssignmentType,
  colors: {
    success: string;
    successBg: string;
    info: string;
    infoBg: string;
    warning: string;
    warningBg: string;
  },
): AssignmentBadgeConfig {
  switch (type) {
    case "user":
      return {
        icon: "person-outline",
        label: "Direct",
        color: colors.success,
        background: colors.successBg,
      };
    case "team":
      return {
        icon: "people-outline",
        label: "Team",
        color: colors.info,
        background: colors.infoBg,
      };
    case "schedule":
      return {
        icon: "time-outline",
        label: "Schedule",
        color: colors.warning,
        background: colors.warningBg,
      };
  }
}

export default function MyOnCallPoliciesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();
  const { projects, totalAssignments, isLoading, isError, refetch } =
    useAllProjectOnCallPolicies();

  const projectCount: number = projects.length;

  const summaryText: string = useMemo(() => {
    const assignmentLabel: string =
      totalAssignments === 1 ? "assignment" : "assignments";
    const projectLabel: string = projectCount === 1 ? "project" : "projects";

    return `You are currently on duty for ${totalAssignments} ${assignmentLabel} across ${projectCount} ${projectLabel}.`;
  }, [projectCount, totalAssignments]);

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await refetch();
  };

  if (isLoading) {
    return (
      <View
        className="flex-1"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
          <View
            className="rounded-3xl overflow-hidden p-5 mb-4"
            style={{
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <SkeletonCard variant="compact" />
          </View>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (isError) {
    return (
      <View
        className="flex-1"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="Could not load on-call assignments"
          subtitle="Pull to refresh or try again."
          icon="alerts"
          actionLabel="Retry"
          onAction={() => {
            return refetch();
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 16, paddingBottom: 56 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <View
        className="rounded-3xl overflow-hidden p-5 mb-5"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: theme.isDark ? "#000" : theme.colors.accentGradientMid,
          shadowOpacity: theme.isDark ? 0.32 : 0.1,
          shadowOffset: { width: 0, height: 10 },
          shadowRadius: 18,
          elevation: 7,
        }}
      >
        <LinearGradient
          colors={[
            theme.colors.oncallActiveBg,
            theme.colors.accentGradientEnd + "08",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: -70,
            left: -30,
            right: -20,
            height: 220,
          }}
        />

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <View
              className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
              style={{
                backgroundColor: theme.colors.oncallActiveBg,
                borderWidth: 1,
                borderColor: theme.colors.borderGlass,
              }}
            >
              <Ionicons
                name="call-outline"
                size={20}
                color={theme.colors.oncallActive}
              />
            </View>
            <View className="flex-1">
              <Text
                className="text-[20px] font-bold"
                style={{
                  color: theme.colors.textPrimary,
                  letterSpacing: -0.4,
                }}
              >
                On-Call Now
              </Text>
              <Text
                className="text-[12px] mt-0.5"
                style={{ color: theme.colors.textSecondary }}
              >
                Live duty assignments
              </Text>
            </View>
          </View>

          <View
            className="px-3 py-1.5 rounded-xl"
            style={{
              backgroundColor: theme.colors.backgroundTertiary,
              borderWidth: 1,
              borderColor: theme.colors.borderSubtle,
            }}
          >
            <Text
              className="text-[18px] font-bold"
              style={{
                color: theme.colors.textPrimary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {totalAssignments}
            </Text>
          </View>
        </View>

        <Text
          className="text-[13px] mt-4 leading-5"
          style={{ color: theme.colors.textSecondary }}
        >
          {summaryText}
        </Text>
      </View>

      {projects.length === 0 ? (
        <View
          className="rounded-3xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <EmptyState
            title="Not currently on-call"
            subtitle="You are not on duty for any on-call policy right now."
            icon="alerts"
          />
        </View>
      ) : (
        <View className="gap-4">
          {projects.map((projectData: ProjectOnCallAssignments) => {
            return (
              <View
                key={projectData.projectId}
                className="rounded-3xl overflow-hidden"
                style={{
                  backgroundColor: theme.colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                  shadowColor: theme.isDark
                    ? "#000"
                    : theme.colors.accentGradientMid,
                  shadowOpacity: theme.isDark ? 0.2 : 0.08,
                  shadowOffset: { width: 0, height: 6 },
                  shadowRadius: 14,
                  elevation: 4,
                }}
              >
                <View
                  className="px-4 py-3.5 flex-row items-center justify-between"
                  style={{
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.borderSubtle,
                    backgroundColor: theme.colors.backgroundSecondary,
                  }}
                >
                  <View className="flex-row items-center flex-1">
                    <Ionicons
                      name="folder-open-outline"
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                    <Text
                      className="text-[14px] font-semibold ml-2 mr-2 flex-1"
                      style={{ color: theme.colors.textPrimary }}
                      numberOfLines={1}
                    >
                      {projectData.projectName}
                    </Text>
                  </View>

                  <View
                    className="px-2 py-1 rounded-lg"
                    style={{
                      backgroundColor: theme.colors.backgroundTertiary,
                      borderWidth: 1,
                      borderColor: theme.colors.borderSubtle,
                    }}
                  >
                    <Text
                      className="text-[11px] font-semibold"
                      style={{ color: theme.colors.textSecondary }}
                    >
                      {projectData.assignments.length} active
                    </Text>
                  </View>
                </View>

                <View>
                  {projectData.assignments.map(
                    (
                      assignment: OnCallAssignmentItem,
                      assignmentIndex: number,
                    ): React.JSX.Element => {
                      const badge: AssignmentBadgeConfig = getAssignmentBadge(
                        assignment.assignmentType,
                        {
                          success: theme.colors.oncallActive,
                          successBg: theme.colors.oncallActiveBg,
                          info: theme.colors.severityInfo,
                          infoBg: theme.colors.severityInfoBg,
                          warning: theme.colors.severityWarning,
                          warningBg: theme.colors.severityWarningBg,
                        },
                      );

                      return (
                        <TouchableOpacity
                          key={`${assignment.projectId}-${assignment.policyId ?? assignmentIndex}`}
                          activeOpacity={0.82}
                          className="px-4 py-3.5"
                          style={
                            assignmentIndex !==
                            projectData.assignments.length - 1
                              ? {
                                  borderBottomWidth: 1,
                                  borderBottomColor: theme.colors.borderSubtle,
                                }
                              : undefined
                          }
                        >
                          <View className="flex-row items-center justify-between">
                            <Text
                              className="text-[15px] font-semibold flex-1 mr-3"
                              style={{ color: theme.colors.textPrimary }}
                              numberOfLines={1}
                            >
                              {assignment.policyName}
                            </Text>

                            <View
                              className="px-2.5 py-1 rounded-full flex-row items-center"
                              style={{
                                backgroundColor: badge.background,
                              }}
                            >
                              <Ionicons
                                name={badge.icon}
                                size={12}
                                color={badge.color}
                              />
                              <Text
                                className="text-[11px] font-semibold ml-1"
                                style={{ color: badge.color }}
                              >
                                {badge.label}
                              </Text>
                            </View>
                          </View>

                          <View className="mt-2">
                            <View className="flex-row items-center">
                              <Ionicons
                                name="git-branch-outline"
                                size={13}
                                color={theme.colors.textTertiary}
                              />
                              <Text
                                className="text-[12px] ml-1.5"
                                style={{ color: theme.colors.textSecondary }}
                                numberOfLines={1}
                              >
                                Rule: {assignment.escalationRuleName}
                              </Text>
                            </View>
                            <View className="flex-row items-center mt-1">
                              <Ionicons
                                name="information-circle-outline"
                                size={13}
                                color={theme.colors.textTertiary}
                              />
                              <Text
                                className="text-[12px] ml-1.5"
                                style={{ color: theme.colors.textSecondary }}
                                numberOfLines={1}
                              >
                                {assignment.assignmentDetail}
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    },
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
