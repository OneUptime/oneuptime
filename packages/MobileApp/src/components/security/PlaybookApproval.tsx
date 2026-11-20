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
  type ContainedPlaybookTarget,
  type PlaybookTarget,
  type WaitingPlaybookStep,
} from "../../security/playbookApproval";
import { getEntityTerm } from "../../security/caseTerms";
import type {
  PlaybookApprovalReadout,
  PlaybookDecision,
} from "../../api/securityCases";
import { ResponseSection } from "../ResponseDetailLayout";
import { countTypingAsActivity } from "../../auth/userActivity";

// The heading over the targets a step never acts on, as the dashboard says it.
export const PROTECTED_TARGETS_TITLE: string = "Protected, never acted on";

interface PlaybookApprovalCardProps {
  step: WaitingPlaybookStep;
  // The reader started the run: someone else must approve it.
  isOwnRun: boolean;
  busy: boolean;
  onDecide: (decision: PlaybookDecision) => void;
  /*
   * The approval as its chat messages say it, once read: what the step
   * will do and through what, who asked, the evidence, and the undo.
   */
  evidence?: PlaybookApprovalReadout | null | undefined;
}

/**
 * A playbook step held for a decision, first on the case's screen: nothing
 * happens until somebody approves or rejects it, and this is often why the
 * phone rang. It says which step of which playbook waits, what the step
 * would act on and what it leaves alone, what will be done and through
 * what, who asked, the evidence behind the case and whether it can be
 * undone - the same as the approval's Slack and Microsoft Teams messages -
 * with Reject and Approve beside it.
 */
export function PlaybookApprovalCard({
  step,
  isOwnRun,
  busy,
  onDecide,
  evidence,
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
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
        }}
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
            testID="playbook-approval-where"
            style={{ ...typography.subhead, color: theme.colors.textSecondary }}
          >
            {step.playbookName ? (
              <>
                {"Playbook "}
                <Text
                  style={{ fontWeight: "600", color: theme.colors.textPrimary }}
                >
                  {step.playbookName}
                </Text>
              </>
            ) : (
              "The playbook"
            )}
            {` waits at step ${step.stepNumber} until someone approves or rejects it.`}
          </Text>
        </View>
      </View>

      {step.proposed.length > 0 ? (
        <TargetGroup title="Acts on" targets={step.proposed} />
      ) : null}
      {step.protectedTargets.length > 0 ? (
        <TargetGroup
          title={PROTECTED_TARGETS_TITLE}
          targets={step.protectedTargets}
        />
      ) : null}

      {evidence ? <PlaybookApprovalEvidence readout={evidence} /> : null}

      {/*
        Who started the run, or how it started on its own. The reader's own
        run says why they cannot approve it instead: the sentence names them.
      */}
      {isOwnRun ? (
        <Text
          testID="playbook-approval-own-run"
          style={{ ...typography.footnote, color: theme.colors.textSecondary }}
        >
          {SELF_APPROVAL_SENTENCE}
        </Text>
      ) : (
        <Text
          testID="playbook-approval-started"
          style={{ ...typography.footnote, color: theme.colors.textTertiary }}
        >
          {startedWhen && startedWhen !== "—"
            ? `${step.startedBy}, ${startedWhen}`
            : step.startedBy}
        </Text>
      )}

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

/*
 * What the approval's chat messages say besides its targets: what will be
 * done and through which connection, who or what asked, the evidence
 * behind the case, and whether it can be undone. The server's own words
 * (POST /security-playbook-run/:runId/approval), so the phone says what
 * Slack and Microsoft Teams say.
 */
