import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  type ViewStyle,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useContentGutters } from "../layout/WindowLayout";
import type { ContentGutters } from "../layout/windowLayout";
import { useRefresh } from "../hooks/useRefresh";
import { useHaptics } from "../hooks/useHaptics";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useProjectUsers } from "../hooks/useProjectUsers";
import {
  isAccessDenied,
  useSecurityCasePriorities,
  useSecurityCaseStatuses,
} from "../hooks/useSecurityCases";
import {
  useCaseWaitingPlaybookRuns,
  useSecurityCaseDetail,
  useSecurityCaseFeed,
  useSecurityCaseNotes,
} from "../hooks/useSecurityCaseDetail";
import {
  createSecurityCaseNote,
  decidePlaybookStep,
  updateSecurityCase,
  type PlaybookDecision,
} from "../api/securityCases";
import {
  doesStatusCloseCase,
  findCaseValue,
  getCaseStatusOfStage,
  getCaseValueChoices,
  hasCaseStatusReached,
  isCaseStatusClosed,
  type CaseValueChoice,
} from "../security/caseValues";
import {
  getAssignWrite,
  getPriorityWrite,
  getStatusWrite,
  isAssignToMeOffered,
  isAssignToSomeoneElseOffered,
  isCaseAssignedTo,
  type CaseWrite,
} from "../security/caseChanges";
import {
  describeCaseSource,
  getAiVerdictTerm,
  readCaseEntities,
  type SecurityCaseVerdict,
  type SecurityEntity,
} from "../security/caseTerms";
import {
  didStartPlaybookRun,
  readWaitingPlaybookStep,
  type WaitingPlaybookStep,
} from "../security/playbookApproval";
import { getCaseGuidance, type CaseGuidance } from "../security/caseGuidance";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import { toPlainText } from "../utils/text";
import { getFriendlyErrorMessage } from "../utils/error";
import type { InboxStackParamList } from "../navigation/types";
import AddNoteModal from "../components/AddNoteModal";
import EmptyState from "../components/EmptyState";
import FeedTimeline from "../components/FeedTimeline";
import MarkdownContent from "../components/MarkdownContent";
import NotesSection from "../components/NotesSection";
import QueryErrorNotice from "../components/QueryErrorNotice";
import UserPickerModal from "../components/UserPickerModal";
import {
  ResponseActions,
  ResponseDetailHeader,
  ResponseDetailSkeleton,
  ResponseGuidance,
  ResponseSection,
  describeResponseAge,
  type ResponseAction,
} from "../components/ResponseDetailLayout";
import {
  getCaseNumber,
  getPersonName,
} from "../components/SecurityCaseCard";
import {
  CaseAiSection,
  CaseEntitiesSection,
  CaseFieldRow,
} from "../components/security/CaseSections";
import {
  CaseValueSheet,
  CloseCaseSheet,
} from "../components/security/CaseChangeSheets";
import {
  PlaybookApprovalCard,
  PlaybookDecisionSheet,
} from "../components/security/PlaybookApproval";
import type {
  ProjectUserItem,
  SecurityCaseFeedItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
  SecurityPlaybookRunItem,
} from "../api/types";

type Props = NativeStackScreenProps<InboxStackParamList, "SecurityCaseDetail">;

type OpenSheet =
  | { kind: "status" }
  | { kind: "priority" }
  | { kind: "assign" }
  | { kind: "close"; status: SecurityCaseStatusItem };

/*
 * "Assign to me" with its icon is wider than the response actions' usual
 * minimum: from here they stack on a phone instead of breaking the label
 * across two lines, and sit side by side where a pane has room.
 */
export const CASE_ACTION_MIN_WIDTH: number = 180;

/*
 * The timeline entry OneUptime AI's triage writes holds its whole report,
 * which the OneUptime AI section draws already; the timeline lists the rest.
 */
