import SecurityAutomaticResponseAction from "../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityAutomaticResponsePolicy from "../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_AUTOMATIC_RESPONSE_LIMIT_WINDOW_IN_MS,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_READY_KINDS,
  SecurityAutomaticResponseTrialState,
  getSecurityAutomaticResponseTrialDaysLeft,
  getSecurityAutomaticResponseTrialState,
  readSecurityAutomaticResponseMatch,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
  SECURITY_AUTOMATIC_RESPONSE_SPARED_OUTCOMES,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SecurityAutomaticResponseTimeToBlock,
  SecurityAutomaticResponseTrialSummary,
  summarizeSecurityAutomaticResponseTrial,
  summarizeTimeToBlock,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseSummary";
import { canSecurityBlockDestinationChallenge } from "../../../Types/SecurityBlocklist/SecurityBlockChallenge";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityAutomaticResponseActionService from "../../Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../Services/SecurityAutomaticResponsePolicyService";
import logger from "../Logger";
import SecurityBlockDestination from "../SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "../SecurityBlocklist/SecurityBlockDestinations";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityAutomaticResponseRules, {
  SecurityAutomaticResponseRule,
} from "./SecurityAutomaticResponseRules";

/*
 * THE AUTOMATIC RESPONSE PAGE, READ (#10350): every policy of the project -
 * the three ready ones first, made Off the first time they are read - with
 * where its trial run stands and what it would have done, its time to
 * block (50th and 95th percentiles, day by day, over 30 days), what it did
 * in the last week, the rules it acts on and whether each runs in real
 * time; the destinations that enforce the blocklist and whether each can
 * challenge; and how many of the hour's automatic blocks are taken.
 *
 * The policies are read as the reader, so a reader who may not read them
 * reads none; what they did is read as OneUptime for those policies alone.
 */

// The window time to block is shown over.
export const SECURITY_AUTOMATIC_RESPONSE_TIME_TO_BLOCK_DAYS: number = 30;

// The most actions one summary reads.
export const SECURITY_AUTOMATIC_RESPONSE_SUMMARY_ROWS: number = 20000;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// The ready policies first, in their order, then the project's own, oldest first.
export function sortSecurityAutomaticResponsePolicies(
  policies: Array<SecurityAutomaticResponsePolicy>,
): Array<SecurityAutomaticResponsePolicy> {
  const rank: (policy: SecurityAutomaticResponsePolicy) => number = (
    policy: SecurityAutomaticResponsePolicy,
  ): number => {
    const index: number = (
      SECURITY_AUTOMATIC_RESPONSE_READY_KINDS as ReadonlyArray<string>
    ).indexOf(policy.kind || "");

    return index === -1
      ? SECURITY_AUTOMATIC_RESPONSE_READY_KINDS.length
      : index;
  };

  return [...policies].sort(
    (
      a: SecurityAutomaticResponsePolicy,
      b: SecurityAutomaticResponsePolicy,
    ): number => {
      return (
        rank(a) - rank(b) ||
        new Date(a.createdAt || 0).getTime() -
          new Date(b.createdAt || 0).getTime()
      );
    },
  );
}

export default class SecurityAutomaticResponseOverview {
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<JSONObject> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    await SecurityAutomaticResponsePolicyService.ensureReadyPolicies(
      data.projectId,
    );

    const policies: Array<SecurityAutomaticResponsePolicy> =
      sortSecurityAutomaticResponsePolicies(
        await SecurityAutomaticResponsePolicyService.findBy({
          query: { projectId: data.projectId },
          select: {
            _id: true,
            kind: true,
            name: true,
            description: true,
            mode: true,
            blockAction: true,
            duration: true,
            matchConditions: true,
            trialStartedAt: true,
            trialEndsAt: true,
            trialFinishedAt: true,
            trialSkippedAt: true,
            turnedOnAt: true,
            createdAt: true,
            turnedOnByUser: { _id: true, name: true, email: true },
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: data.props,
        }),
      );

    const policiesJson: Array<JSONObject> = [];

    for (const policy of policies) {
      policiesJson.push(await this.readPolicy({ ...data, policy, now }));
    }

    const [destinations, blocksThisHour]: [Array<JSONObject>, number] =
      await Promise.all([
        this.readDestinations(data.projectId),
        SecurityAutomaticResponseActionService.countBy({
          query: {
            projectId: data.projectId,
            isTrialRun: false,
            outcome: new Includes([
              ...SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
            ]),
            createdAt: QueryHelper.greaterThanEqualTo(
              new Date(
                now.getTime() - SECURITY_AUTOMATIC_RESPONSE_LIMIT_WINDOW_IN_MS,
              ),
            ),
          },
          props: { isRoot: true },
        }).then((count: { toNumber: () => number }): number => {
          return count.toNumber();
        }),
      ]);

    return {
      policies: policiesJson,
      destinations,
      blocksThisHour,
      maxBlocksPerHour: SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
    };
  }

