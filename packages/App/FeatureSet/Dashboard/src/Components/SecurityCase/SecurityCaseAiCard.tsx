import AppLink from "../AppLink/AppLink";
import {
  getSettingsAction,
  SettingsAction,
} from "../AI/InvestigationNotStarted";
import InvestigationNotice, {
  NOTICE_ICON_CLASS_NAME,
  noticeFailedIcon,
} from "../AI/InvestigationNotice";
import InvestigationStatusBadge, {
  InvestigationStatusIndicator,
  renderInvestigationStatusIndicator,
} from "../AI/InvestigationStatusBadge";
import { EvidenceFocusRequest } from "../AI/InvestigationReport/InvestigationEvidenceList";
import InvestigationReportView from "../AI/InvestigationReport/InvestigationReportView";
import InvestigationRunDetails from "../AI/InvestigationReport/InvestigationRunDetails";
import SecurityCaseApi from "./SecurityCaseApi";
import {
  SecurityCaseAiCopy,
  SecurityCaseAiCreditsAction,
  SecurityCaseAiReasonAction,
  SecurityCaseAiResult,
  SecurityCaseAiStage,
  SecurityCaseAiTriageAccess,
  SecurityCaseTriageStatusView,
  SecurityCaseTriageStep,
  canStartTriage,
  didLatestTriageNotFinish,
  getFailedTriageDescription,
  getSecurityCaseAiBadge,
  getSecurityCaseAiCreditsAction,
  getSecurityCaseAiReasonAction,
  getSecurityCaseAiStage,
  getSecurityCaseAiTriageAccess,
  getSecurityCaseAiStepLabel,
  getSecurityCaseAiVerdictSentence,
  getSuggestedPlaybookRunInProgress,
  isBlockingTriageReason,
  isTriageOnItsWay,
  readSecurityCaseAiResult,
  shouldOfferSuggestedPriority,
  withoutTriageInjectionLead,
} from "./SecurityCaseAiTriage";
import {
  SecurityCaseAiVerdictPill,
  SecurityCasePriorityPill,
  SecurityPlaybookRunStatusPill,
} from "./SecurityCasePills";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import { RUN_POLL_INTERVAL_IN_MS } from "../SecurityPlaybook/useSecurityPlaybookRuns";
import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  ParsedInvestigationReport,
  parseInvestigationReport,
} from "Common/Utils/AI/InvestigationReport";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useAiOffered from "../../Utils/UseAiOffered";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const SECURITY_CASE_AI_CARD_ID: string = "security-case-ai-card";

/*
 * Every button in the card sits on the content's left edge and keeps its
 * row's gap: Button carries md:ml-3 for dialog footers, which pushed the
 * first button of each row 12px in from the text above it.
 */
const CARD_BUTTON_CLASS_NAME: string = "!ml-0";

// How often the card asks while a triage is on its way.
export const SECURITY_CASE_AI_POLL_INTERVAL_MS: number = 3000;
// The latest steps the card lists while a triage runs.
export const SECURITY_CASE_AI_STEPS_SHOWN: number = 5;

export interface ComponentProps {
  securityCase: SecurityCase;
  // The project's case priorities: the suggested one is drawn as it names it.
  priorities: ReadonlyArray<SecurityCasePriority>;
  /*
   * Bumped by the page when a playbook run starts or moves on, so whether
   * the suggested playbook is already running on the case is read again.
   */
  refreshToggle?: string | undefined;
  // The case was read again with the triage's result on it.
  onTriaged: () => void;
  // Sets the case's priority to the one OneUptime AI suggested.
  onSetPriority: (priority: SecurityCasePriority) => void;
  // Opens Run Playbook with the suggested playbook picked.
  onRunPlaybook: (playbookId: ObjectID) => void;
  isWorking?: boolean | undefined;
}

