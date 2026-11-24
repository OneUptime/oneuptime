import AIRun from "../../../Models/DatabaseModels/AIRun";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  Gray500,
  Green500,
  Indigo500,
  Orange500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import PartialEntity from "../../../Types/Database/PartialEntity";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityCaseAiActionStatus,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  isSecurityCaseAiResponseActive,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES,
  SECURITY_CASE_AI_HOLD_QUIET_SKIPS,
  SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES,
  SECURITY_CASE_AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
  SECURITY_CASE_AI_HOLD_SKIP_SENTENCES,
  SecurityCaseAiHoldDecision,
  SecurityCaseAiHoldFacts,
  SecurityCaseAiHoldOutcome,
  SecurityCaseAiHoldPageDecision,
  SecurityCaseAiHoldReview,
  SecurityCaseAiHoldSkip,
  SecurityCaseAiHoldState,
  decideSecurityCaseAiHold,
  decideSecurityCaseAiHoldPage,
  getSecurityCaseAiHoldMinutes,
  reviewSecurityCaseAiHold,
} from "../../../Types/SecurityCase/SecurityCaseAiHold";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { createTranslator } from "../../../Types/Translator";
import { findInstructionLikePhrase } from "../../../Utils/AI/InstructionLikeText";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  isSecurityCaseAtHighestPriority,
  isSecurityCaseBelowAiHoldThreshold,
} from "../../../Utils/SecurityCase/SecurityCaseAiHoldPriorities";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import AIRunService from "../../Services/AIRunService";
import ProjectService from "../../Services/ProjectService";
import SecurityCaseAiActionService from "../../Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityCaseResponse, {
  SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES,
  SecurityCaseResponseNotStartedCode,
} from "../AI/Security/Response/SecurityCaseResponse";
import SecurityCaseResponseLook from "../AI/Security/Response/SecurityCaseResponseLook";
import SecurityCaseTriage, {
  SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES,
  SecurityCaseTriageNotStartedCode,
} from "../AI/Security/SecurityCaseTriage";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import SecurityPlaybookEngine from "../SecurityPlaybook/SecurityPlaybookEngine";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseHandOff from "./SecurityCaseHandOff";
import SecurityCaseNotifications, {
  isSetupTestCase,
} from "./SecurityCaseNotifications";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "./SecurityCaseValues";
import SecurityEventsSwitch from "./SecurityEventsSwitch";

/*
 * ONEUPTIME AI RESPONDS FIRST TO A SECURITY CASE (#10353): the server's
 * half of Types/SecurityCase/SecurityCaseAiHold, the incident side's
 * AiFirstResponder shaped for cases.
 *
 *   - A case a detection opens is held, or not, as it is created
 *     (onCaseOpened, from SecurityCaseService): the project's setting, the
 *     case's priority against the one it holds below, and the rules that
 *     never hold one (decideSecurityCaseAiHold). A case not held for a
 *     reason worth knowing says so on its timeline; one that looks like an
 *     active attack ends every hold of the project too.
 *   - While it is held, the notice people get when it opens waits
 *     (SecurityCaseNotifications.notifyPriorityReached sends nothing), and
 *     so does every Page On-Call step its playbooks reach on their own
 *     (the engine asks getPageDecision, and the run waits in Waiting for
 *     OneUptime AI).
 *   - The hold is reviewed every minute (reviewHolds), after each look of
 *     OneUptime AI's at the case, and as the case changes: contained with
 *     every step checked, or closed, it is resolved; OneUptime AI asking a
 *     person, handing the case over, not getting started, or the hold time
 *     running out, hands it to people (reviewSecurityCaseAiHold).
 *   - Page now, a person taking the case, the case rising to the priority
 *     people are alerted for at once, OneUptime AI's own hand-off and the
 *     project turning the setting off end it where they happen.
 *   - Security Events switched off on the server (#10816) stops this work
 *     as it stops the product's: no case is held while it is off, and the
 *     next review - within a minute - hands every held case to people,
 *     saying why (isProductOff). A held case OneUptime AI works goes to
 *     people with OneUptime AI's own hand-off, which ends the hold with the
 *     same outcome: one notice, whichever every-minute job sees it first.
 *     Switched on again, a case is held only as it opens: nothing held
 *     before comes back.
 *
 * However it ends - one compare-and-set from Holding, so it ends once - the
 * case's timeline says how, the notice people were held from is sent or
 * not (SecurityCaseNotifications, which reads how it ended: one summary to
 * the channels for a case resolved with nobody alerted), and the playbook
 * runs that waited carry on: their page goes, or is skipped.
 *
 * Everything is read and written as OneUptime (root), with the project and
 * the case named in every query. Nothing here reads the case's triage
 * report or its timeline (SubjectReadersOnlyGuard). Never throws to its
 * callers: a case opens, changes and is handed over whatever happens here,
 * and the every-minute review catches what a failure left.
 */

// The most held cases one review reads.
export const SECURITY_CASE_AI_HOLD_REVIEW_LIMIT: number = 500;

// The most cases a recurrence is looked for among.
const RECURRENCE_CASES_READ_LIMIT: number = 100;

// The most waiting runs one pass carries on.
const WAITING_RUNS_READ_LIMIT: number = 200;

