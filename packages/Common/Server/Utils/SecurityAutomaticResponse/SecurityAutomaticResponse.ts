import SecurityAutomaticResponseAction from "../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityAutomaticResponsePolicy from "../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  Gray500,
  Indigo500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_AUTOMATIC_RESPONSE_LIMIT_WINDOW_IN_MS,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyDefinition,
  readSecurityAutomaticResponsePolicyDefinition,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityAutomaticResponseMatchResult,
  isListedByThreatIntelDetection,
  matchSecurityAutomaticResponseDetection,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseMatch";
import {
  SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
  SecurityAutomaticResponseOutcome,
  isSecurityAutomaticResponseActedOutcome,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import { getSecurityRepeatOffenderDuration } from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SECURITY_BLOCK_DURATION_IN_MS,
  SECURITY_BLOCK_MESSAGES,
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockValue,
  isSecurityBlockDuration,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_PROTECTED_RECORD_SOURCES,
  SecurityAddressProtection,
  describeSecurityAddressProtection,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  readSecurityDetectionMatchedEvents,
} from "../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  OneStepRunRead,
  readOneStepRun,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import OldestKeyMap from "../../../Utils/OldestKeyMap";
import {
  automaticResponseLimitMarkdown,
  automaticResponseSparedMarkdown,
  automaticResponseTrialMarkdown,
  describeSignedInUserNames,
} from "../../../Utils/SecurityAutomaticResponse/SecurityAutomaticResponseMarkdown";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityAutomaticResponseActionService from "../../Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../Services/SecurityAutomaticResponsePolicyService";
import SecurityBlockService from "../../Services/SecurityBlockService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import SecurityPlaybookRunService, {
  UNFINISHED_SECURITY_PLAYBOOK_RUN_STATUSES,
} from "../../Services/SecurityPlaybookRunService";
import ThreatIntelIndicatorService from "../../Services/ThreatIntelIndicatorService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityAutomaticResponseOwners from "./SecurityAutomaticResponseOwners";
import SecurityRepeatOffenders from "./SecurityRepeatOffenders";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressCheck,
  SecuritySignedInAddressState,
  SecuritySignedInSource,
  SecuritySignedInUser,
} from "./SecuritySignedInAddresses";

/*
 * AUTOMATIC RESPONSE, AS THE DETECTION IS MADE (#10350).
 *
 * Every source of detections hands them to SecurityCaseIngest, which
 * records them on cases and then hands each to screen(), before any
 * playbook runs and before triage: a detection a policy in its trial run
 * or on may act on - a public address it is about, a technique or rule of
 * the policy - gets a decision job, queued at once so nothing a policy
 * does holds up the next project's detections. A real-time rule makes its
 * detection seconds after the attack's events are written, so its policy
 * decides seconds after that.
 *
 * The job decides under the project's lock, so two decisions never both
 * take the hour's last block, and runs every guardrail in order:
 *
 *   1. what it matches, with every fact read: every request the detection
 *      matched so far turned away (Scanners), threat intel listing the
 *      address (Known-Bad Addresses), the address the requests' own;
 *   2. once an address: one already blocked, one whose block is on its
 *      way on the case - a person's or OneUptime AI's one-step run of
 *      Block Address waiting or running (#10342, #10352) - or one decided
 *      about lately, is left as it is;
 *   3. never a protected or own address (#10338): SecurityBlockService's
 *      check, as the blocklist makes it; one it cannot check is left for a
 *      person;
 *   4. never an address a signed-in user used in the last 30 days
 *      (SecuritySignedInAddresses), hashed addresses included; one it
 *      cannot tell about is left for a person;
 *   5. the repeat-offender ladder: the policy's first length, longer for an
 *      address blocked before in the last 30 days (SecurityRepeatOffenders);
 *   6. at most 50 automatic blocks an hour per project: past it the policy
 *      stops, and pages the project's security owners, once an hour.
 *
 * Then a policy in its trial run records what it would have done, on its
 * record and the case; a policy that is on blocks through the playbook
 * engine, as a person's block from a case is (#10342): a one-step run with
 * the policy's id (SecurityPlaybookRunService.startOneStepRun), whose step
 * needs nobody's approval - the project turned the policy on, and the step
 * says who and when - and whose block goes through the blocklist's one way
 * in, with its protected checks, its timeline and its audit record. What a
 * guardrail decided is recorded, and said on the case.
 */

export const SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB: string =
  "SecurityAutomaticResponse:Decide";

// One decision's turn on a worker, at most.
export const SECURITY_AUTOMATIC_RESPONSE_DECIDE_TIMEOUT_IN_MS: number =
  5 * 60 * 1000;

