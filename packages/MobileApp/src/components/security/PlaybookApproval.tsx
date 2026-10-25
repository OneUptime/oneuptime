import React, { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { elevation, radius, spacing, typography } from "../../theme/tokens";
import { withAlpha } from "../../utils/color";
import { formatRelativeTime } from "../../utils/date";
import GradientButton from "../GradientButton";
import IconBadge from "../IconBadge";
import CaseSheet from "./CaseSheet";
import {
  SELF_APPROVAL_SENTENCE,
  describePlaybookTarget,
  getKeptTargetValues,
  type PlaybookTarget,
  type WaitingPlaybookStep,
} from "../../security/playbookApproval";
import { getEntityTerm } from "../../security/caseTerms";
import type { PlaybookDecision } from "../../api/securityCases";

interface PlaybookApprovalCardProps {
  step: WaitingPlaybookStep;
  // The reader started the run: someone else must approve it.
  isOwnRun: boolean;
  busy: boolean;
  onDecide: (decision: PlaybookDecision) => void;
}

/**
 * A playbook step held for a decision, first on the case's screen: nothing
 * happens until somebody approves or rejects it, and this is often why the
 * phone rang. It says which playbook, which step, and what the step would
 * act on, with Reject and Approve beside it.
 */
export function PlaybookApprovalCard({
  step,
  isOwnRun,
  busy,
  onDecide,
}: PlaybookApprovalCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const startedWhen: string = step.startedAt
    ? formatRelativeTime(step.startedAt)
    : "";

  return (
    <View
      testID="playbook-approval-card"
      style={{
        marginBottom: spacing.xl,
        padding: spacing.lg - 1,
        gap: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 2,
        borderColor: withAlpha(theme.colors.statusWarning, 0.55),
        backgroundColor: theme.colors.backgroundElevated,
        ...elevation("card", theme.dark),
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}
      >
        <IconBadge
          name="hand-left-outline"
          color={theme.colors.statusWarning}
          background={theme.colors.statusWarningBg}
        />
        <View
          style={{ flex: 1, gap: spacing.xxs }}
          accessibilityLiveRegion="polite"
        >
          <Text
            accessibilityRole="header"
            style={{
              ...typography.overline,
              color: theme.colors.statusWarning,
            }}
          >
            Approval needed
          </Text>
          <Text
            testID="playbook-approval-step"
            style={{ ...typography.headline, color: theme.colors.textPrimary }}
          >
            {step.stepTitle}
          </Text>
          <Text
            style={{ ...typography.subhead, color: theme.colors.textSecondary }}
          >
            {`Step ${step.stepNumber} of ${step.playbookName}. Nothing happens until somebody approves or rejects it.`}
          </Text>
        </View>
      </View>

      {step.proposed.length > 0 ? (
        <TargetGroup title="Acts on" targets={step.proposed} />
      ) : null}
      {step.protectedTargets.length > 0 ? (
        <TargetGroup
          title="Leaves alone, as protected"
          targets={step.protectedTargets}
        />
      ) : null}

      <Text
        testID="playbook-approval-started"
        style={{ ...typography.footnote, color: theme.colors.textTertiary }}
      >
        {startedWhen && startedWhen !== "—"
          ? `${step.startedBy}, ${startedWhen}`
          : step.startedBy}
      </Text>

      {isOwnRun ? (
        <Text
          testID="playbook-approval-own-run"
          style={{ ...typography.footnote, color: theme.colors.textSecondary }}
        >
          {SELF_APPROVAL_SENTENCE}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        <GradientButton
          testID="playbook-reject"
          label="Reject"
          icon="close-circle-outline"
          variant="secondary"
          onPress={(): void => {
            onDecide("reject");
          }}
          disabled={busy}
          style={{ flex: 1, minWidth: 140, minHeight: 52 }}
        />
        <GradientButton
          testID="playbook-approve"
          label="Approve"
          icon="checkmark-circle-outline"
          onPress={(): void => {
            onDecide("approve");
          }}
          disabled={busy || isOwnRun}
          loading={busy}
          style={{ flex: 1, minWidth: 140, minHeight: 52 }}
        />
      </View>
    </View>
  );
}

function TargetGroup({
  title,
  targets,
}: {
  title: string;
  targets: Array<PlaybookTarget>;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        style={{
          ...typography.footnote,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        }}
      >
        {title}
      </Text>
      {targets.map((target: PlaybookTarget): React.JSX.Element => {
        return (
          <TargetLine key={`${target.state}-${target.value}`} target={target} />
        );
      })}
    </View>
  );
}

function TargetLine({ target }: { target: PlaybookTarget }): React.JSX.Element {
  const { theme } = useTheme();
  const isProtected: boolean = target.state === "Protected";

  return (
    <View
      testID={isProtected ? "playbook-target-protected" : "playbook-target"}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
    >
      <Ionicons
        name={isProtected ? "shield-checkmark-outline" : getEntityTerm(target.type).icon}
        size={16}
        color={isProtected ? theme.colors.statusSuccess : theme.colors.textSecondary}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1 }}>
        <Text
          selectable
          style={{
            ...typography.subhead,
            fontWeight: "600",
            color: theme.colors.textPrimary,
          }}
        >
          {target.value}
        </Text>
        <Text style={{ ...typography.caption, color: theme.colors.textSecondary }}>
          {describeTargetLine(target)}
        </Text>
      </View>
    </View>
  );
}

/*
 * A target's second line: what it is, and why the step picked it - or, for
 * a protected one under its own heading, the protected entry it matches.
 */
export function describeTargetLine(target: PlaybookTarget): string {
  const label: string = getEntityTerm(target.type).label;

  if (target.state === "Protected") {
    return target.protectedBy &&
      target.protectedBy.toLowerCase() !== target.value.toLowerCase()
      ? `${label} · Matches ${target.protectedBy}`
      : label;
  }

  return `${label} · ${describePlaybookTarget(target)}`;
}

interface PlaybookDecisionSheetProps {
  step: WaitingPlaybookStep | null;
  decision: PlaybookDecision | null;
  submitting: boolean;
  onSubmit: (data: {
    comment: string;
    targets: Array<string> | undefined;
  }) => void;
  onClose: () => void;
}

/**
 * Approve or reject the step, with a comment. An approval of a step that acts
 * on users or hosts lists them, every one ticked: untick any it should leave
 * alone - at least one stays, or the step is rejected instead. Protected ones
 * are listed and never acted on.
 */
export function PlaybookDecisionSheet({
  step,
  decision,
  submitting,
  onSubmit,
  onClose,
}: PlaybookDecisionSheetProps): React.JSX.Element {
  const { theme } = useTheme();
  const [comment, setComment] = useState<string>("");
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<boolean>(false);
  const visible: boolean = Boolean(step && decision);
  const isApproval: boolean = decision === "approve";

  useEffect((): void => {
    if (step && decision) {
      setComment("");
      setKept(
        new Set(
          step.proposed.map((target: PlaybookTarget): string => {
            return target.value.toLowerCase();
          }),
        ),
      );
    }
  }, [step, decision]);

  const keptValues: Array<string> | undefined = step
    ? getKeptTargetValues(step, kept)
    : undefined;
  const hasNoTargetKept: boolean =
    isApproval && keptValues !== undefined && keptValues.length === 0;

  const close: () => void = (): void => {
    if (!submitting) {
      onClose();
    }
  };

  return (
    <CaseSheet
      visible={visible}
      testID={isApproval ? "playbook-approve-sheet" : "playbook-reject-sheet"}
      icon={isApproval ? "checkmark-circle-outline" : "close-circle-outline"}
      iconColor={
        isApproval ? theme.colors.statusSuccess : theme.colors.statusError
      }
      title={
        step
          ? `${isApproval ? "Approve" : "Reject"}: ${step.stepTitle}`
          : ""
      }
      description={
        isApproval
          ? "The run carries on from this step. Your decision is kept on the step, on the case's timeline and in the audit log."
          : "The run stops here and nothing after this step runs. Your decision is kept on the step, on the case's timeline and in the audit log."
      }
      dismissible={!comment.trim() && !submitting}
      onClose={close}
      footer={
        <>
          <GradientButton
            testID="playbook-decision-cancel"
            label="Cancel"
            variant="secondary"
            onPress={close}
            disabled={submitting}
            style={{ flex: 1, minHeight: 52 }}
          />
          <GradientButton
            testID="playbook-decision-submit"
            label={isApproval ? "Approve" : "Reject"}
            icon={isApproval ? "checkmark-circle-outline" : "close-circle-outline"}
            variant={isApproval ? "primary" : "destructive"}
            loading={submitting}
            disabled={hasNoTargetKept}
            onPress={(): void => {
              if (!submitting && !hasNoTargetKept) {
                onSubmit({
                  comment: comment.trim(),
                  targets: isApproval ? keptValues : undefined,
                });
              }
            }}
            style={{ flex: 1, minHeight: 52 }}
          />
        </>
      }
    >
      {isApproval && step && step.proposed.length > 0 ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text
            accessibilityRole="header"
            style={{
              ...typography.subhead,
              fontWeight: "700",
              color: theme.colors.textPrimary,
            }}
          >
            Act on
          </Text>
          <Text
            style={{
              ...typography.footnote,
              color: theme.colors.textSecondary,
              marginTop: spacing.xxs,
              marginBottom: spacing.sm,
            }}
          >
            Every one is ticked. Untick any the step should leave alone.
          </Text>
          {step.proposed.map((target: PlaybookTarget): React.JSX.Element => {
            const key: string = target.value.toLowerCase();
            const checked: boolean = kept.has(key);

            return (
              <Pressable
                key={key}
                testID={`playbook-target-toggle-${target.value}`}
                accessibilityRole="checkbox"
                accessibilityLabel={`${target.value}, ${getEntityTerm(target.type).label}`}
                accessibilityState={{ checked, disabled: submitting }}
                aria-checked={checked}
                disabled={submitting}
                onPress={(): void => {
                  setKept((previous: Set<string>): Set<string> => {
                    const next: Set<string> = new Set(previous);

                    if (next.has(key)) {
                      next.delete(key);
                    } else {
                      next.add(key);
                    }

                    return next;
                  });
                }}
                style={({ pressed }: { pressed: boolean }) => {
                  return {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    minHeight: 52,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                    marginBottom: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.borderSubtle,
                    backgroundColor: pressed
                      ? theme.colors.backgroundTertiary
                      : theme.colors.backgroundElevated,
                  };
                }}
              >
                <Ionicons
                  name={checked ? "checkbox" : "square-outline"}
                  size={22}
                  color={
                    checked
                      ? theme.colors.actionPrimary
                      : theme.colors.textTertiary
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      ...typography.subhead,
                      fontWeight: "600",
                      color: theme.colors.textPrimary,
                    }}
                  >
                    {target.value}
                  </Text>
                  <Text
                    style={{
                      ...typography.caption,
                      color: theme.colors.textSecondary,
                    }}
                  >
                    {`${getEntityTerm(target.type).label} · ${describePlaybookTarget(target)}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {hasNoTargetKept ? (
            <Text
              testID="playbook-no-target-kept"
              style={{
                ...typography.footnote,
                color: theme.colors.statusError,
              }}
            >
              Keep at least one, or reject the step instead.
            </Text>
          ) : null}
          {step.protectedTargets.length > 0 ? (
            <Text
              style={{
                ...typography.footnote,
                color: theme.colors.textSecondary,
                marginTop: spacing.xs,
              }}
            >
              {`Never acted on, because they are protected: ${step.protectedTargets
                .map((target: PlaybookTarget): string => {
                  return target.value;
                })
                .join(", ")}.`}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text
        style={{
          ...typography.subhead,
          fontWeight: "700",
          color: theme.colors.textPrimary,
          marginBottom: spacing.sm,
        }}
      >
        Comment (optional)
      </Text>
      <TextInput
        testID="playbook-decision-comment"
        accessibilityLabel="Comment"
        value={comment}
        onChangeText={setComment}
        placeholder="Why you decided this way."
        placeholderTextColor={theme.colors.textTertiary}
        selectionColor={theme.colors.actionPrimary}
        cursorColor={theme.colors.actionPrimary}
        keyboardAppearance={theme.dark ? "dark" : "light"}
        multiline
        maxLength={2000}
        textAlignVertical="top"
        editable={!submitting}
        onFocus={(): void => {
          setFocused(true);
        }}
        onBlur={(): void => {
          setFocused(false);
        }}
        style={{
          fontSize: typography.body.fontSize,
          minHeight: 80,
          maxHeight: 160,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg - (focused ? 1 : 0),
          paddingVertical: spacing.md - (focused ? 1 : 0),
          backgroundColor: theme.colors.backgroundPrimary,
          borderWidth: focused ? 2 : 1,
          borderColor: focused
            ? theme.colors.actionPrimary
            : theme.colors.borderDefault,
          color: theme.colors.textPrimary,
        }}
      />
    </CaseSheet>
  );
}