// A run left waiting this long after its hold ended is carried on by the review.
const WAITING_RUN_GRACE_IN_MINUTES: number = 1;

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

// The project's columns a hold reads.
const PROJECT_SELECT: {
  _id: true;
  enableAi: true;
  enableAutomaticSecurityCaseTriage: true;
  enableAutomaticSecurityCaseResponse: true;
  enableSecurityCaseAiRespondsFirst: true;
  securityCaseAiHoldBelowPriorityId: true;
  securityCaseAiHoldMinutes: true;
} = {
  _id: true,
  enableAi: true,
  enableAutomaticSecurityCaseTriage: true,
  enableAutomaticSecurityCaseResponse: true,
  enableSecurityCaseAiRespondsFirst: true,
  securityCaseAiHoldBelowPriorityId: true,
  securityCaseAiHoldMinutes: true,
};

// What the project lets OneUptime AI do about holding its cases.
export interface SecurityCaseAiHoldSettings {
  // "Let OneUptime AI respond first".
  isOn: boolean;
  // The switches it takes effect under: AI, and working cases end to end.
  isWorkingCases: boolean;
  pickedPriorityId: ObjectID | null;
  minutes: number;
}

// The case's columns a hold reads.
const CASE_SELECT: {
  _id: true;
  projectId: true;
  title: true;
  description: true;
  entities: true;
  mitreTactics: true;
  mitreTechniques: true;
  groupingKey: true;
  createdAt: true;
  securityCaseStatusId: true;
  securityCasePriorityId: true;
  assignedToUserId: true;
  incidentId: true;
  aiVerdict: true;
  aiSuggestedPlaybookId: true;
  aiTriagePromptInjectionSuspected: true;
  aiResponseState: true;
  aiTookCaseAt: true;
  aiHoldOutcome: true;
  aiHoldUntil: true;
  aiHoldEndedAt: true;
} = {
  _id: true,
  projectId: true,
  title: true,
  description: true,
  entities: true,
  mitreTactics: true,
  mitreTechniques: true,
  groupingKey: true,
  createdAt: true,
  securityCaseStatusId: true,
  securityCasePriorityId: true,
  assignedToUserId: true,
  incidentId: true,
  aiVerdict: true,
  aiSuggestedPlaybookId: true,
  aiTriagePromptInjectionSuspected: true,
  aiResponseState: true,
  aiTookCaseAt: true,
  aiHoldOutcome: true,
  aiHoldUntil: true,
  aiHoldEndedAt: true,
};

function getAiName(): string {
  return `${ProductBrandingText.getProductName()} AI`;
}

function minutes(count: number): string {
  return `${count}${NO_BREAK_SPACE}${count === 1 ? "minute" : "minutes"}`;
}

/*
 * The case's own text a detection wrote - its title, description and the
 * values of its entities - holds text written to steer an AI. What the
 * triage reads besides is scanned when it runs (SecurityCaseTriageRunner),
 * and a case it finds such text in is handed to people at once.
 */
export function hasSecurityCaseSteeringText(
  securityCase: Pick<SecurityCase, "title" | "description" | "entities">,
): boolean {
  const texts: Array<string> = [
    securityCase.title || "",
    securityCase.description || "",
    ...readSecurityEntities(securityCase.entities).map(
      (entity: SecurityEntity): string => {
        return entity.value;
      },
    ),
  ];

  return texts.some((text: string): boolean => {
    return Boolean(findInstructionLikePhrase(text));
  });
}

/*
 * An address, user or host this case names that one of the others names
 * too: what a case OneUptime AI resolved lately and this one share.
 */
export function findSharedHoldEntity(data: {
  entities: ReadonlyArray<SecurityEntity>;
  others: ReadonlyArray<ReadonlyArray<SecurityEntity>>;
}): SecurityEntity | null {
  const key: (entity: SecurityEntity) => string = (
    entity: SecurityEntity,
  ): string => {
    return `${entity.type}:${entity.value.trim().toLowerCase()}`;
  };

  const ofTheirs: Set<string> = new Set<string>();

  for (const other of data.others) {
    for (const entity of other) {
      if (SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES.includes(entity.type)) {
        ofTheirs.add(key(entity));
      }
    }
  }

  return (
    data.entities.find((entity: SecurityEntity): boolean => {
      return (
        SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES.includes(entity.type) &&
        Boolean(entity.value.trim()) &&
        ofTheirs.has(key(entity))
      );
    }) || null
  );
}

/*
 * What the case's timeline says when a hold ends, as OneUptime AI's entry:
 * how it ended, and what that means for what waited.
 */