// How long a project's active policies are kept before they are read again.
export const SECURITY_AUTOMATIC_RESPONSE_POLICIES_CACHE_TTL_MS: number =
  30 * 1000;

// The most projects whose policies one process keeps.
export const SECURITY_AUTOMATIC_RESPONSE_POLICIES_CACHE_MAX_PROJECTS: number = 10000;

/*
 * How long an address a guardrail spared is not decided about again by the
 * same policy: an hour, and ten minutes when OneUptime could not tell - a
 * read that failed may work in a moment.
 */
export const SECURITY_AUTOMATIC_RESPONSE_SPARED_AGAIN_AFTER_MS: number =
  60 * 60 * 1000;
export const SECURITY_AUTOMATIC_RESPONSE_CANNOT_TELL_AGAIN_AFTER_MS: number =
  10 * 60 * 1000;

// A detection as the screen reads it, as it was just recorded.
export interface SecurityAutomaticResponseRecordedDetection {
  securityCaseId: ObjectID;
  securityDetectionId: ObjectID;
  source: SecurityDetectionSource;
  detectionRuleId?: ObjectID | undefined;
  mitreTechniques: Array<string>;
  groupValue?: string | undefined;
  isSetupTest?: boolean | undefined;
}

// What a decision job carries.
export interface SecurityAutomaticResponseJobData {
  projectId: string;
  securityAutomaticResponsePolicyId: string;
  securityCaseId: string;
  securityDetectionId: string;
  address: string;
}

// What a decision came to, for its job's log and its tests.
export interface SecurityAutomaticResponseDecision {
  outcome: SecurityAutomaticResponseOutcome;
  address: string;
  isTrialRun: boolean;
  duration: SecurityBlockDuration | null;
  detail: string | null;
  securityAutomaticResponseActionId: ObjectID | null;
  securityPlaybookRunId: ObjectID | null;
}

interface CachedPolicies {
  loadedAtMs: number;
  policies: Array<SecurityAutomaticResponsePolicy>;
}

// What a job carries, read defensively: one written by an older version, or broken, names nothing.
export function readSecurityAutomaticResponseJobData(
  value: unknown,
): SecurityAutomaticResponseJobData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data: JSONObject = value as JSONObject;
  const ids: Array<string> = [
    "projectId",
    "securityAutomaticResponsePolicyId",
    "securityCaseId",
    "securityDetectionId",
  ];

  for (const key of ids) {
    const id: unknown = data[key];

    if (typeof id !== "string" || !ObjectID.isValidUUID(id)) {
      return null;
    }
  }

  const address: SecurityBlockValue | null = readSecurityBlockValue(
    data["address"],
  );

  if (!address) {
    return null;
  }

  return {
    projectId: data["projectId"] as string,
    securityAutomaticResponsePolicyId: data[
      "securityAutomaticResponsePolicyId"
    ] as string,
    securityCaseId: data["securityCaseId"] as string,
    securityDetectionId: data["securityDetectionId"] as string,
    address: address.value,
  };
}

// How long a block of a length lasts, in milliseconds; a day for a length off the ladder.
function durationInMs(duration: unknown): number {
  return isSecurityBlockDuration(duration) &&
    duration !== SecurityBlockDuration.UntilLifted
    ? SECURITY_BLOCK_DURATION_IN_MS[duration]
    : SECURITY_BLOCK_DURATION_IN_MS[SecurityBlockDuration.OneDay];
}

/*
 * What protects an address, as a policy's record and the case say it: the
 * record that protects it is never named, as everyone who reads playbooks
 * reads the record - the address is said to be one of the project's own.
 */
export function describeAutomaticResponseProtection(data: {
  value: string;
  protection: SecurityAddressProtection;
}): string {
  const protection: SecurityAddressProtection =
    SECURITY_PROTECTED_RECORD_SOURCES.includes(data.protection.source)
      ? {
          ...data.protection,
          name: undefined,
          kind: undefined,
          where: undefined,
        }
      : data.protection;

  return describeSecurityAddressProtection({ value: data.value, protection });
}

