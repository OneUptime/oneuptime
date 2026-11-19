import AddRuleExceptionModal from "../../SecurityEvents/RuleExceptions/AddRuleExceptionModal";
import { ADD_EXCEPTION_DESCRIPTION } from "../../SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import { SecurityCaseValueLists } from "../SecurityCaseValues";
import {
  RESPONSE_AI_HEADING,
  RESPONSE_AI_HIDE,
  RESPONSE_AI_SHOW,
  RESPONSE_AI_VERDICT,
  RESPONSE_BY_HAND,
  RESPONSE_BY_HAND_TOOLTIP,
  RESPONSE_DESCRIPTION,
  RESPONSE_DONE_AT,
  RESPONSE_DONE_BY,
  RESPONSE_DONE_BY_CASE,
  RESPONSE_MARK_DONE,
  RESPONSE_MARK_NOT_DONE,
  RESPONSE_PHASE_TITLES,
  RESPONSE_PROGRESS,
  RESPONSE_READY_TO_CONTAIN,
  RESPONSE_RULE_FALSE_POSITIVES,
  RESPONSE_TITLE,
  SECURITY_CASE_RESPONSE_TEST_IDS,
  ACTION_COPY,
} from "./SecurityCaseResponseCopy";
import {
  RESPONSE_PLAYBOOK_SELECT,
  RESPONSE_TASK_SELECT,
  getCaseResponseVerdictTone,
  getResponseStepTitle,
  readResponsePlaybooks,
  readResponseTasks,
} from "./SecurityCaseResponseData";
import {
  buildResponsePlan,
  getResponseStepKey,
  isAiStep,
  readPlaybookRuns,
} from "./SecurityCaseResponsePlan";
import {
  RESPONSE_PHASES,
  ResponseAction,
  ResponseActionKind,
  ResponsePhase,
  ResponsePlan,
  ResponsePlaybookRunState,
  ResponseStep,
  ResponseStepCompletion,
  ResponseText,
} from "./SecurityCaseResponseTypes";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import { isSecurityCaseAiVerdict } from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import { SecurityCaseMatchesJson } from "Common/Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import {
  SecurityEntity,
  readSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A CASE'S RESPONSE PLAN, on its Overview (#9557): what to do about the
 * case now, most urgent first - confirm it is real, contain it, fix what
 * let it happen, close it - each step concrete to this case
 * (SecurityCaseResponsePlan.ts says how they are chosen).
 *
 * A step OneUptime can do has its button: Assign to Me, Run Playbook (the
 * playbook that contains an account or a host, or the one OneUptime AI
 * suggests), Add Exception (the rule and the entity filled in), Declare
 * Incident, Mark as Contained, Close Case. A step OneUptime cannot do - no
 * firewall OneUptime blocks an address in - says so ("Outside OneUptime"),
 * with what it acts on one click from the clipboard.
 *
 * A step is ticked off where it is suggested: the tick makes it one of the
 * case's tasks, done, by whoever ticked it and when, so the Tasks page, the
 * timeline and Close Case's reminder all know. A step the case itself
 * decides - who has it, an incident declared, a playbook run, Contained,
 * Closed - ticks itself. Once every step that contains the threat is done,
 * the plan says so and offers Mark as Contained, which records the case's
 * time to contain.
 *
 * OneUptime AI's own suggested steps, from its triage, fold under the plan's
 * own, in its words.
 */

export interface ComponentProps {
  caseId: ObjectID;
  securityCase: SecurityCase;
  values: SecurityCaseValueLists;
  matches: SecurityCaseMatchesJson | null;
  refreshToggle?: string | undefined;
  isWorking: boolean;
  onAssignToMe: () => void;
  onRunPlaybook: (playbookId: ObjectID) => void;
  onDeclareIncident: () => void;
  onMarkContained: () => void;
  onCloseCase: () => void;
}

interface PlanData {
  tasks: Array<SecurityCaseTask>;
  playbooks: Array<SecurityPlaybook>;
  // The playbooks a run of which succeeded on the case, and where the others' latest runs stand.
  ranPlaybookIds: Array<string>;
  playbookRunStates: Record<string, ResponsePlaybookRunState>;
}