  private static async readPolicy(data: {
    projectId: ObjectID;
    policy: SecurityAutomaticResponsePolicy;
    now: Date;
  }): Promise<JSONObject> {
    const { policy, now } = data;
    const policyId: ObjectID = policy.id!;
    const trialState: SecurityAutomaticResponseTrialState =
      getSecurityAutomaticResponseTrialState(policy, now);

    const [trialSummary, timeToBlock, lastWeek, rules]: [
      SecurityAutomaticResponseTrialSummary | null,
      SecurityAutomaticResponseTimeToBlock,
      { acted: number; spared: number },
      Array<SecurityAutomaticResponseRule>,
    ] = await Promise.all([
      this.readTrialSummary({ policy, now }),
      this.readTimeToBlock({ policyId, now }),
      this.readLastWeek({ policyId, now }),
      SecurityAutomaticResponseRules.read({
        projectId: data.projectId,
        kind: policy.kind,
      }),
    ]);

    return {
      _id: policyId.toString(),
      kind: policy.kind || null,
      name: policy.name || "",
      description: policy.description || "",
      mode: policy.mode || null,
      blockAction: policy.blockAction || null,
      duration: policy.duration || null,
      matchConditions: readSecurityAutomaticResponseMatch(
        policy.matchConditions,
      ) as unknown as JSONObject,
      trialStartedAt: iso(policy.trialStartedAt),
      trialEndsAt: iso(policy.trialEndsAt),
      trialFinishedAt: iso(policy.trialFinishedAt),
      trialSkippedAt: iso(policy.trialSkippedAt),
      turnedOnAt: iso(policy.turnedOnAt),
      turnedOnBy:
        policy.turnedOnByUser?.name?.toString() ||
        policy.turnedOnByUser?.email?.toString() ||
        null,
      trialState,
      trialDaysLeft: getSecurityAutomaticResponseTrialDaysLeft(policy, now),
      trialSummary: trialSummary as unknown as JSONObject,
      timeToBlock: timeToBlock as unknown as JSONObject,
      lastWeek: lastWeek as unknown as JSONObject,
      rules: rules as unknown as Array<JSONObject>,
    };
  }

  // What the policy's trial run would have done, over its week (or so far); null before it ever ran one.
  private static async readTrialSummary(data: {
    policy: SecurityAutomaticResponsePolicy;
    now: Date;
  }): Promise<SecurityAutomaticResponseTrialSummary | null> {
    const { policy } = data;

    if (!policy.trialStartedAt || !policy.id) {
      return null;
    }

    const from: Date = new Date(policy.trialStartedAt);
    const to: Date = new Date(
      Math.min(
        data.now.getTime(),
        new Date(
          policy.trialFinishedAt || policy.trialEndsAt || data.now,
        ).getTime() + DAY_IN_MS,
      ),
    );

    const rows: Array<SecurityAutomaticResponseAction> =
      await SecurityAutomaticResponseActionService.findBy({
        query: {
          securityAutomaticResponsePolicyId: policy.id,
          isTrialRun: true,
          createdAt: QueryHelper.inBetween(from, to),
        },
        select: { _id: true, value: true, outcome: true, doubtSeenAt: true },
        skip: 0,
        limit: SECURITY_AUTOMATIC_RESPONSE_SUMMARY_ROWS,
        props: { isRoot: true },
      });

    return summarizeSecurityAutomaticResponseTrial(rows);
  }

  // Time to block of the policy's blocks that took hold in the last 30 days.
  private static async readTimeToBlock(data: {
    policyId: ObjectID;
    now: Date;
  }): Promise<SecurityAutomaticResponseTimeToBlock> {
    const rows: Array<SecurityAutomaticResponseAction> =
      await SecurityAutomaticResponseActionService.findBy({
        query: {
          securityAutomaticResponsePolicyId: data.policyId,
          isTrialRun: false,
          appliedAt: QueryHelper.greaterThanEqualTo(
            new Date(
              data.now.getTime() -
                SECURITY_AUTOMATIC_RESPONSE_TIME_TO_BLOCK_DAYS * DAY_IN_MS,
            ),
          ),
        },
        select: { _id: true, appliedAt: true, timeToBlockInSeconds: true },
        sort: { appliedAt: SortOrder.Ascending },
        skip: 0,
        limit: SECURITY_AUTOMATIC_RESPONSE_SUMMARY_ROWS,
        props: { isRoot: true },
      });

    return summarizeTimeToBlock({
      rows,
      now: data.now,
      days: SECURITY_AUTOMATIC_RESPONSE_TIME_TO_BLOCK_DAYS,
    });
  }

  // What the policy did in the last 7 days, on: blocks made, and addresses a guardrail spared.
  private static async readLastWeek(data: {
    policyId: ObjectID;
    now: Date;
  }): Promise<{ acted: number; spared: number }> {
    const since: Date = new Date(data.now.getTime() - 7 * DAY_IN_MS);
    const [acted, spared]: Array<number> = await Promise.all(
      [
        SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES,
        SECURITY_AUTOMATIC_RESPONSE_SPARED_OUTCOMES,
      ].map(async (outcomes: ReadonlyArray<string>): Promise<number> => {
        return (
          await SecurityAutomaticResponseActionService.countBy({
            query: {
              securityAutomaticResponsePolicyId: data.policyId,
              isTrialRun: false,
              outcome: new Includes([...outcomes]),
              createdAt: QueryHelper.greaterThanEqualTo(since),
            },
            props: { isRoot: true },
          })
        ).toNumber();
      }),
    );

    return { acted: acted || 0, spared: spared || 0 };
  }

  // The destinations that enforce the blocklist, and whether each can challenge.
  private static async readDestinations(
    projectId: ObjectID,
  ): Promise<Array<JSONObject>> {
    try {
      const found: SecurityBlockDestinationsFound =
        await SecurityBlockDestinations.findForProject(projectId);

      return found.destinations.map(
        (destination: SecurityBlockDestination): JSONObject => {
          return {
            name: destination.name,
            provider: destination.provider,
            canChallenge: canSecurityBlockDestinationChallenge(destination),
          };
        },
      );
    } catch (error) {
      logger.warn(
        `SecurityAutomaticResponseOverview: could not list project ${projectId.toString()}'s blocklist destinations: ${String(error)}`,
      );
      return [];
    }
  }
}
