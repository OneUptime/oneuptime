import React, { useMemo } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, type ColorTokens } from "../theme";
import { radius, spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useAllProjectOnCallPolicies } from "../hooks/useAllProjectOnCallPolicies";
import EmptyState from "../components/EmptyState";
import SkeletonCard from "../components/SkeletonCard";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import IconBadge from "../components/IconBadge";
import { ListGroup } from "../components/ListGroup";
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

/*
 * Each way of being paged gets its own token pair, so the three kinds stay
 * distinguishable in both palettes: direct is success green, team is the
 * info indigo, and schedule the cyan accent.
 */
export function getAssignmentBadge(
  type: OnCallAssignmentType,
  colors: ColorTokens,
): AssignmentBadgeConfig {
  switch (type) {
    case "user":
      return {
        icon: "person-outline",
        label: "Direct",
        color: colors.statusSuccess,
        background: colors.statusSuccessBg,
      };
    case "team":
      return {
        icon: "people-outline",
        label: "Team",
        color: colors.statusInfo,
        background: colors.statusInfoBg,
      };
    case "schedule":
      return {
        icon: "calendar-outline",
        label: "Schedule",
        color: colors.accentCyan,
        background: colors.accentCyanBg,
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

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    await refetch();
  });

  const intro: React.JSX.Element = (
    <ScreenIntro
      title="My policies"
      description="Understand how this project reaches you."
    />
  );

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: spacing.xl,
            paddingBottom: bottomPadding,
          }}
        >
          {intro}
          <SkeletonCard variant="compact" />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
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
      <ScrollView
        testID="oncall-policies-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        {intro}
        <EmptyState
          title="Something went wrong"
          subtitle="Your on-call duty could not be established, which is not the same as being off duty. Try again."
          icon="error"
          actionLabel="Retry"
          onAction={onRefresh}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      testID="oncall-policies-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {intro}
      <Card testID="policies-summary" style={{ marginBottom: spacing.lg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <IconBadge
            name="shield-checkmark-outline"
            color={theme.colors.actionPrimary}
          />
          <AppText variant="headline" style={{ flex: 1 }}>
            Active assignments
          </AppText>
          <AppText
            testID="policies-total"
            variant="largeTitle"
            tone="accent"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {totalAssignments}
          </AppText>
        </View>
        {projectCount > 0 ? (
          <AppText
            variant="subhead"
            tone="secondary"
            style={{ marginTop: spacing.md }}
          >
            {summaryText}
          </AppText>
        ) : null}
      </Card>

      {projects.length > 0 ? (
        <Banner
          testID="policies-legend"
          tone="neutral"
          icon="information-circle-outline"
          message="Direct assignments page you personally. Team assignments reach you through a team. Schedule assignments apply while you are on its roster."
          style={{ marginBottom: spacing.xxl }}
        />
      ) : null}

      {projects.length === 0 ? (
        <Card testID="policies-empty" variant="outlined">
          <EmptyState
            compact
            title="Not currently on-call"
            subtitle="You are not on duty for any on-call policy right now."
            icon="default"
          />
        </Card>
      ) : (
        <View style={{ gap: spacing.xxl }}>
          {projects.map((projectData: ProjectOnCallAssignments) => {
            return (
              <View
                key={projectData.projectId}
                testID={`policies-project-${projectData.projectId}`}
                style={{ gap: spacing.sm }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    marginHorizontal: spacing.xs,
                  }}
                >
                  <Ionicons
                    name="folder-open-outline"
                    size={15}
                    color={theme.colors.textSecondary}
                  />
                  <AppText
                    variant="overline"
                    tone="secondary"
                    accessibilityRole="header"
                    numberOfLines={1}
                    style={{ flex: 1 }}
                  >
                    {projectData.projectName}
                  </AppText>
                  <AppText variant="caption" tone="secondary">
                    {projectData.assignments.length} active
                  </AppText>
                </View>

                <ListGroup>
                  {projectData.assignments.map(
                    (
                      assignment: OnCallAssignmentItem,
                      assignmentIndex: number,
                    ): React.JSX.Element => {
                      return (
                        <AssignmentRow
                          key={`${assignment.projectId}-${assignment.policyId ?? "unknown"}-${assignmentIndex}`}
                          assignment={assignment}
                        />
                      );
                    },
                  )}
                </ListGroup>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function AssignmentRow({
  assignment,
}: {
  assignment: OnCallAssignmentItem;
}): React.JSX.Element {
  const { theme } = useTheme();
  const badge: AssignmentBadgeConfig = getAssignmentBadge(
    assignment.assignmentType,
    theme.colors,
  );

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
        }}
      >
        <AppText
          variant="headline"
          numberOfLines={2}
          style={{ flex: 1, fontSize: 17, lineHeight: 23 }}
        >
          {assignment.policyName}
        </AppText>

        <View
          testID={`assignment-badge-${assignment.assignmentType}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xxs + 1,
            borderRadius: radius.pill,
            backgroundColor: badge.background,
          }}
        >
          <Ionicons name={badge.icon} size={13} color={badge.color} />
          <AppText variant="caption" weight="600" color={badge.color}>
            {badge.label}
          </AppText>
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        <DetailLine iconName="git-branch-outline">
          Rule: {assignment.escalationRuleName}
        </DetailLine>
        <DetailLine iconName="information-circle-outline">
          {assignment.assignmentDetail}
        </DetailLine>
      </View>
    </View>
  );
}

function DetailLine({
  iconName,
  children,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.xs + 2,
      }}
    >
      <Ionicons
        name={iconName}
        size={14}
        color={theme.colors.textTertiary}
        style={{ marginTop: 3 }}
      />
      <AppText
        variant="subhead"
        tone="secondary"
        numberOfLines={2}
        style={{ flex: 1 }}
      >
        {children}
      </AppText>
    </View>
  );
}