const AI_TRIAGE_FEED_EVENT: string = "AiTriage";

/**
 * One security case, as the analyst a page woke reads and works it: any
 * playbook step waiting for their approval first, then who has the case and
 * the next step, what OneUptime AI made of it, what it is about, its facts -
 * the status, priority and assignee among them a tap from being changed -
 * and its timeline and notes. Building rules and playbooks, hunting through
 * events and the rest of Security Events stay on the web.
 */
export default function SecurityCaseDetailScreen({
  route,
  navigation,
}: Props): React.JSX.Element {
  const { caseId, projectId } = route.params;
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const queryClient: QueryClient = useQueryClient();
  const { successFeedback, errorFeedback } = useHaptics();
  const userId: string | null = useCurrentUserId();

  const caseQuery: ReturnType<typeof useSecurityCaseDetail> =
    useSecurityCaseDetail(projectId, caseId);
  const securityCase: SecurityCaseItem | null | undefined = caseQuery.data;
  const exists: boolean = Boolean(securityCase);
  const statusesQuery: ReturnType<typeof useSecurityCaseStatuses> =
    useSecurityCaseStatuses(projectId);
  const prioritiesQuery: ReturnType<typeof useSecurityCasePriorities> =
    useSecurityCasePriorities(projectId);
  const feedQuery: ReturnType<typeof useSecurityCaseFeed> =
    useSecurityCaseFeed(projectId, caseId, exists);
  const notesQuery: ReturnType<typeof useSecurityCaseNotes> =
    useSecurityCaseNotes(projectId, caseId, exists);
  const runsQuery: ReturnType<typeof useCaseWaitingPlaybookRuns> =
    useCaseWaitingPlaybookRuns(projectId, caseId, exists);

  const [busy, setBusy] = useState<boolean>(false);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [decision, setDecision] = useState<{
    step: WaitingPlaybookStep;
    decision: PlaybookDecision;
  } | null>(null);
  const [deciding, setDeciding] = useState<boolean>(false);
  const [noteModalVisible, setNoteModalVisible] = useState<boolean>(false);
  const [submittingNote, setSubmittingNote] = useState<boolean>(false);
  const isAssignSheetOpen: boolean = sheet?.kind === "assign";
  // The project's people, read once Assign to someone else is opened.
  const { users, isLoading: usersLoading } = useProjectUsers(
    isAssignSheetOpen ? projectId : null,
  );

  const statuses: Array<SecurityCaseStatusItem> = statusesQuery.data ?? [];
  const priorities: Array<SecurityCasePriorityItem> =
    prioritiesQuery.data ?? [];

  const waitingSteps: Array<WaitingPlaybookStep> = useMemo(() => {
    return (runsQuery.data ?? [])
      .map((run: SecurityPlaybookRunItem): WaitingPlaybookStep | null => {
        return readWaitingPlaybookStep(run);
      })
      .filter((step: WaitingPlaybookStep | null): boolean => {
        return step !== null;
      }) as Array<WaitingPlaybookStep>;
  }, [runsQuery.data]);

  const timeline: Array<SecurityCaseFeedItem> = useMemo(() => {
    return (feedQuery.data ?? []).filter(
      (entry: SecurityCaseFeedItem): boolean => {
        return entry.securityCaseFeedEventType !== AI_TRIAGE_FEED_EVENT;
      },
    );
  }, [feedQuery.data]);

  const refreshLists: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["security-cases", projectId] }),
        queryClient.invalidateQueries({
          queryKey: ["security-cases-open-count", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["security-playbook-runs-waiting", projectId],
        }),
      ]);
    }, [queryClient, projectId]);

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    await Promise.allSettled([
      caseQuery.refetch(),
      statusesQuery.refetch(),
      prioritiesQuery.refetch(),
      feedQuery.refetch(),
      notesQuery.refetch(),
      runsQuery.refetch(),
    ]);
  });

  /*
   * One change to the case, as the dashboard makes it. Not drawn ahead of
   * the server: a change refused (a role, a case closed or deleted a moment
   * ago) must not flash on screen as if it had happened. Whatever the
   * answer, the case is read again, so the screen shows where it really is.
   */
  const applyChange: (
    write: CaseWrite,
    failureTitle: string,
  ) => Promise<boolean> = useCallback(
    async (write: CaseWrite, failureTitle: string): Promise<boolean> => {
      setBusy(true);
      try {
        await updateSecurityCase(projectId, caseId, write);
        await successFeedback();
        await Promise.allSettled([caseQuery.refetch(), feedQuery.refetch()]);
        await refreshLists();
        return true;
      } catch (error: unknown) {
        await errorFeedback();
        Alert.alert(failureTitle, getFriendlyErrorMessage(error));
        await Promise.allSettled([caseQuery.refetch()]);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId, caseId, caseQuery, feedQuery, refreshLists],
  );

  const decide: (data: {
    comment: string;
    targets: Array<string> | undefined;
  }) => Promise<void> = useCallback(
    async (data: {
      comment: string;
      targets: Array<string> | undefined;
    }): Promise<void> => {
      if (!decision) {
        return;
      }
      setDeciding(true);
      try {
        await decidePlaybookStep(
          projectId,
          decision.step.runId,
          decision.decision,
          {
            comment: data.comment,
            targets: data.targets,
          },
        );
        await successFeedback();
        setDecision(null);
      } catch (error: unknown) {
        await errorFeedback();
        /*
         * The usual reason is that somebody decided a moment ago, or the
         * run was cancelled: the server says which. The runs are read
         * again below, so a step that is no longer waiting leaves the
         * screen with the sheet.
         */
        setDecision(null);
        Alert.alert(
          decision.decision === "approve"
            ? "Could not approve the step"
            : "Could not reject the step",
          getFriendlyErrorMessage(error),
        );
      } finally {
        setDeciding(false);
        await Promise.allSettled([
          runsQuery.refetch(),
          feedQuery.refetch(),
          caseQuery.refetch(),
        ]);
        await refreshLists();
      }
    },
    [decision, projectId, runsQuery, feedQuery, caseQuery, refreshLists],
  );

  const addNote: (note: string) => Promise<void> = useCallback(
    async (note: string): Promise<void> => {
      setSubmittingNote(true);
      try {
        await createSecurityCaseNote(projectId, caseId, note);
        await Promise.allSettled([notesQuery.refetch(), feedQuery.refetch()]);
        setNoteModalVisible(false);
      } catch (error: unknown) {
        Alert.alert("Could not add the note", getFriendlyErrorMessage(error));
      } finally {
        setSubmittingNote(false);
      }
    },
    [projectId, caseId, notesQuery, feedQuery],
  );

  const placeholderContainerStyle: ViewStyle = {
    padding: spacing.xl,
    ...gutters,
    paddingBottom: bottomPadding,
    flexGrow: 1,
  };

  if (caseQuery.isLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={placeholderContainerStyle}
      >
        <ResponseDetailSkeleton />
      </ScrollView>
    );
  }

  /*
   * Nothing to show, and the reasons are not the same reason. A page lands
   * here: a request that failed says so and offers another go, a refusal
   * says the case is not the reader's to see, and only a request that
   * succeeded and found nothing may say the case is gone.
   */
  if (!securityCase) {
    if (caseQuery.isError && isAccessDenied(caseQuery.error)) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
          contentContainerStyle={placeholderContainerStyle}
        >
          <EmptyState
            title="You cannot see this case"
            subtitle="Your role in this project does not include this security case. A project admin can give you a Security role."
            icon="access"
          />
        </ScrollView>
      );
    }

    if (caseQuery.isError) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
          contentContainerStyle={placeholderContainerStyle}
        >
          <EmptyState
            title="Something went wrong"
            subtitle="This case could not be loaded, which is not the same as it no longer existing. Try again."
            icon="error"
            actionLabel="Retry"
            onAction={(): void => {
              void caseQuery.refetch();
            }}
          />
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={placeholderContainerStyle}
      >
        <EmptyState
          title="Case not found"
          subtitle="This case no longer exists, or it is not part of this project."
          icon="security"
        />
      </ScrollView>
    );
  }

  const caseNumber: string = getCaseNumber(securityCase) || "This case";
  const statusId: string | null =
    securityCase.securityCaseStatusId ??
    securityCase.securityCaseStatus?._id ??
    null;
  const priorityId: string | null =
    securityCase.securityCasePriorityId ??
    securityCase.securityCasePriority?._id ??
    null;
  const status: SecurityCaseStatusItem | null =
    findCaseValue(statuses, statusId) ?? securityCase.securityCaseStatus ?? null;
  const priority: SecurityCasePriorityItem | null =
    findCaseValue(priorities, priorityId) ??
    securityCase.securityCasePriority ??
    null;
  const statusesKnown: boolean = statuses.length > 0;
  /*
   * Closed by the project's own list when it has been read; until then by
   * the server's own stamp, which it clears when a case is reopened.
   */
  const isClosed: boolean = statusesKnown
    ? isCaseStatusClosed(statuses, statusId)
    : Boolean(securityCase.closedAt);
  const isMine: boolean = isCaseAssignedTo(
    securityCase.assignedToUserId,
    userId,
  );
  const assigneeName: string = getPersonName(securityCase.assignedToUser);
  const teamName: string = toPlainText(securityCase.assignedToTeam?.name);
  const guidance: CaseGuidance = getCaseGuidance({
    isClosed,
    isMine,
    hasAssignee: Boolean(securityCase.assignedToUserId),
    assigneeName,
    isContained: hasCaseStatusReached(statuses, statusId, "Contained"),
    verdict: securityCase.verdict,
  });
  const closedStatus: SecurityCaseStatusItem | undefined = getCaseStatusOfStage(
    statuses,
    "Closed",
  );
  const reopenStatus: SecurityCaseStatusItem | undefined = getCaseStatusOfStage(
    statuses,
    "Acknowledged",
  );
  const canAssignToMe: boolean =
    statusesKnown &&
    isAssignToMeOffered({
      statuses,
      statusId,
      assignedToUserId: securityCase.assignedToUserId,
      userId,
    });
  const canAssignToSomeoneElse: boolean =
    statusesKnown && isAssignToSomeoneElseOffered({ statuses, statusId });
  const entities: Array<SecurityEntity> = readCaseEntities(
    securityCase.entities,
  );
  const suggestedVerdict: SecurityCaseVerdict | undefined = getAiVerdictTerm(
    securityCase.aiVerdict,
  )?.suggestedCloseVerdict;
  const suggestedPriority: SecurityCasePriorityItem | undefined =
    findCaseValue(priorities, securityCase.aiSuggestedSecurityCasePriorityId);
  const offerSuggestedPriority: boolean =
    Boolean(suggestedPriority) &&
    String(suggestedPriority?._id).toLowerCase() !==
      String(priorityId ?? "").toLowerCase();

  const openClose: (target: SecurityCaseStatusItem) => void = (
    target: SecurityCaseStatusItem,
  ): void => {
    setSheet({ kind: "close", status: target });
  };

  const actions: Array<ResponseAction> = [];

  if (canAssignToMe && userId) {
    actions.push({
      label: "Assign to me",
      accessibilityLabel: `Assign ${caseNumber} to me`,
      icon: "person-add-outline",
      primary: guidance.stage === "unassigned",
      onPress: async (): Promise<void> => {
        await applyChange(getAssignWrite(userId), "Could not assign the case");
      },
    });
  }

  if (!isClosed && closedStatus) {
    actions.push({
      label: "Close case",
      accessibilityLabel: `Close ${caseNumber}`,
      icon: "checkmark-circle-outline",
      primary: guidance.stage === "mine",
      onPress: (): void => {
        openClose(closedStatus);
      },
    });
  }

  if (isClosed && reopenStatus) {
    actions.push({
      label: "Reopen",
      accessibilityLabel: `Reopen ${caseNumber}`,
      icon: "refresh-outline",
      primary: true,
      onPress: async (): Promise<void> => {
        await applyChange(
          getStatusWrite({
            statuses,
            fromStatusId: statusId,
            pick: { statusId: reopenStatus._id },
          }),
          "Could not reopen the case",
        );
      },
    });
  }

  const pickStatus: (target: SecurityCaseStatusItem) => void = (
    target: SecurityCaseStatusItem,
  ): void => {
    if (
      doesStatusCloseCase({
        statuses,
        fromStatusId: statusId,
        toStatusId: target._id,
      })
    ) {
      openClose(target);
      return;
    }
    setSheet(null);
    void applyChange(
      getStatusWrite({
        statuses,
        fromStatusId: statusId,
        pick: { statusId: target._id },
      }),
      "Could not change the status",
    );
  };

  const statusChoices: Array<CaseValueChoice<SecurityCaseStatusItem>> =
    getCaseValueChoices(statuses, statusId);
  const priorityChoices: Array<CaseValueChoice<SecurityCasePriorityItem>> =
    getCaseValueChoices(priorities, priorityId);

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        testID="security-case-detail-scroll"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.xl,
          ...gutters,
          paddingBottom: bottomPadding,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
            colors={[theme.colors.actionPrimary]}
            progressBackgroundColor={theme.colors.backgroundElevated}
          />
        }
      >
        <ResponseDetailHeader
          title={securityCase.title}
          kind="Security case"
          number={getCaseNumber(securityCase)}
          state={toPlainText(status?.name) || undefined}
          stateColor={
            status?.color ? rgbToHex(status.color) : theme.colors.textTertiary
          }
          severity={toPlainText(priority?.name) || undefined}
          severityColor={
            priority?.color ? rgbToHex(priority.color) : undefined
          }
          meta={
            securityCase.lastDetectedAt
              ? describeResponseAge(
                  "Last detected",
                  securityCase.lastDetectedAt,
                )
              : describeResponseAge("Opened", securityCase.createdAt)
          }
        />

        {runsQuery.isError ? (
          <QueryErrorNotice
            message="Could not check for playbook steps waiting for your approval."
            retryLabel="Retry approvals"
            onRetry={runsQuery.refetch}
          />
        ) : null}
        {waitingSteps.map((step: WaitingPlaybookStep): React.JSX.Element => {
          return (
            <PlaybookApprovalCard
              key={step.runId}
              step={step}
              isOwnRun={didStartPlaybookRun(step, userId)}
              busy={deciding && decision?.step.runId === step.runId}
              onDecide={(next: PlaybookDecision): void => {
                setDecision({ step, decision: next });
              }}
            />
          );
        })}

        {statusesQuery.isError ? (
          <QueryErrorNotice
            message="Unable to load the project's case statuses, which the response actions need."
            retryLabel="Retry statuses"
            onRetry={statusesQuery.refetch}
          />
        ) : null}
        <ResponseGuidance
          tone={guidance.tone}
          icon={guidance.icon}
          title={guidance.title}
          message={guidance.message}
        >
          {actions.length > 0 ? (
            <ResponseActions
              actions={actions}
              busy={busy}
              minWidth={CASE_ACTION_MIN_WIDTH}
              style={{ marginBottom: 0 }}
            />
          ) : null}
        </ResponseGuidance>

        <CaseAiSection
          aiVerdict={securityCase.aiVerdict}
          report={securityCase.aiTriageReport}
          triagedAt={securityCase.aiTriagedAt}
          promptInjectionSuspected={
            securityCase.aiTriagePromptInjectionSuspected === true
          }
          suggestedPriority={
            offerSuggestedPriority ? suggestedPriority : undefined
          }
          busy={busy}
          onSetSuggestedPriority={(): void => {
            if (suggestedPriority) {
              void applyChange(
                getPriorityWrite(suggestedPriority._id),
                "Could not change the priority",
              );
            }
          }}
        />

        <CaseEntitiesSection entities={entities} />

        <ResponseSection
          title="Details"
          iconName="information-circle-outline"
          testID="case-details-section"
        >
          <CaseFieldRow
            testID="case-field-status"
            label="Status"
            value={toPlainText(status?.name) || "Unknown"}
            dotColor={status?.color ? rgbToHex(status.color) : undefined}
            onPress={
              statusesKnown
                ? (): void => {
                    setSheet({ kind: "status" });
                  }
                : undefined
            }
            accessibilityHint="Opens the statuses this case can move to"
          />
          <CaseFieldRow
            testID="case-field-priority"
            label="Priority"
            value={toPlainText(priority?.name) || "Unknown"}
            dotColor={priority?.color ? rgbToHex(priority.color) : undefined}
            onPress={
              priorities.length > 0
                ? (): void => {
                    setSheet({ kind: "priority" });
                  }
                : undefined
            }
            accessibilityHint="Opens the project's case priorities"
          />
          <CaseFieldRow
            testID="case-field-assignee"
            label="Assigned to"
            value={
              isMine
                ? "You"
                : assigneeName ||
                  (securityCase.assignedToUserId ? "Someone" : "Nobody yet")
            }
            onPress={
              canAssignToSomeoneElse
                ? (): void => {
                    setSheet({ kind: "assign" });
                  }
                : undefined
            }
            accessibilityHint="Opens the people this case can be assigned to"
          />
          {teamName ? (
            <CaseFieldRow label="Team" value={teamName} />
          ) : null}
          {describeCaseSource(securityCase.source) ? (
            <CaseFieldRow
              label="Opened by"
              value={describeCaseSource(securityCase.source)}
            />
          ) : null}
          <CaseFieldRow
            label="Detections"
            value={String(securityCase.detectionCount ?? 0)}
          />
          {securityCase.firstDetectedAt ? (
            <CaseFieldRow
              label="First detected"
              value={formatDateTime(securityCase.firstDetectedAt)}
            />
          ) : null}
          {securityCase.lastDetectedAt ? (
            <CaseFieldRow
              label="Last detected"
              value={formatDateTime(securityCase.lastDetectedAt)}
            />
          ) : null}
          <CaseFieldRow
            label="Opened"
            value={formatDateTime(securityCase.createdAt)}
          />
          {isClosed && securityCase.verdict ? (
            <CaseFieldRow
              testID="case-field-verdict"
              label="Verdict"
              value={securityCase.verdict}
            />
          ) : null}
          {securityCase.incidentId ? (
            <CaseFieldRow
              testID="case-field-incident"
              label="Incident"
              value="Open the incident declared for this case"
              onPress={(): void => {
                navigation.navigate("IncidentDetail", {
                  incidentId: securityCase.incidentId as string,
                  projectId,
                });
              }}
              accessibilityHint="Opens the incident"
            />
          ) : null}
        </ResponseSection>

        {isClosed && securityCase.closingNote ? (
          <ResponseSection
            title="Closing note"
            iconName="checkmark-done-outline"
            testID="case-closing-note"
          >
            <MarkdownContent content={securityCase.closingNote} />
          </ResponseSection>
        ) : null}

        {securityCase.description ? (
          <ResponseSection
            title="Description"
            iconName="document-text-outline"
            testID="case-description"
          >
            <MarkdownContent content={securityCase.description} />
          </ResponseSection>
        ) : null}

        {feedQuery.isError ? (
          <QueryErrorNotice
            message="Unable to load the case's timeline."
            retryLabel="Retry timeline"
            onRetry={feedQuery.refetch}
          />
        ) : null}
        {timeline.length > 0 ? (
          <ResponseSection
            title="Timeline"
            iconName="pulse-outline"
            testID="case-timeline"
          >
            <FeedTimeline feed={timeline} />
          </ResponseSection>
        ) : null}

        <NotesSection
          notes={notesQuery.data}
          setNoteModalVisible={setNoteModalVisible}
          isLoading={notesQuery.isLoading}
          isError={notesQuery.isError}
          onRetry={notesQuery.refetch}
        />
      </ScrollView>

      <CaseValueSheet
        visible={sheet?.kind === "status"}
        kind="status"
        caseNumber={caseNumber}
        choices={statusChoices}
        onPick={(value: SecurityCaseStatusItem | SecurityCasePriorityItem) => {
          pickStatus(value as SecurityCaseStatusItem);
        }}
        onClose={(): void => {
          setSheet(null);
        }}
      />
      <CaseValueSheet
        visible={sheet?.kind === "priority"}
        kind="priority"
        caseNumber={caseNumber}
        choices={priorityChoices}
        suggestedId={securityCase.aiSuggestedSecurityCasePriorityId}
        onPick={(value: SecurityCaseStatusItem | SecurityCasePriorityItem) => {
          setSheet(null);
          void applyChange(
            getPriorityWrite(value._id),
            "Could not change the priority",
          );
        }}
        onClose={(): void => {
          setSheet(null);
        }}
      />
      <CloseCaseSheet
        visible={sheet?.kind === "close"}
        caseNumber={caseNumber}
        statusName={
          sheet?.kind === "close" ? toPlainText(sheet.status.name) : ""
        }
        suggestedVerdict={suggestedVerdict}
        submitting={busy}
        onSubmit={(pick: {
          verdict: SecurityCaseVerdict;
          closingNote: string;
        }): void => {
          if (sheet?.kind !== "close") {
            return;
          }
          const target: SecurityCaseStatusItem = sheet.status;
          void applyChange(
            getStatusWrite({
              statuses,
              fromStatusId: statusId,
              pick: {
                statusId: target._id,
                verdict: pick.verdict,
                closingNote: pick.closingNote,
              },
            }),
            "Could not close the case",
          ).then((closed: boolean): void => {
            if (closed) {
              setSheet(null);
            }
          });
        }}
        onClose={(): void => {
          setSheet(null);
        }}
      />
      <UserPickerModal
        visible={isAssignSheetOpen}
        title={`Assign ${caseNumber}`}
        users={users}
        isLoading={usersLoading}
        selectedUserId={securityCase.assignedToUserId ?? null}
        onSelect={(user: ProjectUserItem): void => {
          setSheet(null);
          if (isCaseAssignedTo(securityCase.assignedToUserId, user.userId)) {
            return;
          }
          void applyChange(
            getAssignWrite(user.userId),
            "Could not assign the case",
          );
        }}
        onClose={(): void => {
          setSheet(null);
        }}
      />
      <PlaybookDecisionSheet
        step={decision?.step ?? null}
        decision={decision?.decision ?? null}
        submitting={deciding}
        onSubmit={(data: {
          comment: string;
          targets: Array<string> | undefined;
        }): void => {
          void decide(data);
        }}
        onClose={(): void => {
          if (!deciding) {
            setDecision(null);
          }
        }}
      />
      <AddNoteModal
        visible={noteModalVisible}
        onClose={(): void => {
          setNoteModalVisible(false);
        }}
        onSubmit={(note: string): void => {
          void addNote(note);
        }}
        isSubmitting={submittingNote}
        footnote="Notes stay on the case. Only people who can see security cases read them."
      />
    </>
  );
}