// Who a signed-in check found, as a policy's record says it.
export function describeAutomaticResponseSignedIn(data: {
  value: string;
  users: ReadonlyArray<SecuritySignedInUser>;
}): string {
  const fromRequests: Array<string> = data.users
    .filter((user: SecuritySignedInUser): boolean => {
      return user.source === SecuritySignedInSource.Requests;
    })
    .map((user: SecuritySignedInUser): string => {
      return user.name;
    });
  const fromSignIns: Array<string> = data.users
    .filter((user: SecuritySignedInUser): boolean => {
      return user.source === SecuritySignedInSource.IdentityProvider;
    })
    .map((user: SecuritySignedInUser): string => {
      return user.name;
    });
  const parts: Array<string> = [];

  if (fromRequests.length > 0) {
    parts.push(
      `${describeSignedInUserNames(fromRequests)} on your app's requests`,
    );
  }

  if (fromSignIns.length > 0) {
    parts.push(
      `${describeSignedInUserNames(fromSignIns)} signing in through your identity provider`,
    );
  }

  return `A signed-in user used ${data.value} in the last 30 days: ${parts.join(", and ")}. An address someone signed in uses, such as an office's or a customer's, is never blocked automatically.`;
}

export default class SecurityAutomaticResponse {
  private static cache: OldestKeyMap<string, CachedPolicies> =
    new OldestKeyMap();

  // Forget a project's policies, or every project's: a policy changed, or a test.
  public static clearCache(projectId?: ObjectID): void {
    if (projectId) {
      this.cache.delete(projectId.toString());
      return;
    }

    this.cache.clear();
  }

  // The project's policies in their trial run or on, from the cache while it is fresh.
  public static async getActivePolicies(
    projectId: ObjectID,
  ): Promise<Array<SecurityAutomaticResponsePolicy>> {
    const key: string = projectId.toString();
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: CachedPolicies | undefined = this.cache.get(key);

    if (
      cached &&
      now - cached.loadedAtMs <
        SECURITY_AUTOMATIC_RESPONSE_POLICIES_CACHE_TTL_MS &&
      now >= cached.loadedAtMs
    ) {
      return cached.policies;
    }

    const policies: Array<SecurityAutomaticResponsePolicy> =
      await SecurityAutomaticResponsePolicyService.findActivePolicies(
        projectId,
      );

    this.cache.delete(key);

    while (
      this.cache.size >= SECURITY_AUTOMATIC_RESPONSE_POLICIES_CACHE_MAX_PROJECTS
    ) {
      const oldest: string | undefined = this.cache.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.cache.delete(oldest);
    }

    this.cache.set(key, { loadedAtMs: now, policies });

    return policies;
  }

  /*
   * As detections are recorded: each that a policy in its trial run or on
   * may act on gets a decision job. Cheap - what the policy matches, on the
   * facts the detection was recorded with; the job reads the rest. Returns
   * how many jobs were queued. Never throws: a detection is recorded
   * whatever a policy makes of it.
   */
  @CaptureSpan()
  public static async screen(data: {
    projectId: ObjectID;
    detections: Array<SecurityAutomaticResponseRecordedDetection>;
  }): Promise<number> {
    try {
      const detections: Array<SecurityAutomaticResponseRecordedDetection> =
        data.detections.filter(
          (detection: SecurityAutomaticResponseRecordedDetection): boolean => {
            return !detection.isSetupTest;
          },
        );

      if (detections.length === 0) {
        return 0;
      }

      const policies: Array<SecurityAutomaticResponsePolicy> =
        await this.getActivePolicies(data.projectId);

      if (policies.length === 0) {
        return 0;
      }

      let queued: number = 0;

      for (const detection of detections) {
        for (const policy of policies) {
          if (!policy.id) {
            continue;
          }

          const definition: SecurityAutomaticResponsePolicyDefinition =
            readSecurityAutomaticResponsePolicyDefinition(policy);

          // What only the job can read - outcomes so far, the project's feeds - is left to it.
          const screened: SecurityAutomaticResponseMatchResult =
            matchSecurityAutomaticResponseDetection({
              match: {
                ...definition.match,
                requiresEveryRequestTurnedAway: false,
              },
              facts: {
                source: detection.source,
                detectionRuleId: detection.detectionRuleId?.toString(),
                mitreTechniques: detection.mitreTechniques,
                groupValue: detection.groupValue,
                isThreatIntelListed: isListedByThreatIntelDetection(detection),
              },
            });

          if (!screened.matches) {
            continue;
          }

          await this.enqueue({
            projectId: data.projectId.toString(),
            securityAutomaticResponsePolicyId: policy.id.toString(),
            securityCaseId: detection.securityCaseId.toString(),
            securityDetectionId: detection.securityDetectionId.toString(),
            address: screened.address,
          });
          queued++;
        }
      }

      return queued;
    } catch (error) {
      logger.error(
        `SecurityAutomaticResponse: detections of project ${data.projectId.toString()} could not be screened:`,
      );
      logger.error(error);
      return 0;
    }
  }

