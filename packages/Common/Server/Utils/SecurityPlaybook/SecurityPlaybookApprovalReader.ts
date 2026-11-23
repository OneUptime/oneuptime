import crypto from "crypto";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEntity,
  mergeSecurityEntities,
  readSecurityEntities,
  securityEntityKey,
} from "../../../Types/SecurityCase/SecurityEntity";
import { readSecurityDetectionMatchedEvents } from "../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import SecurityEventRequestOutcome, {
  isSecurityEventRequestOutcome,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  actsOnSecurityEntities,
  getSecurityPlaybookAction,
  getSecurityPlaybookUndoAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { readOneStepRun } from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "../SecurityBlocklist/SecurityProtectedAddresses";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
  isFinishedSecurityPlaybookRunStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  readStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger, {
  isOneUptimeAiRun,
  isSecurityPlaybookTrigger,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  SecurityPlaybookApprovalAsk,
  SecurityPlaybookApprovalEvidence,
  SecurityPlaybookApprovalEvidenceKind,
  SecurityPlaybookApprovalProgress,
  SecurityPlaybookApprovalSource,
  SecurityPlaybookApprovalSourceKind,
  SecurityPlaybookApprovalStanding,
  SecurityPlaybookApprovalStandingKind,
  SecurityPlaybookApprovalTarget,
} from "../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import SecurityEventConnectionService from "../../Services/SecurityEventConnectionService";
import SecurityPlaybookRunService from "../../Services/SecurityPlaybookRunService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../Services/ThreatIntelIndicatorService";
import UserService from "../../Services/UserService";
import FeedPersonName from "../Feed/FeedPersonName";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A PLAYBOOK STEP'S APPROVAL, READ FROM ITS RUN AS IT IS NOW.
 *
 * A step that waits for approval is asked about in Slack, Microsoft Teams,
 * the email and the phone (#10341), and every copy of the question says
 * where it stands once somebody decides - here, in the Dashboard, in the
 * mobile app or in another copy of it. Each is drawn from this: the run,
 * read as OneUptime, and the step it asks about, made into what its message
 * says (SecurityPlaybookApprovalWords) -
 *
 *   - the case, and the approval on it in OneUptime (its Playbook Runs);
 *   - the action, the connection it acts through, and every target as the
 *     step's result keeps it - proposed, protected, left out, and once it
 *     ran, how each went, and its undo;
 *   - who or what asked: the person who ran the playbook, or the playbook
 *     that started on its own, and what started it;
 *   - the evidence the case holds: how far the requests behind it got
 *     (what its detections kept as they fired, never a new read of the
 *     events), what threat intel knows of its other entities, and that
 *     nothing it acts on is protected;
 *   - where it stands: waiting, approved and how the step went since,
 *     rejected, or no longer waiting.
 *
 * The round it asks about is the run and the step - a step is asked about
 * once in a run: approved, it runs; rejected, the run ends - and what the
 * step proposed (getTargetsDigest), which a press is held to.
 *
 * Evidence that cannot be read is left out, logged: the message never says
 * more than OneUptime knows.
 */

// A step's approval, as a press names it and every copy of it is kept by.
export interface SecurityPlaybookApprovalRound {
  projectId: ObjectID;
  runId: ObjectID;
  securityCaseId: ObjectID;
  // The step it asks about: its place in the run, and its id.
  stepIndex: number;
  stepId: string;
  // What the step proposed when it was asked about (getTargetsDigest).
  targetsDigest: string;
}

export interface SecurityPlaybookApprovalRead {
  round: SecurityPlaybookApprovalRound;
  ask: SecurityPlaybookApprovalAsk;
  // The run as read: who started it, and where it is.
  run: SecurityPlaybookRun;
  step: SecurityPlaybookStep;
  result: SecurityPlaybookStepResult;
}

// A digest of what a step proposed, as a value carries it: 132 bits of SHA-256.
const TARGETS_DIGEST_LENGTH: number = 22;

// How many of a case's detections are read for the requests behind them.
const EVIDENCE_DETECTIONS_LIMIT: number = 100;

// The most values an evidence line names.
const EVIDENCE_VALUES_LIMIT: number = 10;

export default class SecurityPlaybookApprovalReader {
  public static readonly RUN_SELECT: {
    _id: true;
    projectId: true;
    securityCaseId: true;
    securityPlaybookId: true;
    playbookName: true;
    status: true;
    trigger: true;
    steps: true;
    stepResults: true;
    currentStepIndex: true;
    triggeredByUserId: true;
    completedAt: true;
  } = {
    _id: true,
    projectId: true,
    securityCaseId: true,
    securityPlaybookId: true,
    playbookName: true,
    status: true,
    trigger: true,
    steps: true,
    stepResults: true,
    currentStepIndex: true,
    triggeredByUserId: true,
    completedAt: true,
  };

  // The run, as OneUptime reads it, in its project only.
  @CaptureSpan()
  public static async readRun(data: {
    projectId: ObjectID;
    runId: ObjectID;
  }): Promise<SecurityPlaybookRun | null> {
    const run: SecurityPlaybookRun | null =
      await SecurityPlaybookRunService.findOneBy({
        query: {
          _id: data.runId.toString(),
          projectId: data.projectId,
        },
        select: SecurityPlaybookApprovalReader.RUN_SELECT,
        props: { isRoot: true },
      });

    return run && run.id ? run : null;
  }

  /*
   * The step of `run` an approval asks about: `stepIndex` when given, the
   * step the run waits on otherwise. Null for one that is not there, or
   * whose run's steps no longer read.
   */
  public static getStep(data: {
    run: SecurityPlaybookRun;
    stepIndex?: number | undefined;
  }): {
    step: SecurityPlaybookStep;
    result: SecurityPlaybookStepResult;
    stepIndex: number;
  } | null {
    let steps: Array<SecurityPlaybookStep>;

    try {
      steps = parseSecurityPlaybookSteps(data.run.steps);
    } catch {
      return null;
    }

    const results: Array<SecurityPlaybookStepResult> = readStepResults(
      data.run.stepResults,
      steps,
    );
    const stepIndex: number =
      data.stepIndex !== undefined
        ? data.stepIndex
        : SecurityPlaybookApprovalReader.getAskedStepIndex({
            run: data.run,
            steps,
            results,
          });
    const step: SecurityPlaybookStep | undefined = steps[stepIndex];
    const result: SecurityPlaybookStepResult | undefined = results[stepIndex];

    if (!step || !result) {
      return null;
    }

    return { step, result, stepIndex };
  }

  /*
   * The step a run's approval is about, when nobody names one: the step it
   * waits on - or, once the run moved on, the last one it asked a person
   * about: decided, still marked waiting, or the step the run stopped at
   * while it waited (cancelled). A run that asked nobody: the step it is on.
   */
  public static getAskedStepIndex(data: {
    run: SecurityPlaybookRun;
    steps: Array<SecurityPlaybookStep>;
    results: Array<SecurityPlaybookStepResult>;
  }): number {
    const current: number = Math.max(0, data.run.currentStepIndex || 0);

    if (data.run.status === SecurityPlaybookRunStatus.WaitingForApproval) {
      return current;
    }

    for (
      let index: number = Math.min(current, data.steps.length - 1);
      index >= 0;
      index--
    ) {
      const result: SecurityPlaybookStepResult | undefined =
        data.results[index];

      if (
        result?.approval ||
        result?.status === SecurityPlaybookStepStatus.WaitingForApproval ||
        (index === current && data.steps[index]?.requiresApproval)
      ) {
        return index;
      }
    }

    return current;
  }

  /*
   * What a step proposed to act on, as a press is held to it: its action,
   * its connection, and the targets it proposed. A step that proposes the
   * same things digests the same, however its results are stored.
   */
  public static getTargetsDigest(data: {
    step: Pick<SecurityPlaybookStep, "action" | "config">;
    targets: Array<Pick<SecurityPlaybookTarget, "value" | "state">> | undefined;
  }): string {
    const connectionId: JSONValue | undefined = data.step.config?.[
      "connectionId"
    ] as JSONValue | undefined;
    const proposed: Array<string> = (data.targets || [])
      .filter((target: Pick<SecurityPlaybookTarget, "state">): boolean => {
        return target.state === SecurityPlaybookTargetState.Proposed;
      })
      .map((target: Pick<SecurityPlaybookTarget, "value">): string => {
        return target.value.trim().toLowerCase();
      })
      .sort();

    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          data.step.action,
          typeof connectionId === "string" ? connectionId.toLowerCase() : "",
          proposed,
        ]),
        "utf8",
      )
      .digest("base64url")
      .slice(0, TARGETS_DIGEST_LENGTH);
  }

  // The approval on the case in OneUptime: its Playbook Runs, with Approve and Reject.
  public static async getApprovalUrl(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<URL> {
    return (
      await SecurityCaseService.getCaseLinkInDashboard(
        data.projectId,
        data.securityCaseId,
      )
    ).addRoute("/playbook-runs");
  }

  /*
   * A step's approval as its message says it now: the run's step that
   * waits, or `stepIndex`'s. Null for a run, step or case that is not
   * there.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    runId: ObjectID;
    stepIndex?: number | undefined;
    // The run, when the caller has read it already with RUN_SELECT.
    run?: SecurityPlaybookRun | undefined;
    /*
     * Whether the evidence is read (on by default): a press decides on the
     * run as it is, and shows none of it - nor waits on it while Slack's
     * three seconds to open a form run.
     */
    withEvidence?: boolean | undefined;
  }): Promise<SecurityPlaybookApprovalRead | null> {
    const run: SecurityPlaybookRun | null =
      data.run || (await SecurityPlaybookApprovalReader.readRun(data));

    if (!run || !run.id || !run.securityCaseId) {
      return null;
    }

    const found: {
      step: SecurityPlaybookStep;
      result: SecurityPlaybookStepResult;
      stepIndex: number;
    } | null = SecurityPlaybookApprovalReader.getStep({
      run,
      stepIndex: data.stepIndex,
    });

    if (!found) {
      return null;
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: {
          _id: run.securityCaseId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          caseNumberWithPrefix: true,
          title: true,
          entities: true,
        },
        props: { isRoot: true },
      });

    if (!securityCase) {
      return null;
    }

    const { step, result, stepIndex } = found;
    const definition: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(step.action);
    const actsOnEntities: boolean = actsOnSecurityEntities(definition);
    const targets: Array<SecurityPlaybookTarget> = result.targets || [];

    const ask: SecurityPlaybookApprovalAsk = {
      caseNumber: securityCase.caseNumberWithPrefix || "Case",
      caseTitle: securityCase.title || "",
      caseUrl: (
        await SecurityPlaybookApprovalReader.getApprovalUrl({
          projectId: data.projectId,
          securityCaseId: run.securityCaseId,
        })
      ).toString(),
      action: step.action,
      connectionName: await SecurityPlaybookApprovalReader.getConnectionName({
        projectId: data.projectId,
        step,
      }),
      targets: await SecurityPlaybookApprovalReader.toAskTargets(targets),
      source: await SecurityPlaybookApprovalReader.getSource(run, {
        isOneStepRun: readOneStepRun(run) !== null,
      }),
      evidence:
        data.withEvidence === false
          ? []
          : await SecurityPlaybookApprovalReader.getEvidence({
              projectId: data.projectId,
              securityCase,
              targets,
              actsOnEntities,
              action: step.action,
            }),
      undoAction:
        actsOnEntities && definition
          ? getSecurityPlaybookUndoAction(definition.type)?.type
          : undefined,
      standing: await SecurityPlaybookApprovalReader.getStanding({
        run,
        result,
      }),
    };

    return {
      round: {
        projectId: data.projectId,
        runId: run.id,
        securityCaseId: run.securityCaseId,
        stepIndex,
        stepId: step.id,
        targetsDigest: SecurityPlaybookApprovalReader.getTargetsDigest({
          step,
          targets,
        }),
      },
      ask,
      run,
      step,
      result,
    };
  }

  /*
   * Where an approval stands, from its run and the step's result:
   *
   *   - waiting, while the run waits on the step;
   *   - approved, by whom and when, and how the step went since: running
   *     (queued or under way), done, failed, or stopped before it ran - the
   *     run cancelled, or ended otherwise;
   *   - rejected, by whom and when;
   *   - no longer waiting: the run stopped waiting with nobody deciding.
   */
  public static async getStanding(data: {
    run: Pick<SecurityPlaybookRun, "status" | "completedAt">;
    result: SecurityPlaybookStepResult;
  }): Promise<SecurityPlaybookApprovalStanding> {
    const { run, result } = data;
    const decision: SecurityPlaybookApprovalDecision | undefined =
      result.approval?.decision;

    if (
      !decision &&
      run.status === SecurityPlaybookRunStatus.WaitingForApproval &&
      result.status === SecurityPlaybookStepStatus.WaitingForApproval
    ) {
      return { kind: SecurityPlaybookApprovalStandingKind.Waiting };
    }

    if (!decision) {
      return {
        kind: SecurityPlaybookApprovalStandingKind.NoLongerWaiting,
        isRunCancelled: run.status === SecurityPlaybookRunStatus.Cancelled,
      };
    }

    const deciderName: string =
      await SecurityPlaybookApprovalReader.getPersonName(
        result.approval?.decidedByUserId,
      );
    const decidedAt: Date | undefined = SecurityPlaybookApprovalReader.readDate(
      result.approval?.decidedAt,
    );

    if (decision === SecurityPlaybookApprovalDecision.Rejected) {
      return {
        kind: SecurityPlaybookApprovalStandingKind.Rejected,
        deciderName,
        decidedAt,
      };
    }

    const completedAt: Date | undefined =
      SecurityPlaybookApprovalReader.readDate(result.completedAt);

    let progress: SecurityPlaybookApprovalProgress;

    switch (result.status) {
      case SecurityPlaybookStepStatus.Succeeded:
        progress = SecurityPlaybookApprovalProgress.Done;
        break;
      case SecurityPlaybookStepStatus.Failed:
        progress = SecurityPlaybookApprovalProgress.Failed;
        break;
      default:
        progress =
          run.status === SecurityPlaybookRunStatus.Cancelled
            ? SecurityPlaybookApprovalProgress.CancelledBeforeRun
            : isFinishedSecurityPlaybookRunStatus(run.status)
              ? SecurityPlaybookApprovalProgress.StoppedBeforeRun
              : SecurityPlaybookApprovalProgress.Running;
    }

    return {
      kind: SecurityPlaybookApprovalStandingKind.Approved,
      deciderName,
      decidedAt,
      progress,
      completedAt,
      ...(progress === SecurityPlaybookApprovalProgress.Failed
        ? { error: result.error || "" }
        : {}),
    };
  }

  /*
   * Who or what asked for the step: the person who ran the playbook by
   * hand, else the playbook, by what started it.
   */
  public static async getSource(
    run: Pick<
      SecurityPlaybookRun,
      "playbookName" | "trigger" | "triggeredByUserId"
    >,
    options: {
      /*
       * A person's one-step run from a case (#10342): asked for by them on
       * the case, with no playbook to name.
       */
      isOneStepRun?: boolean | undefined;
    } = {},
  ): Promise<SecurityPlaybookApprovalSource> {
    const playbookName: string = run.playbookName || "";

    /*
     * One of OneUptime AI's steps, working the case (#10352): asked by
     * OneUptime AI, with no playbook to name.
     */
    if (isOneUptimeAiRun(run)) {
      return {
        kind: SecurityPlaybookApprovalSourceKind.OneUptimeAi,
        playbookName: "",
      };
    }

    if (run.triggeredByUserId) {
      const personName: string =
        await SecurityPlaybookApprovalReader.getPersonName(
          run.triggeredByUserId.toString(),
        );

      if (personName) {
        return {
          kind: SecurityPlaybookApprovalSourceKind.Person,
          playbookName: options.isOneStepRun ? "" : playbookName,
          personName,
        };
      }
    }

    return {
      kind: SecurityPlaybookApprovalSourceKind.Playbook,
      playbookName,
      trigger:
        !run.triggeredByUserId && isSecurityPlaybookTrigger(run.trigger)
          ? run.trigger
          : SecurityPlaybookTrigger.Manual,
    };
  }

  // The step's targets as the message names them: who undid one, by name.
  private static async toAskTargets(
    targets: Array<SecurityPlaybookTarget>,
  ): Promise<Array<SecurityPlaybookApprovalTarget>> {
    const askTargets: Array<SecurityPlaybookApprovalTarget> = [];

    for (const target of targets) {
      askTargets.push({
        value: target.value,
        reason: target.reason,
        state: target.state,
        ...(target.detail ? { detail: target.detail } : {}),
        ...(target.protectedBy ? { protectedBy: target.protectedBy } : {}),
        ...(target.state === SecurityPlaybookTargetState.Undone
          ? {
              undoneByName: await SecurityPlaybookApprovalReader.getPersonName(
                target.undoneByUserId,
              ),
              undoneAt: SecurityPlaybookApprovalReader.readDate(
                target.undoneAt,
              ),
            }
          : {}),
      });
    }

    return askTargets;
  }

  // The connection a step acts through, by its name; none for a step that has none.
  private static async getConnectionName(data: {
    projectId: ObjectID;
    step: SecurityPlaybookStep;
  }): Promise<string | undefined> {
    const connectionId: JSONValue | undefined = data.step.config?.[
      "connectionId"
    ] as JSONValue | undefined;

    if (
      typeof connectionId !== "string" ||
      !ObjectID.isValidUUID(connectionId)
    ) {
      return undefined;
    }

    try {
      const connection: SecurityEventConnection | null =
        await SecurityEventConnectionService.findOneBy({
          query: {
            _id: connectionId,
            projectId: data.projectId,
          },
          select: { name: true },
          props: { isRoot: true },
        });

      return connection?.name || undefined;
    } catch (error) {
      logger.error(
        `SecurityPlaybookApprovalReader: could not read the connection of a step: ${error}`,
        { projectId: data.projectId.toString() },
      );
      return undefined;
    }
  }

  /*
   * What the case holds that says why: the requests behind it, by how far
   * they got; what threat intel knows of its entities that are not a
   * target already said to be known to it; and, for a step that acts on
   * entities, that nothing it acts on is on the protected list - the list
   * was read when the targets were picked, and is read again before the
   * step acts (SecurityPlaybookTargets.protect).
   */
  private static async getEvidence(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    targets: Array<SecurityPlaybookTarget>;
    actsOnEntities: boolean;
    action?: SecurityPlaybookActionType | undefined;
  }): Promise<Array<SecurityPlaybookApprovalEvidence>> {
    const evidence: Array<SecurityPlaybookApprovalEvidence> = [];

    const outcomes: Partial<Record<SecurityEventRequestOutcome, number>> =
      await SecurityPlaybookApprovalReader.readRequestOutcomes({
        projectId: data.projectId,
        securityCaseId: data.securityCase.id!,
      });

    if (Object.keys(outcomes).length > 0) {
      evidence.push({
        kind: SecurityPlaybookApprovalEvidenceKind.Requests,
        outcomes,
      });
    }

    const knownTargets: Set<string> = new Set(
      data.targets
        .filter((target: SecurityPlaybookTarget): boolean => {
          return target.reason === SecurityPlaybookTargetReason.ThreatIntel;
        })
        .map((target: SecurityPlaybookTarget): string => {
          return target.value.trim().toLowerCase();
        }),
    );

    const known: Array<string> = (
      await SecurityPlaybookApprovalReader.readThreatIntelValues({
        projectId: data.projectId,
        securityCase: data.securityCase,
      })
    ).filter((value: string): boolean => {
      return !knownTargets.has(value.trim().toLowerCase());
    });

    if (known.length > 0) {
      evidence.push({
        kind: SecurityPlaybookApprovalEvidenceKind.ThreatIntel,
        values: known.slice(0, EVIDENCE_VALUES_LIMIT),
      });
    }

    const actsOnSome: boolean = data.targets.some(
      (target: SecurityPlaybookTarget): boolean => {
        return target.state !== SecurityPlaybookTargetState.Protected;
      },
    );

    if (data.actsOnEntities && actsOnSome) {
      evidence.push({
        kind: SecurityPlaybookApprovalEvidenceKind.NotProtected,
      });
    }

    // A block (#10342): the addresses it blocks are none of the project's own.
    if (data.action === SecurityPlaybookActionType.BlockAddress) {
      const notOwn: Array<string> =
        await SecurityPlaybookApprovalReader.readNotOwnAddresses({
          projectId: data.projectId,
          targets: data.targets,
        });

      if (notOwn.length > 0) {
        evidence.push({
          kind: SecurityPlaybookApprovalEvidenceKind.NotOwnAddress,
          values: notOwn,
        });
      }
    }

    return evidence;
  }

  /*
   * The addresses a block proposes that OneUptime read as none of the
   * project's own - no host, load balancer, probe, edge or protected entry
   * holds them (SecurityProtectedAddresses). One whose sources could not
   * all be read is left out: the message never says more than OneUptime
   * knows.
   */
  private static async readNotOwnAddresses(data: {
    projectId: ObjectID;
    targets: Array<SecurityPlaybookTarget>;
  }): Promise<Array<string>> {
    const notOwn: Array<string> = [];

    for (const target of data.targets) {
      if (
        target.state !== SecurityPlaybookTargetState.Proposed ||
        notOwn.length >= EVIDENCE_VALUES_LIMIT
      ) {
        continue;
      }

      const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
        target.value,
      );

      if (!block) {
        continue;
      }

      try {
        const check: SecurityProtectionCheck =
          await SecurityProtectedAddresses.findProtection({
            projectId: data.projectId,
            block,
          });

        if (!check.protection && check.unreadSources.length === 0) {
          notOwn.push(target.value);
        }
      } catch (error) {
        logger.error(
          `SecurityPlaybookApprovalReader: could not check whether ${target.value} is one of the project's own addresses: ${error}`,
          { projectId: data.projectId.toString() },
        );
      }
    }

    return notOwn;
  }

  /*
   * How far the requests behind the case got, as its detections kept them
   * when they fired (SecurityDetection.matchedEvents): a request no trace
   * followed is not counted. Empty when none was followed, or the
   * detections cannot be read.
   */
  public static async readRequestOutcomes(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<Partial<Record<SecurityEventRequestOutcome, number>>> {
    const outcomes: Partial<Record<SecurityEventRequestOutcome, number>> = {};

    try {
      const detections: Array<SecurityDetection> =
        await SecurityDetectionService.findBy({
          query: {
            projectId: data.projectId,
            securityCaseId: data.securityCaseId,
          },
          select: { matchedEvents: true },
          skip: 0,
          limit: EVIDENCE_DETECTIONS_LIMIT,
          props: { isRoot: true },
        });

      for (const detection of detections) {
        const kept: ReturnType<typeof readSecurityDetectionMatchedEvents> =
          readSecurityDetectionMatchedEvents(detection.matchedEvents);

        for (const [outcome, count] of Object.entries(kept?.outcomes || {})) {
          const counted: number = Math.max(0, Math.trunc(Number(count) || 0));

          if (!isSecurityEventRequestOutcome(outcome) || counted === 0) {
            continue;
          }

          outcomes[outcome] = (outcomes[outcome] || 0) + counted;
        }
      }
    } catch (error) {
      logger.error(
        `SecurityPlaybookApprovalReader: could not read the requests behind case ${data.securityCaseId.toString()}: ${error}`,
        { projectId: data.projectId.toString() },
      );
      return {};
    }

    return outcomes;
  }

  // The case's entities the project's threat intel knows now, as written on the case.
  private static async readThreatIntelValues(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
  }): Promise<Array<string>> {
    const entities: Array<SecurityEntity> = mergeSecurityEntities(
      readSecurityEntities(data.securityCase.entities),
    );

    if (entities.length === 0) {
      return [];
    }

    try {
      const indicators: Array<ActiveIndicator> =
        await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
          projectId: data.projectId,
          values: entities.map((entity: SecurityEntity): string => {
            return securityEntityKey(entity);
          }),
          now: OneUptimeDate.getCurrentDate(),
        });

      const known: Set<string> = new Set(
        indicators.map((indicator: ActiveIndicator): string => {
          return indicator.indicatorValue.trim().toLowerCase();
        }),
      );

      return entities
        .filter((entity: SecurityEntity): boolean => {
          return known.has(securityEntityKey(entity));
        })
        .map((entity: SecurityEntity): string => {
          return entity.value.trim();
        });
    } catch (error) {
      logger.error(
        `SecurityPlaybookApprovalReader: could not ask threat intel about a case: ${error}`,
        { projectId: data.projectId.toString() },
      );
      return [];
    }
  }

  /*
   * A person, as an approval's messages name them - in the channels and
   * chats it is posted to, the approvers' direct messages and the email to
   * every approver. Everybody named there acted on the run: started it by
   * hand, decided the step or undid a target. So a member, named by their
   * name, else the part of their address before the "@"
   * (FeedPersonName.getMemberName, #10681): never their address, which
   * the messages said of anybody with no name. Empty for nobody.
   */
  public static async getPersonName(
    userId: string | ObjectID | undefined | null,
  ): Promise<string> {
    const id: string = userId ? userId.toString() : "";

    if (!id || !ObjectID.isValidUUID(id)) {
      return "";
    }

    try {
      const user: User | null = await UserService.findOneById({
        id: new ObjectID(id),
        select: { name: true, email: true },
        props: { isRoot: true },
      });

      return FeedPersonName.getMemberName({
        name: user?.name,
        email: user?.email,
      });
    } catch (error) {
      logger.debug(`Could not read the name of a person: ${error}`);
      return "";
    }
  }

  private static readDate(value: string | undefined): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date: Date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