const PHASE_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

// A sentence of the plan, in the reader's words.
function readText(text: ResponseText, translator: Translator): string {
  const values: Record<string, string> = { ...text.values };

  for (const key of Object.keys(text.numbers || {})) {
    values[key] = translator.formatNumber(text.numbers![key] || 0);
  }

  return typeof text.template === "string"
    ? translator.translateTemplate(text.template, values)
    : translator.translatePlural(text.template, text.count || 0, values);
}

const SecurityCaseResponsePlanCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const caseIdText: string = props.caseId.toString();
  const [data, setData] = useState<PlanData | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [workingStepKey, setWorkingStepKey] = useState<string>("");
  const [isShowingAiSteps, setIsShowingAiSteps] = useState<boolean>(false);
  const [exceptionFor, setExceptionFor] = useState<ResponseAction | null>(null);

  const caseUpdateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Update,
  );
  const taskCreateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseTask(),
    ModelAction.Create,
  );
  const taskUpdateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseTask(),
    ModelAction.Update,
  );
  const runGate: PermissionGateResult = PermissionGate.check(
    new SecurityPlaybookRun(),
    ModelAction.Create,
  );
  const exceptionGate: PermissionGateResult = PermissionGate.check(
    new DetectionRuleException(),
    ModelAction.Create,
  );

  // Only the newest read lands: a slow one never replaces a newer one.
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const readNumber: number = latestReadRef.current + 1;
    latestReadRef.current = readNumber;

    try {
      const [tasks, playbooks, runs]: [
        ListResult<SecurityCaseTask>,
        ListResult<SecurityPlaybook>,
        ListResult<SecurityPlaybookRun>,
      ] = await Promise.all([
        ModelAPI.getList<SecurityCaseTask>({
          modelType: SecurityCaseTask,
          query: { securityCaseId: new ObjectID(caseIdText) },
          select: RESPONSE_TASK_SELECT,
          sort: { createdAt: SortOrder.Ascending },
          skip: 0,
          limit: 200,
        }),
        ModelAPI.getList<SecurityPlaybook>({
          modelType: SecurityPlaybook,
          query: { isEnabled: true },
          select: RESPONSE_PLAYBOOK_SELECT,
          sort: { name: SortOrder.Ascending },
          skip: 0,
          limit: 100,
        }),
        ModelAPI.getList<SecurityPlaybookRun>({
          modelType: SecurityPlaybookRun,
          query: { securityCaseId: new ObjectID(caseIdText) },
          select: { _id: true, securityPlaybookId: true, status: true },
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: 100,
        }),
      ]);

      if (readNumber === latestReadRef.current) {
        setData({
          tasks: tasks.data,
          playbooks: playbooks.data,
          ...readPlaybookRuns(
            runs.data.map(
              (
                run: SecurityPlaybookRun,
              ): { playbookId: string; status: string } => {
                return {
                  playbookId: run.securityPlaybookId?.toString() || "",
                  status: run.status || "",
                };
              },
            ),
          ),
        });
        setLoadError("");
      }
    } catch (err) {
      if (readNumber === latestReadRef.current) {
        setLoadError(API.getFriendlyMessage(err));
      }
    }
  }, [caseIdText]);

  useEffect(() => {
    void load();
  }, [load, props.refreshToggle]);

  // A colleague ticking a step off - or a task changed on the Tasks page - reads it again.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const stops: Array<() => void> = [
      ModelEventType.Create,
      ModelEventType.Update,
      ModelEventType.Delete,
    ].map((eventType: ModelEventType): (() => void) => {
      return Realtime.listenToModelEvent<SecurityCaseTask>(
        {
          eventType,
          modelType: SecurityCaseTask,
          tenantId: projectId,
        },
        () => {
          void load();
        },
      );
    });

    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [load]);

  if (loadError && !data) {
    return (
      <Card title={RESPONSE_TITLE} description={RESPONSE_DESCRIPTION}>
        <div data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.error}>
          <ErrorMessage
            message={loadError}
            onRefreshClick={() => {
              void load();
            }}
          />
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card title={RESPONSE_TITLE} description={RESPONSE_DESCRIPTION}>
        <CardListSkeleton count={3} />
      </Card>
    );
  }

  const securityCase: SecurityCase = props.securityCase;
  const statuses: SecurityCaseValueLists["statuses"] = props.values.statuses;
  const stage: SecurityCaseStage =
    SecurityCaseStatuses.getStage(
      statuses,
      securityCase.securityCaseStatusId,
    ) || SecurityCaseStage.New;
  const entities: Array<SecurityEntity> = readSecurityEntities(
    securityCase.entities,
  );

  const plan: ResponsePlan = buildResponsePlan({
    entities,
    mitreTactics: securityCase.mitreTactics || [],
    mitreTechniques: securityCase.mitreTechniques || [],
    isAssigned: Boolean(securityCase.assignedToUserId),
    hasIncident: Boolean(securityCase.incidentId),
    stage,
    hasContainedStatus: Boolean(
      SecurityCaseStatuses.getStatusOfStage(
        statuses,
        SecurityCaseStage.Contained,
      ),
    ),
    matches: props.matches,
    playbooks: readResponsePlaybooks(data.playbooks),
    ranPlaybookIds: data.ranPlaybookIds,
    playbookRunStates: data.playbookRunStates,
    tasks: readResponseTasks(data.tasks),
    ai: {
      suggestedPlaybookId: securityCase.aiSuggestedPlaybookId?.toString(),
      report: securityCase.aiTriageReport,
    },
  });

  const isClosed: boolean = stage === SecurityCaseStage.Closed;

  // Tick a step off - or on again: its task made, or changed.
  const toggle: (step: ResponseStep) => Promise<void> = async (
    step: ResponseStep,
  ): Promise<void> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId || workingStepKey) {
      return;
    }

    setWorkingStepKey(step.key);
    setActionError("");

    try {
      if (step.taskId) {
        await ModelAPI.updateById<SecurityCaseTask>({
          modelType: SecurityCaseTask,
          id: new ObjectID(step.taskId),
          data: { isDone: !step.isDone },
        });
      } else {
        const task: SecurityCaseTask = new SecurityCaseTask();
        task.projectId = projectId;
        task.securityCaseId = props.caseId;
        task.title = getResponseStepTitle({
          step,
          text: readText(step.text, translator),
        });
        task.isDone = true;
        task.responseStepKey = step.key;

        await ModelAPI.create<SecurityCaseTask>({
          model: task,
          modelType: SecurityCaseTask,
        });
      }

      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
      // A colleague's tick may be why: read what is there now.
      await load();
    }

    setWorkingStepKey("");
  };

  const runAction: (action: ResponseAction) => void = (
    action: ResponseAction,
  ): void => {
    switch (action.kind) {
      case ResponseActionKind.AssignToMe:
        props.onAssignToMe();
        return;
      case ResponseActionKind.RunPlaybook:
        if (action.playbookId) {
          props.onRunPlaybook(new ObjectID(action.playbookId));
        }
        return;
      case ResponseActionKind.AddRuleException:
        setExceptionFor(action);
        return;
      case ResponseActionKind.DeclareIncident:
        props.onDeclareIncident();
        return;
      case ResponseActionKind.MarkContained:
        props.onMarkContained();
        return;
      case ResponseActionKind.CloseCase:
        props.onCloseCase();
        return;
      case ResponseActionKind.OpenRoute:
        if (action.route) {
          Navigation.navigate(action.route);
        }
        return;
    }
  };

  // Why a step's button is locked, in the reader's words; undefined when it is not.
  const getActionLock: (action: ResponseAction) => string | undefined = (
    action: ResponseAction,
  ): string | undefined => {
    switch (action.kind) {
      case ResponseActionKind.RunPlaybook:
        return runGate.isAllowed ? undefined : runGate.disabledReason || "";
      case ResponseActionKind.AddRuleException:
        return exceptionGate.isAllowed
          ? undefined
          : exceptionGate.disabledReason || "";
      case ResponseActionKind.OpenRoute:
        return undefined;
      default:
        return caseUpdateGate.isAllowed
          ? undefined
          : caseUpdateGate.disabledReason || "";
    }
  };

  const renderStep: (step: ResponseStep) => ReactElement = (
    step: ResponseStep,
  ): ReactElement => {
    const text: string = step.aiText || readText(step.text, translator);
    const textId: string = `security-case-response-step-${step.key.replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    )}`;
    const isWorking: boolean = workingStepKey === step.key;
    const tickGate: PermissionGateResult = step.taskId
      ? taskUpdateGate
      : taskCreateGate;
    const canTick: boolean =
      step.completion === ResponseStepCompletion.ByTask &&
      !isClosed &&
      tickGate.isAllowed &&
      !isWorking &&
      !workingStepKey;
    const isMarkContained: boolean =
      step.key === getResponseStepKey("contain:mark-contained");
    const isHighlighted: boolean =
      isMarkContained && plan.isReadyToMarkContained;
    const actionLock: string | undefined = step.action
      ? getActionLock(step.action)
      : undefined;

    return (
      <li
        key={step.key}
        className={`flex items-start gap-3 rounded-md px-2 py-2.5 ${
          isHighlighted ? "bg-indigo-50" : ""
        }`}
        data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.step}
        data-step-key={step.key}
        data-done={step.isDone ? "true" : "false"}
      >
        <span className="flex h-6 shrink-0 items-center">
          <input
            type="checkbox"
            checked={step.isDone}
            disabled={!canTick}
            aria-labelledby={textId}
            title={
              step.completion === ResponseStepCompletion.ByCase
                ? translator.translateText(RESPONSE_DONE_BY_CASE)
                : tickGate.isAllowed
                  ? translator.translateTemplate(
                      step.isDone ? RESPONSE_MARK_NOT_DONE : RESPONSE_MARK_DONE,
                      { step: text },
                    )
                  : tickGate.disabledReason
            }
            data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.checkbox}
            onChange={() => {
              void toggle(step);
            }}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600 disabled:cursor-not-allowed"
          />
        </span>
        {/*
         * The step's words, and beside them what it can press - under them on
         * a phone, so the words keep the row's width.
         */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p
              id={textId}
              className={`break-words text-sm leading-6 ${
                step.isDone ? "text-gray-500 line-through" : "text-gray-900"
              }`}
              data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.stepText}
            >
              {step.aiText ? <IsolatedText text={step.aiText} /> : text}
            </p>
            {step.detail ? (
              <p
                className={`text-xs ${
                  step.isDetailWarning ? "text-amber-700" : "text-gray-500"
                }`}
              >
                {readText(step.detail, translator)}
              </p>
            ) : (
              <></>
            )}
            {isHighlighted ? (
              <p
                className="text-xs text-indigo-700"
                data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.readyToContain}
              >
                {translator.translateText(RESPONSE_READY_TO_CONTAIN)}
              </p>
            ) : (
              <></>
            )}
            {step.quotes.length > 0 ? (
              <div
                className="text-xs text-gray-500"
                data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.falsePositives}
              >
                <p>{translator.translateText(RESPONSE_RULE_FALSE_POSITIVES)}</p>
                <ul className="ms-4 list-disc">
                  {step.quotes.map((quote: string): ReactElement => {
                    return (
                      <li key={quote}>
                        <IsolatedText text={quote} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <></>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {step.isOutsideOneUptime ? (
                <span data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.byHand}>
                  <Pill
                    text={RESPONSE_BY_HAND}
                    tone={PillTone.Neutral}
                    isDotHidden={true}
                    tooltip={RESPONSE_BY_HAND_TOOLTIP}
                  />
                </span>
              ) : (
                <></>
              )}
              {step.isDone && step.doneAt ? (
                <span
                  className="text-xs text-gray-500"
                  data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.doneLine}
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    step.doneAt,
                  )}
                >
                  {step.doneByName
                    ? translator.translateTemplate(RESPONSE_DONE_BY, {
                        name: step.doneByName,
                        time: OneUptimeDate.fromNow(step.doneAt),
                      })
                    : translator.translateTemplate(RESPONSE_DONE_AT, {
                        time: OneUptimeDate.fromNow(step.doneAt),
                      })}
                </span>
              ) : (
                <></>
              )}
            </div>
          </div>
          {(step.action || (step.copyValue && !step.isDone)) && !isClosed ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {step.copyValue && !step.isDone ? (
                <CopyTextButton
                  textToBeCopied={step.copyValue}
                  label={translator.translateText(ACTION_COPY) || ACTION_COPY}
                  size="sm"
                  variant="soft"
                />
              ) : (
                <></>
              )}
              {step.action ? (
                <Button
                  title={step.action.title}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  disabled={actionLock !== undefined || props.isWorking}
                  tooltip={actionLock || undefined}
                  dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.action}
                  onClick={() => {
                    runAction(step.action!);
                  }}
                />
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </li>
    );
  };

  const aiSteps: Array<ResponseStep> = plan.steps.filter(isAiStep);
  const aiVerdict: string = isSecurityCaseAiVerdict(securityCase.aiVerdict)
    ? securityCase.aiVerdict
    : "";

  return (
    <div data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.card}>
      <Card
        title={RESPONSE_TITLE}
        description={RESPONSE_DESCRIPTION}
        rightElement={
          <span
            className="whitespace-nowrap text-sm tabular-nums text-gray-500"
            data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.progress}
          >
            {translator.translateTemplate(RESPONSE_PROGRESS, {
              done: translator.formatNumber(plan.done),
              total: translator.formatNumber(plan.total),
            })}
          </span>
        }
      >
        <div className="space-y-4">
          {actionError ? <ErrorMessage message={actionError} /> : <></>}

          {aiVerdict ? (
            <div
              className="flex items-start gap-2 text-sm text-gray-600"
              data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.aiVerdict}
            >
              <Icon
                icon={IconProp.Sparkles}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
              />
              {/* One sentence, its read a chip in it, wherever a language puts it. */}
              <p className="min-w-0 leading-6">
                <TranslatedSentence
                  template={RESPONSE_AI_VERDICT}
                  slots={{
                    verdict: (
                      <Pill
                        text={aiVerdict}
                        tone={getCaseResponseVerdictTone(aiVerdict)}
                      />
                    ),
                  }}
                />
              </p>
            </div>
          ) : (
            <></>
          )}

          {RESPONSE_PHASES.map((phase: ResponsePhase): ReactElement => {
            const phaseSteps: Array<ResponseStep> = plan.steps.filter(
              (step: ResponseStep): boolean => {
                return step.phase === phase && !isAiStep(step);
              },
            );

            if (phaseSteps.length === 0) {
              return <React.Fragment key={phase} />;
            }

            return (
              <section
                key={phase}
                className="space-y-1"
                data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.phase}
                data-phase={phase}
              >
                <h4 className={PHASE_HEADING_CLASS_NAME}>
                  {translator.translateText(RESPONSE_PHASE_TITLES[phase])}
                </h4>
                <ul className="divide-y divide-gray-100">
                  {phaseSteps.map(renderStep)}
                </ul>
                {phase === ResponsePhase.Fix && aiSteps.length > 0 ? (
                  <div className="space-y-1 pt-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      aria-expanded={isShowingAiSteps}
                      onClick={() => {
                        setIsShowingAiSteps(!isShowingAiSteps);
                      }}
                      data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.aiToggle}
                    >
                      <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
                      {isShowingAiSteps
                        ? translator.translateText(RESPONSE_AI_HIDE)
                        : translator.translatePlural(
                            RESPONSE_AI_SHOW,
                            aiSteps.length,
                          )}
                    </button>
                    {isShowingAiSteps ? (
                      <div className="space-y-1">
                        <h5 className={PHASE_HEADING_CLASS_NAME}>
                          {translator.translateText(RESPONSE_AI_HEADING)}
                        </h5>
                        <ul className="divide-y divide-gray-100">
                          {aiSteps.map(renderStep)}
                        </ul>
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                ) : (
                  <></>
                )}
              </section>
            );
          })}
        </div>
      </Card>

      {exceptionFor ? (
        <AddRuleExceptionModal
          detectionRuleId={exceptionFor.detectionRuleId}
          entity={exceptionFor.entity || null}
          description={ADD_EXCEPTION_DESCRIPTION}
          onClose={() => {
            setExceptionFor(null);
          }}
          onSuccess={() => {
            setExceptionFor(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityCaseResponsePlanCard;