export function PlaybookApprovalEvidence({
  readout,
}: {
  readout: PlaybookApprovalReadout;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View testID="playbook-approval-evidence" style={{ gap: spacing.sm }}>
      {readout.action ? (
        <View style={{ gap: spacing.xxs }}>
          <Text
            style={{
              ...typography.footnote,
              fontWeight: "700",
              color: theme.colors.textSecondary,
            }}
          >
            Will do
          </Text>
          <Text
            testID="playbook-approval-action"
            selectable
            style={{ ...typography.subhead, color: theme.colors.textPrimary }}
          >
            {readout.action}
          </Text>
        </View>
      ) : null}
      {readout.source ? (
        <Text
          testID="playbook-approval-source"
          style={{ ...typography.footnote, color: theme.colors.textSecondary }}
        >
          {readout.source}
        </Text>
      ) : null}
      {readout.evidence.length > 0 ? (
        <View style={{ gap: spacing.xxs }}>
          <Text
            style={{
              ...typography.footnote,
              fontWeight: "700",
              color: theme.colors.textSecondary,
            }}
          >
            Evidence
          </Text>
          {readout.evidence.map(
            (line: string, index: number): React.JSX.Element => {
              return (
                <Text
                  key={`${index}-${line}`}
                  testID="playbook-approval-evidence-line"
                  selectable
                  style={{
                    ...typography.subhead,
                    color: theme.colors.textPrimary,
                  }}
                >
                  {`• ${line}`}
                </Text>
              );
            },
          )}
        </View>
      ) : null}
      {readout.undo ? (
        <Text
          testID="playbook-approval-undo"
          style={{ ...typography.footnote, color: theme.colors.textSecondary }}
        >
          {readout.undo}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The approval a push opened, once nobody needs to decide it any more:
 * somebody approved or rejected it a moment ago - here, in Slack, Microsoft
 * Teams or the dashboard - or the run stopped waiting. Who, when, and how
 * the step went, in the words of its chat messages.
 */
export function PlaybookApprovalDecidedNotice({
  readout,
}: {
  readout: PlaybookApprovalReadout;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      testID="playbook-approval-decided"
      accessibilityLiveRegion="polite"
      style={{
        marginBottom: spacing.xl,
        padding: spacing.lg,
        gap: spacing.xs,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
        backgroundColor: theme.colors.backgroundElevated,
        ...elevation("card", theme.dark),
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ ...typography.overline, color: theme.colors.textSecondary }}
      >
        No longer waiting for you
      </Text>
      <Text
        testID="playbook-approval-decided-headline"
        style={{ ...typography.headline, color: theme.colors.textPrimary }}
      >
        {readout.headline}
      </Text>
      {readout.progress ? (
        <Text
          testID="playbook-approval-decided-progress"
          style={{ ...typography.subhead, color: theme.colors.textSecondary }}
        >
          {readout.progress}
        </Text>
      ) : null}
      {readout.targets.map((line: string): React.JSX.Element => {
        return (
          <Text
            key={line}
            selectable
            style={{ ...typography.footnote, color: theme.colors.textSecondary }}
          >
            {`• ${line}`}
          </Text>
        );
      })}
    </View>
  );
}

interface ContainedTargetsSectionProps {
  contained: Array<ContainedPlaybookTarget>;
  // The target an undo is on its way for: its button waits, and so do the others.
  undoing: ContainedPlaybookTarget | null;
  onUndo: (contained: ContainedPlaybookTarget) => void;
}

/**
 * What the case's playbooks contained - each account suspended, host
 * contained or device isolated - with the step's undo beside it, once the
 * threat is gone: one tap and a confirmation, through the step's own
 * connection, as on the case's Playbook Runs page.
 */
export function ContainedTargetsSection({
  contained,
  undoing,
  onUndo,
}: ContainedTargetsSectionProps): React.JSX.Element | null {
  const { theme } = useTheme();

  if (contained.length === 0) {
    return null;
  }

  return (
    <ResponseSection
      title="Contained by playbooks"
      iconName="shield-half-outline"
      count={contained.length}
      testID="playbook-contained-section"
    >
      {contained.map((item: ContainedPlaybookTarget): React.JSX.Element => {
        const key: string = `${item.runId}-${item.stepId}-${item.target.value}`;
        const isUndoing: boolean =
          undoing !== null &&
          undoing.runId === item.runId &&
          undoing.stepId === item.stepId &&
          undoing.target.value === item.target.value;

        return (
          <View
            key={key}
            testID={`playbook-contained-${item.target.value}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              paddingVertical: spacing.md,
            }}
          >
            <Ionicons
              name={getEntityTerm(item.target.type).icon}
              size={18}
              color={theme.colors.textSecondary}
            />
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <Text
                selectable
                style={{
                  ...typography.subhead,
                  fontWeight: "600",
                  color: theme.colors.textPrimary,
                }}
              >
                {item.target.value}
              </Text>
              <Text
                style={{
                  ...typography.caption,
                  color: theme.colors.textSecondary,
                }}
              >
                {`${item.stepTitle} · ${
                  item.playbookName
                    ? `${item.playbookName}, step ${item.stepNumber}`
                    : `Step ${item.stepNumber}`
                }`}
              </Text>
            </View>
            <GradientButton
              testID={`playbook-undo-${item.target.value}`}
              label="Undo"
              icon="arrow-undo-outline"
              variant="secondary"
              size="sm"
              loading={isUndoing}
              disabled={undoing !== null}
              onPress={(): void => {
                onUndo(item);
              }}
            />
          </View>
        );
      })}
    </ResponseSection>
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
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.sm,
      }}
    >
      <Ionicons
        name={
          isProtected
            ? "shield-checkmark-outline"
            : getEntityTerm(target.type).icon
        }
        size={16}
        color={
          isProtected ? theme.colors.statusSuccess : theme.colors.textSecondary
        }
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
        <Text
          style={{ ...typography.caption, color: theme.colors.textSecondary }}
        >
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
 * alone - at least one stays, or the step is rejected instead. A step that
 * acts on one lists it with no box to untick, since leaving it out would
 * leave nothing to approve. Protected ones are listed and never acted on.
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
  // Only a choice between two or more is a choice: one target is the step's.
  const canLeaveTargetsOut: boolean = Boolean(step && step.proposed.length > 1);
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
        step ? `${isApproval ? "Approve" : "Reject"}: ${step.stepTitle}` : ""
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
            icon={
              isApproval ? "checkmark-circle-outline" : "close-circle-outline"
            }
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
              marginBottom: canLeaveTargetsOut ? 0 : spacing.sm,
            }}
          >
            Act on
          </Text>
          {canLeaveTargetsOut ? (
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
          ) : null}
          {step.proposed.map((target: PlaybookTarget): React.JSX.Element => {
            const key: string = target.value.toLowerCase();
            const checked: boolean = kept.has(key);

            if (!canLeaveTargetsOut) {
              return (
                <View
                  key={key}
                  testID={`playbook-target-fixed-${target.value}`}
                  style={{
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
                    backgroundColor: theme.colors.backgroundElevated,
                  }}
                >
                  <Ionicons
                    name={getEntityTerm(target.type).icon}
                    size={20}
                    color={theme.colors.textSecondary}
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
                    <Text
                      style={{
                        ...typography.caption,
                        color: theme.colors.textSecondary,
                      }}
                    >
                      {`${getEntityTerm(target.type).label} · ${describePlaybookTarget(target)}`}
                    </Text>
                  </View>
                </View>
              );
            }

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
              {`${PROTECTED_TARGETS_TITLE}: ${step.protectedTargets
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
        onChangeText={countTypingAsActivity(setComment)}
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