export function getHoldEndedMarkdown(data: {
  outcome: SecurityCaseAiHoldOutcome;
  isClosed: boolean;
  heldMinutes?: number | undefined;
}): MarkdownText {
  const ai: string = getAiName();
  const sent: string = `The alerts ${ai} held went out.`;

  switch (data.outcome) {
    case SecurityCaseAiHoldOutcome.Resolved:
      return data.isClosed
        ? mdText`✅ **Nobody had to be alerted.** The case was closed while ${ai} responded first. Its channels get one summary, and the playbook steps waiting to page on-call are skipped.`
        : mdText`✅ **Nobody had to be alerted.** The case was contained, every step checked, while ${ai} responded first. Its channels get one summary, and the playbook steps waiting to page on-call are skipped.`;
    case SecurityCaseAiHoldOutcome.NeedsApproval:
      return mdText`🔔 **People were alerted.** ${ai} asked a person to approve a step. ${sent}`;
    case SecurityCaseAiHoldOutcome.HandedOff:
      return mdText`🔔 **People were alerted.** ${ai} handed the case to people. ${sent}`;
    case SecurityCaseAiHoldOutcome.TimeRanOut:
      return data.heldMinutes
        ? mdText`🔔 **People were alerted.** ${ai} did not finish within ${minutes(data.heldMinutes)}. ${sent}`
        : mdText`🔔 **People were alerted.** ${ai} did not finish in time. ${sent}`;
    case SecurityCaseAiHoldOutcome.NotStarted:
      return mdText`🔔 **People were alerted.** ${ai} could not start working the case. ${sent}`;
    case SecurityCaseAiHoldOutcome.NotMalicious:
      return mdText`🔔 **People were alerted.** ${ai}'s triage did not read the case as Likely Malicious. ${sent}`;
    case SecurityCaseAiHoldOutcome.NotVerified:
      return mdText`🔔 **People were alerted.** The case was marked Contained, but OneUptime could not check every step that contains it. ${sent}`;
    case SecurityCaseAiHoldOutcome.ActiveAttack:
      return mdText`🔔 **People were alerted.** Several cases opened within ${minutes(SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES)}, which looks like an active attack. ${sent}`;
    case SecurityCaseAiHoldOutcome.TurnedOff:
      return mdText`🔔 **People were alerted.** Letting ${ai} respond first was turned off. ${sent}`;
    case SecurityCaseAiHoldOutcome.ProductOff:
      return mdText`🔔 **People were alerted.** Security Events is off on this server, so ${ai} stopped responding first. ${sent}`;
    case SecurityCaseAiHoldOutcome.PageNow:
      return mdText`🔔 **Page now was pressed.** ${sent}`;
    case SecurityCaseAiHoldOutcome.RoseInPriority:
      return mdText`🔔 **People were alerted.** The case rose to a priority that alerts people at once. ${sent}`;
    case SecurityCaseAiHoldOutcome.TakenByPerson:
      return mdText`🙋 **A person took the case.** Nobody else was alerted, and the playbook steps waiting to page on-call are skipped.`;
    default:
      return mdText`${ai} is working the case before anyone is alerted.`;
  }
}

function getHoldEndedColor(outcome: SecurityCaseAiHoldOutcome): Color {
  if (outcome === SecurityCaseAiHoldOutcome.Resolved) {
    return Green500;
  }

  if (outcome === SecurityCaseAiHoldOutcome.TakenByPerson) {
    return Gray500;
  }

  return Orange500;
}

export default class SecurityCaseAiHold {
  // ---------- A case opens ----------

