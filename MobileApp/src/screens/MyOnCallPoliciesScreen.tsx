import React, { useMemo } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import ScreenIntro from "../components/ScreenIntro";
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
    purple: string;
    purpleBg: string;
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
        icon: "calendar-outline",
        label: "Schedule",
        color: colors.purple,
        background: colors.purpleBg,
      };
  }
}

export default function MyOnCallPoliciesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const { lightImpact } = useHaptics();
  const {
    projects,
    totalAssignments,
    isLoading,
    isError,
    failedProjectCount,
    isPartialFailure,
    refetch,
  } = useAllProjectOnCallPolicies();

  const projectCount: number = projects.length;

  const summaryText: string = useMemo(() => {
    const assignmentLabel: string =
      totalAssignments === 1 ? "assignment" : "assignments";
    const summary: string = `You are currently on duty for ${totalAssignments} ${assignmentLabel} in the selected project.`;

    if (failedProjectCount === 0) {
      return summary;
    }

    /*
     * Some projects answered and some did not, so the count above is a floor,
     * not a total. Stating it on its own would be a confident number built on
     * a partial answer, and the responder has no way to tell from the screen
     * that a project is missing from it.
     */
    const failedLabel: string =
      failedProjectCount === 1 ? "project" : "projects";

    return `${summary} ${failedProjectCount} ${failedLabel} did not answer, so this list may be incomplete.`;
  }, [failedProjectCount, projectCount, totalAssignments]);

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await refetch();
  };

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
        >
          <View
            style={{
              borderRadius: 16,
              overflow: "hidden",
              padding: 20,
              marginBottom: 16,
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

  /*
   * "We asked, and you hold no duty" and "we could not ask" used to land on
   * the same screen, and the gap between them is a responder who puts the
   * phone down versus one who checks again. Two shapes of silence mean we do
   * not know:
   *
   *   - isError: every project we asked failed, so there is no answer at all.
   *   - a partial failure that left us with nothing to show: the projects
   *     that answered hold no duty, and the only projects that could have
   *     held some are exactly the ones that went missing. Rendering "Not
   *     currently on-call" here states as fact the one thing we did not
   *     manage to check.
   *
   * A partial failure WITH assignments to show is deliberately not here - the
   * duty we did find is real and must stay on screen. That case is disclosed
   * in the summary line instead.
   */
  const cannotEstablishDuty: boolean =
    isError || (isPartialFailure && projectCount === 0);

  if (cannotEstablishDuty) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <EmptyState
          title="Something went wrong"
          subtitle="Your on-call duty could not be established, which is not the same as being off duty. Try again."
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
      testID="oncall-policies-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ScreenIntro
        title="My policies"
        description="Understand how this project reaches you."
      />
      <View
        style={{
          paddingVertical: 16,
          paddingHorizontal: 18,
          marginBottom: 20,
          borderRadius: 12,
          backgroundColor: theme.colors.cardAccent,
        }}
      >
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Text
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: "600",
              color: theme.colors.textPrimary,
            }}
          >
            Active assignments
          </Text>
          <Text
            style={{
              fontSize: 28,
              fontWeight: "700",
              letterSpacing: -1,
              color: theme.colors.actionPrimary,
              fontVariant: ["tabular-nums"],
            }}
          >
            {totalAssignments}
          </Text>
        </View>
        {projectCount > 0 ? (
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              marginTop: 8,
              color: theme.colors.textSecondary,
            }}
          >
            {summaryText}
          </Text>
        ) : null}
      </View>

      {projects.length > 0 ? (
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            color: theme.colors.textSecondary,
            marginBottom: 20,
          }}
        >
          Direct assignments page you personally. Team assignments reach you
          through a team. Schedule assignments apply while you are on its
          roster.
        </Text>
      ) : null}

      {projects.length === 0 ? (
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
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
        <View style={{ gap: 16 }}>
          {projects.map((projectData: ProjectOnCallAssignments) => {
            return (
              <View
                key={projectData.projectId}
                style={{
                  borderRadius: 16,
                  backgroundColor: theme.colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                }}
              >
                <View
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.borderSubtle,
                    backgroundColor: theme.colors.backgroundTertiary,
                    borderTopLeftRadius: 15,
                    borderTopRightRadius: 15,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    <Ionicons
                      name="folder-open-outline"
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        marginLeft: 8,
                        marginRight: 8,
                        flex: 1,
                        color: theme.colors.textPrimary,
                      }}
                      numberOfLines={1}
                    >
                      {projectData.projectName}
                    </Text>
                  </View>

                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: theme.colors.backgroundTertiary,
                      borderWidth: 1,
                      borderColor: theme.colors.borderSubtle,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: theme.colors.textSecondary,
                      }}
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
                          purple: "#6B3AB8",
                          purpleBg: "#F0EAF9",
                        },
                      );

                      return (
                        <View
                          key={`${assignment.projectId}-${assignment.policyId ?? "unknown"}-${assignmentIndex}`}
                          style={{
                            paddingHorizontal: 18,
                            paddingVertical: 20,
                            ...(assignmentIndex !==
                            projectData.assignments.length - 1
                              ? {
                                  borderBottomWidth: 1,
                                  borderBottomColor: theme.colors.borderSubtle,
                                }
                              : {}),
                          }}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 18,
                                lineHeight: 25,
                                fontWeight: "600",
                                flex: 1,
                                marginRight: 12,
                                color: theme.colors.textPrimary,
                              }}
                              numberOfLines={2}
                            >
                              {assignment.policyName}
                            </Text>

                            <View
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 5,
                                borderRadius: 6,
                                flexDirection: "row",
                                alignItems: "center",
                                backgroundColor: badge.background,
                              }}
                            >
                              <Ionicons
                                name={badge.icon}
                                size={12}
                                color={badge.color}
                              />
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontWeight: "600",
                                  marginLeft: 4,
                                  color: badge.color,
                                }}
                              >
                                {badge.label}
                              </Text>
                            </View>
                          </View>

                          <View style={{ marginTop: 8 }}>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                            >
                              <Ionicons
                                name="git-branch-outline"
                                size={13}
                                color={theme.colors.textTertiary}
                              />
                              <Text
                                style={{
                                  fontSize: 14,
                                  lineHeight: 21,
                                  flex: 1,
                                  marginLeft: 6,
                                  color: theme.colors.textSecondary,
                                }}
                                numberOfLines={2}
                              >
                                Rule: {assignment.escalationRuleName}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                marginTop: 4,
                              }}
                            >
                              <Ionicons
                                name="information-circle-outline"
                                size={13}
                                color={theme.colors.textTertiary}
                              />
                              <Text
                                style={{
                                  fontSize: 14,
                                  lineHeight: 21,
                                  flex: 1,
                                  marginLeft: 6,
                                  color: theme.colors.textSecondary,
                                }}
                                numberOfLines={2}
                              >
                                {assignment.assignmentDetail}
                              </Text>
                            </View>
                          </View>
                        </View>
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
