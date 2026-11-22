import AddRuleExceptionModal from "../../SecurityEvents/RuleExceptions/AddRuleExceptionModal";
import { BLOCK_ADMIN_PERMISSIONS } from "../../SecurityEvents/Blocklist/BlockAddressModal";
import { LIFTED_TOAST } from "../../SecurityEvents/Blocklist/BlocklistCopy";
import {
  AddressBlockLine,
  BlockHelp,
  BlockStepActions,
} from "./SecurityCaseBlockStep";
import {
  BlockChoice,
  formatNamesInSentence,
} from "./SecurityCaseBlockStepModel";
import {
  BlockFromCaseStarted,
  blockFromCase,
  liftBlockFromCase,
  loadAddressBlocking,
} from "./SecurityCaseAddressBlocks";
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
  RESPONSE_PROGRESS_CHECKED,
  RESPONSE_READY_TO_CONTAIN,
  RESPONSE_RULE_FALSE_POSITIVES,
  RESPONSE_TITLE,
  SECURITY_CASE_RESPONSE_TEST_IDS,
  STEP_CHECKS_NOT_READ,
  STEP_CHECK_CHECKED_AT,
  STEP_CHECK_CONFIRM,
  STEP_CHECK_CONFIRM_TOOLTIP,
  STEP_CHECK_DOCS_LINK,
  STEP_CHECK_DONE_ANYWAY,
  STEP_CHECK_DONE_BY_CHECK,
  STEP_CHECK_HIDE_HOW_WE_KNOW,
  STEP_CHECK_HOW_WE_KNOW,
  STEP_CHECK_STATE_LABELS,
  ACTION_COPY,
  BLOCK_ASKED_TOAST,
  BLOCK_STARTED_TOAST,
  LIFTED_FROM_PLAN_REASON,
  RESPONSE_BLOCKED,
} from "./SecurityCaseResponseCopy";
import { readCaseBlocklist } from "../../SecurityEvents/Blocklist/BlocklistApi";
import {
  StepCheckLinkTarget,
  canConfirmStep,
  getStepCheckDocsUrl,
  getStepCheckLineClassName,
  getStepCheckLinkTarget,
  getStepCheckTone,
  isCheckExplainedInline,
  isDoneAnyway,
  isDoneByCheckOnly,
  readCheckSentence,
} from "./SecurityCaseResponseChecks";
import {
  RESPONSE_PLAYBOOK_SELECT,
  RESPONSE_STEP_CHECK_SELECT,
  RESPONSE_TASK_SELECT,
  getCaseResponseVerdictTone,
  getResponseStepTitle,
  readResponsePlaybooks,
  readResponseStepChecks,
  readResponseTasks,
} from "./SecurityCaseResponseData";
import {
  buildResponsePlan,
  getResponseStepKey,
  isAiStep,
  readAddressBlockRuns,
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
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseStepCheck from "Common/Models/DatabaseModels/SecurityCaseStepCheck";
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
import { ResponseLink } from "Common/Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityCaseStepCheckSentence } from "Common/Types/SecurityCase/SecurityCaseStepCheckEvidence";
import URL from "Common/Types/API/URL";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import {
  SecurityEntity,
  SecurityEntityType,
  readSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";
import { getSecurityBlockExpiry } from "Common/Types/SecurityBlocklist/SecurityBlock";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import { getCaseBlockableAddresses } from "Common/Utils/SecurityCase/ResponsePlan/BlockableAddresses";
import {
  ResponseAddressBlock,
  ResponseAddressBlocking,
  ResponseBlockRequest,
  ResponseBlocklist,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import Toast from "Common/UI/Utils/Toast";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
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
 * Incident, Mark as Contained, Close Case - and, where Microsoft Defender
 * or CrowdStrike blocks it on every machine, Block for 7 Days or Block File
 * for a domain, a file or a command-and-control address (#10346), done once
 * a product holds the block. A step OneUptime cannot do - no firewall
 * OneUptime blocks an address in - says so ("Outside OneUptime"), with what
 * it acts on one click from the clipboard.
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
 *
 * OneUptime checks most steps itself (#10340, SecurityCaseStepCheck): a
 * step it checked says so - Checked by OneUptime, with the line of its
 * evidence and the rest under How We Know - apart from a person's tick
 * ("Done by Jane Doe"). One that looks done offers Confirm, which makes it
 * the person's tick; one OneUptime cannot tell about says why, with the
 * docs that say how to let it check; and one that was done and stopped
 * holding is said at the top of the card. Anyone may still tick a step by
 * hand: one OneUptime does not see done is ticked "anyway". A card whose
 * checks cannot be read still draws the plan, and says so.
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
  // What OneUptime found of the steps; none when they could not be read.
  checks: Array<SecurityCaseStepCheck>;
  isChecksUnread: boolean;
  /*
   * What the blocklist's destinations can hold and the blocks on the case's
   * values (#10346); null when it could not be read, which leaves those
   * steps to be done by hand.
   */
  blocklist: ResponseBlocklist | null;
  // The playbooks a run of which succeeded on the case, and where the others' latest runs stand.
  ranPlaybookIds: Array<string>;
  playbookRunStates: Record<string, ResponsePlaybookRunState>;
  /*
   * Where the blocklist is enforced and what it holds of the case's
   * addresses (#10342); undefined when it could not be read, and the block
   * step is then one done by hand.
   */
  addressBlocking: ResponseAddressBlocking | undefined;
}

const PHASE_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";

// The kinds of value a step blocks through the blocklist (#10346).
const BLOCKABLE_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.IpAddress,
  SecurityEntityType.Domain,
  SecurityEntityType.FileHash,
];

// The case's values the plan asks the blocklist about.
export function getBlockableValues(
  entities: ReadonlyArray<SecurityEntity>,
): Array<string> {
  const values: Array<string> = [];

  for (const entity of entities) {
    const value: string = (entity.value || "").trim();

    if (
      value &&
      BLOCKABLE_ENTITY_TYPES.includes(entity.type) &&
      !values.includes(value)
    ) {
      values.push(value);
    }
  }

  return values;
}

// A sentence of the plan, in the reader's words.
function readText(text: ResponseText, translator: Translator): string {
  const values: Record<string, string> = { ...text.values };

  for (const key of Object.keys(text.numbers || {})) {
    values[key] = translator.formatNumber(text.numbers![key] || 0);
  }

  // Names the sentence lists, as the reader's language lists them (#10342).
  for (const key of Object.keys(text.lists || {})) {
    values[key] = formatNamesInSentence(text.lists![key] || [], translator);
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
  // The steps whose How We Know is open.
  const [openHowWeKnow, setOpenHowWeKnow] = useState<Array<string>>([]);

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
  // A block from the plan is a one-step run that writes the blocklist (#10342): it takes both.
  const blockCreateGate: PermissionGateResult = PermissionGate.check(
    new SecurityBlock(),
    ModelAction.Create,
  );
  const blockUpdateGate: PermissionGateResult = PermissionGate.check(
    new SecurityBlock(),
    ModelAction.Update,
  );
  const blockLockReason: string | undefined = !runGate.isAllowed
    ? runGate.disabledReason || ""
    : !blockCreateGate.isAllowed
      ? blockCreateGate.disabledReason || ""
      : undefined;
  const liftLockReason: string | undefined = blockUpdateGate.isAllowed
    ? undefined
    : blockUpdateGate.disabledReason || "";
  const mayBlockUntilLifted: boolean = PermissionGate.holdsAnyOf(
    BLOCK_ADMIN_PERMISSIONS,
  );

  /*
   * The case's addresses its block steps are about (#10342): its public
   * ones, never one its requests only claimed. Read by the load below.
   */
  const blockableAddresses: Array<string> = getCaseBlockableAddresses({
    entities: readSecurityEntities(props.securityCase.entities),
    matches: props.matches,
  });
  const blockableAddressesKey: string = blockableAddresses.join(",");
  const blockableAddressesRef: MutableRefObject<Array<string>> =
    useRef<Array<string>>(blockableAddresses);
  blockableAddressesRef.current = blockableAddresses;
  const exceptionGate: PermissionGateResult = PermissionGate.check(
    new DetectionRuleException(),
    ModelAction.Create,
  );
  const blockGate: PermissionGateResult = PermissionGate.check(
    new SecurityBlock(),
    ModelAction.Create,
  );

  // The values the plan asks the blocklist about, as one key the read depends on.
  const blockableValues: string = getBlockableValues(
    readSecurityEntities(props.securityCase.entities),
  ).join("\n");

  // Only the newest read lands: a slow one never replaces a newer one.
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const readNumber: number = latestReadRef.current + 1;
    latestReadRef.current = readNumber;

    try {
      const [tasks, playbooks, runs, checks, blocklist]: [
        ListResult<SecurityCaseTask>,
        ListResult<SecurityPlaybook>,
        ListResult<SecurityPlaybookRun>,
        { rows: Array<SecurityCaseStepCheck>; isUnread: boolean },
        ResponseBlocklist | null,
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
          // A one-step block's address is in its step's targets (#10342).
          select: {
            _id: true,
            securityPlaybookId: true,
            status: true,
            steps: true,
            stepResults: true,
          },
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: 100,
        }),
        // Checks that cannot be read leave the plan as it is, and say so.
        ModelAPI.getList<SecurityCaseStepCheck>({
          modelType: SecurityCaseStepCheck,
          query: { securityCaseId: new ObjectID(caseIdText) },
          select: RESPONSE_STEP_CHECK_SELECT,
          sort: { createdAt: SortOrder.Ascending },
          skip: 0,
          limit: 100,
        }).then(
          (
            result: ListResult<SecurityCaseStepCheck>,
          ): { rows: Array<SecurityCaseStepCheck>; isUnread: boolean } => {
            return { rows: result.data || [], isUnread: false };
          },
          (): { rows: Array<SecurityCaseStepCheck>; isUnread: boolean } => {
            return { rows: [], isUnread: true };
          },
        ),
        /*
         * A blocklist that cannot be read - or a reader who may not read it -
         * leaves the steps it would make one click to be done by hand.
         */
        (blockableValues
          ? readCaseBlocklist(blockableValues.split("\n"))
          : Promise.resolve(null)
        ).catch((): null => {
          return null;
        }),
      ]);

      // The blocklist that cannot be read leaves the block step as one done by hand.
      const addressBlocking: ResponseAddressBlocking | undefined =
        await loadAddressBlocking({
          addresses: blockableAddressesRef.current,
          runStates: readAddressBlockRuns(
            runs.data.map(
              (
                run: SecurityPlaybookRun,
              ): {
                securityPlaybookId?: unknown;
                status: string;
                steps?: unknown;
                stepResults?: unknown;
              } => {
                return {
                  securityPlaybookId: run.securityPlaybookId,
                  status: run.status || "",
                  steps: run.steps,
                  stepResults: run.stepResults,
                };
              },
            ),
          ),
        }).catch((): undefined => {
          return undefined;
        });

      if (readNumber === latestReadRef.current) {
        setData({
          tasks: tasks.data,
          playbooks: playbooks.data,
          checks: checks.rows,
          isChecksUnread: checks.isUnread,
          addressBlocking,
          blocklist,
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
  }, [caseIdText, blockableValues]);

  useEffect(() => {
    void load();
  }, [load, props.refreshToggle, blockableAddressesKey]);

  // A colleague ticking a step off - or a task changed on the Tasks page - reads it again.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const eventTypes: Array<ModelEventType> = [
      ModelEventType.Create,
      ModelEventType.Update,
      ModelEventType.Delete,
    ];
    const stops: Array<() => void> = [
      ...eventTypes.map((eventType: ModelEventType): (() => void) => {
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
      }),
      // OneUptime checking a step again reads the plan again too.
      ...eventTypes.map((eventType: ModelEventType): (() => void) => {
        return Realtime.listenToModelEvent<SecurityCaseStepCheck>(
          {
            eventType,
            modelType: SecurityCaseStepCheck,
            tenantId: projectId,
          },
          () => {
            void load();
          },
        );
      }),
      // A block from the plan approved, made or failed (#10342).
      ...eventTypes.map((eventType: ModelEventType): (() => void) => {
        return Realtime.listenToModelEvent<SecurityPlaybookRun>(
          {
            eventType,
            modelType: SecurityPlaybookRun,
            tenantId: projectId,
          },
          () => {
            void load();
          },
        );
      }),
    ];

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
    checks: readResponseStepChecks(data.checks),
    addressBlocking: data.addressBlocking,
    blocklist: data.blocklist || undefined,
  });

  const isClosed: boolean = stage === SecurityCaseStage.Closed;

  /*
   * Blocks the step's address through the playbook engine (#10342): at
   * once for someone who may let a block run without approval, else once
   * someone else approves it. Why not - already blocked, protected - is
   * said where the plan's errors are.
   */
  const blockAddress: (
    step: ResponseStep,
    choice: BlockChoice,
  ) => Promise<void> = async (
    step: ResponseStep,
    choice: BlockChoice,
  ): Promise<void> => {
    const value: string = step.action?.entity?.value || "";

    if (!value || workingStepKey) {
      return;
    }

    setWorkingStepKey(step.key);
    setActionError("");

    try {
      const started: BlockFromCaseStarted = await blockFromCase({
        securityCaseId: props.caseId,
        value,
        blockAction: choice.blockAction,
        duration: choice.duration,
      });

      Toast.success(
        translator.translateTemplate(
          started.needsApproval ? BLOCK_ASKED_TOAST : BLOCK_STARTED_TOAST,
          { value },
        ),
      );
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    await load();
    setWorkingStepKey("");
  };

  // Lifts the block that holds the step's address, as the Blocklist lifts it.
  const liftBlock: (
    step: ResponseStep,
    block: ResponseAddressBlock,
  ) => Promise<void> = async (
    step: ResponseStep,
    block: ResponseAddressBlock,
  ): Promise<void> => {
    if (workingStepKey) {
      return;
    }

    setWorkingStepKey(step.key);
    setActionError("");

    try {
      await liftBlockFromCase({
        blockId: block.id,
        reason: translator.translateText(LIFTED_FROM_PLAN_REASON),
      });

      Toast.success(
        translator.translateTemplate(LIFTED_TOAST, { value: block.value }),
      );
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    await load();
    setWorkingStepKey("");
  };

  /*
   * Blocks a step's value through the blocklist (#10346), as the person: the
   * server refuses a protected value, or one nothing could hold, and says
   * why; the step is done once a product holds the block.
   */
  const block: (step: ResponseStep, action: ResponseAction) => Promise<void> =
    async (step: ResponseStep, action: ResponseAction): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const request: ResponseBlockRequest | undefined = action.block;

      if (!projectId || !request || workingStepKey) {
        return;
      }

      setWorkingStepKey(step.key);
      setActionError("");

      try {
        const record: SecurityBlock = new SecurityBlock();
        record.projectId = projectId;
        record.value = request.value;
        record.action = request.action;
        record.reach = request.reach;
        record.securityCaseId = props.caseId;

        const expiresAt: Date | null = getSecurityBlockExpiry(
          request.duration,
          OneUptimeDate.getCurrentDate(),
        );

        if (expiresAt) {
          record.expiresAt = expiresAt;
        }

        await ModelAPI.create<SecurityBlock>({
          model: record,
          modelType: SecurityBlock,
        });

        Toast.success(
          translator.translateTemplate(RESPONSE_BLOCKED, {
            value: request.value,
          }),
        );
        await load();
      } catch (err) {
        setActionError(API.getFriendlyMessage(err));
      }

      setWorkingStepKey("");
    };

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

  const runAction: (action: ResponseAction, step: ResponseStep) => void = (
    action: ResponseAction,
    step: ResponseStep,
  ): void => {
    switch (action.kind) {
      case ResponseActionKind.BlockIndicator:
        void block(step, action);
        return;
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
      // Its own buttons, beside the step (BlockStepActions).
      case ResponseActionKind.BlockAddress:
        return;
    }
  };

  // Why a step's button is locked, in the reader's words; undefined when it is not.
  const getActionLock: (action: ResponseAction) => string | undefined = (
    action: ResponseAction,
  ): string | undefined => {
    switch (action.kind) {
      case ResponseActionKind.BlockIndicator:
        return blockGate.isAllowed ? undefined : blockGate.disabledReason || "";
      case ResponseActionKind.RunPlaybook:
        return runGate.isAllowed ? undefined : runGate.disabledReason || "";
      case ResponseActionKind.AddRuleException:
        return exceptionGate.isAllowed
          ? undefined
          : exceptionGate.disabledReason || "";
      case ResponseActionKind.OpenRoute:
        return undefined;
      case ResponseActionKind.BlockAddress:
        return blockLockReason;
      default:
        return caseUpdateGate.isAllowed
          ? undefined
          : caseUpdateGate.disabledReason || "";
    }
  };

  const sentenceText: (sentence: SecurityCaseStepCheckSentence) => string = (
    sentence: SecurityCaseStepCheckSentence,
  ): string => {
    return readCheckSentence(sentence, translator);
  };

  // A link of the evidence: a page of the Dashboard, or the product's own, in a new tab.
  const renderCheckLink: (link: ResponseLink, index: number) => ReactElement = (
    link: ResponseLink,
    index: number,
  ): ReactElement => {
    const target: StepCheckLinkTarget | null = getStepCheckLinkTarget(link);

    if (!target) {
      return <React.Fragment key={index} />;
    }

    return (
      <Link
        key={index}
        to={target.url || target.route}
        openInNewTab={Boolean(target.url)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
        dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.checkLink}
      >
        {translator.translateTemplate(target.title, target.values)}
      </Link>
    );
  };

  /*
   * What OneUptime found of a step: its chip and its line, then - for a step
   * it cannot tell about - why, at once, with the docs; for any other, what
   * else it saw under How We Know.
   */
  const renderCheck: (step: ResponseStep) => ReactElement = (
    step: ResponseStep,
  ): ReactElement => {
    const check: NonNullable<ResponseStep["check"]> = step.check!;
    const isInline: boolean = isCheckExplainedInline(check.state);
    const isOpen: boolean = openHowWeKnow.includes(step.key);
    const docsUrl: URL | null = getStepCheckDocsUrl(check.evidence.docsPath);
    const facts: ReactElement =
      check.evidence.facts.length > 0 ? (
        <ul
          className="ms-4 list-disc space-y-0.5 text-xs text-gray-600"
          data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.checkFacts}
        >
          {check.evidence.facts.map(
            (
              fact: SecurityCaseStepCheckSentence,
              index: number,
            ): ReactElement => {
              return <li key={index}>{sentenceText(fact)}</li>;
            },
          )}
        </ul>
      ) : (
        <></>
      );
    const links: ReactElement =
      check.evidence.links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {check.evidence.links.map(renderCheckLink)}
        </div>
      ) : (
        <></>
      );

    return (
      <div
        className="space-y-1"
        data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.checkLine}
        data-check-state={check.state}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.checkChip}>
            <Pill
              text={STEP_CHECK_STATE_LABELS[check.state]}
              tone={getStepCheckTone(check.state)}
            />
          </span>
          <p
            className={`min-w-0 break-words text-xs ${getStepCheckLineClassName(
              check.state,
            )}`}
          >
            {sentenceText(check.evidence.sentence)}
          </p>
        </div>
        {isInline ? (
          <div className="space-y-1">
            {facts}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {check.evidence.links.map(renderCheckLink)}
              {docsUrl ? (
                <Link
                  to={docsUrl}
                  openInNewTab={true}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.docsLink}
                >
                  {translator.translateText(STEP_CHECK_DOCS_LINK)}
                </Link>
              ) : (
                <></>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <button
              type="button"
              className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-expanded={isOpen}
              data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow}
              onClick={() => {
                setOpenHowWeKnow(
                  isOpen
                    ? openHowWeKnow.filter((key: string): boolean => {
                        return key !== step.key;
                      })
                    : [...openHowWeKnow, step.key],
                );
              }}
            >
              {translator.translateText(
                isOpen ? STEP_CHECK_HIDE_HOW_WE_KNOW : STEP_CHECK_HOW_WE_KNOW,
              )}
            </button>
            {isOpen ? (
              <div
                className="space-y-1"
                data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnowPanel}
              >
                {facts}
                {links}
                {check.checkedAt ? (
                  <p
                    className="text-xs text-gray-500"
                    title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      check.checkedAt,
                    )}
                  >
                    {translator.translateTemplate(STEP_CHECK_CHECKED_AT, {
                      time: OneUptimeDate.fromNow(check.checkedAt),
                    })}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderStep: (step: ResponseStep) => ReactElement = (
    step: ResponseStep,
  ): ReactElement => {
    // Words a person wrote - OneUptime AI's, a rule's author's - are drawn as written.
    const writtenText: string = step.aiText || step.ruleText || "";
    const text: string = writtenText || readText(step.text, translator);
    const textId: string = `security-case-response-step-${step.key.replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    )}`;
    const isWorking: boolean = workingStepKey === step.key;
    const tickGate: PermissionGateResult = step.taskId
      ? taskUpdateGate
      : taskCreateGate;
    // A step OneUptime itself checked done, with no tick to take back, has nothing to tick.
    const isDoneByCheck: boolean = isDoneByCheckOnly(step);
    const canTick: boolean =
      step.completion === ResponseStepCompletion.ByTask &&
      !isClosed &&
      !isDoneByCheck &&
      tickGate.isAllowed &&
      !isWorking &&
      !workingStepKey;
    const canConfirm: boolean =
      canConfirmStep(step) &&
      step.completion === ResponseStepCompletion.ByTask &&
      !isClosed &&
      tickGate.isAllowed;
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
                : isDoneByCheck
                  ? translator.translateText(STEP_CHECK_DONE_BY_CHECK)
                  : tickGate.isAllowed
                    ? translator.translateTemplate(
                        step.isDone
                          ? RESPONSE_MARK_NOT_DONE
                          : isDoneAnyway(step)
                            ? STEP_CHECK_DONE_ANYWAY
                            : RESPONSE_MARK_DONE,
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
              {writtenText ? <IsolatedText text={writtenText} /> : text}
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
            {step.addressBlock ? (
              <AddressBlockLine
                address={
                  step.address ||
                  step.action?.entity?.value ||
                  step.copyValue ||
                  ""
                }
                block={step.addressBlock}
                liftLockReason={isClosed ? "" : liftLockReason}
                isWorking={isWorking || Boolean(workingStepKey)}
                onLift={() => {
                  void liftBlock(step, step.addressBlock!);
                }}
              />
            ) : (
              <></>
            )}
            {step.isBlockHelpShown && step.copyValue && !step.isDone ? (
              <BlockHelp address={step.copyValue} />
            ) : (
              <></>
            )}
            {step.check ? renderCheck(step) : <></>}
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
          {(step.action || canConfirm || (step.copyValue && !step.isDone)) &&
          !isClosed ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {canConfirm ? (
                <Button
                  title={STEP_CHECK_CONFIRM}
                  buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                  buttonSize={ButtonSize.Small}
                  disabled={isWorking || Boolean(workingStepKey)}
                  ariaLabel={translator.translateTemplate(
                    STEP_CHECK_CONFIRM_TOOLTIP,
                    { step: text },
                  )}
                  isAriaLabelTranslated={true}
                  dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.confirm}
                  onClick={() => {
                    void toggle(step);
                  }}
                />
              ) : (
                <></>
              )}
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
              {step.action?.kind === ResponseActionKind.BlockAddress ? (
                <BlockStepActions
                  address={step.action.entity?.value || ""}
                  lockReason={actionLock}
                  mayBlockUntilLifted={mayBlockUntilLifted}
                  isWorking={
                    isWorking || Boolean(workingStepKey) || props.isWorking
                  }
                  onBlock={(choice: BlockChoice) => {
                    void blockAddress(step, choice);
                  }}
                />
              ) : step.action ? (
                <Button
                  title={step.action.title}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  disabled={
                    actionLock !== undefined ||
                    props.isWorking ||
                    Boolean(workingStepKey)
                  }
                  isLoading={isWorking}
                  tooltip={actionLock || undefined}
                  dataTestId={SECURITY_CASE_RESPONSE_TEST_IDS.action}
                  onClick={() => {
                    runAction(step.action!, step);
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
  const regressedSteps: Array<ResponseStep> = plan.steps.filter(
    (step: ResponseStep): boolean => {
      return Boolean(step.check) && plan.regressedStepKeys.includes(step.key);
    },
  );
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
            {plan.checked > 0
              ? translator.translatePlural(
                  RESPONSE_PROGRESS_CHECKED,
                  plan.checked,
                  {
                    done: translator.formatNumber(plan.done),
                    total: translator.formatNumber(plan.total),
                  },
                )
              : translator.translateTemplate(RESPONSE_PROGRESS, {
                  done: translator.formatNumber(plan.done),
                  total: translator.formatNumber(plan.total),
                })}
          </span>
        }
      >
        <div className="space-y-4">
          {actionError ? <ErrorMessage message={actionError} /> : <></>}

          {/* A step that was done and stopped holding: the attacker is back. */}
          {regressedSteps.length > 0 ? (
            <div data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.regressed}>
              <Alert
                type={AlertType.DANGER}
                title={
                  <span className="block space-y-1">
                    {regressedSteps.map((step: ResponseStep): ReactElement => {
                      return (
                        <span key={step.key} className="block">
                          {sentenceText(step.check!.evidence.sentence)}
                        </span>
                      );
                    })}
                  </span>
                }
              />
            </div>
          ) : (
            <></>
          )}

          {data.isChecksUnread ? (
            <p
              className="text-xs text-gray-500"
              data-testid={SECURITY_CASE_RESPONSE_TEST_IDS.checksNotRead}
            >
              {translator.translateText(STEP_CHECKS_NOT_READ)}
            </p>
          ) : (
            <></>
          )}

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