/*
 * THE CASE'S ONE AI CARD: what OneUptime AI made of the case, and the one
 * place to ask it.
 *
 *   - Not triaged yet: what a triage does, and Triage with AI - or what
 *     stops one (no LLM provider, no credits, the daily limit), with where
 *     to fix it.
 *   - Triaging: what it is doing, check by check. It changes nothing.
 *   - Triaged: OneUptime AI's read (its pill), the priority and playbook it
 *     suggests - each one click, through the case's own actions (Set
 *     priority, Run Playbook and that playbook's approvals; a playbook
 *     already running on the case shows its run's status instead) - and its report
 *     with every claim cited: a citation opens the check behind it under
 *     Evidence checked, with the rows it read, re-run with the reader's own
 *     permissions. Ask about this case opens Ask AI on the case.
 *   - Failed: what happened, and Try again.
 *
 * Someone who cannot start a triage (a Security Viewer) reads all of it:
 * Triage with AI and Try again stay greyed with who can beside them, and
 * Triage again and Set priority are not offered.
 *
 * With the project's AI off the card is not drawn at all. Like the incident
 * page's AI card, nothing inside it is a box: hairlines and notices.
 */
const SecurityCaseAiCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const caseId: string = props.securityCase._id?.toString() || "";

  const [status, setStatus] = useState<SecurityCaseTriageStatusView | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string>("");
  const [startError, setStartError] = useState<string>("");
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [playbookName, setPlaybookName] = useState<string | null>(null);
  // The suggested playbook's run still going on this case, if one is.
  const [suggestedPlaybookRun, setSuggestedPlaybookRun] =
    useState<SecurityPlaybookRunStatus | null>(null);
  // Bumped to read that run again while it is still going.
  const [suggestedRunCheck, setSuggestedRunCheck] = useState<number>(0);
  const [focusRequest, setFocusRequest] = useState<EvidenceFocusRequest | null>(
    null,
  );
  const focusRequestCounterRef: React.MutableRefObject<number> =
    useRef<number>(0);

  const result: SecurityCaseAiResult = useMemo((): SecurityCaseAiResult => {
    return readSecurityCaseAiResult(props.securityCase);
  }, [
    props.securityCase.aiVerdict,
    props.securityCase.aiSuggestedSecurityCasePriorityId?.toString(),
    props.securityCase.aiSuggestedPlaybookId?.toString(),
    props.securityCase.aiTriageReport,
    props.securityCase.aiTriagedAt?.toString(),
    props.securityCase.aiTriagePromptInjectionSuspected,
  ]);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Update,
  );

  const onTriagedRef: React.MutableRefObject<() => void> = useRef<() => void>(
    props.onTriaged,
  );
  onTriagedRef.current = props.onTriaged;

  // Whether the last answer had a triage on its way: its end reloads the case.
  const wasOnItsWayRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!caseId || !ObjectID.isValidUUID(caseId)) {
      return;
    }

    try {
      const next: SecurityCaseTriageStatusView =
        await SecurityCaseApi.getAiTriage(new ObjectID(caseId));
      const isOnItsWay: boolean = isTriageOnItsWay(next);

      setStatus(next);
      setLoadError("");

      if (wasOnItsWayRef.current && !isOnItsWay) {
        // The triage just settled: read the case again for its result.
        onTriagedRef.current();
      }

      wasOnItsWayRef.current = isOnItsWay;
    } catch (error) {
      setLoadError(API.getFriendlyMessage(error));
    }
  }, [caseId]);

  useEffect(() => {
    if (!isAiOffered) {
      return;
    }

    void load();
  }, [isAiOffered, load, result.triagedAt?.getTime()]);

  // Poll while a triage is on its way.
  const isOnItsWay: boolean = isTriageOnItsWay(status);

  useEffect(() => {
    if (!isAiOffered || !isOnItsWay) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void load();
    }, SECURITY_CASE_AI_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isAiOffered, isOnItsWay, load]);

  // The suggested playbook's name, read with the viewer's permissions.
  useEffect(() => {
    const playbookId: string | undefined = result.suggestedPlaybookId;

    if (!isAiOffered || !playbookId || !ObjectID.isValidUUID(playbookId)) {
      setPlaybookName(null);
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getItem<SecurityPlaybook>({
      modelType: SecurityPlaybook,
      id: new ObjectID(playbookId),
      select: { name: true, isEnabled: true },
    })
      .then((playbook: SecurityPlaybook | null) => {
        if (isCurrent) {
          setPlaybookName(
            playbook && playbook.isEnabled !== false
              ? playbook.name || null
              : null,
          );
        }
      })
      .catch(() => {
        if (isCurrent) {
          setPlaybookName(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [isAiOffered, result.suggestedPlaybookId]);

  /*
   * Whether the suggested playbook is already on its way on this case (its
   * latest run here, not finished): then the card shows that run's status
   * in place of Run playbook, which would start a second run asking for the
   * same approval again. Read again when the page says a run started or
   * moved on, and every few seconds while that run is still going - as
   * Playbook Runs below is - so its end brings Run playbook back.
   */
  useEffect(() => {
    const playbookId: string | undefined = result.suggestedPlaybookId;

    if (
      !isAiOffered ||
      !playbookId ||
      !ObjectID.isValidUUID(playbookId) ||
      !ObjectID.isValidUUID(caseId)
    ) {
      setSuggestedPlaybookRun(null);
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getList<SecurityPlaybookRun>({
      modelType: SecurityPlaybookRun,
      query: {
        securityCaseId: new ObjectID(caseId),
        securityPlaybookId: new ObjectID(playbookId),
      },
      select: { _id: true, status: true },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
    })
      .then((runs: ListResult<SecurityPlaybookRun>) => {
        if (isCurrent) {
          setSuggestedPlaybookRun(
            getSuggestedPlaybookRunInProgress(runs.data[0]?.status),
          );
        }
      })
      .catch(() => {
        // Not knowing leaves Run playbook, as before the run was read.
        if (isCurrent) {
          setSuggestedPlaybookRun(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    isAiOffered,
    caseId,
    result.suggestedPlaybookId,
    props.refreshToggle,
    suggestedRunCheck,
  ]);

  useEffect(() => {
    if (!suggestedPlaybookRun) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setSuggestedRunCheck((count: number): number => {
        return count + 1;
      });
    }, RUN_POLL_INTERVAL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [suggestedPlaybookRun]);

  /*
   * The report as drawn: without the runner's own heads-up about text
   * written to steer an AI, which the card says first in the reader's
   * language. Copy report keeps it (InvestigationReportView copies
   * result.report).
   */
  const report: ParsedInvestigationReport | null = useMemo(() => {
    if (!result.report) {
      return null;
    }

    return parseInvestigationReport(
      result.promptInjectionSuspected
        ? withoutTriageInjectionLead(result.report)
        : result.report,
    );
  }, [result.report, result.promptInjectionSuspected]);

  // A citation chip opens the check behind it under Evidence checked.
  const focusCitation: (citationId: string) => void = useCallback(
    (citationId: string): void => {
      focusRequestCounterRef.current += 1;
      setFocusRequest({
        citationId,
        requestId: focusRequestCounterRef.current,
      });
    },
    [],
  );

  const loadEvidenceRows: (data: {
    runId: string;
    citationId: string;
  }) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> = useCallback(
    async (data: {
      runId: string;
      citationId: string;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return await SecurityCaseApi.loadAiTriageEvidenceRows({
        caseId: new ObjectID(caseId),
        runId: data.runId,
        citationId: data.citationId,
      });
    },
    [caseId],
  );

  if (!isAiOffered) {
    return <></>;
  }

  const stage: SecurityCaseAiStage = getSecurityCaseAiStage({
    status,
    result,
  });

  const startTriage: () => Promise<void> = async (): Promise<void> => {
    setIsStarting(true);
    setStartError("");

    try {
      await SecurityCaseApi.startAiTriage(new ObjectID(caseId));
      wasOnItsWayRef.current = true;
      await load();
    } catch (error) {
      setStartError(API.getFriendlyMessage(error));
    }

    setIsStarting(false);
  };

  const askAboutCase: () => void = (): void => {
    GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, {
      prompt: translator.translateText(SecurityCaseAiCopy.askPrompt) || "",
    });
  };

  const badge: { text: string; indicator: InvestigationStatusIndicator } =
    getSecurityCaseAiBadge({ stage, hasStatus: status !== null });

  // When the triage finished, as every time on a timeline reads.
  const clock: FeedClock = getFeedClock({ language: translator.language });

  /*
   * Who is reading, as the permission gate knows it: someone who may start
   * a triage, someone known not to (the gate says why), or neither yet -
   * the permissions are on their way, and nobody is told they cannot do
   * what they may (PermissionGateResult).
   */
  const triageAccess: SecurityCaseAiTriageAccess =
    getSecurityCaseAiTriageAccess(updateGate);
  const canStart: boolean =
    canStartTriage(status) && triageAccess === SecurityCaseAiTriageAccess.Yes;

  /*
   * Triage with AI or Try again: the card's one action. Someone known not
   * to be able to start a triage sees it greyed, with who can beside it
   * (renderWhoCanTriage), as the Security overview's set-up buttons do.
   */
  const triageButton: (title: string, isPrimary: boolean) => ReactElement = (
    title: string,
    isPrimary: boolean,
  ): ReactElement => {
    if (triageAccess === SecurityCaseAiTriageAccess.NotKnownYet) {
      return <></>;
    }

    return (
      <Button
        title={title}
        icon={IconProp.Sparkles}
        buttonStyle={
          isPrimary ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
        }
        buttonSize={isPrimary ? ButtonSize.Normal : ButtonSize.Small}
        isLoading={isStarting}
        disabled={!canStart || isStarting}
        className={CARD_BUTTON_CLASS_NAME}
        tooltip={
          triageAccess === SecurityCaseAiTriageAccess.No
            ? updateGate.disabledReason
            : undefined
        }
        onClick={() => {
          void startTriage();
        }}
        dataTestId="security-case-ai-triage-button"
      />
    );
  };

  // Who can start a triage, said beside the greyed button.
  const renderWhoCanTriage: () => ReactElement = (): ReactElement => {
    if (triageAccess !== SecurityCaseAiTriageAccess.No) {
      return <></>;
    }

    return (
      <span
        className="text-sm text-gray-500"
        data-testid="security-case-ai-who-can-triage"
      >
        {translator.translateText(SecurityCaseAiCopy.whoCanTriage)}
      </span>
    );
  };

  const reasonCode: SecurityCaseTriageStatusView["notStartedCode"] =
    status?.notStartedCode || null;
  const reasonAction: SecurityCaseAiReasonAction | null =
    getSecurityCaseAiReasonAction(reasonCode);
  const blockingReason: boolean = isBlockingTriageReason(reasonCode);

  /*
   * Out of AI credits: AI Credits for someone who may add them, who can for
   * anyone known not to (LowBalanceMessagesNameWhoCan).
   */
  const renderCreditsAction: () => ReactElement = (): ReactElement => {
    const access: ProjectBalanceAccess = getProjectBalanceAccess(
      ProjectBalanceType.AI,
    );
    const action: SecurityCaseAiCreditsAction | null =
      getSecurityCaseAiCreditsAction({
        mayAddCredits: access === ProjectBalanceAccess.Yes,
        isKnownNotToAdd: access === ProjectBalanceAccess.No,
      });

    if (!action) {
      return <></>;
    }

    return action.linksToAiCredits ? (
      <AppLink
        className="font-medium text-indigo-600 hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_AI_CREDITS] as Route,
        )}
      >
        <>{translator.translateText(action.label)}</>
      </AppLink>
    ) : (
      <span data-testid="security-case-ai-reason-who-can">
        {translator.translateText(action.label)}
      </span>
    );
  };

  /*
   * Where to fix what stops a triage - for someone who may fix it. Everyone
   * else is told who can, in the words the incident card uses for the same
   * setting (getSettingsAction).
   */
  const renderReasonAction: () => ReactElement = (): ReactElement => {
    if (reasonCode === "insufficient_ai_balance") {
      return renderCreditsAction();
    }

    if (!reasonCode || !reasonAction) {
      return <></>;
    }

    const settings: SettingsAction | null =
      reasonCode === "provider_missing" ||
      reasonCode === "project_daily_limit_reached"
        ? getSettingsAction(reasonCode, "incident")
        : null;

    if (settings && !PermissionGate.holdsAnyOf(settings.permissions)) {
      return (
        <span data-testid="security-case-ai-reason-who-can">
          {translator.translateText(settings.whoCanAct)}
        </span>
      );
    }

    return (
      <AppLink
        className="font-medium text-indigo-600 hover:underline"
        to={RouteUtil.populateRouteParams(RouteMap[reasonAction.page] as Route)}
      >
        <>{translator.translateText(reasonAction.label)}</>
      </AppLink>
    );
  };

  const renderReason: () => ReactElement = (): ReactElement => {
    if (!reasonCode || !blockingReason) {
      return <></>;
    }

    return (
      <InvestigationNotice
        indicator={renderInvestigationStatusIndicator("attention")}
        title={SecurityCaseAiCopy.reasons[reasonCode]}
        testId="security-case-ai-reason"
      >
        {renderReasonAction()}
      </InvestigationNotice>
    );
  };

  const renderStartError: () => ReactElement = (): ReactElement => {
    return startError ? (
      <InvestigationNotice
        indicator={noticeFailedIcon}
        title={startError}
        role="alert"
        testId="security-case-ai-start-error"
        onDismiss={() => {
          setStartError("");
        }}
      />
    ) : (
      <></>
    );
  };

  const renderSteps: () => ReactElement = (): ReactElement => {
    const steps: Array<SecurityCaseTriageStep> = (status?.steps || []).slice(
      -SECURITY_CASE_AI_STEPS_SHOWN,
    );

    if (steps.length === 0) {
      return <></>;
    }

    return (
      <ul
        className="space-y-1.5 border-t border-gray-100 pt-3"
        aria-label={translator.translateText(SecurityCaseAiCopy.stepsLabel)}
        data-testid="security-case-ai-steps"
      >
        {steps.map((step: SecurityCaseTriageStep, index: number) => {
          return (
            <li
              key={`${index}-${step.toolName}`}
              className="flex items-center gap-2 text-sm text-gray-600"
            >
              <Icon
                icon={step.failed ? IconProp.Alert : IconProp.Check}
                className={`${NOTICE_ICON_CLASS_NAME} ${
                  step.failed ? "text-amber-500" : "text-emerald-600"
                }`}
              />
              <span className="min-w-0 break-words">
                {translator.translateText(
                  getSecurityCaseAiStepLabel(step.toolName),
                )}
              </span>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderSuggestions: () => ReactElement = (): ReactElement => {
    // The suggested priority as the project names it; none it no longer has.
    const suggestedPriority: SecurityCasePriority | null =
      SecurityCasePriorities.find(props.priorities, result.suggestedPriorityId);
    const offerPriority: boolean = shouldOfferSuggestedPriority({
      suggestedPriorityId: result.suggestedPriorityId,
      currentPriorityId: props.securityCase.securityCasePriorityId?.toString(),
      isSuggestedPriorityKnown: Boolean(suggestedPriority),
    });

    if (!suggestedPriority && !playbookName) {
      return <></>;
    }

    return (
      <dl className="divide-y divide-gray-100 border-y border-gray-100">
        {suggestedPriority ? (
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
            data-testid="security-case-ai-suggested-priority"
          >
            <dt className="text-sm text-gray-600">
              {translator.translateText(SecurityCaseAiCopy.suggestedPriority)}
            </dt>
            <dd className="flex items-center gap-3">
              <SecurityCasePriorityPill value={suggestedPriority} />
              {offerPriority && updateGate.isAllowed ? (
                <Button
                  title={SecurityCaseAiCopy.setPriorityButton}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  className={CARD_BUTTON_CLASS_NAME}
                  disabled={props.isWorking}
                  onClick={() => {
                    props.onSetPriority(suggestedPriority);
                  }}
                  dataTestId="security-case-ai-set-priority"
                />
              ) : (
                <></>
              )}
            </dd>
          </div>
        ) : (
          <></>
        )}
        {playbookName && result.suggestedPlaybookId ? (
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
            data-testid="security-case-ai-suggested-playbook"
          >
            <dt className="text-sm text-gray-600">
              {translator.translateText(SecurityCaseAiCopy.suggestedPlaybook)}
            </dt>
            {/*
              The playbook's whole name, wrapping on a phone rather than
              cut short: it is what Run playbook would start - or, when it
              is already running on the case, its run's status, as Playbook
              Runs shows it.
            */}
            <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <span className="min-w-0 break-words text-sm font-medium text-gray-900">
                {playbookName}
              </span>
              {suggestedPlaybookRun ? (
                <span
                  className="inline-flex"
                  data-testid="security-case-ai-suggested-playbook-run"
                >
                  <SecurityPlaybookRunStatusPill
                    value={suggestedPlaybookRun}
                    tooltip={
                      translator.translateText(
                        SecurityCaseAiCopy.suggestedPlaybookRunning,
                      ) || undefined
                    }
                  />
                </span>
              ) : (
                <Button
                  title={SecurityCaseAiCopy.runPlaybookButton}
                  icon={IconProp.Play}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  className={CARD_BUTTON_CLASS_NAME}
                  disabled={props.isWorking}
                  onClick={() => {
                    props.onRunPlaybook(
                      new ObjectID(result.suggestedPlaybookId!),
                    );
                  }}
                  dataTestId="security-case-ai-run-playbook"
                />
              )}
            </dd>
          </div>
        ) : (
          <></>
        )}
      </dl>
    );
  };

  const renderTriaged: () => ReactElement = (): ReactElement => {
    return (
      <div className="space-y-5" data-testid="security-case-ai-triaged">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SecurityCaseAiVerdictPill value={result.verdict} />
          <span className="text-sm text-gray-600">
            {translator.translateText(
              getSecurityCaseAiVerdictSentence(result.verdict),
            )}
          </span>
        </div>

        {result.promptInjectionSuspected ? (
          <InvestigationNotice
            indicator={
              <Icon
                icon={IconProp.ShieldExclamation}
                className={`${NOTICE_ICON_CLASS_NAME} text-amber-500`}
              />
            }
            title={SecurityCaseAiCopy.promptInjectionTitle}
            role="status"
            testId="security-case-ai-prompt-injection"
          >
            {translator.translateText(
              SecurityCaseAiCopy.promptInjectionDescription,
            )}
          </InvestigationNotice>
        ) : (
          <></>
        )}

        {/*
          A later triage that stopped: said over the read it left, with why
          it stopped when the run recorded it, as a triage that never
          finished says it.
        */}
        {didLatestTriageNotFinish(status) ? (
          <InvestigationNotice
            indicator={renderInvestigationStatusIndicator("attention")}
            title={SecurityCaseAiCopy.lastRunFailed}
            testId="security-case-ai-last-run-failed"
          >
            {status?.run?.errorMessage ? (
              <span data-testid="security-case-ai-last-run-failed-why">
                {status.run.errorMessage}
              </span>
            ) : undefined}
          </InvestigationNotice>
        ) : (
          <></>
        )}

        {renderSuggestions()}

        {report && result.report ? (
          <InvestigationReportView
            analysisMarkdown={result.report}
            report={report}
            analysisTldr={null}
            evidence={status?.evidence || []}
            references={[]}
            subjectType="incident"
            onCitationActivate={focusCitation}
          />
        ) : (
          <></>
        )}

        {report && result.report ? (
          <InvestigationRunDetails
            evidence={status?.evidence || []}
            legacyEntries={report.evidenceChecked}
            events={[]}
            usage={
              status?.run && status.evidence.length > 0
                ? {
                    toolCallCount: status.run.toolCallCount,
                    totalTokens: status.run.totalTokens,
                  }
                : null
            }
            subjectType="securityCase"
            subjectId={caseId}
            runId={status?.run?.id || null}
            focusRequest={focusRequest}
            loadEvidenceRows={loadEvidenceRows}
          />
        ) : (
          <></>
        )}

        {renderStartError()}

        {/*
          The way on from the read: ask about it, or read the case afresh -
          and when the project cannot triage now (no LLM provider, no AI
          credits, its daily limit), what stops it and where to fix it, in
          place of a Triage again that could not start.
        */}
        <div className="space-y-4 border-t border-gray-100 pt-4">
          {renderReason()}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              title={SecurityCaseAiCopy.askButton}
              icon={IconProp.ChatBubbleLeftRight}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              className={CARD_BUTTON_CLASS_NAME}
              onClick={askAboutCase}
              dataTestId="security-case-ai-ask"
            />
            {/*
              Triage again, for who may start one: a greyed outline button
              reads as one that works, and the read is what the others came
              for.
            */}
            {blockingReason ||
            triageAccess !== SecurityCaseAiTriageAccess.Yes ? (
              <></>
            ) : (
              triageButton(SecurityCaseAiCopy.triageAgainButton, false)
            )}
            {result.triagedAt ? (
              <span
                className="text-xs text-gray-500"
                title={formatFeedFullTime(result.triagedAt, clock)}
                data-testid="security-case-ai-triaged-when"
              >
                {translator.translateTemplate(SecurityCaseAiCopy.triagedWhen, {
                  // "5 minutes ago", in the reader's language.
                  when:
                    formatFeedTimeAgo(result.triagedAt, clock) ||
                    OneUptimeDate.fromNow(result.triagedAt),
                })}
              </span>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (loadError && !status) {
      return (
        <InvestigationNotice
          indicator={noticeFailedIcon}
          title={loadError}
          role="alert"
          testId="security-case-ai-load-error"
        />
      );
    }

    if (stage === SecurityCaseAiStage.Triaging) {
      return (
        <div className="space-y-3" data-testid="security-case-ai-triaging">
          <InvestigationNotice
            indicator={renderInvestigationStatusIndicator("live")}
            title={SecurityCaseAiCopy.triagingTitle}
            role="status"
          >
            {translator.translateText(SecurityCaseAiCopy.triagingDescription)}
          </InvestigationNotice>
          {renderSteps()}
        </div>
      );
    }

    if (stage === SecurityCaseAiStage.Triaged) {
      return renderTriaged();
    }

    if (stage === SecurityCaseAiStage.Failed) {
      return (
        <div className="space-y-4" data-testid="security-case-ai-failed">
          <InvestigationNotice
            indicator={noticeFailedIcon}
            title={SecurityCaseAiCopy.failedTitle}
            role="status"
            testId="security-case-ai-failed-notice"
          >
            {translator.translateText(getFailedTriageDescription(status))}
          </InvestigationNotice>
          {renderReason()}
          {renderStartError()}
          {blockingReason ||
          triageAccess === SecurityCaseAiTriageAccess.NotKnownYet ? (
            <></>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {triageButton(SecurityCaseAiCopy.tryAgainButton, true)}
              {renderWhoCanTriage()}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4" data-testid="security-case-ai-not-triaged">
        <InvestigationNotice
          indicator={
            <Icon
              icon={IconProp.Sparkles}
              className={`${NOTICE_ICON_CLASS_NAME} text-indigo-500`}
            />
          }
          title={SecurityCaseAiCopy.notTriagedTitle}
        >
          {translator.translateText(SecurityCaseAiCopy.notTriagedDescription)}
        </InvestigationNotice>
        {renderReason()}
        {renderStartError()}
        {status &&
        !blockingReason &&
        triageAccess !== SecurityCaseAiTriageAccess.NotKnownYet ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {triageButton(SecurityCaseAiCopy.triageButton, true)}
            {renderWhoCanTriage()}
            {/*
              Where new cases are set to be triaged on their own - for who
              may triage; the others are told who can instead.
            */}
            {!status.isAutomaticTriageOn &&
            triageAccess === SecurityCaseAiTriageAccess.Yes ? (
              <span data-testid="security-case-ai-automatic-off">
                <AppLink
                  className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_AI] as Route,
                  )}
                >
                  <>
                    {translator.translateText(
                      SecurityCaseAiCopy.automaticOffNote,
                    )}
                  </>
                </AppLink>
              </span>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div id={SECURITY_CASE_AI_CARD_ID} data-testid={SECURITY_CASE_AI_CARD_ID}>
      <Card
        title={SecurityCaseAiCopy.cardTitle}
        rightElement={
          <InvestigationStatusBadge
            text={badge.text}
            indicator={badge.indicator}
          />
        }
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default SecurityCaseAiCard;