  /*
   * A case was created: held while OneUptime AI responds first, or not. A
   * case not held for a reason worth knowing says so on its timeline; one
   * that looks like an active attack hands every hold of the project to
   * people as well. Never throws: the case opens either way.
   */
  @CaptureSpan()
  public static async onCaseOpened(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    isOpenedByDetection: boolean;
    now?: Date | undefined;
  }): Promise<SecurityCaseAiHoldDecision> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    let decision: SecurityCaseAiHoldDecision = {
      canHold: false,
      skip: SecurityCaseAiHoldSkip.CheckFailed,
    };
    let facts: SecurityCaseAiHoldFacts | null = null;
    let settings: SecurityCaseAiHoldSettings | null = null;

    try {
      settings = await this.readSettings(data.projectId);
    } catch (error) {
      /*
       * Whether the project holds cases at all cannot be read: nothing is
       * held, and nothing is said - most projects do not hold, and a line
       * on every case for them would be noise.
       */
      logger.error(
        `SecurityCaseAiHold: could not read whether project ${data.projectId.toString()} lets OneUptime AI respond first; people are alerted as usual:`,
      );
      logger.error(error);
      return decision;
    }

    // The cheap answer first: a project that does not hold reads nothing more.
    if (!settings.isOn) {
      return { canHold: false, skip: SecurityCaseAiHoldSkip.NotOn };
    }

    // Security Events switched off on the server: none of its work starts.
    if (await this.isProductOff()) {
      return { canHold: false, skip: SecurityCaseAiHoldSkip.ProductOff };
    }

    try {
      facts = await this.readFacts({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        isOpenedByDetection: data.isOpenedByDetection,
        settings,
        now,
      });

      decision = decideSecurityCaseAiHold(facts);
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not decide whether OneUptime AI responds first to case ${data.securityCaseId.toString()}; people are alerted as usual:`,
      );
      logger.error(error);
    }

    try {
      if (decision.canHold && settings) {
        await this.startHold({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          minutes: settings.minutes,
          now,
        });

        return decision;
      }

      if (
        decision.skip &&
        !SECURITY_CASE_AI_HOLD_QUIET_SKIPS.includes(decision.skip)
      ) {
        await this.sayNotHeld({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          skip: decision.skip,
          facts,
        });
      }

      if (decision.isActiveAttack) {
        await this.endEveryHold({
          projectId: data.projectId,
          outcome: SecurityCaseAiHoldOutcome.ActiveAttack,
          now,
        });
      }
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not act on whether OneUptime AI responds first to case ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
    }

    return decision;
  }

  public static async readSettings(
    projectId: ObjectID,
  ): Promise<SecurityCaseAiHoldSettings> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: PROJECT_SELECT,
      props: { isRoot: true },
    });

    return {
      isOn: project?.enableSecurityCaseAiRespondsFirst === true,
      isWorkingCases:
        project?.enableAi !== false &&
        project?.enableAutomaticSecurityCaseResponse === true,
      pickedPriorityId: project?.securityCaseAiHoldBelowPriorityId || null,
      minutes: getSecurityCaseAiHoldMinutes(project?.securityCaseAiHoldMinutes),
    };
  }

  // What decides whether a new case is held, read once.
  public static async readFacts(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    isOpenedByDetection: boolean;
    settings: SecurityCaseAiHoldSettings;
    now: Date;
  }): Promise<SecurityCaseAiHoldFacts> {
    const securityCase: SecurityCase | null = await this.readCase(data);

    if (!securityCase?.id) {
      throw new Error(
        `Security case ${data.securityCaseId.toString()} not found.`,
      );
    }

    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(data.projectId);
    const priorityId: string | undefined =
      securityCase.securityCasePriorityId?.toString();
    const isSetupTest: boolean = isSetupTestCase(securityCase);
    const isBelowThreshold: boolean = isSecurityCaseBelowAiHoldThreshold({
      priorities: values.priorities,
      priorityId,
      pickedPriorityId: data.settings.pickedPriorityId,
    });
    const isHighestPriority: boolean = isSecurityCaseAtHighestPriority({
      priorities: values.priorities,
      priorityId,
    });

    const facts: SecurityCaseAiHoldFacts = {
      isOn: data.settings.isOn,
      isSetupTest,
      isOpenedByDetection: data.isOpenedByDetection,
      isBelowThreshold,
      isHighestPriority,
      otherCasesOpenedRecently: 0,
      cannotWorkCasesBecause: null,
      cannotTriageBecause: null,
      hasSteeringText: false,
      recentlyResolvedEntity: null,
    };

    // A case no rule after these would hold reads nothing more.
    if (
      isSetupTest ||
      !data.isOpenedByDetection ||
      isHighestPriority ||
      !isBelowThreshold
    ) {
      return facts;
    }

    facts.otherCasesOpenedRecently = (
      await SecurityCaseService.countBy({
        query: {
          projectId: data.projectId,
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveMinutes(
              data.now,
              -SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES,
            ),
          ),
          _id: QueryHelper.notEquals(data.securityCaseId.toString()),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    const cannotWork: SecurityCaseResponseNotStartedCode | null =
      await SecurityCaseResponse.getNotStartedReason({
        projectId: data.projectId,
      });

    facts.cannotWorkCasesBecause = cannotWork
      ? ENGLISH.translateText(
          SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES[cannotWork],
        ) || SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES[cannotWork]
      : null;

    const cannotTriage: SecurityCaseTriageNotStartedCode | null =
      await SecurityCaseTriage.getNotStartedReason({
        projectId: data.projectId,
        automatic: true,
      });

    facts.cannotTriageBecause = cannotTriage
      ? SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES[cannotTriage]
      : null;
    facts.hasSteeringText = hasSecurityCaseSteeringText(securityCase);
    facts.recentlyResolvedEntity = await this.findRecentlyResolvedEntity({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      entities: readSecurityEntities(securityCase.entities),
      now: data.now,
    });

    return facts;
  }

  /*
   * An address, user or host the case names that a case resolved with
   * nobody alerted named too, within the recurrence window: what was done
   * about it did not hold, and people take it this time.
   */
  public static async findRecentlyResolvedEntity(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    entities: Array<SecurityEntity>;
    now: Date;
  }): Promise<SecurityEntity | null> {
    if (
      !data.entities.some((entity: SecurityEntity): boolean => {
        return SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES.includes(
          entity.type,
        );
      })
    ) {
      return null;
    }

    const resolved: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: {
        projectId: data.projectId,
        aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
        aiHoldEndedAt: QueryHelper.greaterThanEqualTo(
          OneUptimeDate.addRemoveHours(
            data.now,
            -SECURITY_CASE_AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
          ),
        ),
        _id: QueryHelper.notEquals(data.securityCaseId.toString()),
      },
      select: { _id: true, entities: true },
      sort: { aiHoldEndedAt: SortOrder.Descending },
      skip: 0,
      limit: RECURRENCE_CASES_READ_LIMIT,
      props: { isRoot: true },
    });

    return findSharedHoldEntity({
      entities: data.entities,
      others: resolved.map((row: SecurityCase): Array<SecurityEntity> => {
        return readSecurityEntities(row.entities);
      }),
    });
  }

  // The case is held: from now, for at most the project's hold time.
  private static async startHold(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    minutes: number;
    now: Date;
  }): Promise<void> {
    await SecurityCaseService.updateColumnsByIdWithoutHooks({
      id: data.securityCaseId,
      data: {
        aiHoldOutcome: SecurityCaseAiHoldOutcome.Holding,
        aiHoldUntil: OneUptimeDate.addRemoveMinutes(data.now, data.minutes),
        aiHoldEndedAt: null,
        aiHoldEndedByUserId: null,
      } as unknown as PartialEntity<SecurityCase>,
    });

    const ai: string = getAiName();

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown:
        mdText`🤖 **${ai} is responding first.** Nobody is alerted yet: ${ai} works the case for up to ${minutes(data.minutes)}, and alerts people at once if it needs them. Page now on the case alerts them now.`.toString(),
      eventType: SecurityCaseFeedEventType.AiResponse,
      displayColor: Indigo500,
      postedAt: data.now,
    });
  }

  // Why a new case was not held, on its timeline.
  private static async sayNotHeld(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    skip: SecurityCaseAiHoldSkip;
    facts: SecurityCaseAiHoldFacts | null;
  }): Promise<void> {
    const why: string = ENGLISH.translateTemplate(
      SECURITY_CASE_AI_HOLD_SKIP_SENTENCES[data.skip],
      {
        why:
          data.facts?.cannotWorkCasesBecause ||
          data.facts?.cannotTriageBecause ||
          "",
        value: data.facts?.recentlyResolvedEntity?.value || "",
      },
    );

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown:
        mdText`**${getAiName()} did not hold this case's alerts.** ${why} People were alerted as usual.`.toString(),
      eventType: SecurityCaseFeedEventType.AiResponse,
      displayColor: Gray500,
    });
  }

  // ---------- While it is held ----------

  /*
   * Every minute: each held case, reviewed once - and every playbook run
   * still waiting for a hold that ended carried on.
   */
  @CaptureSpan()
  public static async reviewHolds(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<void> {
    const held: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: {
        aiHoldUntil: QueryHelper.notNull(),
        aiHoldOutcome: SecurityCaseAiHoldOutcome.Holding,
      },
      select: { _id: true, projectId: true },
      sort: { aiHoldUntil: SortOrder.Ascending },
      skip: 0,
      limit: SECURITY_CASE_AI_HOLD_REVIEW_LIMIT,
      props: { isRoot: true },
    });

    for (const securityCase of held) {
      if (!securityCase.id || !securityCase.projectId) {
        continue;
      }

      try {
        await this.review({
          projectId: securityCase.projectId,
          securityCaseId: securityCase.id,
          now,
        });
      } catch (error) {
        logger.error(
          `SecurityCaseAiHold: could not review the hold of case ${securityCase.id.toString()}:`,
        );
        logger.error(error);
      }
    }

    await this.carryOnLeftRuns(now);
  }

  /*
   * Reviews one case's hold now, and acts on it. Returns how it ended, or
   * null when it holds on - or was not held.
   */
  @CaptureSpan()
  public static async review(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now?: Date | undefined;
  }): Promise<SecurityCaseAiHoldOutcome | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const securityCase: SecurityCase | null = await this.readCase(data);

    if (
      !securityCase?.id ||
      securityCase.aiHoldOutcome !== SecurityCaseAiHoldOutcome.Holding
    ) {
      return null;
    }

    const state: SecurityCaseAiHoldState = await this.readState({
      projectId: data.projectId,
      securityCase,
      now,
    });
    const review: SecurityCaseAiHoldReview = reviewSecurityCaseAiHold(state);

    if (!review.outcome) {
      return null;
    }

    /*
     * Security Events switched off while OneUptime AI works the case
     * (#10816): it stops working it too. Its hand-off ends the hold with
     * this outcome (onHandedToPeople), so people get one notice, saying
     * why, whether this review or OneUptime AI's own every-minute job
     * (SecurityCaseResponseProductOff) sees the switch first.
     */
    let isHandedOver: boolean = false;

    if (
      review.outcome === SecurityCaseAiHoldOutcome.ProductOff &&
      isSecurityCaseAiResponseActive(state.responseState)
    ) {
      isHandedOver = await SecurityCaseHandOff.handToPeople({
        projectId: data.projectId,
        securityCaseId: securityCase.id,
        reason: SecurityCaseHandOffReason.ProductOff,
        now,
      });
    }

    // Once: a hand-off above that ended the hold leaves nothing to end here.
    const isEnded: boolean = await this.endHold({
      projectId: data.projectId,
      securityCaseId: securityCase.id,
      outcome: review.outcome,
      isClosed: state.stage === SecurityCaseStage.Closed,
      now,
    });

    return isEnded || isHandedOver ? review.outcome : null;
  }

  /*
   * Never throws: a review asked for by a look or a change of the case
   * waits for the every-minute one when it fails.
   */
  public static async reviewSoon(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<void> {
    try {
      await this.review(data);
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not review the hold of case ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
    }
  }

  /*
   * Whether Security Events is switched off on the server (#10816): then
   * no case is held, and every held case goes to people at the next
   * review, within a minute, saying why. Read as OneUptime AI working a
   * case reads it (SecurityEventsSwitch): a read that fails answers "on",
   * as ServerProducts does - switching a product off is never a lock.
   */
  public static async isProductOff(): Promise<boolean> {
    return await SecurityEventsSwitch.isOff();
  }

  // What a held case's review reads about it, and about OneUptime AI's work on it.
  public static async readState(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    now: Date;
  }): Promise<SecurityCaseAiHoldState> {
    const { securityCase } = data;
    const [settings, values, isProductOff]: [
      SecurityCaseAiHoldSettings,
      ProjectSecurityCaseValues,
      boolean,
    ] = await Promise.all([
      this.readSettings(data.projectId),
      SecurityCaseValues.getForProject(data.projectId),
      this.isProductOff(),
    ]);
    const stage: SecurityCaseStage =
      SecurityCaseStatuses.getStage(
        values.statuses,
        securityCase.securityCaseStatusId,
      ) || SecurityCaseStage.New;

    // Read only for a case that is Contained: whether every step that contains it held.
    let isContainmentVerified: boolean = false;

    if (stage === SecurityCaseStage.Contained) {
      isContainmentVerified = (
        await SecurityCaseResponseLook.readPlan({
          projectId: data.projectId,
          securityCase,
          values,
          stage,
          now: data.now,
        })
      ).plan.isContainmentVerified;
    }

    const triage: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: securityCase.id!,
      },
      sort: { createdAt: SortOrder.Descending },
      select: { _id: true, status: true, completedAt: true, updatedAt: true },
      props: { isRoot: true },
    });

    const asked: number = (
      await SecurityCaseAiActionService.countBy({
        query: {
          projectId: data.projectId,
          securityCaseId: securityCase.id!,
          status: SecurityCaseAiActionStatus.Asked,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    const settledAt: Date | undefined =
      triage?.completedAt || triage?.updatedAt || undefined;

    return {
      now: data.now,
      openedAt: securityCase.createdAt
        ? new Date(securityCase.createdAt)
        : data.now,
      holdUntil: securityCase.aiHoldUntil
        ? new Date(securityCase.aiHoldUntil)
        : null,
      isStillOn: settings.isOn && settings.isWorkingCases,
      isProductOff,
      isStillBelowThreshold: isSecurityCaseBelowAiHoldThreshold({
        priorities: values.priorities,
        priorityId: securityCase.securityCasePriorityId?.toString(),
        pickedPriorityId: settings.pickedPriorityId,
      }),
      stage,
      isContainmentVerified,
      aiVerdict: (securityCase.aiVerdict as SecurityCaseAiVerdict) || null,
      triageStatus: (triage?.status as AIRunStatus) || null,
      triageSettledAt: settledAt ? new Date(settledAt) : null,
      responseState:
        (securityCase.aiResponseState as SecurityCaseAiResponseState) || null,
      isWaitingForApproval: asked > 0,
    };
  }

  // ---------- How a hold ends ----------

  /*
   * Ends the case's hold, once: of two that end it at the same moment, the
   * one whose compare-and-set from Holding lands does - says so on the
   * timeline, has the notice people were held from sent as the end calls
   * for (SecurityCaseNotifications), and carries on the playbook runs that
   * waited. Returns whether this call ended it.
   */
  @CaptureSpan()
  public static async endHold(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    outcome: SecurityCaseAiHoldOutcome;
    // The person who ended it: pressed Page now, or took the case.
    byUserId?: ObjectID | undefined;
    // The case is closed: a resolved hold says so.
    isClosed?: boolean | undefined;
    now?: Date | undefined;
  }): Promise<boolean> {
    if (data.outcome === SecurityCaseAiHoldOutcome.Holding) {
      return false;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const isEnded: boolean =
      await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
        id: data.securityCaseId,
        data: {
          aiHoldOutcome: data.outcome,
          aiHoldUntil: null,
          aiHoldEndedAt: now,
          aiHoldEndedByUserId: data.byUserId || null,
        } as unknown as PartialEntity<SecurityCase>,
        expectedData: {
          projectId: data.projectId,
          aiHoldOutcome: SecurityCaseAiHoldOutcome.Holding,
        } as unknown as PartialEntity<SecurityCase>,
        skipUpdateDateColumn: true,
      });

    if (!isEnded) {
      return false;
    }

    try {
      const securityCase: SecurityCase | null =
        await SecurityCaseService.findOneBy({
          query: { _id: data.securityCaseId, projectId: data.projectId },
          select: { _id: true, createdAt: true },
          props: { isRoot: true },
        });
      const heldMinutes: number | undefined = securityCase?.createdAt
        ? Math.max(
            1,
            Math.round(
              (now.getTime() - new Date(securityCase.createdAt).getTime()) /
                60000,
            ),
          )
        : undefined;

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        feedInfoInMarkdown: getHoldEndedMarkdown({
          outcome: data.outcome,
          isClosed: data.isClosed === true,
          heldMinutes,
        }).toString(),
        eventType: SecurityCaseFeedEventType.AiResponse,
        displayColor: getHoldEndedColor(data.outcome),
        postedAt: now,
        ...(data.byUserId ? { userId: data.byUserId } : {}),
      });
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not say on case ${data.securityCaseId.toString()}'s timeline how its hold ended:`,
      );
      logger.error(error);
    }

    // The notice people were held from: sent, a summary, or only the channels.
    await SecurityCaseNotifications.aiHoldEnded({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      actorUserId: data.byUserId,
    });

    await this.carryOnWaitingRuns({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
    });

    return true;
  }

  /*
   * Ends every hold of the project the same way: an active attack, or the
   * setting turned off. Returns how many this call ended.
   */
  @CaptureSpan()
  public static async endEveryHold(data: {
    projectId: ObjectID;
    outcome: SecurityCaseAiHoldOutcome;
    now?: Date | undefined;
  }): Promise<number> {
    const held: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: {
        projectId: data.projectId,
        aiHoldOutcome: SecurityCaseAiHoldOutcome.Holding,
      },
      select: { _id: true },
      skip: 0,
      limit: SECURITY_CASE_AI_HOLD_REVIEW_LIMIT,
      props: { isRoot: true },
    });

    let ended: number = 0;

    for (const securityCase of held) {
      if (!securityCase.id) {
        continue;
      }

      try {
        if (
          await this.endHold({
            projectId: data.projectId,
            securityCaseId: securityCase.id,
            outcome: data.outcome,
            now: data.now,
          })
        ) {
          ended++;
        }
      } catch (error) {
        logger.error(
          `SecurityCaseAiHold: could not end the hold of case ${securityCase.id.toString()}:`,
        );
        logger.error(error);
      }
    }

    return ended;
  }

  // Page now: someone wants people on the case, without waiting for OneUptime AI.
  @CaptureSpan()
  public static async pageNow(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    userId?: ObjectID | undefined;
  }): Promise<boolean> {
    return await this.endHold({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      outcome: SecurityCaseAiHoldOutcome.PageNow,
      byUserId: data.userId,
    });
  }

  /*
   * How a hold ends when OneUptime AI hands its case to people: a person
   * who took the case over has it; Security Events switched off (#10816)
   * ends it as the review would, saying so; any other reason is OneUptime
   * AI's hand-off, whose reason the notice gives.
   */
  public static getHandOffOutcome(
    reason: SecurityCaseHandOffReason,
  ): SecurityCaseAiHoldOutcome {
    switch (reason) {
      case SecurityCaseHandOffReason.TakenOver:
        return SecurityCaseAiHoldOutcome.TakenByPerson;
      case SecurityCaseHandOffReason.ProductOff:
        return SecurityCaseAiHoldOutcome.ProductOff;
      default:
        return SecurityCaseAiHoldOutcome.HandedOff;
    }
  }

  /*
   * OneUptime AI handed the case to people (SecurityCaseHandOff, #10352): a
   * held case's hold ends with it - and the notice people were held from
   * is the one that tells them, with the hand-off's reason, so they are not
   * told twice. A person who took the case over from OneUptime AI has it:
   * nobody else is alerted. Returns whether a hold ended. Never throws.
   */
  public static async onHandedToPeople(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    reason: SecurityCaseHandOffReason;
    byUserId?: ObjectID | undefined;
  }): Promise<boolean> {
    try {
      // Most hand-offs are of cases never held: one read, and nothing else.
      if (
        !(await this.isHeld({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        }))
      ) {
        return false;
      }

      const isTakenOver: boolean =
        data.reason === SecurityCaseHandOffReason.TakenOver;

      return await this.endHold({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        outcome: this.getHandOffOutcome(data.reason),
        byUserId: isTakenOver ? data.byUserId : undefined,
      });
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not end the hold of case ${data.securityCaseId.toString()} as OneUptime AI handed it to people:`,
      );
      logger.error(error);
      return false;
    }
  }

  /*
   * A held case changed (SecurityCaseService): a person who took it - who
   * assigned it to somebody, or moved its status on - has it, and nobody
   * else is alerted; a case that rose to the priority people are alerted
   * for at once alerts them; one that reached Contained or Closed some
   * other way is reviewed now. Never throws.
   */
  public static async onCaseChanged(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    // A person made the change - not a playbook, OneUptime AI or its checks.
    byUserId?: ObjectID | undefined;
    isAssignedToPerson: boolean;
    isStatusChanged: boolean;
    isPriorityRaised: boolean;
  }): Promise<void> {
    try {
      if (data.byUserId && (data.isAssignedToPerson || data.isStatusChanged)) {
        await this.endHold({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          outcome: SecurityCaseAiHoldOutcome.TakenByPerson,
          byUserId: data.byUserId,
        });
        return;
      }

      if (data.isPriorityRaised || data.isStatusChanged) {
        await this.review({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        });
      }
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not act on a change of held case ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
    }
  }

  /*
   * The project's switches changed: letting OneUptime AI respond first,
   * working cases end to end, or AI itself turned off hands every case it
   * holds to people. Never throws.
   */
  public static async onProjectSettingsChanged(data: {
    projectId: ObjectID;
  }): Promise<void> {
    try {
      await this.endEveryHold({
        projectId: data.projectId,
        outcome: SecurityCaseAiHoldOutcome.TurnedOff,
      });
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not hand the cases project ${data.projectId.toString()} holds to people:`,
      );
      logger.error(error);
    }
  }

  // ---------- The Page On-Call steps that wait ----------

  /*
   * What a playbook's Page On-Call step does about the case's hold, when
   * its run reaches it (SecurityPlaybookEngine): page, wait, or skip
   * (decideSecurityCaseAiHoldPage). A case that cannot be read pages: a
   * doubt never keeps a page from people.
   */
  public static async getPageDecision(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    run: Pick<
      SecurityPlaybookRun,
      "trigger" | "triggeredByUserId" | "createdAt"
    >;
  }): Promise<{
    decision: SecurityCaseAiHoldPageDecision;
    // How the hold ended, for a page skipped: what its step says.
    outcome: SecurityCaseAiHoldOutcome | null;
  }> {
    try {
      const securityCase: SecurityCase | null =
        await SecurityCaseService.findOneBy({
          query: { _id: data.securityCaseId, projectId: data.projectId },
          select: { _id: true, aiHoldOutcome: true, aiHoldEndedAt: true },
          props: { isRoot: true },
        });

      return {
        decision: decideSecurityCaseAiHoldPage({
          outcome: securityCase?.aiHoldOutcome,
          holdEndedAt: securityCase?.aiHoldEndedAt,
          run: {
            trigger: data.run.trigger,
            isStartedByPerson: Boolean(data.run.triggeredByUserId),
            createdAt: data.run.createdAt,
          },
        }),
        outcome: securityCase?.aiHoldOutcome || null,
      };
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not read case ${data.securityCaseId.toString()}'s hold for a page; paging:`,
      );
      logger.error(error);
      return { decision: SecurityCaseAiHoldPageDecision.Page, outcome: null };
    }
  }

  // Why a Page On-Call step that waited was skipped, as its result says it.
  public static getPageSkippedMessage(
    outcome: SecurityCaseAiHoldOutcome | null,
  ): string {
    return outcome === SecurityCaseAiHoldOutcome.TakenByPerson
      ? `Skipped: a person took the case while ${getAiName()} responded first, so nobody else was paged.`
      : `Skipped: the case was resolved while ${getAiName()} responded first, so nobody had to be paged.`;
  }

  // Whether the case is held now.
  public static async isHeld(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<boolean> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, aiHoldOutcome: true },
        props: { isRoot: true },
      });

    return securityCase?.aiHoldOutcome === SecurityCaseAiHoldOutcome.Holding;
  }

  /*
   * The case's playbook runs that wait for OneUptime AI, carried on: each
   * queued again, once (a compare-and-set from Waiting for OneUptime AI),
   * to page or skip its step as the hold ended. Returns how many.
   */
  public static async carryOnWaitingRuns(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<number> {
    try {
      const runs: Array<SecurityPlaybookRun> =
        await SecurityPlaybookRunService.findBy({
          query: {
            projectId: data.projectId,
            securityCaseId: data.securityCaseId,
            status: SecurityPlaybookRunStatus.WaitingForOneUptimeAi,
          },
          select: { _id: true },
          skip: 0,
          limit: WAITING_RUNS_READ_LIMIT,
          props: { isRoot: true },
        });

      return await this.queueAgain(runs);
    } catch (error) {
      logger.error(
        `SecurityCaseAiHold: could not carry on the playbook runs of case ${data.securityCaseId.toString()} that waited for OneUptime AI:`,
      );
      logger.error(error);
      return 0;
    }
  }

  /*
   * The runs still waiting a minute after their case's hold ended - one
   * that came to wait just as the hold ended, a hold's end that failed
   * part way - carried on.
   */
  private static async carryOnLeftRuns(now: Date): Promise<void> {
    const runs: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: {
          status: SecurityPlaybookRunStatus.WaitingForOneUptimeAi,
          updatedAt: QueryHelper.lessThanEqualTo(
            OneUptimeDate.addRemoveMinutes(now, -WAITING_RUN_GRACE_IN_MINUTES),
          ),
        },
        select: { _id: true, projectId: true, securityCaseId: true },
        skip: 0,
        limit: WAITING_RUNS_READ_LIMIT,
        props: { isRoot: true },
      });

    const left: Array<SecurityPlaybookRun> = [];

    for (const run of runs) {
      if (!run.projectId || !run.securityCaseId) {
        continue;
      }

      try {
        if (
          !(await this.isHeld({
            projectId: run.projectId,
            securityCaseId: run.securityCaseId,
          }))
        ) {
          left.push(run);
        }
      } catch (error) {
        logger.error(error);
      }
    }

    await this.queueAgain(left);
  }

  private static async queueAgain(
    runs: Array<SecurityPlaybookRun>,
  ): Promise<number> {
    let queued: number = 0;

    for (const run of runs) {
      if (!run.id) {
        continue;
      }

      try {
        const isQueued: boolean =
          await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks(
            {
              id: run.id,
              data: { status: SecurityPlaybookRunStatus.Queued },
              expectedData: {
                status: SecurityPlaybookRunStatus.WaitingForOneUptimeAi,
              },
            },
          );

        if (isQueued) {
          await SecurityPlaybookEngine.enqueueRun(run.id);
          queued++;
        }
      } catch (error) {
        logger.error(
          `SecurityCaseAiHold: could not carry on playbook run ${run.id.toString()}:`,
        );
        logger.error(error);
      }
    }

    return queued;
  }

  private static async readCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<SecurityCase | null> {
    return await SecurityCaseService.findOneBy({
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: CASE_SELECT,
      props: { isRoot: true },
    });
  }
}
