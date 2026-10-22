import AppLink from "../AppLink/AppLink";
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
  SecurityCaseTriageStatusView,
  SecurityCaseTriageStep,
  canStartTriage,
  didLatestTriageNotFinish,
  getSecurityCaseAiBadge,
  getSecurityCaseAiCreditsAction,
  getSecurityCaseAiReasonAction,
  getSecurityCaseAiStage,
  getSecurityCaseAiStepLabel,
  getSecurityCaseAiVerdictSentence,
  isBlockingTriageReason,
  isTriageOnItsWay,
  readSecurityCaseAiResult,
  shouldOfferSuggestedPriority,
} from "./SecurityCaseAiTriage";
import {
  SecurityCaseAiVerdictPill,
  SecurityCasePriorityPill,
} from "./SecurityCasePills";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
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

// How often the card asks while a triage is on its way.
export const SECURITY_CASE_AI_POLL_INTERVAL_MS: number = 3000;
// The latest steps the card lists while a triage runs.
export const SECURITY_CASE_AI_STEPS_SHOWN: number = 5;

export interface ComponentProps {
  securityCase: SecurityCase;
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
 *     priority, Run Playbook and that playbook's approvals) - and its report
 *     with every claim cited: a citation opens the check behind it under
 *     Evidence checked, with the rows it read, re-run with the reader's own
 *     permissions. Ask about this case opens Ask AI on the case.
 *   - Failed: what happened, and Try again.
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
  const [focusRequest, setFocusRequest] = useState<EvidenceFocusRequest | null>(
    null,
  );
  const focusRequestCounterRef: React.MutableRefObject<number> =
    useRef<number>(0);

  const result: SecurityCaseAiResult = useMemo((): SecurityCaseAiResult => {
    return readSecurityCaseAiResult(props.securityCase);
  }, [
    props.securityCase.aiVerdict,
    props.securityCase.aiSuggestedPriority,
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

  const report: ParsedInvestigationReport | null = useMemo(() => {
    return result.report ? parseInvestigationReport(result.report) : null;
  }, [result.report]);

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

  const canStart: boolean = canStartTriage(status) && updateGate.isAllowed;

  const triageButton: (title: string, isPrimary: boolean) => ReactElement = (
    title: string,
    isPrimary: boolean,
  ): ReactElement => {
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
        tooltip={
          updateGate.isAllowed
            ? undefined
            : updateGate.disabledReason ||
              translator.translateText(SecurityCaseAiCopy.noPermission) ||
              undefined
        }
        onClick={() => {
          void startTriage();
        }}
        dataTestId="security-case-ai-triage-button"
      />
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
        {reasonCode === "insufficient_ai_balance" ? (
          renderCreditsAction()
        ) : reasonAction ? (
          <AppLink
            className="font-medium text-indigo-600 hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[reasonAction.page] as Route,
            )}
          >
            <>{translator.translateText(reasonAction.label)}</>
          </AppLink>
        ) : (
          <></>
        )}
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
    const offerPriority: boolean = shouldOfferSuggestedPriority({
      suggestedPriority: result.suggestedPriority,
      currentPriority: props.securityCase.priority,
    });

    if (!result.suggestedPriority && !playbookName) {
      return <></>;
    }

    return (
      <dl className="divide-y divide-gray-100 border-y border-gray-100">
        {result.suggestedPriority ? (
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
            data-testid="security-case-ai-suggested-priority"
          >
            <dt className="text-sm text-gray-600">
              {translator.translateText(SecurityCaseAiCopy.suggestedPriority)}
            </dt>
            <dd className="flex items-center gap-3">
              <SecurityCasePriorityPill value={result.suggestedPriority} />
              {offerPriority && updateGate.isAllowed ? (
                <Button
                  title={SecurityCaseAiCopy.setPriorityButton}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  disabled={props.isWorking}
                  onClick={() => {
                    if (result.suggestedPriority) {
                      props.onSetPriority(result.suggestedPriority);
                    }
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
            <dd className="flex min-w-0 items-center gap-3">
              <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                {playbookName}
              </span>
              <Button
                title={SecurityCaseAiCopy.runPlaybookButton}
                icon={IconProp.Play}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                disabled={props.isWorking}
                onClick={() => {
                  props.onRunPlaybook(
                    new ObjectID(result.suggestedPlaybookId!),
                  );
                }}
                dataTestId="security-case-ai-run-playbook"
              />
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
            title={SecurityCaseAiCopy.promptInjection}
            role="status"
            testId="security-case-ai-prompt-injection"
          />
        ) : (
          <></>
        )}

        {didLatestTriageNotFinish(status) ? (
          <InvestigationNotice
            indicator={renderInvestigationStatusIndicator("attention")}
            title={SecurityCaseAiCopy.lastRunFailed}
            testId="security-case-ai-last-run-failed"
          />
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-100 pt-4">
          <Button
            title={SecurityCaseAiCopy.askButton}
            icon={IconProp.ChatBubbleLeftRight}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={askAboutCase}
            dataTestId="security-case-ai-ask"
          />
          {triageButton(SecurityCaseAiCopy.triageAgainButton, false)}
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
          >
            {translator.translateText(SecurityCaseAiCopy.failedDescription)}
          </InvestigationNotice>
          {renderReason()}
          {renderStartError()}
          {blockingReason ? (
            <></>
          ) : (
            <div>{triageButton(SecurityCaseAiCopy.tryAgainButton, true)}</div>
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
        {status && !blockingReason ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {triageButton(SecurityCaseAiCopy.triageButton, true)}
            {!status.isAutomaticTriageOn ? (
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