  /*
   * A decision job, at once: one per policy and address a minute, however
   * many detections of the address arrive in it.
   */
  public static async enqueue(
    job: SecurityAutomaticResponseJobData,
  ): Promise<void> {
    const minute: number = Math.floor(
      OneUptimeDate.getCurrentDate().getTime() / 60000,
    );

    await Queue.addJob(
      QueueName.Worker,
      `security-automatic-response-${job.securityAutomaticResponsePolicyId}-${job.address}-${minute}`,
      SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB,
      job as unknown as JSONObject,
      { attempts: 1 },
    );
  }

  /*
   * A decision: under the project's lock, every guardrail in order, then
   * what the policy does. Null when there was nothing to decide - the
   * policy is off now, the address is blocked already or was decided about
   * lately, or the detection is not the policy's after all.
   */
  @CaptureSpan()
  public static async decide(
    job: SecurityAutomaticResponseJobData,
  ): Promise<SecurityAutomaticResponseDecision | null> {
    const projectId: ObjectID = new ObjectID(job.projectId);

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: projectId.toString(),
      namespace: "SecurityAutomaticResponse",
      lockTimeout: SECURITY_AUTOMATIC_RESPONSE_DECIDE_TIMEOUT_IN_MS,
      acquireTimeout: 60 * 1000,
    });

    try {
      return await this.decideLocked(projectId, job);
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.warn(
          `SecurityAutomaticResponse: could not give back project ${projectId.toString()}'s lock; it runs out by itself. ${String(error)}`,
        );
      }
    }
  }

  /*
   * Whether a block of the address is on its way on the case already: a
   * one-step run of Block Address on it - a person's from the case
   * (#10342), or OneUptime AI's as it works the case (#10352) - waiting
   * for its approval or running. The policy leaves the address to that
   * run, as it leaves one blocked already: a run of its own would be
   * refused beside it, and the block is coming.
   */
  private static async isBlockOnItsWay(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    address: string;
  }): Promise<boolean> {
    const keyOf: (value: string) => string = (value: string): string => {
      return (
        readSecurityBlockValue(value)?.value || value.trim().toLowerCase()
      );
    };
    const wanted: string = keyOf(data.address);

    const runs: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          securityPlaybookId: QueryHelper.isNull(),
          status: new Includes(UNFINISHED_SECURITY_PLAYBOOK_RUN_STATUSES),
        },
        select: {
          _id: true,
          securityPlaybookId: true,
          steps: true,
          stepResults: true,
        },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      });

    return runs.some((run: SecurityPlaybookRun): boolean => {
      const read: OneStepRunRead | null = readOneStepRun(run);

      return Boolean(
        read &&
          read.action === SecurityPlaybookActionType.BlockAddress &&
          read.values.some((value: string): boolean => {
            return keyOf(value) === wanted;
          }),
      );
    });
  }

  private static async decideLocked(
    projectId: ObjectID,
    job: SecurityAutomaticResponseJobData,
  ): Promise<SecurityAutomaticResponseDecision | null> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const policy: SecurityAutomaticResponsePolicy | null =
      await SecurityAutomaticResponsePolicyService.findOneBy({
        query: {
          _id: job.securityAutomaticResponsePolicyId,
          projectId,
        },
        select: {
          _id: true,
          kind: true,
          name: true,
          description: true,
          mode: true,
          blockAction: true,
          duration: true,
          matchConditions: true,
          turnedOnAt: true,
          turnedOnByUserId: true,
        },
        props: { isRoot: true },
      });

    if (
      !policy?.id ||
      (policy.mode !== SecurityAutomaticResponseMode.TrialRun &&
        policy.mode !== SecurityAutomaticResponseMode.On)
    ) {
      return null;
    }

    const isTrialRun: boolean =
      policy.mode === SecurityAutomaticResponseMode.TrialRun;
    const definition: SecurityAutomaticResponsePolicyDefinition =
      readSecurityAutomaticResponsePolicyDefinition(policy);
    const policyName: string = (policy.name || definition.name).trim();

    const detection: SecurityDetection | null =
      await SecurityDetectionService.findOneBy({
        query: { _id: job.securityDetectionId, projectId },
        select: {
          _id: true,
          title: true,
          source: true,
          detectionRuleId: true,
          mitreTechniques: true,
          groupValue: true,
          matchedEvents: true,
          firstSeenAt: true,
          securityCaseId: true,
        },
        props: { isRoot: true },
      });

    if (!detection?.securityCaseId) {
      return null;
    }

    const matched: SecurityDetectionMatchedEvents | null =
      readSecurityDetectionMatchedEvents(detection.matchedEvents);
    const source: SecurityDetectionSource =
      (detection.source as SecurityDetectionSource) ||
      SecurityDetectionSource.DetectionRule;
    const listed: boolean | null = isListedByThreatIntelDetection({ source });
    const isThreatIntelListed: boolean | null = definition.match
      .requiresThreatIntel
      ? listed === true
        ? true
        : await this.isListedByThreatIntel({
            projectId,
            address: job.address,
            now,
          })
      : listed;

    const result: SecurityAutomaticResponseMatchResult =
      matchSecurityAutomaticResponseDetection({
        match: definition.match,
        facts: {
          source,
          detectionRuleId: detection.detectionRuleId?.toString(),
          mitreTechniques: detection.mitreTechniques || [],
          groupValue: detection.groupValue,
          outcomes: matched?.outcomes,
          isThreatIntelListed,
          principalAddresses: getPrincipalAddresses(matched),
        },
      });

    if (!result.matches) {
      return null;
    }

    const address: string = result.address;

    if (
      await this.wasDecidedLately({
        policyId: policy.id,
        address,
        isTrialRun,
        now,
      })
    ) {
      return null;
    }

    const record: (data: {
      outcome: SecurityAutomaticResponseOutcome;
      duration?: SecurityBlockDuration | undefined;
      priorBlockCount?: number | undefined;
      detail?: string | undefined;
      pagedAt?: Date | undefined;
    }) => Promise<SecurityAutomaticResponseAction> = async (data: {
      outcome: SecurityAutomaticResponseOutcome;
      duration?: SecurityBlockDuration | undefined;
      priorBlockCount?: number | undefined;
      detail?: string | undefined;
      pagedAt?: Date | undefined;
    }): Promise<SecurityAutomaticResponseAction> => {
      const action: SecurityAutomaticResponseAction =
        new SecurityAutomaticResponseAction();
      action.projectId = projectId;
      action.securityAutomaticResponsePolicyId = policy.id!;
      action.policyName = policyName.slice(0, 100);
      action.securityCaseId = detection.securityCaseId!;
      action.value = address;
      action.outcome = data.outcome;
      action.isTrialRun = isTrialRun;
      action.blockAction = definition.blockAction;
      action.detectionTitle = (detection.title || "").slice(0, 100);

      const firstRequestAt: Date | null = getFirstRequestAt({
        matched,
        firstSeenAt: detection.firstSeenAt,
      });

      if (firstRequestAt) {
        action.firstRequestAt = firstRequestAt;
      }

      if (data.duration) {
        action.duration = data.duration;
      }

      if (data.priorBlockCount !== undefined) {
        action.priorBlockCount = data.priorBlockCount;
      }

      if (data.detail) {
        action.detail = data.detail;
      }

      if (data.pagedAt) {
        action.pagedAt = data.pagedAt;
      }

      return await SecurityAutomaticResponseActionService.create({
        data: action,
        props: { isRoot: true },
      });
    };

    const spare: (data: {
      outcome: SecurityAutomaticResponseOutcome;
      detail: string;
    }) => Promise<SecurityAutomaticResponseDecision> = async (data: {
      outcome: SecurityAutomaticResponseOutcome;
      detail: string;
    }): Promise<SecurityAutomaticResponseDecision> => {
      const action: SecurityAutomaticResponseAction = await record(data);

      await this.writeTimeline({
        projectId,
        securityCaseId: detection.securityCaseId!,
        markdown: automaticResponseSparedMarkdown({
          address,
          policyName,
          detail: data.detail,
          isTrialRun,
        }),
        color: Gray500,
      });

      return {
        outcome: data.outcome,
        address,
        isTrialRun,
        duration: null,
        detail: data.detail,
        securityAutomaticResponseActionId: action.id || null,
        securityPlaybookRunId: null,
      };
    };

    // Never a protected or own address (#10338), nor one blocked already.
    const check: Awaited<ReturnType<(typeof SecurityBlockService)["check"]>> =
      await SecurityBlockService.check({
        projectId,
        value: address,
        props: { isRoot: true },
      });

    if (check.problem || !check.value) {
      logger.warn(
        `SecurityAutomaticResponse: policy ${policy.id.toString()} found ${address} unblockable: ${check.problem || "not an address"}`,
      );
      return null;
    }

    if (check.coveredBy) {
      return null;
    }

    // Nor one whose block is on its way on the case already.
    if (
      await this.isBlockOnItsWay({
        projectId,
        securityCaseId: detection.securityCaseId,
        address: check.value.value,
      })
    ) {
      return null;
    }

    if (check.protection?.protection) {
      return await spare({
        outcome: SecurityAutomaticResponseOutcome.SparedProtected,
        detail: describeAutomaticResponseProtection({
          value: address,
          protection: check.protection.protection,
        }),
      });
    }

    if (check.protection && check.protection.unreadSources.length > 0) {
      return await spare({
        outcome: SecurityAutomaticResponseOutcome.SparedCannotTell,
        detail: SECURITY_BLOCK_MESSAGES.checkFailed({ value: address }),
      });
    }

    // Never an address a signed-in user used in the last 30 days.
    const signedIn: SecuritySignedInAddressCheck =
      await SecuritySignedInAddresses.check({
        projectId,
        value: address,
        now,
      });

    if (signedIn.state === SecuritySignedInAddressState.SignedIn) {
      return await spare({
        outcome: SecurityAutomaticResponseOutcome.SparedSignedIn,
        detail: describeAutomaticResponseSignedIn({
          value: address,
          users: signedIn.users,
        }),
      });
    }

    if (signedIn.state === SecuritySignedInAddressState.CannotTell) {
      return await spare({
        outcome: SecurityAutomaticResponseOutcome.SparedCannotTell,
        detail: signedIn.reason,
      });
    }

    // Repeat offenders get longer blocks.
    let priorBlockCount: number = 0;

    try {
      priorBlockCount = (
        await SecurityRepeatOffenders.read({ projectId, value: address, now })
      ).offenceCount;
    } catch (error) {
      // The shortest length is the safe one: an address that never offended is blocked for it.
      logger.warn(
        `SecurityAutomaticResponse: could not read how often ${address} was blocked before; its block is the policy's first length. ${String(error)}`,
      );
    }

    const duration: SecurityBlockDuration = getSecurityRepeatOffenderDuration({
      firstDuration: definition.duration,
      offenceCount: priorBlockCount,
    });

    // At most 50 automatic blocks an hour per project.
    if (
      (await this.countBlocksThisHour({
        projectId,
        policyId: policy.id,
        isTrialRun,
        now,
      })) >= SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR
    ) {
      const wasPaged: boolean = isTrialRun
        ? false
        : await this.pageAtLimit({
            projectId,
            policyName,
            address,
            securityCaseId: detection.securityCaseId,
            now,
          });
      const action: SecurityAutomaticResponseAction = await record({
        outcome: SecurityAutomaticResponseOutcome.StoppedAtLimit,
        duration,
        priorBlockCount,
        detail: isTrialRun
          ? `The project's policies would have made ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR} automatic blocks in the last hour, the most they make in an hour.`
          : `The project's policies made ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR} automatic blocks in the last hour, the most they make in an hour.`,
        ...(wasPaged ? { pagedAt: now } : {}),
      });

      await this.writeTimeline({
        projectId,
        securityCaseId: detection.securityCaseId,
        markdown: automaticResponseLimitMarkdown({
          action: definition.blockAction,
          address,
          policyName,
          limit: SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
          wasPaged:
            wasPaged || (await this.wasPagedThisHour({ projectId, now })),
          isTrialRun,
        }),
        color: Yellow500,
      });

      return {
        outcome: SecurityAutomaticResponseOutcome.StoppedAtLimit,
        address,
        isTrialRun,
        duration,
        detail: action.detail || null,
        securityAutomaticResponseActionId: action.id || null,
        securityPlaybookRunId: null,
      };
    }

    const outcome: SecurityAutomaticResponseOutcome =
      definition.blockAction === SecurityBlockAction.Challenge
        ? SecurityAutomaticResponseOutcome.Challenged
        : SecurityAutomaticResponseOutcome.Blocked;

    // A trial run records what it would have done, and does nothing else.
    if (isTrialRun) {
      const action: SecurityAutomaticResponseAction = await record({
        outcome,
        duration,
        priorBlockCount,
      });

      await this.writeTimeline({
        projectId,
        securityCaseId: detection.securityCaseId,
        markdown: automaticResponseTrialMarkdown({
          action: definition.blockAction,
          address,
          duration,
          policyName,
          priorBlockCount,
        }),
        color: Indigo500,
      });

      return {
        outcome,
        address,
        isTrialRun,
        duration,
        detail: null,
        securityAutomaticResponseActionId: action.id || null,
        securityPlaybookRunId: null,
      };
    }

    // On: the block, through the engine, as a person's block from a case is.
    const action: SecurityAutomaticResponseAction = await record({
      outcome,
      duration,
      priorBlockCount,
    });

    let run: SecurityPlaybookRun;

    try {
      run = await SecurityPlaybookRunService.startOneStepRun({
        projectId,
        securityCaseId: detection.securityCaseId,
        automaticResponsePolicyId: policy.id,
        policyName,
        step: buildAutomaticResponseStep({
          blockAction: definition.blockAction,
          duration,
          turnedOnByUserId: policy.turnedOnByUserId,
          turnedOnAt: policy.turnedOnAt,
          now,
        }),
        targets: [
          {
            type: SecurityEntityType.IpAddress,
            value: address,
            reason: SecurityPlaybookTargetReason.GroupedOn,
            state: SecurityPlaybookTargetState.Proposed,
          },
        ],
      });
    } catch (error) {
      const detail: string =
        error instanceof Error && error.message
          ? error.message
          : "The block could not be started.";

      await SecurityAutomaticResponseActionService.updateOneById({
        id: action.id!,
        data: {
          outcome: SecurityAutomaticResponseOutcome.Failed,
          detail,
        },
        props: { isRoot: true },
      });

      await this.writeTimeline({
        projectId,
        securityCaseId: detection.securityCaseId,
        markdown: automaticResponseSparedMarkdown({
          address,
          policyName,
          detail,
          isTrialRun,
        }),
        color: Red500,
      });

      return {
        outcome: SecurityAutomaticResponseOutcome.Failed,
        address,
        isTrialRun,
        duration,
        detail,
        securityAutomaticResponseActionId: action.id || null,
        securityPlaybookRunId: null,
      };
    }

    if (run.id && action.id) {
      await SecurityAutomaticResponseActionService.updateOneById({
        id: action.id,
        data: { securityPlaybookRunId: run.id },
        props: { isRoot: true },
      });
    }

    return {
      outcome,
      address,
      isTrialRun,
      duration,
      detail: null,
      securityAutomaticResponseActionId: action.id || null,
      securityPlaybookRunId: run.id || null,
    };
  }

  // Whether the project's threat intel lists an address right now.
  private static async isListedByThreatIntel(data: {
    projectId: ObjectID;
    address: string;
    now: Date;
  }): Promise<boolean> {
    try {
      const indicators: Array<unknown> =
        await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
          projectId: data.projectId,
          values: [data.address.trim().toLowerCase()],
          now: data.now,
        });

      return indicators.length > 0;
    } catch (error) {
      // Not known to be listed: a policy that waits for threat intel waits.
      logger.warn(
        `SecurityAutomaticResponse: could not read project ${data.projectId.toString()}'s threat intel for ${data.address}: ${String(error)}`,
      );
      return false;
    }
  }

  /*
   * Whether the policy decided about the address lately, so it is left as
   * it is: a block it made, or would have made, still in force; an address
   * a guardrail spared within the hour (ten minutes when it could not
   * tell). A trial run and the policy on are told apart.
   */
  private static async wasDecidedLately(data: {
    policyId: ObjectID;
    address: string;
    isTrialRun: boolean;
    now: Date;
  }): Promise<boolean> {
    const latest: SecurityAutomaticResponseAction | null =
      await SecurityAutomaticResponseActionService.findOneBy({
        query: {
          securityAutomaticResponsePolicyId: data.policyId,
          value: data.address,
          isTrialRun: data.isTrialRun,
        },
        select: { _id: true, createdAt: true, outcome: true, duration: true },
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      });

    if (!latest?.createdAt) {
      return false;
    }

    const age: number =
      data.now.getTime() - new Date(latest.createdAt).getTime();

    if (isSecurityAutomaticResponseActedOutcome(latest.outcome)) {
      return age < durationInMs(latest.duration);
    }

    if (latest.outcome === SecurityAutomaticResponseOutcome.Failed) {
      return age < SECURITY_AUTOMATIC_RESPONSE_CANNOT_TELL_AGAIN_AFTER_MS;
    }

    return (
      age <
      (latest.outcome === SecurityAutomaticResponseOutcome.SparedCannotTell
        ? SECURITY_AUTOMATIC_RESPONSE_CANNOT_TELL_AGAIN_AFTER_MS
        : SECURITY_AUTOMATIC_RESPONSE_SPARED_AGAIN_AFTER_MS)
    );
  }

  /*
   * The automatic blocks of the last hour the limit counts: the project's
   * policies' blocks, and - for a policy in its trial run - the blocks it
   * would have made too, as if it were on.
   */
  public static async countBlocksThisHour(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    isTrialRun: boolean;
    now: Date;
  }): Promise<number> {
    const since: Date = new Date(
      data.now.getTime() - SECURITY_AUTOMATIC_RESPONSE_LIMIT_WINDOW_IN_MS,
    );
    const live: number = (
      await SecurityAutomaticResponseActionService.countBy({
        query: {
          projectId: data.projectId,
          isTrialRun: false,
          outcome: new Includes([
            ...SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
          ]),
          createdAt: QueryHelper.greaterThanEqualTo(since),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (!data.isTrialRun) {
      return live;
    }

    const wouldHave: number = (
      await SecurityAutomaticResponseActionService.countBy({
        query: {
          securityAutomaticResponsePolicyId: data.policyId,
          isTrialRun: true,
          outcome: new Includes([
            ...SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
          ]),
          createdAt: QueryHelper.greaterThanEqualTo(since),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return live + wouldHave;
  }

  // Whether the project's security owners were paged about the limit in the last hour.
  private static async wasPagedThisHour(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<boolean> {
    const paged: number = (
      await SecurityAutomaticResponseActionService.countBy({
        query: {
          projectId: data.projectId,
          outcome: SecurityAutomaticResponseOutcome.StoppedAtLimit,
          isTrialRun: false,
          pagedAt: QueryHelper.greaterThanEqualTo(
            new Date(
              data.now.getTime() -
                SECURITY_AUTOMATIC_RESPONSE_LIMIT_WINDOW_IN_MS,
            ),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return paged > 0;
  }

  /*
   * The page at the limit, once an hour a project: the first time its
   * policies stop, its security owners are paged; until an hour has passed
   * since, the next stops say they were.
   */
  private static async pageAtLimit(data: {
    projectId: ObjectID;
    policyName: string;
    address: string;
    securityCaseId: ObjectID;
    now: Date;
  }): Promise<boolean> {
    if (await this.wasPagedThisHour(data)) {
      return false;
    }

    return await SecurityAutomaticResponseOwners.page({
      projectId: data.projectId,
      title: `Automatic response stopped: ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR} blocks in the last hour`,
      descriptionInMarkdown: [
        `Your automatic response policies made ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR} blocks in the last hour, the most they make in an hour, so they stopped blocking. An attack this large needs a person.`,
        ``,
        `The ${data.policyName} policy did not act on \`${data.address}\`. Open Security Events -> Playbooks -> Automatic Response to see what the policies did, and the case to block addresses by hand.`,
      ].join("\n"),
    });
  }

  // One line on the case's timeline. Never throws.
  private static async writeTimeline(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    markdown: MarkdownText;
    color: typeof Gray500;
  }): Promise<void> {
    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown: data.markdown.toString(),
      eventType: SecurityCaseFeedEventType.ResponseAction,
      displayColor: data.color,
    });
  }
}

/*
 * The step a policy's block is: Block the address, as the policy says and
 * for the ladder's length, with nobody's approval to wait for - the project
 * turned the policy on, and the step says who and when, as a playbook's
 * step a Security Admin let run without approval says it.
 */
export function buildAutomaticResponseStep(data: {
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
  turnedOnByUserId?: ObjectID | null | undefined;
  turnedOnAt?: Date | null | undefined;
  now: Date;
}): SecurityPlaybookStep {
  return {
    id: ObjectID.generate().toString(),
    action: SecurityPlaybookActionType.BlockAddress,
    config: {
      blockAction: data.blockAction,
      duration: data.duration,
    },
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    approvalTurnedOff: {
      ...(data.turnedOnByUserId
        ? { byUserId: data.turnedOnByUserId.toString() }
        : {}),
      at: (data.turnedOnAt
        ? new Date(data.turnedOnAt)
        : data.now
      ).toISOString(),
    },
  };
}

// The verified client addresses of a detection's kept events, as blocks are written.
export function getPrincipalAddresses(
  matched: SecurityDetectionMatchedEvents | null,
): Array<string> {
  const addresses: Set<string> = new Set();

  for (const event of matched?.events || []) {
    const read: SecurityBlockValue | null = readSecurityBlockValue(
      event.principalIp,
    );

    if (read) {
      addresses.add(read.value);
    }
  }

  return Array.from(addresses);
}

/*
 * When the address's first request of the detection happened: the earliest
 * event the detection kept, or - when it kept none - when it was first
 * seen.
 */
export function getFirstRequestAt(data: {
  matched: SecurityDetectionMatchedEvents | null;
  firstSeenAt?: Date | string | null | undefined;
}): Date | null {
  let earliest: number | null = null;

  for (const event of data.matched?.events || []) {
    const time: number = new Date(
      (event as SecurityDetectionMatchedEvent).time,
    ).getTime();

    if (Number.isFinite(time) && (earliest === null || time < earliest)) {
      earliest = time;
    }
  }

  if (earliest !== null) {
    return new Date(earliest);
  }

  if (data.firstSeenAt) {
    const firstSeen: Date = new Date(data.firstSeenAt);

    return Number.isFinite(firstSeen.getTime()) ? firstSeen : null;
  }

  return null;
}
